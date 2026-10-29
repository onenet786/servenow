#!/usr/bin/env node
// ServeNow Flutter-web screenshot tool.
//
// Serves a Flutter web build, seeds a signed-in session per role (no password
// is used or changed), drives headless Chrome over the DevTools protocol, and
// walks the scenarios in scenarios.mjs, saving <out>/<role>/NN_<screen>.png.
//
// Usage (from mobile_app/):
//   node tool/screenshots/capture.mjs --out ../docs/app-screens/before \
//        --api http://127.0.0.1:3098 --jwt-secret-file <file> [--roles guest,customer] \
//        [--only 03_store] [--build build/web_screens] [--port 8090]
//   node tool/screenshots/capture.mjs --dump customer --steps "tap:My Orders"   (print semantics labels)
//
// Node >= 22 (global fetch/WebSocket). jsonwebtoken is resolved from the repo
// root node_modules (D:/GIT-HUB/servenow/node_modules).
//
// Safety: every non-GET request the app makes to the API is blocked by Chrome
// request interception, so a capture run can never write to the database.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ROLES, SCENARIOS } from './scenarios.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..', '..');
const REPO_DIR = path.resolve(APP_DIR, '..');

// ---------------------------------------------------------------- args
function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const key = k.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) a[key] = true;
    else { a[key] = next; i++; }
  }
  return a;
}
const args = parseArgs(process.argv);
const OUT = path.resolve(args.out || path.join(REPO_DIR, 'docs', 'app-screens', 'before'));
const API = (args.api || process.env.SERVENOW_API_BASE_URL || 'http://127.0.0.1:3099').replace(/\/+$/, '');
const BUILD = path.resolve(APP_DIR, args.build || 'build/web_screens');
const PORT = Number(args.port || 8090);
const APP_URL = `http://127.0.0.1:${PORT}/`;
const ROLE_FILTER = args.roles ? String(args.roles).split(',') : null;
const ONLY = args.only ? String(args.only).split(',') : null;
const VERBOSE = !!args.verbose;
const CHROME = args.chrome || findChrome();
const GEO = String(args.geo || '30.4686,70.9661').split(',').map(Number);
const IMAGES_FROM = args['images-from'] === 'none' ? '' : String(args['images-from'] || 'https://servenow.pk').replace(/\/+$/, '');

function readSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET.trim();
  const f = args['jwt-secret-file'];
  if (!f) throw new Error('Pass --jwt-secret-file <file> or set JWT_SECRET (must match the backend).');
  return fs.readFileSync(f, 'utf8').trim();
}

function findChrome() {
  const c = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return c.find((p) => fs.existsSync(p)) || 'chrome';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- static server
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.css': 'text/css', '.ico': 'image/x-icon', '.bin': 'application/octet-stream', '.frag': 'text/plain' };
function startStatic() {
  if (!fs.existsSync(path.join(BUILD, 'index.html'))) throw new Error(`No web build at ${BUILD}. See README.`);
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, APP_URL).pathname);
    let f = path.join(BUILD, p);
    if (!f.startsWith(BUILD) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(BUILD, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(PORT, '127.0.0.1', () => r(srv)));
}

// ---------------------------------------------------------------- CDP
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && c.pending.has(m.id)) {
        const { res, rej } = c.pending.get(m.id); c.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else if (m.method) c.handlers.forEach((h) => h(m));
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  on(h) { this.handlers.push(h); }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch {} }
}

async function launchChrome() {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-shots-'));
  const dbgPort = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${userDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars',
    '--force-device-scale-factor=2', '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
  let ver;
  for (let i = 0; i < 50; i++) {
    try { ver = await (await fetch(`http://127.0.0.1:${dbgPort}/json/version`)).json(); break; } catch { await sleep(200); }
  }
  if (!ver) throw new Error('Chrome did not start');
  const list = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  const kill = () => { cdp.close(); try { proc.kill(); } catch {} setTimeout(() => { try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {} }, 1500); };
  return { cdp, kill };
}

// ---------------------------------------------------------------- session seeding
const require = createRequire(path.join(REPO_DIR, 'package.json'));
const cartCache = {};
async function buildCart(spec) {
  // spec: { storeId, count } -> cart_items_v1 payload built from live GET /api/stores/:id products
  const key = JSON.stringify(spec);
  if (cartCache[key]) return cartCache[key];
  const j = await (await fetch(`${API}/api/stores/${spec.storeId}`, { signal: AbortSignal.timeout(15000) })).json();
  const products = (j.products || []).filter((p) => p.is_available).slice(0, spec.count || 2);
  const payload = products.map((p, i) => ({ product: p, variant: (p.size_variants || [])[0] || null, quantity: i + 1 }));
  return (cartCache[key] = JSON.stringify(payload));
}

async function makeSession(role) {
  const def = ROLES[role];
  if (!def) throw new Error(`Unknown role/session "${role}" (see ROLES in scenarios.mjs)`);
  const prefs = { ...(def.prefs || {}) };
  if (def.cart) prefs.cart_items_v1 = await buildCart(def.cart);
  if (def.user) {
    const jwt = require('jsonwebtoken');
    const payload = { id: def.user.id, email: def.user.email, user_type: def.user.user_type,
      first_name: def.user.first_name, last_name: def.user.last_name, is_guest: def.user.user_type === 'guest' };
    const token = jwt.sign(payload, readSecret(), { expiresIn: '2h' });
    prefs.token = token;
    prefs.user = JSON.stringify({ id: def.user.id, first_name: def.user.first_name, last_name: def.user.last_name,
      email: def.user.email, user_type: def.user.user_type, phone: def.user.phone ?? null, address: def.user.address ?? null,
      date_of_birth: null, is_guest: def.user.user_type === 'guest' });
  }
  // shared_preferences_web stores each key as localStorage["flutter."+key] = JSON.stringify(value)
  const ls = {};
  for (const [k, v] of Object.entries(prefs)) ls['flutter.' + k] = JSON.stringify(v);
  return ls;
}

// ---------------------------------------------------------------- page helpers
const FIND_JS = `
window.__snFind = function(label, opts) {
  opts = opts || {};
  const host = document.querySelector('flt-semantics-host');
  if (!host) return null;
  const norm = s => (s || '').replace(/\\s+/g, ' ').trim();
  const want = norm(label).toLowerCase();
  const out = [];
  for (const el of host.querySelectorAll('*')) {
    const own = norm(el.getAttribute('aria-label') || '');
    const txt = norm(el.childElementCount === 0 ? el.textContent : '');
    const cand = [own, txt].filter(Boolean);
    for (const c of cand) {
      const lc = c.toLowerCase();
      const ok = opts.exact ? lc === want : (lc === want || lc.startsWith(want) || lc.includes(want));
      if (!ok) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cy = r.top + r.height / 2, cx = r.left + r.width / 2;
      const inView = cy > 4 && cy < innerHeight - 4 && cx > 0 && cx < innerWidth;
      if (!inView && !opts.offscreen) continue;
      out.push({ x: cx, y: cy, w: r.width, h: r.height, label: c,
        score: (inView ? 0 : 1e9) + (lc === want ? 0 : lc.startsWith(want) ? 1 : 2) * 1e7 + r.top });
    }
  }
  out.sort((a, b) => a.score - b.score);
  return out;
};
window.__snLabels = function() {
  const host = document.querySelector('flt-semantics-host');
  if (!host) return [];
  const seen = [];
  for (const el of host.querySelectorAll('*')) {
    const l = (el.getAttribute('aria-label') || (el.childElementCount === 0 ? el.textContent : '') || '').replace(/\\s+/g,' ').trim();
    if (!l) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    seen.push(Math.round(r.left)+','+Math.round(r.top)+' '+(el.getAttribute('role')||el.tagName.toLowerCase())+' | '+l.slice(0,90));
  }
  return seen;
};`;

class Page {
  constructor(cdp) { this.cdp = cdp; this.blocked = []; this.mocks = {}; }
  async init() {
    const c = this.cdp;
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    // Keep the desktop UA: Flutter's desktop semantics enabler accepts a programmatic click on its placeholder.
    // Kot Addu (where the stores in the data set are), so the customer dashboard is inside the delivery area.
    await c.send('Browser.grantPermissions', { permissions: ['geolocation'], origin: APP_URL.replace(/\/$/, '') }).catch(() => {});
    await c.send('Emulation.setGeolocationOverride', { latitude: GEO[0], longitude: GEO[1], accuracy: 30 });
    // Read-only guard: block any mutating request to the API.
    await c.send('Fetch.enable', { patterns: [{ urlPattern: API + '/*', requestStage: 'Request' }] });
    c.on(async (m) => {
      if (m.method !== 'Fetch.requestPaused') return;
      const { requestId, request } = m.params;
      const u = new URL(request.url);
      if (IMAGES_FROM && request.method === 'GET' && u.pathname.startsWith('/uploads/')) {
        // Local DB copies have no upload files; serve product/store images from the public site instead.
        try {
          const r = await fetch(IMAGES_FROM + u.pathname, { signal: AbortSignal.timeout(15000) });
          const body = Buffer.from(await r.arrayBuffer()).toString('base64');
          await c.send('Fetch.fulfillRequest', { requestId, responseCode: r.status, body, responseHeaders: [
            { name: 'Content-Type', value: r.headers.get('content-type') || 'application/octet-stream' },
            { name: 'Access-Control-Allow-Origin', value: '*' }] });
        } catch { c.send('Fetch.continueRequest', { requestId }).catch(() => {}); }
        return;
      }
      const mock = this.mocks[`${request.method} ${u.pathname}`];
      if (mock) {
        // Canned response for a write endpoint so a screen behind it can be reached without touching the DB.
        if (VERBOSE) console.log('   [mocked]', request.method, u.pathname);
        c.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [
          { name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
          body: Buffer.from(JSON.stringify(mock)).toString('base64') }).catch(() => {});
        return;
      }
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        c.send('Fetch.continueRequest', { requestId }).catch(() => {});
      } else {
        this.blocked.push(`${request.method} ${request.url}`);
        if (VERBOSE) console.log('   [blocked]', request.method, request.url);
        c.send('Fetch.fulfillRequest', { requestId, responseCode: 403, responseHeaders: [
          { name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
          body: Buffer.from(JSON.stringify({ success: false, message: 'Blocked by screenshot tool (read-only)' })).toString('base64') }).catch(() => {});
      }
    });
    if (VERBOSE) c.on((m) => { if (m.method === 'Runtime.consoleAPICalled') console.log('   [console]', m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200)); });
  }
  async goto(url) {
    await this.cdp.send('Page.navigate', { url });
    await this.waitFor(`document.readyState === 'complete'`, 15000);
  }
  async waitFor(expr, timeout = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (await this.cdp.eval(expr)) return true; } catch {}
      await sleep(150);
    }
    return false;
  }
  async boot(localStorageMap, { semantics = true } = {}) {
    // Load once on the origin to get access to localStorage, then seed it and load the app.
    await this.goto(APP_URL + 'favicon.png');
    await this.cdp.eval(`localStorage.clear(); ${Object.entries(localStorageMap).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n')} true`);
    await this.goto(APP_URL);
    const ok = await this.waitFor(`!!document.querySelector('flt-glass-pane, flutter-view')`, 30000);
    if (!ok) throw new Error('Flutter did not start');
    if (semantics) await this.enableSemantics();
  }
  async enableSemantics() {
    // Flutter web keeps a hidden "Enable accessibility" placeholder; clicking it builds the flt-semantics tree.
    await this.waitFor(`!!document.querySelector('flt-semantics-placeholder') || !!document.querySelector('flt-semantics-host flt-semantics')`, 20000);
    await this.cdp.eval(`(() => { const p = document.querySelector('flt-semantics-placeholder'); if (p) p.click(); return true; })()`);
    await this.waitFor(`!!document.querySelector('flt-semantics-host flt-semantics')`, 10000);
    await this.cdp.eval(FIND_JS + '; true');
  }
  async find(label, opts = {}) {
    await this.ensureHelpers();
    return (await this.cdp.eval(`window.__snFind(${JSON.stringify(label)}, ${JSON.stringify(opts)})`)) || [];
  }
  async labels() {
    await this.ensureHelpers();
    return this.cdp.eval('window.__snLabels()');
  }
  async ensureHelpers() {
    if (!(await this.cdp.eval('!!window.__snFind'))) await this.cdp.eval(FIND_JS + '; true');
  }
  async tapXY(x, y) {
    const s = { x, y, button: 'left', clickCount: 1, pointerType: 'mouse' };
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...s });
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...s });
    await sleep(60);
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...s });
  }
  async tap(label, opts = {}) {
    const timeout = opts.timeout ?? 12000;
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const hits = await this.find(label, { ...opts, offscreen: true });
      let pick = opts.index != null ? hits[opts.index] : (opts.last ? hits[hits.length - 1] : hits[0]);
      if (pick && !opts.noscroll && (pick.y > 840 || pick.y < 4)) {
        // bring it into view, then re-locate
        await this.scroll(pick.y - 420, 195, 420); await sleep(800);
        const again = await this.find(label, opts);
        pick = opts.index != null ? again[opts.index] : (opts.last ? again[again.length - 1] : again[0]);
      }
      if (pick) { await this.tapXY(pick.x, pick.y); return pick; }
      await sleep(300);
    }
    if (opts.optional) return null;
    throw new Error(`tap: "${label}" not found`);
  }
  async scroll(dy, x = 195, y = 500) {
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy });
  }
  async screenshot(file) {
    const r = await this.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
}

// Step language used in scenarios.mjs:
//   'tap:Label'  'tap?:Label' (optional)  'tapx:Label' (exact)  'tapl:Label' (last match)
//   'xy:195,400' 'wait:1500'  'until:Label' (wait until a label appears)  'scroll:600'
//   'back' (taps the AppBar back button)  'dismiss' (closes common dialogs: OK / Later / Close)
async function runSteps(page, steps) {
  for (const raw of steps) {
    const i = raw.indexOf(':');
    const op = i < 0 ? raw : raw.slice(0, i);
    const arg = i < 0 ? '' : raw.slice(i + 1);
    if (VERBOSE) console.log('   step', raw);
    switch (op) {
      case 'tap': await page.tap(arg); break;
      case 'tap?': await page.tap(arg, { optional: true, timeout: 3000 }); break;
      case 'tapx': await page.tap(arg, { exact: true }); break;
      case 'tapl': await page.tap(arg, { last: true }); break;
      case 'xy': { const [x, y] = arg.split(',').map(Number); await page.tapXY(x, y); break; }
      case 'wait': await sleep(Number(arg)); break;
      case 'until': { const ok = await page.waitFor(`(window.__snFind && (window.__snFind(${JSON.stringify(arg)})||[]).length>0)`, 20000); if (!ok) throw new Error(`until: "${arg}" never appeared`); break; }
      case 'scroll': await page.scroll(Number(arg)); await sleep(700); break;
      case 'type': await page.cdp.send('Input.insertText', { text: arg }); break;
      case 'back': await page.tap('Back', { timeout: 5000 }); break;
      case 'dismiss':
        for (const l of ['OK', 'Later', 'Close', 'Dismiss']) { if (await page.tap(l, { exact: true, optional: true, timeout: 800 })) await sleep(500); }
        break;
      default: throw new Error('unknown step ' + raw);
    }
    await sleep(op === 'wait' ? 0 : 900);
  }
}

// ---------------------------------------------------------------- main
async function settle(page, ms = 2500) {
  // wait for network quiet-ish: Flutter loads data after the first frame
  await sleep(ms);
}

async function captureRole(role, page) {
  const list = SCENARIOS[role] || [];
  const results = [];
  for (const sc of list) {
    if (ONLY && !ONLY.some((o) => sc.name.includes(o))) continue;
    const file = path.join(OUT, role, `${sc.name}.png`);
    const t0 = Date.now();
    let timer;
    try {
      const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('scenario timed out (120s)')), 120000); });
      await Promise.race([timeout, (async () => {
      page.mocks = sc.mock || {};
      await page.boot(await makeSession(sc.session || role), { semantics: !sc.raw });
      await settle(page, sc.bootWait ?? 3500);
      await runSteps(page, [...(sc.raw ? [] : ['dismiss']), ...(sc.steps || []), ...(sc.expect ? [`until:${sc.expect}`] : [])]);
      await settle(page, sc.wait ?? 2500);
      await page.screenshot(file);
      })()]);
      clearTimeout(timer);
      results.push({ role, name: sc.name, ok: true, ms: Date.now() - t0 });
      console.log(`  ok   ${role}/${sc.name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      clearTimeout(timer);
      results.push({ role, name: sc.name, ok: false, error: e.message });
      console.log(`  FAIL ${role}/${sc.name}: ${e.message}`);
      try { await page.screenshot(path.join(OUT, role, `_failed_${sc.name}.png`)); } catch {}
    }
  }
  return results;
}

async function main() {
  const srv = await startStatic();
  const { cdp, kill } = await launchChrome();
  const cleanup = () => { kill(); srv.close(); };
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  try {
    const page = new Page(cdp);
    await page.init();
    if (args.dump) {
      const role = String(args.dump);
      await page.boot(await makeSession(role));
      await settle(page, 3500);
      const steps = args.steps ? String(args.steps).split('|') : [];
      await runSteps(page, steps);
      await settle(page, Number(args.wait || 2500));
      if (args.eval) console.log(await page.cdp.eval(String(args.eval)));
      console.log((await page.labels()).join('\n'));
      if (args.shot) await page.screenshot(path.resolve(String(args.shot)));
      return;
    }
    console.log(`App ${APP_URL} (build ${BUILD})  API ${API}  ->  ${OUT}`);
    const all = [];
    for (const role of Object.keys(SCENARIOS)) {
      if (ROLE_FILTER && !ROLE_FILTER.includes(role)) continue;
      console.log(`[${role}]`);
      all.push(...(await captureRole(role, page)));
    }
    fs.mkdirSync(OUT, { recursive: true });
    // merge with an earlier log so partial re-runs (--roles/--only) keep the other results
    const logFile = path.join(OUT, 'capture-log.json');
    let prev = { results: [], blockedWrites: [] };
    try { prev = JSON.parse(fs.readFileSync(logFile, 'utf8')); } catch {}
    const key = (r) => r.role + '/' + r.name;
    const done = new Set(all.map(key));
    fs.writeFileSync(logFile, JSON.stringify({ when: new Date().toISOString(), api: API,
      results: [...(prev.results || []).filter((r) => !done.has(key(r))), ...all],
      blockedWrites: [...new Set([...(prev.blockedWrites || []), ...page.blocked])] }, null, 2));
    const failed = all.filter((r) => !r.ok);
    console.log(`\n${all.length - failed.length}/${all.length} captured. Blocked write attempts: ${new Set(page.blocked).size}`);
    if (failed.length) process.exitCode = 1;
  } finally {
    cleanup();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
