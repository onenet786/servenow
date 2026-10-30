// General ledger (double-entry).
//
// The GL is derived from the business source documents (orders, wallet
// transactions, rider cash movements, settlements, vouchers, expenses, journal
// vouchers and gateway payments). syncLedger() builds the journal each document
// should have and compares it with what is posted:
//   - missing        -> post it
//   - changed/void   -> post a reversal dated today, then the corrected journal
// Posted journals are never updated or deleted, so history stays auditable.
// Every journal must balance to the paisa or it is not posted.
//
// Policies (agreed 28 Oct 2026):
//   - Revenue is recognised on delivery.
//   - Wallet top-ups are a liability to the customer, not income.
//   - Store payable keeps the per-store-type rule: pickup-paid stores ("Cash
//     Only", "Cash with Discount") are owed cost price, credit stores are owed
//     price less the store discount.
//   - Commission income = item value - store payable; delivery fees are income.

const ACCOUNTS = [
  // code, name, type
  ['1000', 'Office cash', 'asset'],
  ['1010', 'Bank and gateway', 'asset'],
  ['1100', 'Rider cash receivable', 'asset'],
  ['1150', 'Cash collections clearing', 'asset'],
  ['1300', 'Rider advances', 'asset'],
  ['2000', 'Store payables', 'liability'],
  ['2100', 'Customer wallet balances', 'liability'],
  ['2150', 'Wallet transfers in transit', 'liability'],
  ['2200', 'Customer prepayments', 'liability'],
  ['3900', 'Suspense (needs review)', 'equity'],
  ['4000', 'Commission income', 'income'],
  ['4050', 'Order adjustments and rounding', 'income'],
  ['4100', 'Delivery fee income', 'income'],
  ['4900', 'Other income', 'income'],
  ['5100', 'Salaries and rider pay', 'expense'],
  ['5200', 'Rent', 'expense'],
  ['5300', 'Utilities and communication', 'expense'],
  ['5400', 'Vehicle, fuel and maintenance', 'expense'],
  ['5500', 'Marketing and printing', 'expense'],
  ['5600', 'Office and stationery', 'expense'],
  ['5800', 'Wallet and cash adjustments', 'expense'],
  ['5900', 'Other expenses', 'expense'],
];
const ACCOUNT_NAMES = Object.fromEntries(ACCOUNTS.map(([code, name]) => [code, name]));
const ACCOUNT_TYPES = Object.fromEntries(ACCOUNTS.map(([code, , type]) => [code, type]));

const {
  storePayableLineSql,
  loadStoreNameIndex,
  loadPickupStoresOnOrder,
  createPickupStoreResolver,
} = require('../utils/storeAccount');

const SYNC_LOCK = 'servenow_gl_sync';

const toCents = (value) => Math.round(Number(value || 0) * 100);
const fromCents = (cents) => Math.round(cents) / 100;

function expenseAccount(text) {
  const t = String(text || '').toLowerCase();
  if (/reconcil/.test(t)) return '3900';
  if (/salar|wage|rider pay|bonus/.test(t)) return '5100';
  if (/rent/.test(t)) return '5200';
  if (/electric|gas|internet|mobile|phone|utility|water/.test(t)) return '5300';
  if (/bike|fuel|petrol|maintenance|repair|vehicle/.test(t)) return '5400';
  if (/print|broch|marketing|advert|promotion/.test(t)) return '5500';
  if (/office|stationer/.test(t)) return '5600';
  if (/historical|adjustment/.test(t)) return '3900';
  return '5900';
}

function journalAccount(name) {
  const t = String(name || '').trim().toLowerCase();
  const code = t.match(/^(\d{4})\b/);
  if (code && ACCOUNT_NAMES[code[1]]) return code[1];
  const exact = ACCOUNTS.find(([, n]) => n.toLowerCase() === t);
  if (exact) return exact[0];
  if (/bank/.test(t)) return '1010';
  if (/cash/.test(t) && /rider/.test(t)) return '1100';
  if (/cash/.test(t)) return '1000';
  if (/advance/.test(t)) return '1300';
  if (/rider/.test(t)) return '1100';
  if (/store|payable|vendor/.test(t)) return '2000';
  if (/wallet|customer/.test(t)) return '2100';
  if (/commission/.test(t)) return '4000';
  if (/delivery/.test(t)) return '4100';
  if (/income|revenue/.test(t)) return '4900';
  if (/expense|cost/.test(t)) return expenseAccount(t);
  return '3900';
}

const cashOrBank = (method) => (['bank_transfer', 'check', 'card'].includes(String(method || '').toLowerCase()) ? '1010' : '1000');

// ---------------------------------------------------------------------------
// Schema

async function ensureLedgerSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS gl_accounts (
      code VARCHAR(10) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      account_type ENUM('asset','liability','equity','income','expense') NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS gl_journals (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      journal_key VARCHAR(120) NOT NULL,
      source_type VARCHAR(40) NOT NULL,
      source_id VARCHAR(80) NOT NULL,
      seq INT NOT NULL DEFAULT 1,
      journal_date DATE NOT NULL,
      description VARCHAR(255) NULL,
      fingerprint CHAR(64) NULL,
      reversal_of BIGINT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_gl_journal_key (journal_key),
      KEY idx_gl_journal_source (source_type, source_id),
      KEY idx_gl_journal_date (journal_date),
      KEY idx_gl_journal_reversal (reversal_of)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS gl_lines (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      journal_id BIGINT NOT NULL,
      account_code VARCHAR(10) NOT NULL,
      entity_type VARCHAR(20) NULL,
      entity_id VARCHAR(40) NULL,
      debit DECIMAL(14,2) NOT NULL DEFAULT 0,
      credit DECIMAL(14,2) NOT NULL DEFAULT 0,
      memo VARCHAR(255) NULL,
      KEY idx_gl_lines_journal (journal_id),
      KEY idx_gl_lines_account (account_code, entity_type, entity_id),
      CONSTRAINT fk_gl_lines_journal FOREIGN KEY (journal_id) REFERENCES gl_journals(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  const placeholders = ACCOUNTS.map(() => '(?, ?, ?)').join(', ');
  await db.query(
    `INSERT INTO gl_accounts (code, name, account_type) VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE name = VALUES(name), account_type = VALUES(account_type)`,
    ACCOUNTS.flat()
  );
}

// ---------------------------------------------------------------------------
// Journal builders. Each returns { key, date, description, lines } where line
// amounts are in paisa: positive = debit, negative = credit.

function line(account, cents, entityType = null, entityId = null, memo = null) {
  return { account, cents, entityType, entityId: entityId == null ? null : String(entityId), memo };
}

const loadStoreNames = loadStoreNameIndex;

async function buildOrderJournals(db) {
  // Delivery date = the rider's first cash collection for the order, else its last update.
  // (Loaded separately: joining the text reference_id to orders.id cannot use an index.)
  const [orders] = await db.query(`
    SELECT o.id, o.order_number, o.payment_method, o.total_amount, o.delivery_fee,
           DATE_FORMAT(COALESCE(o.updated_at, o.created_at), '%Y-%m-%d') AS journal_date
    FROM orders o
    WHERE o.status = 'delivered'`);
  const [collections] = await db.query(`
    SELECT wt.reference_id AS order_id, DATE_FORMAT(MIN(wt.created_at), '%Y-%m-%d') AS first_collect
    FROM wallet_transactions wt
    JOIN wallets w ON w.id = wt.wallet_id
    WHERE w.rider_id IS NOT NULL AND wt.type = 'credit' AND wt.reference_type = 'order'
    GROUP BY wt.reference_id`);
  const collectedOn = new Map(collections.map((c) => [String(c.order_id), c.first_collect]));
  for (const o of orders) o.journal_date = collectedOn.get(String(o.id)) || o.journal_date;

  const [items] = await db.query(`
    SELECT oi.order_id, COALESCE(oi.store_id, p.store_id) AS store_id,
           SUM(oi.price * oi.quantity) AS item_value,
           SUM(${storePayableLineSql()}) AS store_payable
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id AND o.status = 'delivered'
    JOIN products p ON p.id = oi.product_id
    LEFT JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
    GROUP BY oi.order_id, COALESCE(oi.store_id, p.store_id)`);

  const itemsByOrder = new Map();
  for (const row of items) {
    if (!itemsByOrder.has(row.order_id)) itemsByOrder.set(row.order_id, []);
    itemsByOrder.get(row.order_id).push(row);
  }

  return orders.map((o) => {
    const total = toCents(o.total_amount);
    const fee = toCents(o.delivery_fee);
    const method = String(o.payment_method || 'cash').toLowerCase();
    const debitAccount = method === 'cash' ? '1150' : '2200';
    const lines = [line(debitAccount, total, 'order', o.id, `Order ${o.order_number} (${method})`)];
    let itemValue = 0;
    let payable = 0;
    for (const s of itemsByOrder.get(o.id) || []) {
      const value = toCents(s.item_value);
      const owed = toCents(s.store_payable);
      itemValue += value;
      payable += owed;
      if (owed) lines.push(line('2000', -owed, 'store', s.store_id, `Payable for order ${o.order_number}`));
    }
    if (itemValue - payable) lines.push(line('4000', -(itemValue - payable), 'order', o.id));
    if (fee) lines.push(line('4100', -fee, 'order', o.id));
    const rounding = total - itemValue - fee;
    if (rounding) lines.push(line('4050', -rounding, 'order', o.id, 'Order total differs from items + delivery fee'));
    return {
      key: `order:${o.id}`,
      date: o.journal_date,
      description: `Order ${o.order_number} delivered`,
      lines,
    };
  });
}

async function buildWalletJournals(db, storeIdsByName) {
  const [rows] = await db.query(`
    SELECT wt.id, wt.type, wt.amount, wt.description, wt.reference_type, wt.reference_id,
           DATE_FORMAT(wt.created_at, '%Y-%m-%d') AS journal_date,
           w.user_type, w.user_id, w.rider_id
    FROM wallet_transactions wt
    JOIN wallets w ON w.id = wt.wallet_id
    ORDER BY wt.id`);

  const storeFromDescription = createPickupStoreResolver(storeIdsByName, await loadPickupStoresOnOrder(db));
  // Reversals of a pickup payment name the order, not the store: use the store
  // the rider paid for that order.
  const pickupStoreByOrder = new Map();
  for (const r of rows) {
    if (r.rider_id && r.type === 'debit' && r.reference_type === 'order') {
      const storeId = storeFromDescription(r.description, r.reference_id);
      if (storeId) {
        const key = `${r.rider_id}:${r.reference_id}`;
        const seen = pickupStoreByOrder.get(key);
        pickupStoreByOrder.set(key, seen && seen !== storeId ? 'ambiguous' : storeId);
      }
    }
  }

  const journals = [];
  for (const r of rows) {
    const cents = toCents(r.amount);
    if (!cents) continue;
    const isCredit = r.type === 'credit' || r.type === 'refund';
    const isDebit = r.type === 'debit';
    const ref = String(r.reference_type || '');
    const desc = String(r.description || '').slice(0, 200);
    let lines = null;

    if (r.rider_id) {
      const rider = ['rider', r.rider_id];
      if (ref === 'rider_cash_movement') continue; // posted from the movement document
      if (ref === 'order' && isCredit) {
        lines = [line('1100', cents, ...rider), line('1150', -cents, 'order', r.reference_id, desc)];
      } else if (ref === 'order' && isDebit && /pickup-paid store/i.test(desc)) {
        const storeId = storeFromDescription(desc, r.reference_id);
        lines = storeId
          ? [line('2000', cents, 'store', storeId, desc), line('1100', -cents, ...rider)]
          : [line('3900', cents, null, null, `Store not identified: ${desc}`), line('1100', -cents, ...rider)];
      } else if ((ref === 'order' || ref === 'order_cancel_reversal') && isDebit) {
        lines = [line('1150', cents, 'order', r.reference_id, desc), line('1100', -cents, ...rider)];
      } else if (ref === 'order_cancel_reversal' && isCredit) {
        const named = /^Reversal: /.test(desc) ? storeFromDescription(desc, null) : null;
        const storeId = named || pickupStoreByOrder.get(`${r.rider_id}:${r.reference_id}`);
        lines = storeId && storeId !== 'ambiguous'
          ? [line('1100', cents, ...rider), line('2000', -cents, 'store', storeId, desc)]
          : [line('1100', cents, ...rider), line('3900', -cents, null, null, desc)];
      } else if (ref === 'system_correction' && isDebit) {
        lines = [line('1150', cents, null, null, desc), line('1100', -cents, ...rider)];
      } else {
        lines = isDebit
          ? [line('3900', cents, null, null, desc), line('1100', -cents, ...rider)]
          : [line('1100', cents, ...rider), line('3900', -cents, null, null, desc)];
      }
    } else if (r.user_id) {
      const user = ['user', r.user_id];
      if (['topup', 'wallet_topup', 'auto_recharge'].includes(ref) && isCredit) {
        lines = [line('1010', cents, null, null, desc), line('2100', -cents, ...user)];
      } else if (ref === 'order' && isDebit) {
        lines = [line('2100', cents, ...user), line('2200', -cents, 'order', r.reference_id, desc)];
      } else if (ref === 'order_refund' && isCredit) {
        lines = [line('2200', cents, 'order', r.reference_id, desc), line('2100', -cents, ...user)];
      } else if (ref === 'refund' && isCredit) {
        // Manual refund route: the refunds row id is the reference; the order is unknown here.
        lines = [line('2200', cents, null, null, desc), line('2100', -cents, ...user)];
      } else if (ref === 'transfer') {
        lines = isDebit
          ? [line('2100', cents, ...user), line('2150', -cents, 'transfer', r.reference_id)]
          : [line('2150', cents, 'transfer', r.reference_id), line('2100', -cents, ...user)];
      } else if (!ref && /^admin adjustment/i.test(desc)) {
        lines = isDebit
          ? [line('2100', cents, ...user), line('5800', -cents, null, null, desc)]
          : [line('5800', cents, null, null, desc), line('2100', -cents, ...user)];
      } else {
        lines = isDebit
          ? [line('2100', cents, ...user), line('3900', -cents, null, null, desc)]
          : [line('3900', cents, null, null, desc), line('2100', -cents, ...user)];
      }
    } else {
      continue; // store wallets mirror settlements, which are posted from store_settlements
    }
    journals.push({ key: `wallet_transaction:${r.id}`, date: r.journal_date, description: desc || `Wallet transaction ${r.id}`, lines });
  }
  return journals;
}

async function buildRiderMovementJournals(db) {
  const [rows] = await db.query(`
    SELECT rcm.id, rcm.movement_number, rcm.rider_id, rcm.movement_type, rcm.amount, rcm.reference_type,
           rcm.description, DATE_FORMAT(rcm.movement_date, '%Y-%m-%d') AS journal_date,
           (SELECT wt.type FROM wallet_transactions wt
             WHERE wt.reference_type = 'rider_cash_movement' AND wt.reference_id = rcm.id
             ORDER BY wt.id LIMIT 1) AS wallet_direction
    FROM rider_cash_movements rcm
    WHERE rcm.status IN ('approved', 'completed')`);
  const journals = [];
  for (const m of rows) {
    const cents = toCents(m.amount);
    if (!cents) continue;
    const rider = ['rider', m.rider_id];
    const memo = `${m.movement_number}: ${String(m.description || '').slice(0, 180)}`;
    let lines = null;
    switch (m.movement_type) {
      case 'cash_submission':
        if (m.reference_type === 'receipt_voucher') continue; // the voucher journal is the record
        lines = [line('1000', cents, null, null, memo), line('1100', -cents, ...rider)];
        break;
      case 'advance':
        lines = [line('1300', cents, ...rider, memo), line('1100', -cents, ...rider)];
        break;
      case 'fuel_payment':
        lines = [line('5400', cents, ...rider, memo), line('1100', -cents, ...rider)];
        break;
      case 'cash_collection':
        if (m.reference_type === 'order') continue; // the rider wallet credit is the record
        lines = [line('1100', cents, ...rider), line('1150', -cents, null, null, memo)];
        break;
      case 'store_payment':
        continue; // the rider wallet debit is the record
      default: // adjustment, settlement: direction follows the rider wallet entry
        lines = m.wallet_direction === 'debit'
          ? [line('3900', cents, null, null, memo), line('1100', -cents, ...rider)]
          : [line('1100', cents, ...rider), line('3900', -cents, null, null, memo)];
    }
    journals.push({ key: `rider_cash_movement:${m.id}`, date: m.journal_date, description: `Rider ${m.movement_type} ${m.movement_number}`, lines });
  }
  return journals;
}

async function buildDocumentJournals(db) {
  const journals = [];

  const [settlements] = await db.query(`
    SELECT id, settlement_number, store_id, net_amount, payment_method,
           DATE_FORMAT(COALESCE(paid_at, settlement_date, created_at), '%Y-%m-%d') AS journal_date
    FROM store_settlements WHERE status = 'paid'`);
  for (const s of settlements) {
    const cents = toCents(s.net_amount);
    if (!cents) continue;
    journals.push({
      key: `store_settlement:${s.id}`, date: s.journal_date, description: `Store settlement ${s.settlement_number}`,
      lines: [line('2000', cents, 'store', s.store_id), line(cashOrBank(s.payment_method), -cents)],
    });
  }

  const [payments] = await db.query(`
    SELECT id, voucher_number, payee_type, payee_id, payee_name, purpose, amount, payment_method,
           DATE_FORMAT(voucher_date, '%Y-%m-%d') AS journal_date
    FROM cash_payment_vouchers WHERE status IN ('approved', 'paid')`);
  for (const v of payments) {
    const cents = toCents(v.amount);
    if (!cents) continue;
    const memo = `${v.payee_name || ''} ${v.purpose || ''}`.trim().slice(0, 200);
    let debit;
    if (v.payee_type === 'store' && v.payee_id) debit = line('2000', cents, 'store', v.payee_id, memo);
    // Bulk payment to stores without a store named: reduces store payables, unallocated
    else if (/store purchase/i.test(memo)) debit = line('2000', cents, null, null, `Unallocated: ${memo}`);
    else if (v.payee_type === 'rider') debit = line('5100', cents, 'rider', v.payee_id, memo);
    else debit = line(expenseAccount(memo), cents, null, null, memo);
    journals.push({
      key: `payment_voucher:${v.id}`, date: v.journal_date, description: `Payment voucher ${v.voucher_number}`,
      lines: [debit, line(cashOrBank(v.payment_method), -cents)],
    });
  }

  const [receipts] = await db.query(`
    SELECT id, voucher_number, payer_type, payer_id, payer_name, amount, payment_method,
           DATE_FORMAT(COALESCE(voucher_date, received_at), '%Y-%m-%d') AS journal_date
    FROM cash_receipt_vouchers WHERE status = 'received'`);
  for (const v of receipts) {
    const cents = toCents(v.amount);
    if (!cents) continue;
    let credit;
    if (v.payer_type === 'rider' && v.payer_id) credit = line('1100', -cents, 'rider', v.payer_id);
    else if (v.payer_type === 'store' && v.payer_id) credit = line('2000', -cents, 'store', v.payer_id);
    else if (v.payer_type === 'customer' && v.payer_id) credit = line('2100', -cents, 'user', v.payer_id);
    else credit = line('4900', -cents, null, null, v.payer_name);
    journals.push({
      key: `receipt_voucher:${v.id}`, date: v.journal_date, description: `Receipt voucher ${v.voucher_number}`,
      lines: [line(cashOrBank(v.payment_method), cents), credit],
    });
  }

  const [expenses] = await db.query(`
    SELECT id, expense_number, category, description, vendor_name, amount, payment_method,
           DATE_FORMAT(expense_date, '%Y-%m-%d') AS journal_date
    FROM admin_expenses WHERE status = 'paid'`);
  for (const e of expenses) {
    const cents = toCents(e.amount);
    if (!cents) continue;
    const memo = `${e.category || ''} ${e.vendor_name || ''}`.trim();
    journals.push({
      key: `admin_expense:${e.id}`, date: e.journal_date, description: `Expense ${e.expense_number}`,
      lines: [line(expenseAccount(`${e.category} ${e.description}`), cents, null, null, memo), line(cashOrBank(e.payment_method), -cents)],
    });
  }

  const [jvEntries] = await db.query(`
    SELECT jv.id, jv.voucher_number, DATE_FORMAT(jv.voucher_date, '%Y-%m-%d') AS journal_date,
           e.account_name, e.entity_type, e.entity_id, e.entry_type, e.amount
    FROM journal_vouchers jv
    JOIN journal_voucher_entries e ON e.jnv_id = jv.id
    WHERE jv.status = 'posted'
    ORDER BY jv.id, e.id`);
  const jvs = new Map();
  for (const e of jvEntries) {
    if (!jvs.has(e.id)) jvs.set(e.id, { key: `journal_voucher:${e.id}`, date: e.journal_date, description: `Journal voucher ${e.voucher_number}`, lines: [] });
    const cents = toCents(e.amount) * (e.entry_type === 'credit' ? -1 : 1);
    const entityType = e.entity_type === 'customer' ? 'user' : e.entity_type;
    jvs.get(e.id).lines.push(line(journalAccount(e.account_name), cents, e.entity_id ? entityType : null, e.entity_id, e.account_name));
  }
  journals.push(...jvs.values());

  // Card / gateway payments captured for orders
  const [captured] = await db.query(`
    SELECT id, order_id, amount, DATE_FORMAT(created_at, '%Y-%m-%d') AS journal_date
    FROM payments WHERE status IN ('success', 'refunded') AND payment_method = 'card'`);
  for (const p of captured) {
    const cents = toCents(p.amount);
    if (!cents) continue;
    journals.push({
      key: `payment:${p.id}`, date: p.journal_date, description: `Card payment for order ${p.order_id}`,
      lines: [line('1010', cents), line('2200', -cents, 'order', p.order_id)],
    });
  }

  // Ledger postings entered by hand (not created by any document above)
  const [manual] = await db.query(`
    SELECT id, transaction_number, transaction_type, category, description, amount, payment_method, reference_type,
           DATE_FORMAT(created_at, '%Y-%m-%d') AS journal_date
    FROM financial_transactions
    WHERE status = 'completed'
      AND (reference_type IS NULL OR reference_type NOT IN
        ('order','payment_voucher','receipt_voucher','rider_cash_movement','store_settlement','admin_expense',
         'journal_voucher_entry','wallet_transaction','payment','refund','rider_store_payment'))`);
  for (const t of manual) {
    const cents = toCents(t.amount);
    if (!cents) continue;
    const memo = String(t.description || t.category || '').slice(0, 200);
    const cash = cashOrBank(t.payment_method);
    const plug = t.reference_type === 'manual_reconciliation';
    let lines;
    if (t.transaction_type === 'income') lines = [line(cash, cents), line(plug ? '3900' : '4900', -cents, null, null, memo)];
    else if (t.transaction_type === 'expense') lines = [line(plug ? '3900' : expenseAccount(`${t.category} ${memo}`), cents, null, null, memo), line(cash, -cents)];
    else continue; // settlements/adjustments without a document are listed in the reconciliation
    journals.push({ key: `financial_transaction:${t.id}`, date: t.journal_date, description: `Manual entry ${t.transaction_number}`, lines });
  }

  return journals;
}

async function buildAllJournals(db) {
  const storeIdsByName = await loadStoreNames(db);
  const groups = await Promise.all([
    buildOrderJournals(db),
    buildWalletJournals(db, storeIdsByName),
    buildRiderMovementJournals(db),
    buildDocumentJournals(db),
  ]);
  return groups.flat();
}

// ---------------------------------------------------------------------------
// Sync

function normaliseLines(lines) {
  // Merge identical account/entity lines and drop zero lines
  const merged = new Map();
  for (const l of lines) {
    const k = `${l.account}|${l.entityType || ''}|${l.entityId || ''}`;
    const prev = merged.get(k);
    if (prev) prev.cents += l.cents;
    else merged.set(k, { ...l });
  }
  return [...merged.values()].filter((l) => l.cents !== 0);
}

function fingerprintOf(lines) {
  const crypto = require('crypto');
  const canonical = lines
    .map((l) => `${l.account}|${l.entityType || ''}|${l.entityId || ''}|${l.cents}`)
    .sort()
    .join(';');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

async function insertJournals(conn, journals) {
  const BATCH = 400;
  for (let i = 0; i < journals.length; i += BATCH) {
    const batch = journals.slice(i, i + BATCH);
    await conn.query(
      `INSERT INTO gl_journals (journal_key, source_type, source_id, seq, journal_date, description, fingerprint, reversal_of)
       VALUES ${batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      batch.flatMap((j) => [j.journalKey, j.sourceType, j.sourceId, j.seq, j.date, String(j.description || '').slice(0, 255), j.fingerprint, j.reversalOf || null])
    );
    const [ids] = await conn.query('SELECT id, journal_key FROM gl_journals WHERE journal_key IN (?)', [batch.map((j) => j.journalKey)]);
    const idByKey = new Map(ids.map((r) => [r.journal_key, r.id]));
    const lineRows = [];
    for (const j of batch) {
      for (const l of j.lines) {
        lineRows.push([
          idByKey.get(j.journalKey), l.account, l.entityType, l.entityId,
          l.cents > 0 ? fromCents(l.cents) : 0, l.cents < 0 ? fromCents(-l.cents) : 0,
          l.memo ? String(l.memo).slice(0, 255) : null,
        ]);
      }
    }
    for (let k = 0; k < lineRows.length; k += 1000) {
      const chunk = lineRows.slice(k, k + 1000);
      await conn.query(
        `INSERT INTO gl_lines (journal_id, account_code, entity_type, entity_id, debit, credit, memo) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        chunk.flat()
      );
    }
  }
}

// Posts missing journals and reverses/reposts changed ones. Returns a summary.
async function syncLedger(pool, { dryRun = false } = {}) {
  await ensureLedgerSchemaOnce(pool);
  const conn = await pool.getConnection();
  const summary = { posted: 0, reversed: 0, unchanged: 0, unbalanced: [] };
  try {
    const [[lock]] = await conn.query('SELECT GET_LOCK(?, 30) AS ok', [SYNC_LOCK]);
    if (!lock || Number(lock.ok) !== 1) throw new Error('Ledger sync is already running');
    try {
      const desired = new Map();
      for (const j of await buildAllJournals(conn)) {
        const lines = normaliseLines(j.lines);
        const sum = lines.reduce((acc, l) => acc + l.cents, 0);
        if (sum !== 0) {
          summary.unbalanced.push({ key: j.key, difference: fromCents(sum) });
          continue;
        }
        if (!lines.length) continue;
        desired.set(j.key, { ...j, lines, fingerprint: fingerprintOf(lines) });
      }

      // Active = posted, not a reversal, and not yet reversed
      const [active] = await conn.query(`
        SELECT j.id, j.source_type, j.source_id, j.fingerprint
        FROM gl_journals j
        WHERE j.reversal_of IS NULL
          AND NOT EXISTS (SELECT 1 FROM gl_journals r WHERE r.reversal_of = j.id)`);
      const [seqRows] = await conn.query('SELECT source_type, source_id, MAX(seq) AS seq FROM gl_journals GROUP BY source_type, source_id');
      const maxSeq = new Map(seqRows.map((r) => [`${r.source_type}:${r.source_id}`, Number(r.seq)]));
      const activeByKey = new Map(active.map((r) => [`${r.source_type}:${r.source_id}`, r]));

      const today = new Date().toISOString().slice(0, 10);
      const toInsert = [];
      const reversals = [];
      const nextSeq = (key) => {
        const seq = (maxSeq.get(key) || 0) + 1;
        maxSeq.set(key, seq);
        return seq;
      };

      for (const [key, current] of activeByKey) {
        const want = desired.get(key);
        if (want && want.fingerprint === current.fingerprint) {
          summary.unchanged += 1;
          desired.delete(key);
          continue;
        }
        reversals.push({ key, current });
      }

      if (reversals.length) {
        const [lines] = await conn.query('SELECT journal_id, account_code, entity_type, entity_id, debit, credit FROM gl_lines WHERE journal_id IN (?)', [reversals.map((r) => r.current.id)]);
        const byJournal = new Map();
        for (const l of lines) {
          if (!byJournal.has(l.journal_id)) byJournal.set(l.journal_id, []);
          byJournal.get(l.journal_id).push(line(l.account_code, toCents(l.credit) - toCents(l.debit), l.entity_type, l.entity_id));
        }
        for (const { key, current } of reversals) {
          const [sourceType, ...rest] = key.split(':');
          const seq = nextSeq(key);
          toInsert.push({
            journalKey: `${key}:${seq}`, sourceType, sourceId: rest.join(':'), seq, date: today,
            description: `Reversal of journal ${current.id} (source document changed)`,
            fingerprint: null, reversalOf: current.id, lines: byJournal.get(current.id) || [],
          });
        }
        summary.reversed = reversals.length;
      }

      for (const [key, j] of desired) {
        const [sourceType, ...rest] = key.split(':');
        const seq = nextSeq(key);
        const reposting = activeByKey.has(key);
        toInsert.push({
          journalKey: `${key}:${seq}`, sourceType, sourceId: rest.join(':'), seq,
          date: reposting ? today : j.date, description: j.description, fingerprint: j.fingerprint, lines: j.lines,
        });
        summary.posted += 1;
      }

      if (!dryRun && toInsert.length) {
        await conn.beginTransaction();
        try {
          await insertJournals(conn, toInsert);
          await conn.commit();
        } catch (err) {
          await conn.rollback();
          throw err;
        }
      }
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [SYNC_LOCK]);
    }
  } finally {
    conn.release();
  }
  return summary;
}

let schemaReady = null;
function ensureLedgerSchemaOnce(pool) {
  if (!schemaReady) schemaReady = ensureLedgerSchema(pool).catch((err) => { schemaReady = null; throw err; });
  return schemaReady;
}

// Reports call this first so the GL is current. Concurrent callers share one run,
// and a run that finished within the last minute is reused.
let lastSync = { at: 0, promise: null };
function syncLedgerIfStale(pool, maxAgeMs = 60 * 1000) {
  if (lastSync.promise) return lastSync.promise;
  if (Date.now() - lastSync.at < maxAgeMs) return Promise.resolve(null);
  lastSync.promise = syncLedger(pool)
    .then((summary) => { lastSync.at = Date.now(); return summary; })
    .finally(() => { lastSync.promise = null; });
  return lastSync.promise;
}

// ---------------------------------------------------------------------------
// Reports

function dateFilter(from, to, column = 'j.journal_date') {
  const clauses = [];
  const params = [];
  if (from) { clauses.push(`${column} >= ?`); params.push(from); }
  if (to) { clauses.push(`${column} <= ?`); params.push(to); }
  return { sql: clauses.length ? `AND ${clauses.join(' AND ')}` : '', params };
}

async function trialBalance(db, { from = null, to = null } = {}) {
  const f = dateFilter(from, to);
  const [rows] = await db.query(`
    SELECT a.code, a.name, a.account_type, COALESCE(t.debit, 0) AS debit, COALESCE(t.credit, 0) AS credit
    FROM gl_accounts a
    LEFT JOIN (
      SELECT l.account_code, SUM(l.debit) AS debit, SUM(l.credit) AS credit
      FROM gl_lines l JOIN gl_journals j ON j.id = l.journal_id
      WHERE 1=1 ${f.sql}
      GROUP BY l.account_code
    ) t ON t.account_code = a.code
    ORDER BY a.code`, f.params);
  const accounts = rows.map((r) => {
    const debit = toCents(r.debit);
    const credit = toCents(r.credit);
    return { code: r.code, name: r.name, type: r.account_type, debit: fromCents(debit), credit: fromCents(credit), balance: fromCents(debit - credit) };
  });
  const totalDebit = accounts.reduce((s, a) => s + toCents(a.debit), 0);
  const totalCredit = accounts.reduce((s, a) => s + toCents(a.credit), 0);
  return { from, to, accounts, total_debit: fromCents(totalDebit), total_credit: fromCents(totalCredit), balanced: totalDebit === totalCredit };
}

async function profitAndLoss(db, { from = null, to = null } = {}) {
  const tb = await trialBalance(db, { from, to });
  const income = tb.accounts.filter((a) => a.type === 'income').map((a) => ({ ...a, amount: fromCents(toCents(a.credit) - toCents(a.debit)) }));
  const expenses = tb.accounts.filter((a) => a.type === 'expense').map((a) => ({ ...a, amount: fromCents(toCents(a.debit) - toCents(a.credit)) }));
  const totalIncome = income.reduce((s, a) => s + toCents(a.amount), 0);
  const totalExpenses = expenses.reduce((s, a) => s + toCents(a.amount), 0);
  return {
    from, to, income, expenses,
    total_income: fromCents(totalIncome), total_expenses: fromCents(totalExpenses), net_profit: fromCents(totalIncome - totalExpenses),
  };
}

async function balanceSheet(db, { to = null } = {}) {
  const tb = await trialBalance(db, { to });
  const pick = (type, sign) => tb.accounts.filter((a) => a.type === type).map((a) => ({ code: a.code, name: a.name, amount: fromCents(sign * toCents(a.balance)) }));
  const assets = pick('asset', 1);
  const liabilities = pick('liability', -1);
  const equity = pick('equity', -1);
  const earnings = tb.accounts
    .filter((a) => a.type === 'income' || a.type === 'expense')
    .reduce((s, a) => s - toCents(a.balance), 0);
  equity.push({ code: 'P&L', name: 'Accumulated profit (loss)', amount: fromCents(earnings) });
  const sum = (list) => list.reduce((s, a) => s + toCents(a.amount), 0);
  return {
    to, assets, liabilities, equity,
    total_assets: fromCents(sum(assets)), total_liabilities: fromCents(sum(liabilities)), total_equity: fromCents(sum(equity)),
    balanced: sum(assets) === sum(liabilities) + sum(equity),
  };
}

async function accountStatement(db, code, { entityType = null, entityId = null, from = null, to = null, limit = 500 } = {}) {
  const params = [code];
  let entitySql = '';
  if (entityType) { entitySql += ' AND l.entity_type = ?'; params.push(entityType); }
  if (entityId != null && entityId !== '') { entitySql += ' AND l.entity_id = ?'; params.push(String(entityId)); }
  const [[opening]] = await db.query(
    `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS bal FROM gl_lines l JOIN gl_journals j ON j.id = l.journal_id
     WHERE l.account_code = ? ${entitySql} ${from ? 'AND j.journal_date < ?' : 'AND 1=0'}`,
    from ? [...params, from] : params
  );
  const f = dateFilter(from, to);
  const [rows] = await db.query(
    `SELECT j.id AS journal_id, DATE_FORMAT(j.journal_date, '%Y-%m-%d') AS date, j.source_type, j.source_id, j.description,
            l.entity_type, l.entity_id, l.debit, l.credit, l.memo
     FROM gl_lines l JOIN gl_journals j ON j.id = l.journal_id
     WHERE l.account_code = ? ${entitySql} ${f.sql}
     ORDER BY j.journal_date, j.id
     LIMIT ${Math.min(Math.max(parseInt(limit, 10) || 500, 1), 5000)}`,
    [...params, ...f.params]
  );
  let running = toCents(opening.bal);
  const openingBalance = fromCents(running);
  const entries = rows.map((r) => {
    running += toCents(r.debit) - toCents(r.credit);
    return { ...r, debit: Number(r.debit), credit: Number(r.credit), balance: fromCents(running) };
  });
  return { account: code, name: ACCOUNT_NAMES[code] || code, opening_balance: openingBalance, entries, closing_balance: fromCents(running) };
}

async function entityBalances(db, code, { to = null } = {}) {
  const f = dateFilter(null, to);
  const [rows] = await db.query(
    `SELECT l.entity_type, l.entity_id, SUM(l.debit) AS debit, SUM(l.credit) AS credit
     FROM gl_lines l JOIN gl_journals j ON j.id = l.journal_id
     WHERE l.account_code = ? ${f.sql}
     GROUP BY l.entity_type, l.entity_id
     HAVING ROUND(SUM(l.debit) - SUM(l.credit), 2) <> 0
     ORDER BY ABS(SUM(l.debit) - SUM(l.credit)) DESC`,
    [code, ...f.params]
  );
  return rows.map((r) => ({ entity_type: r.entity_type, entity_id: r.entity_id, balance: fromCents(toCents(r.debit) - toCents(r.credit)) }));
}

// Compares the GL with the operational sub-ledgers and lists items to review.
async function reconciliation(db) {
  const result = {};

  const [riders] = await db.query(`
    SELECT w.rider_id, CONCAT(COALESCE(r.first_name, ''), ' ', COALESCE(r.last_name, '')) AS name, w.balance AS wallet_balance,
           (SELECT COALESCE(SUM(CASE WHEN wt.type IN ('credit','refund') THEN wt.amount WHEN wt.type = 'debit' THEN -wt.amount ELSE 0 END), 0)
              FROM wallet_transactions wt WHERE wt.wallet_id = w.id) AS wallet_history_total,
           (SELECT COALESCE(SUM(l.debit - l.credit), 0) FROM gl_lines l
             WHERE l.account_code = '1100' AND l.entity_type = 'rider' AND l.entity_id = w.rider_id) AS gl_balance
    FROM wallets w LEFT JOIN riders r ON r.id = w.rider_id
    WHERE w.rider_id IS NOT NULL
    ORDER BY w.rider_id`);
  result.riders = riders.map((r) => ({
    rider_id: r.rider_id, name: r.name.trim(),
    wallet_balance: Number(r.wallet_balance), wallet_history_total: fromCents(toCents(r.wallet_history_total)),
    gl_balance: fromCents(toCents(r.gl_balance)),
    difference: fromCents(toCents(r.wallet_balance) - toCents(r.gl_balance)),
  }));

  const [pendingMovements] = await db.query(`
    SELECT rcm.id, rcm.movement_number, rcm.rider_id, rcm.movement_type, rcm.amount, rcm.status,
           DATE_FORMAT(rcm.movement_date, '%Y-%m-%d') AS date,
           EXISTS (SELECT 1 FROM wallet_transactions wt WHERE wt.reference_type = 'rider_cash_movement' AND wt.reference_id = rcm.id) AS in_wallet
    FROM rider_cash_movements rcm
    WHERE rcm.status NOT IN ('approved', 'completed', 'cancelled', 'rejected')
    ORDER BY rcm.amount DESC`);
  result.pending_rider_movements = pendingMovements.map((m) => ({ ...m, amount: Number(m.amount), in_wallet: Boolean(m.in_wallet) }));

  const [wrongDirection] = await db.query(`
    SELECT rcm.id, rcm.movement_number, rcm.rider_id, rcm.amount, wt.id AS wallet_transaction_id
    FROM rider_cash_movements rcm
    JOIN wallet_transactions wt ON wt.reference_type = 'rider_cash_movement' AND wt.reference_id = rcm.id
    WHERE rcm.movement_type = 'cash_submission' AND wt.type = 'credit'`);
  result.submissions_credited_to_wallet = wrongDirection.map((m) => ({ ...m, amount: Number(m.amount) }));

  // Collections clearing per order: zero when the cash collected equals the delivered order total
  const [clearing] = await db.query(`
    SELECT x.order_id, x.balance, x.collections, o.order_number, o.status, o.total_amount
    FROM (
      SELECT l.entity_id AS order_id, SUM(l.debit - l.credit) AS balance, SUM(l.credit > 0) AS collections
      FROM gl_lines l
      WHERE l.account_code = '1150'
      GROUP BY l.entity_id
      HAVING ROUND(SUM(l.debit - l.credit), 2) <> 0
    ) x
    LEFT JOIN orders o ON o.id = x.order_id
    ORDER BY ABS(x.balance) DESC`);
  result.collections_clearing = clearing.map((r) => {
    const balance = fromCents(toCents(r.balance));
    let reason = 'Collected amount differs from order total';
    if (r.order_id == null) reason = 'Wallet clean-up entries (not linked to an order)';
    else if (!r.order_number) reason = 'Order no longer exists';
    else if (r.status !== 'delivered') reason = `Cash collected but order is ${r.status}`;
    else if (Number(r.collections) > 1 && balance < 0) reason = 'Cash collection recorded more than once';
    else if (Number(r.collections) === 0) reason = 'Delivered cash order with no collection in rider wallet';
    return { order_id: r.order_id, order_number: r.order_number || null, status: r.status || null, balance, reason };
  });
  const [[unallocated]] = await db.query(`SELECT COALESCE(SUM(debit - credit), 0) AS amount FROM gl_lines WHERE account_code = '2000' AND entity_id IS NULL`);
  result.store_payments_unallocated = fromCents(toCents(unallocated.amount));
  result.customer_prepayments = (await entityBalances(db, '2200')).map((r) => ({ order_id: r.entity_id, balance: r.balance }));

  const [stores] = await db.query(`
    SELECT s.id, s.name, s.payment_term,
           (SELECT COALESCE(SUM(l.credit - l.debit), 0) FROM gl_lines l
             WHERE l.account_code = '2000' AND l.entity_type = 'store' AND l.entity_id = s.id) AS gl_payable
    FROM stores s ORDER BY s.name`);
  result.stores = stores
    .map((s) => ({ store_id: s.id, name: s.name, payment_term: s.payment_term, gl_payable: fromCents(toCents(s.gl_payable)) }))
    .filter((s) => s.gl_payable !== 0);

  const [customers] = await db.query(`
    SELECT w.user_id, w.balance AS wallet_balance,
           (SELECT COALESCE(SUM(l.credit - l.debit), 0) FROM gl_lines l
             WHERE l.account_code = '2100' AND l.entity_type = 'user' AND l.entity_id = w.user_id) AS gl_balance
    FROM wallets w WHERE w.user_id IS NOT NULL`);
  result.customer_wallets = customers
    .map((c) => ({ user_id: c.user_id, wallet_balance: Number(c.wallet_balance), gl_balance: fromCents(toCents(c.gl_balance)) }))
    .filter((c) => toCents(c.wallet_balance) !== toCents(c.gl_balance));

  const [suspense] = await db.query(`
    SELECT j.id AS journal_id, DATE_FORMAT(j.journal_date, '%Y-%m-%d') AS date, j.source_type, j.source_id, j.description,
           l.debit, l.credit, l.memo
    FROM gl_lines l JOIN gl_journals j ON j.id = l.journal_id
    WHERE l.account_code = '3900'
    ORDER BY ABS(l.debit - l.credit) DESC`);
  result.suspense = suspense.map((s) => ({ ...s, debit: Number(s.debit), credit: Number(s.credit) }));

  const [deliveredWithoutItems] = await db.query(`
    SELECT o.id, o.order_number, o.total_amount FROM orders o
    WHERE o.status = 'delivered' AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id)`);
  result.delivered_orders_without_items = deliveredWithoutItems.map((o) => ({ ...o, total_amount: Number(o.total_amount) }));

  const [legacyUnposted] = await db.query(`
    SELECT id, transaction_number, transaction_type, category, amount, reference_type
    FROM financial_transactions
    WHERE status = 'completed' AND transaction_type NOT IN ('income', 'expense')
      AND (reference_type IS NULL OR reference_type IN ('manual', 'manual_reconciliation'))`);
  result.manual_entries_not_posted = legacyUnposted.map((t) => ({ ...t, amount: Number(t.amount) }));

  return result;
}

module.exports = {
  ACCOUNTS,
  ACCOUNT_NAMES,
  ACCOUNT_TYPES,
  ensureLedgerSchema,
  buildAllJournals,
  syncLedger,
  syncLedgerIfStale,
  trialBalance,
  profitAndLoss,
  balanceSheet,
  accountStatement,
  entityBalances,
  reconciliation,
  expenseAccount,
  journalAccount,
  toCents,
  fromCents,
};
