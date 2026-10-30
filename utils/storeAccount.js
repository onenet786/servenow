// Store account: the per-store sub-ledger behind GL account 2000 (Store payables).
//
//   balance = store payable of delivered order items
//           - payments to the store
//
// Store payable keeps the per-store-type rule used by the general ledger:
// pickup-paid stores ("Cash Only", "Cash with Discount") are owed cost price,
// credit stores are owed price less the store discount.
//
// Payments to the store (each one debits 2000 in services/ledger.js):
//   - paid store settlements (net_amount), linked to order lines or not
//   - rider payments at pickup for pickup-paid stores (rider wallet debits),
//     less reversals when such an order is cancelled
//   - approved/paid payment vouchers with payee_type 'store'
//   - posted journal voucher lines on the store payables account
//   - received receipt vouchers from a store count as a negative payment
//
// A positive balance is owed to the store; a negative balance is store credit
// (the store has been paid more than it earned).
//
// Credit is consumed exactly once: order lines linked to a settlement (or paid
// by a rider at pickup) count as settled, so
//   available credit = max(0, payments - payable of settled lines)
// and the remaining open lines are covered first-in-first-out by that credit.
// When covered lines are later linked to a settlement, their payable becomes
// settled and the credit shrinks by the same amount.
//
// Everything here only reads the database.

const PICKUP_PAID_TERMS = ['cash only', 'cash with discount'];

const toCents = (value) => Math.round(Number(value || 0) * 100);
const fromCents = (cents) => Math.round(cents) / 100;
const isPickupPaidTerm = (term) => PICKUP_PAID_TERMS.includes(String(term || '').trim().toLowerCase());

// Store payable of one order line (not summed). Aliases: order_items, products, stores.
function storePayableLineSql({ oi = 'oi', p = 'p', s = 's' } = {}) {
  return `CASE
             WHEN LOWER(TRIM(COALESCE(${s}.payment_term, ''))) IN ('${PICKUP_PAID_TERMS.join("','")}')
               THEN COALESCE(${oi}.cost_price,
                    (SELECT psp.cost_price FROM product_size_prices psp
                      WHERE psp.product_id = ${oi}.product_id
                        AND ((${oi}.size_id IS NOT NULL AND psp.size_id = ${oi}.size_id AND psp.unit_id IS NULL)
                          OR (${oi}.unit_id IS NOT NULL AND psp.unit_id = ${oi}.unit_id AND psp.size_id IS NULL))
                      LIMIT 1),
                    ${p}.cost_price, ${oi}.price) * ${oi}.quantity
             ELSE GREATEST(0, ${oi}.quantity * ${oi}.price - ${oi}.quantity * (
               CASE
                 WHEN LOWER(TRIM(COALESCE(${s}.payment_term, ''))) LIKE '%discount%'
                      AND COALESCE(${s}.store_discount_apply_all_products, 0) = 1
                      AND COALESCE(${s}.store_discount_percent, 0) > 0
                   THEN ${oi}.price * (COALESCE(${s}.store_discount_percent, 0) / 100)
                 WHEN ${oi}.discount_type = 'percent' AND COALESCE(${oi}.discount_value, 0) > 0
                   THEN ${oi}.price * (COALESCE(${oi}.discount_value, 0) / 100)
                 WHEN ${oi}.discount_type = 'amount' AND COALESCE(${oi}.discount_value, 0) > 0
                   THEN COALESCE(${oi}.discount_value, 0)
                 ELSE 0
               END))
           END`;
}

// ---------------------------------------------------------------------------
// Rider payments at pickup (shared with services/ledger.js)

async function loadStoreNameIndex(db) {
  const [stores] = await db.query('SELECT id, name, payment_term FROM stores');
  const byName = new Map();
  for (const s of stores) byName.set(String(s.name || '').trim().toLowerCase(), s.id);
  return byName;
}

// Pickup-paid stores on each order, for payments that name a store which has
// since been renamed or deleted.
async function loadPickupStoresOnOrder(db) {
  const [orderStores] = await db.query(`
    SELECT DISTINCT oi.order_id, COALESCE(oi.store_id, p.store_id) AS store_id
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
    WHERE LOWER(TRIM(COALESCE(s.payment_term, ''))) IN ('${PICKUP_PAID_TERMS.join("','")}')`);
  const pickupStoresOnOrder = new Map();
  for (const r of orderStores) {
    const key = String(r.order_id);
    if (!pickupStoresOnOrder.has(key)) pickupStoresOnOrder.set(key, []);
    pickupStoresOnOrder.get(key).push(r.store_id);
  }
  return pickupStoresOnOrder;
}

// Returns (description, orderId) => store id or null.
function createPickupStoreResolver(storeIdsByName, pickupStoresOnOrder) {
  return (text, orderId = null) => {
    const m = String(text || '').match(/pickup-paid store (.+?) for order/i);
    const byName = m ? storeIdsByName.get(m[1].trim().toLowerCase()) : null;
    if (byName) return byName;
    const onOrder = orderId == null ? null : pickupStoresOnOrder.get(String(orderId));
    return onOrder && onOrder.length === 1 ? onOrder[0] : null;
  };
}

// Rider wallet entries that pay (or un-pay) a pickup-paid store. amount_c > 0 is
// a payment to the store. Same identification rules as the general ledger.
async function loadRiderPickupPayments(db, { storeIdsByName = null, pickupStoresOnOrder = null } = {}) {
  const names = storeIdsByName || (await loadStoreNameIndex(db));
  const onOrder = pickupStoresOnOrder || (await loadPickupStoresOnOrder(db));
  const resolve = createPickupStoreResolver(names, onOrder);
  const [rows] = await db.query(`
    SELECT wt.id, wt.type, wt.amount, wt.description, wt.reference_type, wt.reference_id, w.rider_id,
           DATE_FORMAT(wt.created_at, '%Y-%m-%d %H:%i:%s') AS ts
    FROM wallet_transactions wt
    JOIN wallets w ON w.id = wt.wallet_id
    WHERE w.rider_id IS NOT NULL
      AND ((wt.reference_type = 'order' AND wt.type = 'debit')
        OR (wt.reference_type = 'order_cancel_reversal' AND wt.type IN ('credit', 'refund')))
    ORDER BY wt.id`);

  const pickupStoreByOrder = new Map();
  for (const r of rows) {
    if (r.reference_type === 'order' && r.type === 'debit') {
      const storeId = resolve(r.description, r.reference_id);
      if (storeId) {
        const key = `${r.rider_id}:${r.reference_id}`;
        const seen = pickupStoreByOrder.get(key);
        pickupStoreByOrder.set(key, seen && seen !== storeId ? 'ambiguous' : storeId);
      }
    }
  }

  const payments = [];
  const unidentified = [];
  for (const r of rows) {
    const cents = toCents(r.amount);
    if (!cents) continue;
    const desc = String(r.description || '').slice(0, 200);
    const base = { source: 'wallet_transaction', id: r.id, ts: r.ts, date: String(r.ts || '').slice(0, 10), order_id: r.reference_id, rider_id: r.rider_id, description: desc };
    if (r.reference_type === 'order' && r.type === 'debit') {
      if (!/pickup-paid store/i.test(desc)) continue;
      const storeId = resolve(desc, r.reference_id);
      if (storeId) payments.push({ ...base, store_id: storeId, amount_c: cents, reversal: false });
      else unidentified.push({ ...base, amount_c: cents });
    } else if (r.reference_type === 'order_cancel_reversal') {
      const named = /^Reversal: /.test(desc) ? resolve(desc, null) : null;
      const storeId = named || pickupStoreByOrder.get(`${r.rider_id}:${r.reference_id}`);
      if (storeId && storeId !== 'ambiguous') payments.push({ ...base, store_id: storeId, amount_c: -cents, reversal: true });
      else unidentified.push({ ...base, amount_c: -cents });
    }
  }
  return { payments, unidentified };
}

// ---------------------------------------------------------------------------
// Loading

const columnCache = new Map();
async function hasColumnCached(db, table, column) {
  const key = `${table}.${column}`;
  if (columnCache.get(key)) return true;
  try {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    );
    const found = Number(rows?.[0]?.cnt || 0) > 0;
    if (found) columnCache.set(key, true);
    return found;
  } catch (_) {
    return false;
  }
}
function markColumnPresent(table, column) {
  columnCache.set(`${table}.${column}`, true);
}

async function safeQuery(db, sql, params = []) {
  try {
    const [rows] = await db.query(sql, params);
    return rows || [];
  } catch (err) {
    if (err && (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146)) return [];
    throw err;
  }
}

// Loads every source document that touches store payables, optionally for one store.
async function loadStoreAccountData(db, { storeId = null } = {}) {
  const sid = storeId == null || storeId === '' ? null : Number(storeId);
  const storeWhere = sid ? 'WHERE id = ?' : '';
  const storeParams = sid ? [sid] : [];

  const [stores] = await db.query(
    `SELECT id, name, payment_term, store_discount_percent, store_discount_apply_all_products,
            commission_rate, payment_grace_days, is_active
     FROM stores ${storeWhere} ORDER BY name`,
    storeParams
  );

  const [items] = await db.query(
    `SELECT oi.id, oi.order_id, o.order_number, COALESCE(oi.store_id, p.store_id) AS store_id,
            oi.quantity, oi.price, (oi.price * oi.quantity) AS item_value,
            ${storePayableLineSql()} AS store_payable,
            oi.settlement_id, o.payment_status,
            DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i:%s') AS order_created_ts,
            DATE_FORMAT(COALESCE(o.updated_at, o.created_at), '%Y-%m-%d %H:%i:%s') AS order_updated_ts,
            (LOWER(TRIM(COALESCE(p.description, ''))) = 'created from admin manual order') AS manual_product
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id AND o.status = 'delivered'
     JOIN products p ON p.id = oi.product_id
     LEFT JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
     ${sid ? 'WHERE COALESCE(oi.store_id, p.store_id) = ?' : ''}
     ORDER BY oi.order_id, oi.id`,
    storeParams
  );

  // Delivery date = the rider's first cash collection for the order, else its last update (as the GL).
  const orderIds = [...new Set(items.map((i) => String(i.order_id)))];
  let collections = [];
  if (orderIds.length) {
    collections = await safeQuery(db,
      `SELECT wt.reference_id AS order_id, DATE_FORMAT(MIN(wt.created_at), '%Y-%m-%d %H:%i:%s') AS first_collect
       FROM wallet_transactions wt
       JOIN wallets w ON w.id = wt.wallet_id
       WHERE w.rider_id IS NOT NULL AND wt.type = 'credit' AND wt.reference_type = 'order'
         ${sid ? 'AND wt.reference_id IN (?)' : ''}
       GROUP BY wt.reference_id`,
      sid ? [orderIds] : []);
  }

  const hasKind = await hasColumnCached(db, 'store_settlements', 'settlement_kind');
  const hasCredit = await hasColumnCached(db, 'store_settlements', 'credit_applied');
  const settlements = await safeQuery(db,
    `SELECT ss.id, ss.settlement_number, ss.store_id, ss.status,
            DATE_FORMAT(ss.settlement_date, '%Y-%m-%d') AS settlement_date,
            DATE_FORMAT(COALESCE(ss.paid_at, ss.settlement_date, ss.created_at), '%Y-%m-%d %H:%i:%s') AS paid_ts,
            DATE_FORMAT(ss.created_at, '%Y-%m-%d %H:%i:%s') AS created_ts,
            ss.total_orders_amount, ss.commissions, ss.deductions, ss.net_amount, ss.payment_method, ss.notes,
            ${hasKind ? 'ss.settlement_kind' : 'NULL'} AS settlement_kind,
            ${hasCredit ? 'ss.credit_applied' : '0'} AS credit_applied,
            (SELECT COUNT(*) FROM order_items x WHERE x.settlement_id = ss.id) AS linked_items
     FROM store_settlements ss
     ${sid ? 'WHERE ss.store_id = ?' : ''}
     ORDER BY ss.id`,
    storeParams);

  const vouchers = await safeQuery(db,
    `SELECT id, voucher_number, payee_id AS store_id, payee_name, purpose, amount, payment_method, status,
            DATE_FORMAT(voucher_date, '%Y-%m-%d') AS voucher_date
     FROM cash_payment_vouchers
     WHERE status IN ('approved', 'paid') AND payee_type = 'store' AND payee_id IS NOT NULL AND payee_id <> 0
       ${sid ? 'AND payee_id = ?' : ''}`,
    storeParams);

  const receipts = await safeQuery(db,
    `SELECT id, voucher_number, payer_id AS store_id, payer_name, amount, payment_method,
            DATE_FORMAT(COALESCE(voucher_date, received_at), '%Y-%m-%d') AS voucher_date
     FROM cash_receipt_vouchers
     WHERE status = 'received' AND payer_type = 'store' AND payer_id IS NOT NULL AND payer_id <> 0
       ${sid ? 'AND payer_id = ?' : ''}`,
    storeParams);

  const { journalAccount } = require('../services/ledger');
  const jvRows = await safeQuery(db,
    `SELECT jv.id, jv.voucher_number, DATE_FORMAT(jv.voucher_date, '%Y-%m-%d') AS voucher_date,
            e.account_name, e.entity_id AS store_id, e.entry_type, e.amount
     FROM journal_vouchers jv
     JOIN journal_voucher_entries e ON e.jnv_id = jv.id
     WHERE jv.status = 'posted' AND e.entity_type = 'store' AND e.entity_id IS NOT NULL AND e.entity_id <> ''
       ${sid ? 'AND e.entity_id = ?' : ''}
     ORDER BY jv.id, e.id`,
    sid ? [String(sid)] : []);
  const journals = jvRows.filter((e) => journalAccount(e.account_name) === '2000');

  const pickup = await loadRiderPickupPayments(db);
  const pickupPayments = sid ? pickup.payments.filter((p) => Number(p.store_id) === sid) : pickup.payments;

  const riderStorePayments = await safeQuery(db,
    `SELECT order_id, store_id FROM rider_store_payments ${sid ? 'WHERE store_id = ?' : ''}`,
    storeParams);

  return {
    storeId: sid,
    stores, items, collections, settlements, vouchers, receipts, journals,
    pickupPayments, unidentifiedPickupPayments: sid ? [] : pickup.unidentified,
    riderStorePayments,
  };
}

// ---------------------------------------------------------------------------
// Building accounts (pure)

const METHOD_KEYS = { cash: 'cash', bank_transfer: 'bank', check: 'cheque', cheque: 'cheque', card: 'bank' };
const methodKey = (m) => METHOD_KEYS[String(m || '').toLowerCase()] || 'cash';

function emptyAccount(storeId, store) {
  return {
    store_id: Number(storeId),
    name: store ? store.name : `Store #${storeId} (deleted)`,
    exists: Boolean(store),
    payment_term: store ? store.payment_term || null : null,
    pickup_paid: store ? isPickupPaidTerm(store.payment_term) : false,
    discount_percent: store ? Number(store.store_discount_percent || 0) : 0,
    discount_all_products: store ? Number(store.store_discount_apply_all_products || 0) === 1 : false,
    grace_days: store ? Number(store.payment_grace_days || 0) : 0,
    is_active: store ? Boolean(Number(store.is_active)) : false,
    items: [],
    payments: [],
    settlements: [],
  };
}

function buildAccounts(raw) {
  const storesById = new Map(raw.stores.map((s) => [Number(s.id), s]));
  const accounts = new Map();
  const acc = (storeId) => {
    const id = Number(storeId);
    if (!accounts.has(id)) accounts.set(id, emptyAccount(id, storesById.get(id)));
    return accounts.get(id);
  };
  for (const s of raw.stores) acc(s.id);

  const collectedAt = new Map((raw.collections || []).map((c) => [String(c.order_id), c.first_collect]));
  const pickupPaidOrders = new Set();
  for (const p of raw.pickupPayments || []) if (!p.reversal) pickupPaidOrders.add(`${p.store_id}:${p.order_id}`);
  for (const r of raw.riderStorePayments || []) pickupPaidOrders.add(`${r.store_id}:${r.order_id}`);
  const settlementById = new Map((raw.settlements || []).map((s) => [Number(s.id), s]));

  for (const it of raw.items) {
    if (it.store_id == null) continue;
    const a = acc(it.store_id);
    const ts = collectedAt.get(String(it.order_id)) || it.order_updated_ts;
    const settlement = it.settlement_id ? settlementById.get(Number(it.settlement_id)) : null;
    const linked = Boolean(settlement && settlement.status !== 'cancelled');
    const pickupPaid = pickupPaidOrders.has(`${it.store_id}:${it.order_id}`);
    a.items.push({
      id: Number(it.id),
      order_id: Number(it.order_id),
      order_number: it.order_number,
      ts,
      date: String(ts || '').slice(0, 10),
      order_date: String(it.order_created_ts || '').slice(0, 10),
      value_c: toCents(it.item_value),
      payable_raw: Number(it.store_payable || 0),
      payable_c: toCents(it.store_payable),
      settlement_id: it.settlement_id ? Number(it.settlement_id) : null,
      settlement_number: settlement ? settlement.settlement_number : null,
      settlement_status: settlement ? settlement.status : null,
      settled: linked || pickupPaid,
      settled_by: linked ? 'settlement' : pickupPaid ? 'pickup' : null,
      payment_status: it.payment_status,
      manual_product: Boolean(Number(it.manual_product)),
    });
  }

  for (const s of raw.settlements || []) {
    const a = acc(s.store_id);
    const kind = s.settlement_kind || (Number(s.linked_items) > 0 ? 'orders' : (toCents(s.total_orders_amount) === 0 ? 'lump_sum' : 'manual'));
    const settlement = {
      id: Number(s.id),
      number: s.settlement_number,
      status: s.status,
      date: s.settlement_date,
      paid_ts: s.paid_ts,
      created_ts: s.created_ts,
      total_c: toCents(s.total_orders_amount),
      commissions_c: toCents(s.commissions),
      deductions_c: toCents(s.deductions),
      credit_applied_c: toCents(s.credit_applied),
      net_c: toCents(s.net_amount),
      method: s.payment_method,
      notes: s.notes || '',
      kind,
      on_account: kind === 'on_account',
      linked_items: Number(s.linked_items || 0),
    };
    a.settlements.push(settlement);
    if (s.status === 'paid' && settlement.net_c) {
      a.payments.push({
        type: settlement.on_account ? 'on_account' : 'settlement',
        id: settlement.id, ref: settlement.number, ts: s.paid_ts, date: String(s.paid_ts || '').slice(0, 10),
        amount_c: settlement.net_c, method: methodKey(s.payment_method), settlement,
      });
    }
  }

  for (const p of raw.pickupPayments || []) {
    acc(p.store_id).payments.push({
      type: 'pickup', id: p.id, ref: p.reversal ? `Reversal for order ${p.order_id}` : `Order ${p.order_id}`,
      ts: p.ts, date: p.date, amount_c: p.amount_c, method: 'pickup', order_id: Number(p.order_id) || null,
      rider_id: p.rider_id, reversal: p.reversal, description: p.description,
    });
  }
  for (const v of raw.vouchers || []) {
    const cents = toCents(v.amount);
    if (!cents) continue;
    acc(v.store_id).payments.push({
      type: 'voucher', id: Number(v.id), ref: v.voucher_number, ts: `${v.voucher_date} 23:59:59`, date: v.voucher_date,
      amount_c: cents, method: methodKey(v.payment_method), description: v.purpose || '',
    });
  }
  for (const r of raw.receipts || []) {
    const cents = toCents(r.amount);
    if (!cents) continue;
    acc(r.store_id).payments.push({
      type: 'receipt', id: Number(r.id), ref: r.voucher_number, ts: `${r.voucher_date} 23:59:59`, date: r.voucher_date,
      amount_c: -cents, method: methodKey(r.payment_method), description: r.payer_name || '',
    });
  }
  for (const j of raw.journals || []) {
    const cents = toCents(j.amount) * (j.entry_type === 'credit' ? -1 : 1);
    if (!cents) continue;
    acc(j.store_id).payments.push({
      type: 'journal', id: Number(j.id), ref: j.voucher_number, ts: `${j.voucher_date} 23:59:59`, date: j.voucher_date,
      amount_c: cents, method: 'journal', description: j.account_name || '',
    });
  }

  for (const a of accounts.values()) {
    a.items.sort((x, y) => String(x.ts).localeCompare(String(y.ts)) || x.order_id - y.order_id || x.id - y.id);
    a.payments.sort((x, y) => String(x.ts).localeCompare(String(y.ts)) || String(x.ref).localeCompare(String(y.ref)));
  }
  return accounts;
}

// Groups order lines per order, rounding the payable per order as the GL does.
function ordersOf(account) {
  const map = new Map();
  for (const it of account.items) {
    if (!map.has(it.order_id)) {
      map.set(it.order_id, { order_id: it.order_id, order_number: it.order_number, ts: it.ts, date: it.date, value_raw: 0, payable_raw: 0, lines: 0 });
    }
    const o = map.get(it.order_id);
    o.value_raw += it.value_c / 100;
    o.payable_raw += it.payable_raw;
    o.lines += 1;
  }
  return [...map.values()].map((o) => ({ ...o, value_c: toCents(o.value_raw), payable_c: toCents(o.payable_raw) }));
}

// FIFO coverage of order lines by store credit. Lines must be in date order.
// Returns per-line covered/due cents and the credit applied.
function applyCreditFifo(lines, creditCents, payableOf = (l) => l.payable_c) {
  let remaining = Math.max(0, Math.round(creditCents || 0));
  const out = lines.map((line) => {
    const payable = Math.max(0, Math.round(payableOf(line)));
    const covered = Math.min(remaining, payable);
    remaining -= covered;
    return { line, payable_c: payable, covered_c: covered, due_c: payable - covered };
  });
  return { lines: out, applied_c: Math.max(0, Math.round(creditCents || 0)) - remaining, left_c: remaining };
}

const daysBetween = (fromYmd, toYmd) => {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : 0;
};

const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Current position of one store: balance, credit, open lines with FIFO coverage, aging.
function accountPosition(account, { today = todayYmd() } = {}) {
  const orders = ordersOf(account);
  const payableC = orders.reduce((s, o) => s + o.payable_c, 0);
  const paidC = account.payments.reduce((s, p) => s + p.amount_c, 0);
  const settledC = account.items.filter((i) => i.settled).reduce((s, i) => s + i.payable_c, 0);
  const creditC = Math.max(0, paidC - settledC);
  const open = account.items.filter((i) => !i.settled && i.payable_c > 0);
  const fifo = applyCreditFifo(open, creditC);
  const aging = { d0_7: 0, d8_15: 0, d16_30: 0, d30_plus: 0 };
  const dueOrders = new Set();
  let dueC = 0;
  let coveredC = 0;
  let oldest = null;
  for (const r of fifo.lines) {
    coveredC += r.covered_c;
    if (r.due_c <= 0) continue;
    dueC += r.due_c;
    dueOrders.add(r.line.order_id);
    if (!oldest || r.line.date < oldest) oldest = r.line.date;
    const age = daysBetween(r.line.date, today);
    if (age <= 7) aging.d0_7 += r.due_c;
    else if (age <= 15) aging.d8_15 += r.due_c;
    else if (age <= 30) aging.d16_30 += r.due_c;
    else aging.d30_plus += r.due_c;
  }
  const daysOutstanding = oldest ? daysBetween(oldest, today) : 0;
  const openSettlements = account.settlements.filter((s) => s.status === 'pending' || s.status === 'approved');
  return {
    payable_c: payableC,
    paid_c: paidC,
    balance_c: payableC - paidC,
    settled_payable_c: settledC,
    credit_c: creditC,
    open_lines: fifo.lines,
    open_payable_c: fifo.lines.reduce((s, r) => s + r.payable_c, 0),
    covered_c: coveredC,
    credit_left_c: fifo.left_c,
    unsettled_c: dueC,
    unsettled_orders: dueOrders.size,
    oldest_unpaid: oldest,
    days_outstanding: daysOutstanding,
    overdue: dueC > 0 && daysOutstanding > Math.max(0, account.grace_days || 0),
    aging,
    open_settlements: openSettlements.length,
    open_settlements_c: openSettlements.reduce((s, x) => s + x.net_c, 0),
    orders,
  };
}

const inRange = (date, from, to) => (!from || date >= from) && (!to || date <= to);

// Period figures for one store (dates are YYYY-MM-DD, inclusive; null = open-ended).
function accountPeriod(account, { from = null, to = null, orders = null } = {}) {
  const list = orders || ordersOf(account);
  const before = (d) => from && d < from;
  let openingC = 0;
  const period = {
    delivered_orders: 0, gross_c: 0, commission_c: 0, credit_given_c: 0,
    paid: { cash: 0, bank: 0, cheque: 0, pickup: 0, voucher: 0, adjustment: 0 },
    total_paid_c: 0,
  };
  for (const o of list) {
    if (before(o.date)) openingC += o.payable_c;
    else if (inRange(o.date, from, to)) {
      period.delivered_orders += 1;
      period.gross_c += o.value_c;
      period.credit_given_c += o.payable_c;
      period.commission_c += o.value_c - o.payable_c;
    }
  }
  let last = null;
  for (const p of account.payments) {
    if (before(p.date)) { openingC -= p.amount_c; continue; }
    if (!inRange(p.date, from, to)) continue;
    let bucket;
    if (p.type === 'settlement' || p.type === 'on_account') bucket = p.method;
    else if (p.type === 'pickup') bucket = 'pickup';
    else if (p.type === 'voucher') bucket = 'voucher';
    else bucket = 'adjustment';
    period.paid[bucket] = (period.paid[bucket] || 0) + p.amount_c;
    period.total_paid_c += p.amount_c;
  }
  for (const p of account.payments) {
    if (p.amount_c > 0 && (!to || p.date <= to) && (!last || p.ts >= last.ts)) last = p;
  }
  return {
    ...period,
    opening_c: openingC,
    closing_c: openingC + period.credit_given_c - period.total_paid_c,
    last_payment: last ? { date: last.date, amount_c: last.amount_c, type: last.type, ref: last.ref } : null,
  };
}

// Chronological statement with running balance.
function accountStatement(account, { from = null, to = null } = {}) {
  const rows = [];
  for (const o of ordersOf(account)) {
    rows.push({ ts: o.ts, date: o.date, kind: 0, type: 'order', label: `Order delivered #${o.order_number}`, ref: o.order_number,
      order_id: o.order_id, credit_given_c: o.payable_c, paid_c: 0, gross_c: o.value_c, lines: o.lines });
  }
  const labels = {
    settlement: (p) => (p.settlement && p.settlement.linked_items === 0 ? `Settlement ${p.ref} (no orders linked)` : `Settlement ${p.ref}`),
    on_account: (p) => `Payment on account ${p.ref}`,
    pickup: (p) => (p.reversal ? `Rider pickup payment reversed (order ${p.order_id})` : `Rider paid at pickup (order ${p.order_id})`),
    voucher: (p) => `Payment voucher ${p.ref}`,
    receipt: (p) => `Receipt from store ${p.ref}`,
    journal: (p) => `Journal voucher ${p.ref}`,
  };
  for (const p of account.payments) {
    rows.push({
      ts: p.ts, date: p.date, kind: 1, type: p.type, label: labels[p.type](p), ref: p.ref, method: p.method,
      settlement_id: p.settlement ? p.settlement.id : null, order_id: p.order_id || null,
      linked_items: p.settlement ? p.settlement.linked_items : null,
      credit_given_c: 0, paid_c: p.amount_c,
    });
  }
  rows.sort((x, y) => String(x.ts).localeCompare(String(y.ts)) || x.kind - y.kind);
  let opening = 0;
  const entries = [];
  let running = 0;
  for (const r of rows) {
    if (from && r.date < from) { opening += r.credit_given_c - r.paid_c; continue; }
    if (to && r.date > to) continue;
    if (!entries.length) running = opening;
    running += r.credit_given_c - r.paid_c;
    entries.push({ ...r, balance_c: running });
  }
  if (!entries.length) running = opening;
  return {
    opening_c: opening,
    closing_c: running,
    total_credit_given_c: entries.reduce((s, r) => s + r.credit_given_c, 0),
    total_paid_c: entries.reduce((s, r) => s + r.paid_c, 0),
    entries,
  };
}

// Payments not linked to any order line that were followed by a settlement
// linking the very lines they had paid (FIFO), i.e. the store was paid twice.
function findDoublePayments(account) {
  const lumps = account.payments.filter((p) =>
    ((p.type === 'settlement' || p.type === 'on_account') && p.settlement && p.settlement.linked_items === 0) ||
    p.type === 'voucher' || (p.type === 'journal' && p.amount_c > 0));
  if (!lumps.length) return [];
  const linkedSettlements = account.settlements.filter((s) => s.status !== 'cancelled' && s.linked_items > 0);
  const itemsBySettlement = new Map();
  for (const it of account.items) {
    if (!it.settlement_id) continue;
    if (!itemsBySettlement.has(it.settlement_id)) itemsBySettlement.set(it.settlement_id, []);
    itemsBySettlement.get(it.settlement_id).push(it);
  }
  const events = [];
  for (const it of account.items) events.push({ ts: it.ts, order: 0, kind: 'delivery', item: it });
  for (const s of linkedSettlements) events.push({ ts: s.created_ts, order: 1, kind: 'link', settlement: s });
  for (const p of lumps) events.push({ ts: p.ts, order: 2, kind: 'lump', payment: p });
  events.sort((a, b) => String(a.ts).localeCompare(String(b.ts)) || a.order - b.order);

  const state = new Map(); // item id -> { remaining, covered, sources: Map(ref -> cents), linked }
  const pool = [];
  const advances = [];
  const cover = (st, payment, amount) => {
    st.remaining -= amount;
    st.covered += amount;
    st.sources.set(payment.ref, (st.sources.get(payment.ref) || 0) + amount);
  };
  const issues = [];
  for (const ev of events) {
    if (ev.kind === 'delivery') {
      const prior = state.get(ev.item.id);
      if (prior && prior.linked) continue;
      const st = { item: ev.item, remaining: Math.max(0, ev.item.payable_c), covered: 0, sources: new Map(), linked: false };
      state.set(ev.item.id, st);
      pool.push(st);
      while (st.remaining > 0 && advances.length) {
        const adv = advances[0];
        const amount = Math.min(adv.left, st.remaining);
        cover(st, adv.payment, amount);
        adv.left -= amount;
        if (adv.left <= 0) advances.shift();
      }
    } else if (ev.kind === 'lump') {
      let left = ev.payment.amount_c;
      for (const st of pool) {
        if (left <= 0) break;
        if (st.linked || st.remaining <= 0) continue;
        const amount = Math.min(left, st.remaining);
        cover(st, ev.payment, amount);
        left -= amount;
      }
      if (left > 0) advances.push({ payment: ev.payment, left });
    } else {
      const s = ev.settlement;
      let overlap = 0;
      const sources = new Map();
      let first = null;
      let last = null;
      for (const it of itemsBySettlement.get(s.id) || []) {
        let st = state.get(it.id);
        if (!st) {
          state.set(it.id, { item: it, remaining: 0, covered: 0, sources: new Map(), linked: true });
          continue;
        }
        if (st.linked) continue;
        st.linked = true;
        if (st.covered > 0) {
          overlap += st.covered;
          for (const [ref, c] of st.sources) sources.set(ref, (sources.get(ref) || 0) + c);
          if (!first || it.date < first) first = it.date;
          if (!last || it.date > last) last = it.date;
        }
      }
      // Credit the settlement itself used: recorded credit_applied, or (older
      // settlements) the part of its linked lines' payable it did not pay.
      const linkedPayable = (itemsBySettlement.get(s.id) || []).reduce((sum, it) => sum + Math.max(0, it.payable_c), 0);
      const creditUsed = Math.max(0, s.credit_applied_c, linkedPayable - s.deductions_c - s.net_c);
      const doubleC = overlap - creditUsed;
      if (doubleC > 0) {
        issues.push({
          settlement_id: s.id, settlement_number: s.number, settlement_status: s.status, settlement_date: s.date,
          double_paid_c: doubleC, lump_payments: [...sources.entries()].map(([ref, c]) => ({ ref, amount_c: c })),
          items_from: first, items_to: last,
        });
      }
    }
  }
  return issues;
}

// Read-only list of data issues for one store.
function accountIssues(account, position = accountPosition(account)) {
  const issues = { store_credit_c: 0, unlinked_payments: [], net_mismatches: [], double_payments: [] };
  if (position.balance_c < 0) issues.store_credit_c = -position.balance_c;
  for (const s of account.settlements) {
    if (s.status === 'paid' && s.linked_items === 0 && s.net_c > 0) {
      issues.unlinked_payments.push({ settlement_id: s.id, settlement_number: s.number, date: String(s.paid_ts || s.date).slice(0, 10), net_c: s.net_c, on_account: s.on_account, method: s.method, notes: s.notes });
    }
    if (s.status === 'cancelled') continue;
    const lumpSum = s.linked_items === 0 && s.total_c === 0;
    if (lumpSum) continue; // listed above (or a recorded payment on account)
    const expected = s.total_c - s.commissions_c - s.deductions_c - s.credit_applied_c;
    if (Math.abs(expected - s.net_c) > 1) { // ignore a 1 paisa rounding difference
      issues.net_mismatches.push({ settlement_id: s.id, settlement_number: s.number, status: s.status, date: s.date, total_c: s.total_c, commissions_c: s.commissions_c, deductions_c: s.deductions_c, credit_applied_c: s.credit_applied_c, net_c: s.net_c, expected_c: expected, difference_c: s.net_c - expected });
    }
  }
  issues.double_payments = findDoublePayments(account);
  return issues;
}

// ---------------------------------------------------------------------------
// Convenience

async function loadStoreAccounts(db, opts = {}) {
  const raw = await loadStoreAccountData(db, opts);
  const accounts = buildAccounts(raw);
  return { accounts, raw };
}

async function getStoreAccount(db, storeId, { today } = {}) {
  const { accounts } = await loadStoreAccounts(db, { storeId });
  const account = accounts.get(Number(storeId)) || emptyAccount(storeId, null);
  return { account, position: accountPosition(account, { today }) };
}

module.exports = {
  PICKUP_PAID_TERMS,
  isPickupPaidTerm,
  storePayableLineSql,
  loadStoreNameIndex,
  loadPickupStoresOnOrder,
  createPickupStoreResolver,
  loadRiderPickupPayments,
  loadStoreAccountData,
  loadStoreAccounts,
  buildAccounts,
  ordersOf,
  applyCreditFifo,
  accountPosition,
  accountPeriod,
  accountStatement,
  accountIssues,
  findDoublePayments,
  getStoreAccount,
  hasColumnCached,
  markColumnPresent,
  toCents,
  fromCents,
  daysBetween,
  todayYmd,
};
