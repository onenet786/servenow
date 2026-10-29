// OPTIONAL data correction (never run automatically).
//
// Links a paid lump-sum store settlement (no order lines linked, e.g.
// SS-20261018-MO2VOB, id 300, Amir Bashir Naan Shop) to the oldest unsettled
// order lines of its store that it paid for (first in, first out, whole lines
// only, up to the settlement's net amount). Afterwards those orders show as
// paid by that settlement instead of "covered by store credit", and the lump
// sum drops off the "not linked to orders" list.
//
// The store balance and the general ledger do not change: the payment is
// already counted, and linking only records which orders it paid.
//
//   node scripts/store-payments/link-lump-sum-settlement.js --settlement 300           dry run (default)
//   node scripts/store-payments/link-lump-sum-settlement.js --settlement 300 --apply   write it
//
// --apply updates order_items.settlement_id and the settlement's
// total_orders_amount / commissions (net_amount is never changed) and appends a
// note. Take a backup first. Database connection: the usual DB_* variables.
require('dotenv').config();
const mysql = require('mysql2/promise');
const sa = require('../../utils/storeAccount');

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const settlementId = Number(arg('--settlement'));
const apply = argv.includes('--apply');
const rs = (c) => (c / 100).toFixed(2);

async function main() {
  if (!Number.isInteger(settlementId) || settlementId <= 0) {
    console.error('Usage: --settlement <id> [--apply]');
    process.exit(1);
  }
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
  });
  try {
    const [[s]] = await conn.query(
      `SELECT ss.id, ss.settlement_number, ss.store_id, ss.status, ss.net_amount, ss.total_orders_amount, ss.notes,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.settlement_id = ss.id) AS linked
       FROM store_settlements ss WHERE ss.id = ?`, [settlementId]);
    if (!s) throw new Error(`Settlement ${settlementId} not found`);
    if (s.status !== 'paid') throw new Error(`${s.settlement_number} is ${s.status}; only paid lump sums are linked`);
    if (Number(s.linked) > 0) throw new Error(`${s.settlement_number} already has ${s.linked} order line(s) linked`);

    if (apply) await conn.beginTransaction();
    if (apply) await conn.query('SELECT id FROM stores WHERE id = ? FOR UPDATE', [s.store_id]);

    const { account, position } = await sa.getStoreAccount(conn, s.store_id);
    const netC = sa.toCents(s.net_amount);
    const chosen = [];
    let usedC = 0;
    let grossC = 0;
    for (const row of position.open_lines) {
      const it = row.line;
      if (it.settlement_id || it.settled) continue;
      if (usedC + it.payable_c > netC) break; // whole lines only, oldest first
      chosen.push(it);
      usedC += it.payable_c;
      grossC += it.value_c;
    }

    console.log(`${s.settlement_number} (id ${s.id}) - ${account.name} (#${s.store_id}), net Rs ${rs(netC)}`);
    console.log(`Store balance Rs ${rs(position.balance_c)} (negative = store credit); unchanged by linking.`);
    if (!chosen.length) {
      console.log('No unsettled order lines fit within the settlement amount. Nothing to do.');
      if (apply) await conn.rollback();
      return;
    }
    console.log(`Lines to link (${chosen.length}), delivered ${chosen[0].date} to ${chosen[chosen.length - 1].date}:`);
    for (const it of chosen) console.log(`  item ${it.id}  order ${it.order_number}  ${it.date}  payable Rs ${rs(it.payable_c)}`);
    console.log(`Payable linked Rs ${rs(usedC)} (gross Rs ${rs(grossC)}); Rs ${rs(netC - usedC)} of the payment stays as store credit.`);
    const ids = chosen.map((i) => i.id);
    const note = `Linked to ${ids.length} order line(s) by scripts/store-payments/link-lump-sum-settlement.js on ${new Date().toISOString().slice(0, 10)}; Rs ${rs(netC - usedC)} left as store credit`;
    console.log('\nEquivalent SQL:');
    console.log(`  START TRANSACTION;`);
    console.log(`  UPDATE order_items SET settlement_id = ${s.id} WHERE settlement_id IS NULL AND id IN (${ids.join(', ')});`);
    console.log(`  UPDATE store_settlements SET total_orders_amount = ${rs(grossC)}, commissions = ${rs(grossC - usedC)}, notes = CONCAT(COALESCE(notes, ''), '\\n${note}') WHERE id = ${s.id} AND status = 'paid';`);
    console.log(`  COMMIT;`);

    if (!apply) {
      console.log('\nDry run: nothing written. Re-run with --apply to write it.');
      return;
    }
    const [r1] = await conn.query(
      `UPDATE order_items SET settlement_id = ? WHERE settlement_id IS NULL AND id IN (?)`, [s.id, ids]);
    if (r1.affectedRows !== ids.length) throw new Error(`Expected ${ids.length} lines, updated ${r1.affectedRows}; rolled back`);
    await conn.query(
      `UPDATE store_settlements SET total_orders_amount = ?, commissions = ?, notes = CONCAT(COALESCE(notes, ''), ?)
       WHERE id = ? AND status = 'paid'`,
      [rs(grossC), rs(grossC - usedC), `${s.notes ? '\n' : ''}${note}`, s.id]);
    await conn.commit();
    const after = await sa.getStoreAccount(conn, s.store_id);
    console.log(`\nApplied. Store balance now Rs ${rs(after.position.balance_c)} (was Rs ${rs(position.balance_c)}).`);
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* no transaction */ }
    throw err;
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
