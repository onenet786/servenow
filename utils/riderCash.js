// Rider cash: one calculation behind every rider report.
//
// The rider wallet is the record of cash a rider should be holding, so each
// report sorts wallet entries into these headings instead of working the
// figures out again from orders or cash movements:
//
//   closing = opening + collected + fees - paid_stores - fuel - advances
//           - handed_in + cancelled + adjustments + corrections + reset
//
// Everything here only reads the database.

const money = (cents) => Math.round(cents) / 100;
const toCents = (value) => Math.round(Number(value || 0) * 100);

// Fuel logged before this date was never paid through
// the rider wallet, so it stays with the accounts and not a rider hand-in.
const FUEL_RULE_START = '2026-10-31';

// How far above their own recent average a rider's fuel can go without a note.
const FUEL_RATE_LIMIT = 1.5;

const HEADINGS = ['collected', 'fees', 'paid_stores', 'fuel', 'advances', 'handed_in', 'cancelled', 'adjustments', 'corrections', 'reset'];

function headingOf({ reference_type: ref, description, type }) {
  const desc = String(description || '');
  if (ref === 'balance_reset') return 'reset';
  if (ref === 'system_correction') return 'corrections';
  if (ref === 'order_cancel_reversal') return 'cancelled';
  if (ref === 'order') {
    if (/pickup-paid store/i.test(desc)) return 'paid_stores';
    if (/^delivery fee/i.test(desc)) return 'fees';
    return type === 'debit' ? 'corrections' : 'collected';
  }
  if (/cash submission/i.test(desc)) return 'handed_in';
  if (/^cash advance/i.test(desc)) return 'advances';
  if (/^fuel/i.test(desc)) return 'fuel';
  if (/^cash collection/i.test(desc)) return 'collected';
  return 'adjustments';
}

const signed = (row) => (row.type === 'debit' ? -toCents(row.amount) : toCents(row.amount));

// Wallet entries for riders, oldest first. Dates are YYYY-MM-DD and inclusive.
async function loadRiderWalletEntries(db, { riderId = null } = {}) {
  const [rows] = await db.query(
    `SELECT wt.id, wt.type, wt.amount, wt.description, wt.reference_type, wt.reference_id, w.rider_id,
            DATE_FORMAT(wt.created_at, '%Y-%m-%d %H:%i:%s') AS ts
     FROM wallet_transactions wt
     JOIN wallets w ON w.id = wt.wallet_id
     WHERE w.rider_id IS NOT NULL ${riderId ? 'AND w.rider_id = ?' : ''}
     ORDER BY wt.created_at, wt.id`,
    riderId ? [riderId] : []
  );
  return rows.map((r) => ({ ...r, date: String(r.ts).slice(0, 10), heading: headingOf(r), cents: signed(r) }));
}

// One row per rider for the period. With no end date, closing equals the wallet.
async function riderCashPositions(db, { riderId = null, from = null, to = null } = {}) {
  const [riders] = await db.query(
    `SELECT r.id, TRIM(CONCAT(COALESCE(r.first_name, ''), ' ', COALESCE(r.last_name, ''))) AS name,
            COALESCE(w.balance, 0) AS balance
     FROM riders r
     LEFT JOIN wallets w ON w.rider_id = r.id
     ${riderId ? 'WHERE r.id = ?' : ''}
     ORDER BY name`,
    riderId ? [riderId] : []
  );
  const entries = await loadRiderWalletEntries(db, { riderId });

  const rows = new Map();
  for (const r of riders) {
    const row = { rider_id: Number(r.id), name: r.name, wallet_balance: toCents(r.balance), opening: 0, history: 0 };
    for (const h of HEADINGS) row[h] = 0;
    rows.set(Number(r.id), row);
  }
  for (const e of entries) {
    const row = rows.get(Number(e.rider_id));
    if (!row) continue;
    row.history += e.cents;
    if (to && e.date > to) continue;
    if (from && e.date < from) row.opening += e.cents;
    else row[e.heading] += e.cents;
  }

  return [...rows.values()].map((row) => {
    // A little old history never reached the entries; it stays in the opening figure.
    const opening = row.opening + (row.wallet_balance - row.history);
    const closing = opening + HEADINGS.reduce((s, h) => s + row[h], 0);
    return {
      rider_id: row.rider_id,
      name: row.name,
      opening: money(opening),
      collected: money(row.collected),
      fees: money(row.fees),
      paid_stores: money(-row.paid_stores),
      fuel: money(-row.fuel),
      advances: money(-row.advances),
      handed_in: money(-row.handed_in),
      cancelled: money(row.cancelled),
      adjustments: money(row.adjustments),
      corrections: money(row.corrections),
      reset: money(row.reset),
      closing: money(closing),
      wallet_balance: money(row.wallet_balance),
    };
  });
}

// Totals for a list of positions.
function sumPositions(rows) {
  const total = {};
  for (const key of ['opening', 'collected', 'fees', 'paid_stores', 'fuel', 'advances', 'handed_in', 'cancelled', 'adjustments', 'corrections', 'reset', 'closing', 'wallet_balance']) {
    total[key] = money(rows.reduce((s, r) => s + toCents(r[key]), 0));
  }
  return total;
}

// Fuel paid but not yet taken off a hand-in. It reduces what the rider owes the office.
async function outstandingFuelPayments(db, riderId) {
  const [rows] = await db.query(
    `SELECT id, amount FROM rider_cash_movements
     WHERE rider_id = ? AND movement_type = 'fuel_payment' AND status = 'approved' AND reference_type IS NULL`,
    [riderId]
  );
  return {
    ids: rows.map((r) => Number(r.id)),
    total: money(rows.reduce((s, r) => s + toCents(r.amount), 0)),
  };
}

// Average fuel cost per km over the rider's last 90 days of logged fuel.
async function riderFuelRate(db, riderId) {
  const [[row]] = await db.query(
    `SELECT SUM(fuel_cost) AS cost, SUM(distance) AS km
     FROM riders_fuel_history
     WHERE rider_id = ? AND entry_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) AND distance > 0 AND fuel_cost > 0`,
    [riderId]
  );
  const km = Number(row?.km || 0);
  return km > 0 ? Number(row.cost) / km : 0;
}

module.exports = {
  FUEL_RULE_START,
  FUEL_RATE_LIMIT,
  HEADINGS,
  headingOf,
  loadRiderWalletEntries,
  riderCashPositions,
  sumPositions,
  outstandingFuelPayments,
  riderFuelRate,
};
