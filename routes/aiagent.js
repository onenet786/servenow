// AIAgent assistant: widget settings for our pages, the manifest AIAgent connects from, and the signed tool
// endpoint. The tool endpoint is called by the AIAgent server, not by browsers: every call must be signed
// (X-AIAgent-Signature: sha256=HMAC(AIAGENT_TOOL_SECRET, raw body)) and is answered for the signed-in
// person in its identity token, or as a visitor when there is none.
const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const ai = require('../services/aiagent');

const router = express.Router();
const hits = new Map(); // ip -> { n, at }
const PER_MINUTE = 120;
const MAX_SKEW_SECONDS = 300;

function limited(ip) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.at > 60_000) { hits.set(ip, { n: 1, at: now }); return false; }
  h.n += 1;
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.at > 60_000) hits.delete(k);
  return h.n > PER_MINUTE;
}

function signatureOk(raw, header, secret) {
  if (!secret || typeof header !== 'string') return false;
  const want = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  return header.length === want.length && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(want));
}

// The ServeNow account behind a page's own login token, as it is now (null for guests and visitors).
async function pageAccount(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  let user;
  try {
    user = jwt.verify(token, process.env.JWT_SECRET);
  } catch (_) {
    return null;
  }
  if (!user || user.is_guest || user.user_type === 'guest' || !Number.isInteger(Number(user.id))) return null;
  const account = await ai.loadAccount(req.db, `${user.user_type === 'rider' ? 'r' : 'u'}${Number(user.id)}`);
  return account && account.user_type === user.user_type ? account : null;
}

// What a page needs to show the chat button. The identity token is only for the signed-in person.
router.get('/api/aiagent/widget', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const s = ai.settings();
  if (!s.url || !s.channelKey) return res.json({ enabled: false });
  const out = { enabled: true, src: `${s.url}/api/widget.js`, key: s.channelKey };
  try {
    const account = s.identitySecret ? await pageAccount(req) : null;
    if (account) {
      out.identity = ai.mintIdentity(account, s.identitySecret);
      out.scope = ai.scopeFor(account, s.identitySecret);
      out.expires_in = ai.TOKEN_TTL_SECONDS;
    }
  } catch (err) {
    console.error('[aiagent] identity failed:', err.message);
  }
  res.json(out);
});

// Manifest for AIAgent's "Connect a system": type this site's address in AIAgent -> Tools and it sets up the
// read-only tools by itself. Holds no ServeNow data, only tool names and descriptions.
router.get('/.well-known/aiagent.json', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(ai.manifest());
});

router.post('/integrations/aiagent/tools', express.raw({ type: () => true, limit: '64kb' }), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (limited(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    const s = ai.settings();
    if (!s.toolSecret) return res.status(503).json({ error: 'disabled', message: 'The ServeNow assistant is switched off.' });
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!signatureOk(raw, req.get('x-aiagent-signature'), s.toolSecret)) return res.status(401).json({ error: 'bad_signature' });

    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch (_) { return res.status(400).json({ error: 'bad_json' }); }
    // sent_at is inside the signed body, so a captured request can only be replayed within this window.
    if (!Number.isInteger(body.sent_at) || Math.abs(Date.now() / 1000 - body.sent_at) > MAX_SKEW_SECONDS) {
      return res.status(401).json({ error: 'stale_request' });
    }
    if (body.test) return res.json({ ok: true, message: 'Test call received and signature verified.' });

    const tool = String(body.tool || req.get('x-aiagent-tool') || '');
    // Without a valid token (none, expired after a few hours, or signed out) the caller is a visitor.
    const user = await ai.verifyIdentity(req.db, body.identity, s.identitySecret);
    res.json(await ai.runTool(req.db, tool, body.arguments, user));
  } catch (err) {
    const ref = crypto.randomBytes(4).toString('hex');
    console.error(`[aiagent ${ref}]`, err);
    res.status(500).json({ error: 'internal', message: `ServeNow could not answer right now (reference ${ref}).` });
  }
});

module.exports = router;
