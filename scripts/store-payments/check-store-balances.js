// Cross-checks every store's balance (utils/storeAccount.js) against the
// general ledger's Store payables account (2000). Read-only.
//
//   node scripts/store-payments/check-store-balances.js            all stores
//   node scripts/store-payments/check-store-balances.js --store 48 one store, with detail
//   node scripts/store-payments/check-store-balances.js --json     machine-readable output
//
// Two ledger views are compared:
//   - "GL now": journals rebuilt in memory from the current source documents
//     (what the next sync would post)
//   - "GL posted": what is in gl_lines today (may lag until the next sync)
// For every store, balance must equal -(GL 2000 balance for that store).
// Database connection comes from the usual DB_* environment variables.
require('dotenv').config();
const mysql = require('mysql2/promise');
const ledger = require('../../services/ledger');
const sa = require('../../utils/storeAccount');

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const storeFilter = arg('--store') ? Number(arg('--store')) : null;
const asJson = argv.includes('--json');
const rs = (c) => (c / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
  });
  try {
    await conn.query('SET SESSION TRANSACTION READ ONLY');
    await conn.query('START TRANSACTION READ ONLY');

    const { accounts, raw } = await sa.loadStoreAccounts(conn);

    const glNow = new Map();
    let glNowUnallocated = 0;
    for (const j of await ledger.buildAllJournals(conn)) {
      for (const l of j.lines) {
        if (l.account !== '2000') continue;
        if (l.entityType === 'store' && l.entityId != null) glNow.set(Number(l.entityId), (glNow.get(Number(l.entityId)) || 0) + l.cents);
        else glNowUnallocated += l.cents;
      }
    }

    const glPosted = new Map();
    let glPostedUnallocated = null;
    let postedAvailable = true;
    try {
      const [rows] = await conn.query(`
        SELECT l.entity_type, l.entity_id, SUM(l.debit) AS debit, SUM(l.credit) AS credit
        FROM gl_lines l WHERE l.account_code = '2000' GROUP BY l.entity_type, l.entity_id`);
      glPostedUnallocated = 0;
      for (const r of rows) {
        const cents = sa.toCents(r.debit) - sa.toCents(r.credit);
        if (r.entity_type === 'store' && r.entity_id != null) glPosted.set(Number(r.entity_id), cents);
        else glPostedUnallocated += cents;
      }
    } catch (_) {
      postedAvailable = false;
    }

    const ids = new Set([...accounts.keys(), ...glNow.keys(), ...glPosted.keys()]);
    const report = [];
    for (const id of [...ids].sort((a, b) => a - b)) {
      if (storeFilter && id !== storeFilter) continue;
      const account = accounts.get(id);
      const pos = account ? sa.accountPosition(account) : { payable_c: 0, paid_c: 0, balance_c: 0 };
      const now = -(glNow.get(id) || 0);
      const posted = postedAvailable ? -(glPosted.get(id) || 0) : null;
      report.push({
        store_id: id,
        name: account ? account.name : `Store #${id}`,
        payment_term: account ? account.payment_term : null,
        payable: pos.payable_c / 100,
        paid: pos.paid_c / 100,
        balance: pos.balance_c / 100,
        gl_now: now / 100,
        gl_posted: posted == null ? null : posted / 100,
        diff_now: (pos.balance_c - now) / 100,
        diff_posted: posted == null ? null : (pos.balance_c - posted) / 100,
      });
    }

    const diffsNow = report.filter((r) => Math.abs(r.diff_now) >= 0.01);
    const diffsPosted = report.filter((r) => r.diff_posted != null && Math.abs(r.diff_posted) >= 0.01);
    const unidentified = raw.unidentifiedPickupPayments.reduce((s, p) => s + p.amount_c, 0);
    const summary = {
      stores_checked: report.length,
      total_balance: report.reduce((s, r) => s + Math.round(r.balance * 100), 0) / 100,
      total_gl_now: report.reduce((s, r) => s + Math.round(r.gl_now * 100), 0) / 100,
      differences_vs_gl_now: diffsNow.length,
      differences_vs_gl_posted: postedAvailable ? diffsPosted.length : null,
      gl_unallocated_store_payments_now: glNowUnallocated / 100,
      gl_unallocated_store_payments_posted: glPostedUnallocated == null ? null : glPostedUnallocated / 100,
      pickup_payments_store_not_identified: unidentified / 100,
    };

    if (asJson) {
      console.log(JSON.stringify({ summary, differences_now: diffsNow, differences_posted: diffsPosted, stores: storeFilter ? report : undefined }, null, 2));
      return;
    }
    console.log(`Database ${process.env.DB_NAME}: ${summary.stores_checked} stores checked`);
    console.log(`  Sum of store balances (owed to stores +): Rs ${rs(Math.round(summary.total_balance * 100))}`);
    console.log(`  GL 2000 per-store total (credit +):        Rs ${rs(Math.round(summary.total_gl_now * 100))}`);
    console.log(`  Store payments not allocated to a store (debit on 2000, e.g. CPV-40): Rs ${rs(glNowUnallocated)} (posted: ${glPostedUnallocated == null ? 'n/a' : `Rs ${rs(glPostedUnallocated)}`})`);
    console.log(`  Rider pickup payments whose store could not be identified (GL suspense 3900): Rs ${rs(unidentified)}`);
    console.log(`  Differences vs GL rebuilt now: ${diffsNow.length}`);
    for (const r of diffsNow) console.log(`    #${r.store_id} ${r.name}: balance ${r.balance.toFixed(2)} vs GL ${r.gl_now.toFixed(2)} (diff ${r.diff_now.toFixed(2)})`);
    if (postedAvailable) {
      console.log(`  Differences vs GL posted in gl_lines: ${diffsPosted.length}`);
      for (const r of diffsPosted) console.log(`    #${r.store_id} ${r.name}: balance ${r.balance.toFixed(2)} vs posted ${r.gl_posted.toFixed(2)} (diff ${r.diff_posted.toFixed(2)})`);
    } else {
      console.log('  gl_lines not found: posted GL not compared');
    }
    if (storeFilter) {
      for (const r of report) {
        console.log(`\n#${r.store_id} ${r.name} (${r.payment_term || '-'})`);
        console.log(`  payable ${r.payable.toFixed(2)}  paid ${r.paid.toFixed(2)}  balance ${r.balance.toFixed(2)}  GL now ${r.gl_now.toFixed(2)}  GL posted ${r.gl_posted == null ? 'n/a' : r.gl_posted.toFixed(2)}`);
      }
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
