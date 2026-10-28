// Posts the general ledger from the source documents and prints a summary.
//
//   node scripts/ledger/rebuild-gl.js            post missing/changed journals (safe, repeatable)
//   node scripts/ledger/rebuild-gl.js --dry-run  show what would be posted, write nothing
//   CONFIRM_DESTRUCTIVE=yes node scripts/ledger/rebuild-gl.js --from-scratch
//                                                delete all GL rows first (never in production)
//
// Database connection comes from the usual DB_* environment variables.
require('dotenv').config();
const mysql = require('mysql2/promise');
const ledger = require('../../services/ledger');

const args = new Set(process.argv.slice(2));

async function main() {
  if (args.has('--from-scratch')) {
    if (process.env.NODE_ENV === 'production' || process.env.CONFIRM_DESTRUCTIVE !== 'yes') {
      console.error('--from-scratch deletes the general ledger. It needs CONFIRM_DESTRUCTIVE=yes and is refused with NODE_ENV=production.');
      process.exit(1);
    }
  }
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
    connectionLimit: 4,
    decimalNumbers: false,
  });
  try {
    console.log(`Database ${process.env.DB_NAME} on ${process.env.DB_HOST}:${process.env.DB_PORT || 3306}`);
    await ledger.ensureLedgerSchema(pool);
    if (args.has('--from-scratch')) {
      await pool.query('DELETE FROM gl_lines');
      await pool.query('DELETE FROM gl_journals');
      console.log('Existing general ledger deleted.');
    }
    const started = Date.now();
    const summary = await ledger.syncLedger(pool, { dryRun: args.has('--dry-run') });
    console.log(`Posted ${summary.posted}, reversed ${summary.reversed}, unchanged ${summary.unchanged} (${Date.now() - started} ms)${args.has('--dry-run') ? ' [dry run]' : ''}`);
    if (summary.unbalanced.length) {
      console.log(`Not posted, unbalanced: ${summary.unbalanced.length}`);
      for (const u of summary.unbalanced.slice(0, 20)) console.log(`  ${u.key}: off by ${u.difference}`);
    }
    const tb = await ledger.trialBalance(pool);
    console.log(`Trial balance: debits ${tb.total_debit.toFixed(2)}, credits ${tb.total_credit.toFixed(2)} -> ${tb.balanced ? 'BALANCED' : 'NOT BALANCED'}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
