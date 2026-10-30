// Generates the one-time balance reset SQL: at a cut-off, every rider goes to
// zero and every store's payable becomes an agreed figure. Read-only: it prints
// SQL computed from a restored backup. Review it, test it on a copy, then run it.
//
//   node scripts/store-payments/build-balance-reset.js <targets.json> > reset.sql
//
// targets.json: { "cutoff": "YYYY-MM-DD HH:MM:SS", "date": "YYYY-MM-DD", "tag": "YYYYMMDD",
//                 "actor_user_id": 1, "stores": { "<store id>": 123.45 },
//                 "voucher": { "id": 1, "number": "CRV-...", "rider_id": 1, "amount": 1, "movement_date": "YYYY-MM-DD" } }
//
// Adjustments are fixed amounts as of the backup, so activity after the cut-off
// stays on top of the new balances. Database connection: the usual DB_* variables.
require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql2/promise');
const ledger = require('../../services/ledger');
const sa = require('../../utils/storeAccount');

const money = (cents) => (Math.abs(cents) / 100).toFixed(2);
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;

async function main() {
  const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const db = await mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const { accounts } = await sa.loadStoreAccounts(db);
  const stores = [...accounts.values()];
  const journals = await ledger.buildAllJournals(db);
  const [wallets] = await db.query('SELECT rider_id, balance FROM wallets WHERE rider_id IS NOT NULL');
  const [pending] = await db.query(
    `SELECT id, rider_id, movement_type, amount FROM rider_cash_movements WHERE status = 'pending' ORDER BY id`);
  const [riderOrders] = await db.query(
    `SELECT DISTINCT rider_id FROM orders WHERE rider_id IS NOT NULL AND status = 'delivered'
       AND LOWER(TRIM(COALESCE(payment_method, ''))) = 'cash' AND LOWER(TRIM(COALESCE(payment_status, ''))) = 'paid'
       AND created_at <= ?`, [cfg.cutoff]);

  // Ledger balances per rider and the store payables held on no store.
  const glRider = new Map();
  const glAdvance = new Map();
  let unallocatedStoreCents = 0;
  for (const j of journals) {
    for (const l of j.lines) {
      if (l.account === '1100' && l.entityType === 'rider') glRider.set(Number(l.entityId), (glRider.get(Number(l.entityId)) || 0) + l.cents);
      if (l.account === '1300' && l.entityType === 'rider') glAdvance.set(Number(l.entityId), (glAdvance.get(Number(l.entityId)) || 0) + l.cents);
      if (l.account === '2000' && !l.entityId) unallocatedStoreCents += l.cents;
    }
  }

  const walletCents = new Map(wallets.map((w) => [Number(w.rider_id), Math.round(Number(w.balance) * 100)]));
  const voucherCents = Math.round(cfg.voucher.amount * 100);
  walletCents.set(cfg.voucher.rider_id, (walletCents.get(cfg.voucher.rider_id) || 0) - voucherCents);

  const entries = [];
  const entry = (account, type, id, cents, note) => {
    if (cents) entries.push({ account, type, id, cents, note });
  };
  const riderIds = new Set([...walletCents.keys(), ...glRider.keys(), ...glAdvance.keys()]);
  for (const id of riderIds) {
    // The wallet reset below posts -wallet to 1100; the rest closes the ledger balance.
    entry('1100 Rider cash receivable', 'rider', id, -((glRider.get(id) || 0) - (walletCents.get(id) || 0)), 'Rider balance reset');
    entry('1300 Rider advances', 'rider', id, -(glAdvance.get(id) || 0), 'Rider advance reset');
  }
  for (const a of stores) {
    const position = sa.accountPosition(a);
    const target = Math.round(Number(cfg.stores[a.store_id] || 0) * 100);
    entry('2000 Store payables', 'store', a.store_id, position.balance_c - target, `Store payable set to ${money(target)}`);
  }
  for (const id of Object.keys(cfg.stores)) {
    if (!accounts.has(Number(id))) throw new Error(`Store ${id} not found`);
  }
  entry('2000 Store payables', null, null, -unallocatedStoreCents, 'Bulk store payments not held on any store');
  const netCents = entries.reduce((s, e) => s + e.cents, 0);
  const walletTotal = [...walletCents.values()].reduce((s, c) => s + c, 0);
  // Wallet resets post their other side to 3900; this entry balances the voucher.
  entry('3900 Suspense (needs review)', null, null, -netCents, 'Balance reset offset');
  const debitCents = entries.filter((e) => e.cents > 0).reduce((s, e) => s + e.cents, 0);

  const jvNumber = `JV-RESET-${cfg.tag}`;
  const guardTable = `balance_reset_${cfg.tag}`;
  const pendingIds = pending.map((p) => p.id);
  const pendingTotal = (pending.reduce((s, p) => s + Math.round(Number(p.amount) * 100), 0) / 100).toFixed(2);
  const out = [];
  const w = (s = '') => out.push(s);

  w(`-- One-time balance reset as of ${cfg.cutoff}. Riders to zero, store payables to the agreed list.`);
  w('-- Back up the database first. Upload the rider cash fix and restart Node BEFORE running this.');
  w('-- Run the whole file once in phpMyAdmin. If a guard fails it stops with a CHECK constraint error and changes nothing.');
  w();
  w('-- ===== Guards =====');
  w(`CREATE TABLE IF NOT EXISTS \`${guardTable}\` (ok TINYINT NOT NULL CHECK (ok = 1), step VARCHAR(40) NOT NULL PRIMARY KEY);`);
  w(`INSERT INTO \`${guardTable}\` (ok, step) SELECT (SELECT COUNT(*) FROM \`${guardTable}\` WHERE step = 'done') = 0, 'not already run'`);
  w(`  ON DUPLICATE KEY UPDATE ok = VALUES(ok);`);
  w(`INSERT INTO \`${guardTable}\` (ok, step) SELECT (SELECT COUNT(*) FROM cash_receipt_vouchers WHERE id = ${cfg.voucher.id} AND voucher_number = ${q(cfg.voucher.number)} AND status = 'received' AND amount = ${money(voucherCents)} AND payer_id = ${cfg.voucher.rider_id}) = 1, 'voucher received'`);
  w(`  ON DUPLICATE KEY UPDATE ok = VALUES(ok);`);
  w(`INSERT INTO \`${guardTable}\` (ok, step) SELECT (SELECT COUNT(*) FROM rider_cash_movements WHERE reference_type = 'receipt_voucher' AND reference_id = ${cfg.voucher.id}) = 0, 'voucher not yet posted'`);
  w(`  ON DUPLICATE KEY UPDATE ok = VALUES(ok);`);
  w(`INSERT INTO \`${guardTable}\` (ok, step) SELECT (SELECT COUNT(*) = ${pendingIds.length} AND ROUND(SUM(amount), 2) = ${pendingTotal} FROM rider_cash_movements WHERE status = 'pending' AND id IN (${pendingIds.join(',')})) = 1, 'pending items unchanged'`);
  w(`  ON DUPLICATE KEY UPDATE ok = VALUES(ok);`);
  w();
  w('START TRANSACTION;');
  w();
  w('-- ===== 1. Store payment records riders never got (wallet debits already exist) =====');
  w(`INSERT IGNORE INTO rider_store_payments (order_id, store_id, rider_id, amount, source_status, created_by, created_at)`);
  w(`SELECT o.id, s.id, w.rider_id, wt.amount, 'picked_up', NULL, wt.created_at`);
  w(`FROM wallet_transactions wt`);
  w(`JOIN wallets w ON w.id = wt.wallet_id AND w.rider_id IS NOT NULL`);
  w(`JOIN orders o ON o.id = CAST(wt.reference_id AS UNSIGNED) AND o.status = 'delivered'`);
  w(`JOIN stores s ON wt.description = CONCAT('Paid to pickup-paid store ', s.name, ' for order #', o.order_number)`);
  w(`WHERE wt.type = 'debit' AND wt.reference_type = 'order';`);
  w();
  w(`-- ===== 2. Finish receipt voucher ${cfg.voucher.number} (it never reached the wallet) =====`);
  w(`INSERT INTO rider_cash_movements (movement_number, rider_id, movement_date, movement_type, amount, description, reference_type, reference_id, recorded_by, status, approved_by, approved_at)`);
  w(`VALUES (${q(`RCM-${cfg.voucher.number}`)}, ${cfg.voucher.rider_id}, ${q(cfg.voucher.movement_date)}, 'cash_submission', ${money(voucherCents)}, ${q(`Cash submission via CRV ${cfg.voucher.number}`)}, 'receipt_voucher', ${cfg.voucher.id}, ${cfg.actor_user_id}, 'completed', ${cfg.actor_user_id}, NOW());`);
  w(`SET @voucher_movement = LAST_INSERT_ID();`);
  w(`UPDATE wallets SET balance = balance - ${money(voucherCents)}, total_spent = total_spent + ${money(voucherCents)} WHERE rider_id = ${cfg.voucher.rider_id};`);
  w(`INSERT INTO wallet_transactions (wallet_id, type, amount, description, reference_type, reference_id, balance_after, created_at)`);
  w(`SELECT id, 'debit', ${money(voucherCents)}, ${q(`Cash submission via CRV ${cfg.voucher.number}`)}, 'rider_cash_movement', @voucher_movement, balance, ${q(cfg.cutoff)} FROM wallets WHERE rider_id = ${cfg.voucher.rider_id};`);
  w();
  w('-- ===== 3. Close old hand-ins: every order up to the cut-off counts as handed in =====');
  const closingRiders = new Set([...riderOrders.map((r) => Number(r.rider_id)), ...pending.map((p) => Number(p.rider_id))]);
  for (const id of closingRiders) {
    const pendingSubmissions = pending.filter((p) => Number(p.rider_id) === id && p.movement_type === 'cash_submission').map((p) => p.id);
    w(`INSERT INTO rider_cash_movements (movement_number, rider_id, movement_date, movement_type, amount, description, reference_type, recorded_by, status, approved_by, approved_at)`);
    w(`VALUES (${q(`RCM-RESET-${cfg.tag}-${id}`)}, ${id}, ${q(cfg.date)}, 'cash_submission', 0.00, ${q(`Balance reset: orders up to ${cfg.cutoff} closed`)}, 'balance_reset', ${cfg.actor_user_id}, 'completed', ${cfg.actor_user_id}, NOW());`);
    w(`SET @reset_movement = LAST_INSERT_ID();`);
    if (pendingSubmissions.length) {
      w(`UPDATE rider_cash_submission_orders SET movement_id = @reset_movement WHERE movement_id IN (${pendingSubmissions.join(',')});`);
    }
    w(`INSERT INTO rider_cash_submission_orders (movement_id, order_id, rider_id, order_number, order_amount)`);
    w(`SELECT @reset_movement, o.id, o.rider_id, o.order_number, o.total_amount FROM orders o`);
    w(`WHERE o.rider_id = ${id} AND o.status = 'delivered' AND LOWER(TRIM(COALESCE(o.payment_method, ''))) = 'cash' AND LOWER(TRIM(COALESCE(o.payment_status, ''))) = 'paid'`);
    w(`  AND o.created_at <= ${q(cfg.cutoff)} AND NOT EXISTS (SELECT 1 FROM rider_cash_submission_orders rcso JOIN rider_cash_movements rcm ON rcm.id = rcso.movement_id`);
    w(`    WHERE rcso.order_id = o.id AND rcm.movement_type = 'cash_submission' AND rcm.status IN ('pending', 'approved', 'completed'));`);
  }
  w(`UPDATE rider_cash_movements SET status = 'cancelled', notes = CONCAT(COALESCE(notes, ''), ${q(` Closed by balance reset ${cfg.tag}`)}) WHERE id IN (${pendingIds.join(',')}) AND status = 'pending';`);
  w();
  w('-- ===== 4. Rider wallets to zero =====');
  for (const [id, cents] of walletCents) {
    if (!cents) continue;
    const type = cents > 0 ? 'debit' : 'credit';
    w(cents > 0
      ? `UPDATE wallets SET balance = balance - ${money(cents)}, total_spent = total_spent + ${money(cents)} WHERE rider_id = ${id};`
      : `UPDATE wallets SET balance = balance + ${money(cents)}, total_credited = total_credited + ${money(cents)} WHERE rider_id = ${id};`);
    w(`INSERT INTO wallet_transactions (wallet_id, type, amount, description, reference_type, reference_id, balance_after, created_at)`);
    w(`SELECT id, '${type}', ${money(cents)}, ${q(`Balance reset ${cfg.tag}`)}, 'balance_reset', ${q(cfg.tag)}, balance, ${q(cfg.cutoff)} FROM wallets WHERE rider_id = ${id};`);
  }
  w();
  w('-- ===== 5. Journal voucher: store payables to the list, ledger rider balances to zero =====');
  w(`INSERT INTO journal_vouchers (voucher_number, voucher_date, description, reference_number, total_amount, status, prepared_by, approved_by, posted_at)`);
  w(`VALUES (${q(jvNumber)}, ${q(cfg.date)}, ${q(`Balance reset as of ${cfg.cutoff}: riders to zero, store payables to agreed list`)}, ${q(cfg.tag)}, ${money(debitCents)}, 'posted', ${cfg.actor_user_id}, ${cfg.actor_user_id}, NOW());`);
  w(`SET @jv = LAST_INSERT_ID();`);
  w(`INSERT INTO journal_voucher_entries (jnv_id, account_name, entity_type, entity_id, entry_type, amount, description) VALUES`);
  w(entries.map((e) => `(@jv, ${q(e.account)}, ${e.type ? q(e.type) : "'other'"}, ${e.id || 'NULL'}, '${e.cents > 0 ? 'debit' : 'credit'}', ${money(e.cents)}, ${q(e.note)})`).join(',\n') + ';');
  w();
  w(`INSERT INTO \`${guardTable}\` (ok, step) VALUES (1, 'done');`);
  w('COMMIT;');
  process.stdout.write(`${out.join('\n')}\n`);
  process.stderr.write(`entries ${entries.length}, debits ${money(debitCents)}, suspense from JV ${(-netCents / 100).toFixed(2)}, wallets reset ${(walletTotal / 100).toFixed(2)}, unallocated ${(unallocatedStoreCents / 100).toFixed(2)}\n`);
  await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
