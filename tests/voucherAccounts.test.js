const test = require('node:test');
const assert = require('node:assert');
const ledger = require('../services/ledger');
const { DOCUMENTS } = require('../utils/financeControls');

const choose = ledger.chooseVoucherAccount;
const expenseRow = { payee_type: 'expense', payee_name: 'Rent', purpose: 'October', payment_method: 'cash' };

test('voucher account: what a voucher posts to when nobody chooses', () => {
  assert.deepEqual(ledger.voucherAccount('payment', { payee_type: 'store', payee_id: 5, payee_name: 'Adnan Broast' }), { code: '2000', locked: true });
  assert.deepEqual(ledger.voucherAccount('payment', { payee_type: 'expense', payee_name: 'Shop rent' }), { code: '5200', locked: false });
  assert.deepEqual(ledger.voucherAccount('payment', { payee_type: 'rider', payee_id: 3, payee_name: 'Ali', purpose: 'fuel' }), { code: '5400', locked: false });
  assert.deepEqual(ledger.voucherAccount('payment', { payee_type: 'other', payee_name: 'Store purchase bulk' }), { code: '2000', locked: true });
  assert.deepEqual(ledger.voucherAccount('receipt', { payer_type: 'rider', payer_id: 3 }), { code: '1100', locked: true });
  assert.deepEqual(ledger.voucherAccount('receipt', { payer_type: 'store', payer_id: 3 }), { code: '2000', locked: true });
  assert.deepEqual(ledger.voucherAccount('receipt', { payer_type: 'customer', payer_id: 3 }), { code: '2100', locked: true });
  assert.deepEqual(ledger.voucherAccount('receipt', { payer_type: 'other' }), { code: '4900', locked: false });
  assert.deepEqual(ledger.voucherAccount('expense', { category: 'utilities', description: 'electric bill' }), { code: '5300', locked: false });
});

test('voucher account: empty means automatic', () => {
  assert.deepEqual(choose('payment', expenseRow, ''), { code: null });
  assert.deepEqual(choose('payment', expenseRow, undefined), { code: null });
});

test('voucher account: a person can choose from the safe list', () => {
  assert.deepEqual(choose('payment', expenseRow, '5600'), { code: '5600' });
  assert.deepEqual(choose('payment', expenseRow, '1300'), { code: '1300' });
  assert.deepEqual(choose('receipt', { payer_type: 'other', payment_method: 'cash' }, '5200'), { code: '5200' });
  assert.deepEqual(choose('expense', { category: 'other' }, '5500'), { code: '5500' });
});

test('voucher account: accounts with their own records cannot be chosen', () => {
  for (const code of ['2000', '1100', '2100', '1150', '2150', '2200', '3900']) {
    assert.ok(choose('payment', expenseRow, code).error, `payment ${code}`);
    assert.ok(choose('receipt', { payer_type: 'other', payment_method: 'cash' }, code).error, `receipt ${code}`);
    assert.ok(choose('expense', { category: 'other' }, code).error, `expense ${code}`);
  }
});

test('voucher account: rubbish is refused', () => {
  for (const code of ['9999', 'abc', "5200' OR 1=1", '5200 ']) {
    const out = choose('payment', expenseRow, code);
    if (code === '5200 ') assert.deepEqual(out, { code: '5200' });
    else assert.ok(out.error, code);
  }
});

test('voucher account: a store payment stays on store payables', () => {
  const store = { payee_type: 'store', payee_id: 5, payee_name: 'Adnan Broast', payment_method: 'cash' };
  assert.deepEqual(choose('payment', store, '2000'), { code: null });
  assert.match(choose('payment', store, '5200').error, /2000 Store payables/);
});

test('voucher account: a receipt from a rider or customer stays on their balance', () => {
  assert.match(choose('receipt', { payer_type: 'rider', payer_id: 3 }, '4900').error, /1100/);
  assert.match(choose('receipt', { payer_type: 'customer', payer_id: 3 }, '4900').error, /2100/);
});

test('voucher account: cash cannot be paid to cash', () => {
  assert.match(choose('payment', expenseRow, '1000').error, /already moves/);
  assert.deepEqual(choose('payment', expenseRow, '1010'), { code: '1010' });
  assert.match(choose('payment', { ...expenseRow, payment_method: 'bank_transfer' }, '1010').error, /already moves/);
  assert.match(choose('payment', { ...expenseRow, payment_method: 'cheque' }, '1010').error, /already moves/);
  assert.deepEqual(choose('payment', { ...expenseRow, payment_method: 'bank_transfer' }, '1000'), { code: '1000' });
});

test('voucher account: the suggested account is always accepted', () => {
  const adjustment = { payee_type: 'other', payee_name: 'Reconciliation', payment_method: 'cash' };
  assert.equal(ledger.voucherAccount('payment', adjustment).code, '3900');
  assert.deepEqual(choose('payment', adjustment, '3900'), { code: '3900' });
});

test('voucher account: the list marks what each form may offer', () => {
  const list = ledger.voucherAccountList();
  assert.equal(list.length, 22);
  const rent = list.find((a) => a.code === '5200');
  assert.ok(rent.payment && rent.receipt && rent.expense);
  const payables = list.find((a) => a.code === '2000');
  assert.ok(!payables.payment && !payables.receipt && !payables.expense);
  assert.ok(list.find((a) => a.code === '4900').receipt);
  assert.ok(!list.find((a) => a.code === '4900').payment);
});

test('journal voucher: only real accounts are accepted', () => {
  assert.ok(ledger.isJournalAccount('2000 Store payables'));
  assert.ok(ledger.isJournalAccount('5200'));
  assert.ok(ledger.isJournalAccount('Rent'));
  assert.ok(!ledger.isJournalAccount('Sales'));
  assert.ok(!ledger.isJournalAccount('Cash'));
  assert.ok(!ledger.isJournalAccount('9999 Made up'));
  assert.ok(!ledger.isJournalAccount(''));
});

test('the chosen account is locked once a voucher is approved', () => {
  for (const doc of ['payment_voucher', 'receipt_voucher', 'expense']) {
    assert.equal(DOCUMENTS[doc].lockedFields.gl_account_code, 'gl_account_code', doc);
  }
});
