// Fetches an image from a web address someone typed in. The server would otherwise fetch anything
// on their behalf, including addresses only it can reach, and hand the result back as an upload.
//
// Refused: anything but http(s) on ports 80 and 443; private, loopback and link-local addresses,
// checked when the connection is made so a name cannot resolve safely and then change; redirects
// to such addresses; more than 8 MB; anything whose bytes are not a real image.

const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const { detectImageExtension, maxFileSize } = require('../middleware/upload');

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10 * 1000;

const blocked = new net.BlockList();
for (const [address, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
]) blocked.addSubnet(address, prefix, 'ipv4');
blocked.addAddress('::', 'ipv6');
blocked.addAddress('::1', 'ipv6');
for (const [address, prefix] of [['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96]]) {
    blocked.addSubnet(address, prefix, 'ipv6');
}

function isBlockedAddress(ip) {
    const family = net.isIP(ip);
    if (!family) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return isBlockedAddress(mapped[1]);
    return blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

// Used by the connection itself, so what is checked is what gets connected to.
function safeLookup(hostname, options, callback) {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err);
        if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) {
            return callback(new Error('Address not allowed'));
        }
        if (options.all) return callback(null, addresses);
        return callback(null, addresses[0].address, addresses[0].family);
    });
}

function fetchOnce(url) {
    return new Promise((resolve, reject) => {
        const client = url.protocol === 'https:' ? https : http;
        const req = client.get(url, { lookup: safeLookup, agent: false, timeout: TIMEOUT_MS }, (res) => {
            const { statusCode, headers } = res;
            if (statusCode >= 300 && statusCode < 400 && headers.location) {
                res.resume();
                return resolve({ redirect: headers.location });
            }
            if (statusCode !== 200) {
                res.resume();
                return reject(new Error(`Status ${statusCode}`));
            }
            const chunks = [];
            let size = 0;
            res.on('data', (chunk) => {
                size += chunk.length;
                if (size > maxFileSize) return req.destroy(new Error('Too large'));
                chunks.push(chunk);
            });
            res.on('end', () => resolve({ buffer: Buffer.concat(chunks) }));
            res.on('error', reject);
        });
        req.on('timeout', () => req.destroy(new Error('Timed out')));
        req.on('error', reject);
    });
}

function checkUrl(value, base) {
    const url = new URL(value, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Scheme not allowed');
    if (url.username || url.password) throw new Error('Credentials not allowed');
    if (url.port && url.port !== '80' && url.port !== '443') throw new Error('Port not allowed');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    // A literal address never reaches the lookup above
    if (net.isIP(host) && isBlockedAddress(host)) throw new Error('Address not allowed');
    return url;
}

// Returns { buffer, ext } for a real image, or null when it is refused or fails.
async function fetchRemoteImage(remoteUrl) {
    try {
        let url = checkUrl(remoteUrl);
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            const result = await fetchOnce(url);
            if (result.redirect) {
                url = checkUrl(result.redirect, url);
                continue;
            }
            const ext = detectImageExtension(result.buffer);
            return ext ? { buffer: result.buffer, ext } : null;
        }
        return null;
    } catch (err) {
        console.warn('Remote image refused:', err.message);
        return null;
    }
}

module.exports = { fetchRemoteImage, isBlockedAddress, checkUrl };
