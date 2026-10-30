const test = require('node:test');
const assert = require('node:assert');
const riderCash = require('../utils/riderCash');

const entry = (type, amount, reference_type, description) => ({ type, amount, reference_type, description });

test('wallet entries go under the right heading', () => {
  const cases = [
    [entry('credit', 580, 'order', 'Cash collection for order #1'), 'collected'],
    [entry('credit', 100, 'order', 'Delivery fee for order #1'), 'fees'],
    [entry('debit', 420, 'order', 'Paid to pickup-paid store Serve Drink for order #1'), 'paid_stores'],
    [entry('debit', 800, 'rider_cash_movement', 'Fuel payment via RCM-1'), 'fuel'],
    [entry('debit', 5000, 'rider_cash_movement', 'Cash advance via RCM-1'), 'advances'],
    [entry('debit', 160, 'rider_cash_movement', 'Cash submission via RCM-1'), 'handed_in'],
    [entry('credit', 1, 'rider_cash_movement', 'Reversal of cash submission via CRV CRV-1'), 'handed_in'],
    [entry('credit', 8100, 'rider_cash_movement', 'Adjustment credit via RCM-1'), 'adjustments'],
    [entry('debit', 580, 'order_cancel_reversal', 'Reversal: Cash collection for order #1'), 'cancelled'],
    [entry('debit', 5769.99, 'system_correction', 'Cleanup'), 'corrections'],
    [entry('debit', 434420.6, 'balance_reset', 'Balance reset 20261030'), 'reset'],
  ];
  for (const [row, heading] of cases) assert.equal(riderCash.headingOf(row), heading, row.description);
});

function fakeDb({ wallet, entries }) {
  return {
    async query(sql) {
      if (sql.includes('FROM riders r')) return [[{ id: 1, name: 'Rider One', balance: wallet }]];
      return [entries];
    },
  };
}

const rows = [
  { ts: '2026-10-29 10:00:00', ...entry('credit', 1000, 'order', 'Cash collection for order #1'), rider_id: 1 },
  { ts: '2026-10-30 10:00:00', ...entry('credit', 500, 'order', 'Cash collection for order #2'), rider_id: 1 },
  { ts: '2026-10-30 10:00:01', ...entry('debit', 300, 'order', 'Paid to pickup-paid store Serve Drink for order #2'), rider_id: 1 },
  { ts: '2026-10-30 12:00:00', ...entry('debit', 1000, 'rider_cash_movement', 'Cash submission via RCM-1'), rider_id: 1 },
];

test('closing with no dates equals the wallet', async () => {
  const [row] = await riderCash.riderCashPositions(fakeDb({ wallet: 200, entries: rows }));
  assert.equal(row.collected, 1500);
  assert.equal(row.paid_stores, 300);
  assert.equal(row.handed_in, 1000);
  assert.equal(row.closing, 200);
  assert.equal(row.wallet_balance, 200);
});

test('old history that never reached the entries is carried in the opening figure', async () => {
  const [row] = await riderCash.riderCashPositions(fakeDb({ wallet: 660, entries: rows }));
  assert.equal(row.opening, 460);
  assert.equal(row.closing, 660);
});

test('a period starts from what was held before it', async () => {
  const [row] = await riderCash.riderCashPositions(fakeDb({ wallet: 200, entries: rows }), { from: '2026-10-30', to: '2026-10-30' });
  assert.equal(row.opening, 1000);
  assert.equal(row.collected, 500);
  assert.equal(row.closing, 200);
});

test('totals add every rider', () => {
  const total = riderCash.sumPositions([{ collected: 100.1, closing: 1 }, { collected: 200.2, closing: 2 }]);
  assert.equal(total.collected, 300.3);
  assert.equal(total.closing, 3);
});
