// Test helpers: mount a real router on an Express app backed by a scripted
// fake database, and make authenticated HTTP requests against it.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only_0123456789';

const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');

// handler(sql, params) returns the value a mysql2 execute() resolves to
// ([rows] or [result]). Every statement is recorded in `log`; transaction
// boundaries are recorded as BEGIN / COMMIT / ROLLBACK.
function fakeDb(handler) {
  const log = [];
  const execute = async (sql, params = []) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    log.push(q);
    const result = await handler(q, params);
    if (result !== undefined) return result;
    if (/^(ALTER|CREATE)/i.test(q)) return [{}];
    if (/^INSERT/i.test(q)) return [{ insertId: 1, affectedRows: 1 }];
    if (/^(UPDATE|DELETE)/i.test(q)) return [{ affectedRows: 1 }];
    return [[]];
  };
  const conn = {
    execute,
    query: execute,
    beginTransaction: async () => log.push('BEGIN'),
    commit: async () => log.push('COMMIT'),
    rollback: async () => log.push('ROLLBACK'),
    release: () => log.push('RELEASE'),
  };
  return { db: { execute, query: execute, getConnection: async () => conn }, log };
}

// Answers the auth middleware's account-status check
function activeAccount(q, userType) {
  if (/FROM users WHERE id = \?/.test(q) && /is_active/.test(q)) return [[{ is_active: 1, user_type: userType }]];
  if (/SELECT is_active FROM riders WHERE id = \?/.test(q)) return [[{ is_active: 1 }]];
  return undefined;
}

function tokenFor(user) {
  return jwt.sign(user, process.env.JWT_SECRET);
}

async function request(router, mountPath, db, { method = 'GET', path, user, body, headers = {}, rawBody, beforeRouter } = {}) {
  const app = express();
  if (beforeRouter) beforeRouter(app);
  else app.use(express.json());
  app.use((req, _res, next) => { req.db = db; req.io = null; next(); });
  app.use(mountPath, router);
  const payload = rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : '';
  const allHeaders = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers };
  if (user) allHeaders.authorization = 'Bearer ' + tokenFor(user);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const req = http.request({ port: server.address().port, method, path, headers: allHeaders }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          server.close();
          let json = {};
          try { json = JSON.parse(data); } catch (_) { /* non-JSON body */ }
          resolve({ status: res.statusCode, body: json });
        });
      });
      req.on('error', (e) => { server.close(); reject(e); });
      req.end(payload);
    });
  });
}

module.exports = { fakeDb, activeAccount, tokenFor, request };
