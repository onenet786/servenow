// AIAgent assistant: widget settings for our pages, the manifest AIAgent connects from, and the signed tool
// endpoint. The tool endpoint is called by the AIAgent server, not by browsers. The connector
// (utils/aiagent-connect.js) checks the signature, the time window and the identity token, and runs
// actions only after the person confirmed a summary; services/aiagent.js holds the tools themselves.
const express = require('express');
const jwt = require('jsonwebtoken');
const ai = require('../services/aiagent');
const { createConnector } = require('../utils/aiagent-connect');
const { runOncePerProcess } = require('../utils/runOnce');

const router = express.Router();
const TOOL_PATH = '/integrations/aiagent/tools';

const ensureActionsTable = runOncePerProcess((db) => db.execute(`
    CREATE TABLE IF NOT EXISTS assistant_actions (
      id INT PRIMARY KEY AUTO_INCREMENT,
      tool VARCHAR(40) NOT NULL,
      actor_type VARCHAR(20) NOT NULL,
      actor_id INT NOT NULL,
      actor_name VARCHAR(120),
      details TEXT,
      result TEXT,
      conversation_id VARCHAR(64),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_assistant_actions_created (created_at)
    )`));

// Every action the assistant carried out, for the record (who, what, when).
async function logAction(db, entry) {
  await ensureActionsTable(db);
  await db.execute(
    `INSERT INTO assistant_actions (tool, actor_type, actor_id, actor_name, details, result, conversation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [entry.tool, entry.user.type, entry.user.id, entry.user.name, JSON.stringify(entry.arguments).slice(0, 2000),
      JSON.stringify(entry.result).slice(0, 2000), entry.conversationId]
  );
}

const connector = createConnector({
  name: 'ServeNow',
  path: TOOL_PATH,
  toolSecret: () => ai.settings().toolSecret,
  identitySecret: () => ai.settings().identitySecret,
  identityTtlSeconds: ai.TOKEN_TTL_SECONDS,
  // The account as it is now: switched off, deleted or a changed role means "visitor".
  async loadUser(sub, claims, { db }) {
    const account = await ai.loadAccount(db, sub);
    if (!account || account.user_type !== claims.role) return null;
    const name = `${account.first_name || ''} ${account.last_name || ''}`.trim() || account.email;
    return { id: account.id, type: account.user_type, name, branch_id: account.branch_id, label: `${name} (${account.user_type})` };
  },
  tools: ai.TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    public: t.who.includes('anyone'),
    action: !!t.action,
    allow: async (user, { db }) => {
      const denied = await ai.accessError(db, t, user);
      return denied ? denied.message : true;
    },
    preview: t.action ? (args, { db, user }) => ai.ACTIONS[t.name].preview(db, args, user) : undefined,
    run: t.action
      ? (args, { db, io, user }) => ai.ACTIONS[t.name].run(db, args, user, io)
      : (args, { db, user }) => ai.runTool(db, t.name, args, user),
  })),
  // A failure to write the record is logged by the connector and never undoes the action.
  onAction: (entry) => logAction(entry.context.db, entry),
});

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
// tools by itself. Holds no ServeNow data, only tool names and descriptions.
router.get('/.well-known/aiagent.json', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(connector.manifest());
});

router.post(TOOL_PATH, express.raw({ type: () => true, limit: '64kb' }), async (req, res) => {
  // Without a valid identity token (none, expired after a few hours, or signed out) the caller is a visitor.
  const out = await connector.handle({
    rawBody: req.body,
    signature: req.get('x-aiagent-signature'),
    ip: req.ip,
    context: { db: req.db, io: req.io },
  });
  res.set('Cache-Control', 'no-store');
  res.status(out.status).json(out.body);
});

module.exports = router;
