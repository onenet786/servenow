const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { applyWalletDelta } = require('../utils/walletBalance');
const { checkDocumentUpdate, makerCheckerApplies } = require('../utils/financeControls');
const { recordFinancialTransaction } = require('../utils/dbHelpers');
const ledger = require('../services/ledger');
const storeAccount = require('../utils/storeAccount');
const fs = require('fs');
const path = require('path');

const router = express.Router();
let _legacyCpvBackfillDone = false;

const SUPPORTED_FINANCIAL_REPORT_TYPES = [
    'daily_summary',
    'weekly_summary',
    'monthly_summary',
    'store_settlement',
    'rider_cash_report',
    'rider_orders_report',
    'rider_payments_report',
    'rider_receivings_report',
    'rider_wallet_report',
    'rider_petrol_report',
    'rider_daily_mileage_report',
    'rider_daily_activity_report',
    'rider_day_closing_report',
    'order_profit_report',
    'expense_report',
    'general_voucher',
    'store_financials',
    'rider_fuel_report',
    'comprehensive_report',
    'store_payable_reconciliation',
    'unsettled_amounts_report',
    'cash_discrepancy_report',
    'store_order_settlement_report',
    'credit_store_order_reconciliation',
    'delivery_charges_breakdown',
    'order_wise_sale_summary',
    'periodic_sales_report',
    'periodic_credit_cash_report',
    'periodic_comprehensive_summary_report',
    'periodic_store_payments_balance_report',
    'transaction_summary',
    'custom'
];

// Helper to log errors to file
const logDebugError = (error) => {
    const logPath = path.join(__dirname, '..', 'debug_error.log');
    const msg = `[${new Date().toISOString()}] ${error.message}\n${error.stack}\n\n`;
    fs.appendFile(logPath, msg, (e) => {
        if (e) console.error('Failed to write debug log:', e);
    });
};

function generateVoucherNumber(prefix, date = new Date()) {
    const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
    const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}-${dateStr}-${randomStr}`;
}

function isDiscountPaymentTerm(term) {
    return String(term || '').toLowerCase().includes('discount');
}

async function hasColumn(db, tableName, columnName) {
    const [rows] = await db.execute(
        `SELECT COUNT(*) AS cnt
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?`,
        [tableName, columnName]
    );
    return Number(rows?.[0]?.cnt || 0) > 0;
}

async function ensureOrderItemsCostPriceColumn(db) {
    try {
        const exists = await hasColumn(db, 'order_items', 'cost_price');
        if (!exists) {
            await db.execute(
                'ALTER TABLE order_items ADD COLUMN cost_price DECIMAL(10, 2) NULL AFTER price'
            );
        }
    } catch (error) {
        console.error('Failed to ensure order_items.cost_price column:', error);
    }
}

async function ensureRiderStorePaymentsTable(db) {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS rider_store_payments (
            id INT PRIMARY KEY AUTO_INCREMENT,
            order_id INT NOT NULL,
            store_id INT NOT NULL,
            rider_id INT NOT NULL,
            amount DECIMAL(12,2) NOT NULL,
            source_status VARCHAR(40) NOT NULL DEFAULT 'picked_up',
            created_by INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_rider_store_payment (order_id, store_id, source_status),
            INDEX idx_rsp_rider (rider_id),
            INDEX idx_rsp_store (store_id),
            INDEX idx_rsp_order (order_id)
        )
    `);
}

async function ensureStoreSettlementColumns(db) {
    const discountApplyExists = await hasColumn(
        db,
        'stores',
        'store_discount_apply_all_products'
    );
    if (!discountApplyExists) {
        await db.execute(
            `ALTER TABLE stores
             ADD COLUMN store_discount_apply_all_products TINYINT(1) NOT NULL DEFAULT 0`
        );
    }

    const discountPercentExists = await hasColumn(
        db,
        'stores',
        'store_discount_percent'
    );
    if (!discountPercentExists) {
        await db.execute(
            `ALTER TABLE stores
             ADD COLUMN store_discount_percent DECIMAL(10,2) NULL`
        );
    }
}

async function ensureStoreSettlementSchema(db) {
    await ensureRiderStorePaymentsTable(db);
    await ensureStoreSettlementColumns(db);
}

async function ensureFinancialReportsReportTypeEnum(db) {
    try {
        const enumList = SUPPORTED_FINANCIAL_REPORT_TYPES.map((type) => `'${type}'`).join(', ');
        await db.execute(
            `ALTER TABLE financial_reports MODIFY COLUMN report_type ENUM(${enumList}) NOT NULL`
        );
    } catch (error) {
        console.error('Failed to ensure financial_reports.report_type enum:', error);
    }
}

function getSettlementUnitAdjustment(item, unitPrice) {
    const useStoreDiscount =
        isDiscountPaymentTerm(item.payment_term) &&
        Number(item.store_discount_apply_all_products || 0) === 1 &&
        Number(item.store_discount_percent || 0) > 0;

    if (useStoreDiscount) {
        return unitPrice * (Number(item.store_discount_percent || 0) / 100);
    }

    if (item.discount_type === 'percent' && Number(item.discount_value || 0) > 0) {
        return unitPrice * (Number(item.discount_value || 0) / 100);
    }
    if (item.discount_type === 'amount' && Number(item.discount_value || 0) > 0) {
        return Number(item.discount_value || 0);
    }
    return 0;
}

function buildSettlementItemAmounts(item) {
    const qty = Number(item.quantity || 0);
    const unitPrice = Number(item.price || 0);
    const lineGross = unitPrice * qty;
    const itemRate = 0;
    const unitDiscount = getSettlementUnitAdjustment(item, unitPrice);
    const lineDiscount = Math.max(0, unitDiscount * qty);
    const lineNet = Math.max(0, lineGross - lineDiscount);
    const lineCommission = lineNet * (itemRate / 100);
    const linePayable = lineNet - lineCommission;

    return {
        lineGross,
        lineDiscount,
        lineNet,
        lineCommission,
        linePayable
    };
}

// FIFO coverage of settlement candidate lines by the store's available credit
// (payments not yet matched to settled lines, see utils/storeAccount.js).
// Every line is returned; covered lines carry line_covered/line_due so the UI
// can show them as covered. payableRemaining is what is actually still due.
function applyCreditToSettlementItems(items, creditCents = 0) {
    const withAmounts = (items || []).map((item) => {
        const amounts = buildSettlementItemAmounts(item);
        return {
            ...item,
            line_gross: amounts.lineGross,
            line_discount: amounts.lineDiscount,
            line_net: amounts.lineNet,
            line_commission: amounts.lineCommission,
            line_payable: amounts.linePayable
        };
    });
    const fifo = storeAccount.applyCreditFifo(withAmounts, creditCents, (line) => storeAccount.toCents(line.line_payable));
    let grossTotal = 0;
    let payableTotal = 0;
    const displayItems = fifo.lines.map((row) => {
        grossTotal += Number(row.line.line_gross || 0);
        payableTotal += Number(row.line.line_payable || 0);
        return {
            ...row.line,
            line_covered: storeAccount.fromCents(row.covered_c),
            line_due: storeAccount.fromCents(row.due_c),
            covered_by_credit: row.covered_c > 0 && row.due_c === 0 ? 'full' : (row.covered_c > 0 ? 'partial' : null)
        };
    });
    const creditApplied = storeAccount.fromCents(fifo.applied_c);
    return {
        displayItems,
        allItemIds: displayItems.map((item) => item.id),
        grossTotal,
        adjustmentTotal: grossTotal - payableTotal,
        payableTotal,
        creditAvailable: storeAccount.fromCents(Math.max(0, Math.round(creditCents || 0))),
        creditApplied,
        payableRemaining: Math.max(0, payableTotal - creditApplied)
    };
}

async function getSettlementCandidateItems(db, storeId, startDate = null, endDate = null) {
    const params = [storeId];
    const dateFilter = startDate && endDate ? 'AND o.created_at BETWEEN ? AND ?' : '';
    if (startDate && endDate) {
        params.push(startDate, endDate);
    }

    const [items] = await db.execute(`
        SELECT 
            oi.id, oi.order_id, oi.product_id, oi.quantity, oi.price, 
            oi.variant_label, oi.discount_type, oi.discount_value,
            o.order_number, o.created_at as order_date,
            p.name as product_name,
            s.commission_rate,
            s.payment_term,
            s.store_discount_apply_all_products,
            s.store_discount_percent
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        JOIN products p ON oi.product_id = p.id
        JOIN stores s ON COALESCE(oi.store_id, p.store_id) = s.id
        WHERE s.id = ?
        AND o.status = 'delivered'
        AND o.payment_status = 'paid'
        AND oi.settlement_id IS NULL
        AND LOWER(TRIM(COALESCE(s.payment_term, ''))) NOT IN ('cash only', 'cash with discount')
        AND LOWER(TRIM(COALESCE(p.description, ''))) <> 'created from admin manual order'
        AND NOT EXISTS (
            SELECT 1
            FROM rider_store_payments rsp
            WHERE rsp.order_id = oi.order_id
              AND rsp.store_id = COALESCE(oi.store_id, p.store_id)
        )
        ${dateFilter}
        ORDER BY o.created_at ASC
    `, params);

    return items;
}

async function calculateStoreSettlementBalance(
    db,
    storeId,
    startDate = null,
    endDate = null,
    selectedItemIds = null,
    { creditCents = null } = {}
) {
    let items = await getSettlementCandidateItems(db, storeId, startDate, endDate);
    if (Array.isArray(selectedItemIds)) {
        const selectedSet = new Set(
            selectedItemIds
                .map((id) => Number(id))
                .filter((id) => Number.isInteger(id) && id > 0)
        );
        items = items.filter((item) => selectedSet.has(Number(item.id)));
    }
    let credit = creditCents;
    let position = null;
    if (credit == null) {
        position = (await storeAccount.getStoreAccount(db, storeId)).position;
        credit = position.credit_c;
    }
    return { ...applyCreditToSettlementItems(items, credit), position };
}

function getStorePayableSqlExpression(storeAlias = 's') {
    return `
        GREATEST(
            0,
            (oi.quantity * oi.price) -
            (
                oi.quantity * (
                    CASE
                        WHEN LOWER(TRIM(COALESCE(${storeAlias}.payment_term, ''))) LIKE '%discount%'
                             AND COALESCE(${storeAlias}.store_discount_apply_all_products, 0) = 1
                             AND COALESCE(${storeAlias}.store_discount_percent, 0) > 0
                            THEN oi.price * (COALESCE(${storeAlias}.store_discount_percent, 0) / 100)
                        WHEN oi.discount_type = 'percent' AND COALESCE(oi.discount_value, 0) > 0
                            THEN oi.price * (COALESCE(oi.discount_value, 0) / 100)
                        WHEN oi.discount_type = 'amount' AND COALESCE(oi.discount_value, 0) > 0
                            THEN COALESCE(oi.discount_value, 0)
                        ELSE 0
                    END
                )
            )
        )`;
}

async function backfillLegacyPaymentVouchersToFinancialTransactions(db) {
    if (_legacyCpvBackfillDone) return 0;
    const [pendingRows] = await db.execute(
        `SELECT cpv.id
         FROM cash_payment_vouchers cpv
         LEFT JOIN financial_transactions ft
           ON ft.reference_type = 'payment_voucher'
          AND ft.reference_id = cpv.voucher_number
         WHERE cpv.status IN ('approved', 'paid')
           AND ft.id IS NULL
         LIMIT 1`
    );
    if (!pendingRows.length) {
        _legacyCpvBackfillDone = true;
        return 0;
    }

    const [result] = await db.execute(
        `INSERT INTO financial_transactions
            (transaction_number, transaction_type, category, description, amount, payment_method, related_entity_type, related_entity_id, reference_type, reference_id, notes, created_by, status, created_at)
         SELECT
            CONCAT(
                'FIN-BF-',
                DATE_FORMAT(COALESCE(cpv.paid_at, cpv.approved_at, cpv.updated_at, cpv.created_at, NOW()), '%Y%m%d'),
                '-',
                LPAD(cpv.id, 6, '0')
            ) AS transaction_number,
            'expense' AS transaction_type,
            'payment' AS category,
            CONCAT('CPV ', cpv.voucher_number, ' | Backfill payment to ', COALESCE(cpv.payee_name, 'N/A')) AS description,
            cpv.amount,
            cpv.payment_method,
            cpv.payee_type,
            cpv.payee_id,
            'payment_voucher' AS reference_type,
            cpv.voucher_number AS reference_id,
            'Backfilled from legacy CPV' AS notes,
            COALESCE(cpv.paid_by, cpv.approved_by, cpv.prepared_by, 1) AS created_by,
            'completed' AS status,
            COALESCE(cpv.paid_at, cpv.approved_at, cpv.updated_at, cpv.created_at, NOW()) AS created_at
         FROM cash_payment_vouchers cpv
         LEFT JOIN financial_transactions ft
           ON ft.reference_type = 'payment_voucher'
          AND ft.reference_id = cpv.voucher_number
         WHERE cpv.status IN ('approved', 'paid')
           AND ft.id IS NULL`
    );
    _legacyCpvBackfillDone = true;
    return Number(result?.affectedRows || 0);
}

async function ensureRiderCashMovementTypes(db) {
    try {
        await db.execute(
            `ALTER TABLE rider_cash_movements
             MODIFY COLUMN movement_type ENUM('cash_collection', 'cash_submission', 'advance', 'settlement', 'adjustment', 'store_payment', 'fuel_payment') NOT NULL`
        );
    } catch (_) {}
}

async function ensureRiderCashSubmissionOrdersTable(db) {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS rider_cash_submission_orders (
            id INT PRIMARY KEY AUTO_INCREMENT,
            movement_id INT NOT NULL,
            order_id INT NOT NULL,
            rider_id INT NOT NULL,
            order_number VARCHAR(64) NULL,
            order_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_movement_order (movement_id, order_id),
            KEY idx_rcso_order (order_id),
            KEY idx_rcso_rider (rider_id),
            KEY idx_rcso_movement (movement_id)
        )
    `);
}

async function backfillLegacyRiderCashSubmissionLinks(db) {
    await ensureRiderCashSubmissionOrdersTable(db);

    const [existingLinks] = await db.execute(
        `SELECT movement_id, order_id
         FROM rider_cash_submission_orders`
    );
    const linkedMovementIds = new Set(existingLinks.map((row) => Number(row.movement_id)));
    const linkedOrderIds = new Set(existingLinks.map((row) => Number(row.order_id)));

    const [walletRows] = await db.execute(
        `SELECT
            w.rider_id,
            wt.id AS wallet_tx_id,
            wt.type,
            wt.amount,
            wt.reference_type,
            wt.reference_id,
            o.id AS order_id,
            o.order_number,
            o.total_amount AS order_amount,
            rcm.id AS movement_id,
            rcm.movement_type,
            rcm.status AS movement_status,
            COALESCE(rcm.reference_type, '') AS movement_reference_type
         FROM wallet_transactions wt
         JOIN wallets w ON w.id = wt.wallet_id
         LEFT JOIN orders o
           ON wt.type = 'credit'
          AND wt.reference_type = 'order'
          AND CAST(wt.reference_id AS UNSIGNED) = o.id
         LEFT JOIN rider_cash_movements rcm
           ON wt.type = 'debit'
          AND wt.reference_type = 'rider_cash_movement'
          AND CAST(wt.reference_id AS UNSIGNED) = rcm.id
         WHERE w.rider_id IS NOT NULL
         ORDER BY w.rider_id ASC, wt.id ASC`
    );

    if (!walletRows.length) {
        return { linkedMovements: 0, linkedOrders: 0 };
    }

    const stagedLinks = [];
    let currentRiderId = null;
    let pendingOrders = [];

    for (const row of walletRows) {
        const riderId = Number(row.rider_id || 0);
        if (currentRiderId !== riderId) {
            currentRiderId = riderId;
            pendingOrders = [];
        }

        const rowType = String(row.type || '').toLowerCase().trim();
        const refType = String(row.reference_type || '').toLowerCase().trim();

        if (rowType === 'credit' && refType === 'order') {
            const orderId = Number(row.order_id || 0);
            if (orderId > 0 && !linkedOrderIds.has(orderId)) {
                pendingOrders.push({
                    order_id: orderId,
                    order_number: row.order_number || null,
                    order_amount: Number(row.order_amount || row.amount || 0)
                });
            }
            continue;
        }

        if (rowType !== 'debit' || refType !== 'rider_cash_movement') {
            continue;
        }

        const movementId = Number(row.movement_id || row.reference_id || 0);
        if (!movementId || linkedMovementIds.has(movementId)) {
            continue;
        }

        const movementType = String(row.movement_type || '').toLowerCase().trim();
        const movementStatus = String(row.movement_status || '').toLowerCase().trim();
        const movementRefType = String(row.movement_reference_type || '').toLowerCase().trim();
        const isSubmissionLike =
            movementType === 'cash_submission' ||
            (movementType === 'cash_collection' && movementRefType !== 'order');

        if (!isSubmissionLike || !['approved', 'completed'].includes(movementStatus)) {
            continue;
        }

        const targetAmount = Number(row.amount || 0);
        if (targetAmount <= 0 || pendingOrders.length === 0) {
            continue;
        }

        let runningTotal = 0;
        const matchedOrders = [];
        for (const order of pendingOrders) {
            matchedOrders.push(order);
            runningTotal += Number(order.order_amount || 0);
            if (Math.abs(runningTotal - targetAmount) < 0.01) {
                break;
            }
            if (runningTotal > targetAmount + 0.01) {
                matchedOrders.length = 0;
                break;
            }
        }

        if (!matchedOrders.length || Math.abs(runningTotal - targetAmount) > 0.01) {
            continue;
        }

        matchedOrders.forEach((order) => {
            stagedLinks.push([
                movementId,
                order.order_id,
                riderId,
                order.order_number,
                Number(order.order_amount || 0)
            ]);
            linkedOrderIds.add(order.order_id);
        });
        linkedMovementIds.add(movementId);
        pendingOrders = pendingOrders.slice(matchedOrders.length);
    }

    if (!stagedLinks.length) {
        return { linkedMovements: 0, linkedOrders: 0 };
    }

    const valuesSql = stagedLinks.map(() => '(?, ?, ?, ?, ?)').join(', ');
    await db.execute(
        `INSERT IGNORE INTO rider_cash_submission_orders
         (movement_id, order_id, rider_id, order_number, order_amount)
         VALUES ${valuesSql}`,
        stagedLinks.flat()
    );

    return {
        linkedMovements: new Set(stagedLinks.map((row) => row[0])).size,
        linkedOrders: stagedLinks.length
    };
}

async function ensureRiderFuelPaymentEntriesTable(db) {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS rider_fuel_payment_entries (
            id INT PRIMARY KEY AUTO_INCREMENT,
            movement_id INT NOT NULL,
            fuel_history_id INT NOT NULL,
            rider_id INT NOT NULL,
            entry_date DATE NULL,
            fuel_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_movement_fuel_entry (movement_id, fuel_history_id),
            KEY idx_rfpe_fuel_history (fuel_history_id),
            KEY idx_rfpe_rider (rider_id),
            KEY idx_rfpe_movement (movement_id)
        )
    `);
}

router.use(authenticateToken);

// Custom authorization for financial routes
router.use(async (req, res, next) => {
    // Admin has full access
    if (req.user.user_type === 'admin') {
        return next();
    }

    // Check specific permissions based on path
    const path = req.path;
    let requiredPerm = null;

    if (path.startsWith('/payment-vouchers')) requiredPerm = 'menu_financial_cpv';
    else if (path.startsWith('/receipt-vouchers')) requiredPerm = 'menu_financial_crv';
    else if (path.startsWith('/store-settlements')) requiredPerm = 'menu_financial_settlements';
    else if (path.startsWith('/expenses')) requiredPerm = 'menu_financial_expenses';
    else if (path.startsWith('/rider-cash')) requiredPerm = 'menu_financial_rider_cash';
    else if (path.startsWith('/bank-payment-vouchers')) requiredPerm = 'menu_financial_bpv';
    else if (path.startsWith('/bank-receipt-vouchers')) requiredPerm = 'menu_financial_brv';
    else if (path.startsWith('/journal-vouchers')) requiredPerm = 'menu_financial_jnv';
    else if (path.startsWith('/dashboard') || path.startsWith('/cash-ledger') || path.startsWith('/transactions')) requiredPerm = 'menu_financial_dashboard';
    else if (path.startsWith('/gl/') && req.method === 'GET') requiredPerm = 'menu_financial_dashboard';
    else if (path.startsWith('/reports')) {
        // SECURITY: default-deny. Non-admins need at least one report/finance
        // permission; individual handlers (e.g. /reports/generate) narrow further.
        if (req.method === 'DELETE') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }
        try {
            const [rows] = await req.db.execute(
                `SELECT 1 FROM user_permissions
                 WHERE user_id = ?
                   AND (permission_key = 'menu_reports'
                        OR permission_key LIKE 'menu\\_report\\_%'
                        OR permission_key LIKE 'report\\_%'
                        OR permission_key LIKE 'menu\\_financial%')
                 LIMIT 1`,
                [req.user.id]
            );
            if (rows.length > 0 && req.user.user_type === 'standard_user') {
                return next();
            }
        } catch (e) {
            console.error('Permission check error:', e);
        }
        return res.status(403).json({
            success: false,
            message: 'Admin access required or missing permission'
        });
    }

    // Permissions are only granted to standard users; this also prevents a rider
    // whose numeric id collides with a staff user from inheriting their access.
    if (requiredPerm && req.user.user_type === 'standard_user') {
        try {
            // Check DB for permission
            const [rows] = await req.db.execute(
                'SELECT 1 FROM user_permissions WHERE user_id = ? AND permission_key = ?',
                [req.user.id, requiredPerm]
            );
            if (rows.length > 0) {
                return next();
            }
        } catch (e) {
            console.error('Permission check error:', e);
        }
    }

    // Default reject if no specific permission matched or permission check failed
    return res.status(403).json({ 
        success: false, 
        message: 'Admin access required or missing permission' 
    });
});

router.get('/dashboard', async (req, res) => {
    try {
        const { period = 'all' } = req.query;
        const today = new Date();
        const dateOnly = today.toISOString().split('T')[0];
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 7);
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth() + 1;

        const buildPeriodFilter = (columnName) => {
            if (period === 'today') {
                return { clause: `DATE(${columnName}) = DATE(?)`, params: [dateOnly] };
            }
            if (period === 'week') {
                return { clause: `${columnName} >= ? AND ${columnName} < ?`, params: [startOfWeek.toISOString(), endOfWeek.toISOString()] };
            }
            if (period === 'month') {
                return { clause: `YEAR(${columnName}) = ? AND MONTH(${columnName}) = ?`, params: [currentYear, currentMonth] };
            }
            if (period === 'year') {
                return { clause: `YEAR(${columnName}) = ?`, params: [currentYear] };
            }
            return { clause: '', params: [] }; // all
        };

        const ftPeriod = buildPeriodFilter('ft.created_at');
        const ftWhere = [
            "COALESCE(ft.status, '') <> 'cancelled'",
            ftPeriod.clause || null
        ].filter(Boolean);

        const [transactions] = await req.db.execute(
            `SELECT transaction_type, category, SUM(amount) as total
             FROM financial_transactions ft
             WHERE ${ftWhere.join(' AND ')}
             GROUP BY transaction_type, category`,
            ftPeriod.params
        );

        const cpvPeriod = buildPeriodFilter('voucher_date');
        const cpvWhere = ["status = 'paid'", cpvPeriod.clause || null].filter(Boolean);
        const [paymentVouchers] = await req.db.execute(
            `SELECT SUM(amount) as total FROM cash_payment_vouchers WHERE ${cpvWhere.join(' AND ')}`,
            cpvPeriod.params
        );

        const crvPeriod = buildPeriodFilter('voucher_date');
        const crvWhere = ["status = 'received'", crvPeriod.clause || null].filter(Boolean);
        const [receiptVouchers] = await req.db.execute(
            `SELECT SUM(amount) as total FROM cash_receipt_vouchers WHERE ${crvWhere.join(' AND ')}`,
            crvPeriod.params
        );

        const riderPeriod = buildPeriodFilter('movement_date');
        const riderWhere = [
            "status IN ('approved', 'completed')",
            riderPeriod.clause || null
        ].filter(Boolean);
        const [riderCash] = await req.db.execute(
            `SELECT movement_type, SUM(amount) as total
             FROM rider_cash_movements rcm
             WHERE ${riderWhere.join(' AND ')}
             GROUP BY movement_type`,
            riderPeriod.params
        );

        const riderFuelPeriod = buildPeriodFilter('entry_date');
        const riderFuelWhere = [
            riderFuelPeriod.clause || null
        ].filter(Boolean);
        const [riderFuelRows] = await req.db.execute(
            `SELECT COALESCE(SUM(COALESCE(fuel_cost, 0)), 0) AS total
             FROM riders_fuel_history
             ${riderFuelWhere.length ? `WHERE ${riderFuelWhere.join(' AND ')}` : ''}`,
            riderFuelPeriod.params
        );
        const [allTimeRiderFuelRows] = await req.db.execute(
            `SELECT COALESCE(SUM(COALESCE(fuel_cost, 0)), 0) AS total
             FROM riders_fuel_history`
        );

        const unsettledPeriod = buildPeriodFilter('o.created_at');
        const unsettledWhere = [
            "o.status = 'delivered'",
            "o.payment_status = 'paid'",
            "oi.settlement_id IS NULL",
            "LOWER(TRIM(COALESCE(s.payment_term, ''))) NOT IN ('cash only', 'cash with discount')",
            "LOWER(TRIM(COALESCE(p.description, ''))) <> 'created from admin manual order'",
            `NOT EXISTS (
                SELECT 1
                FROM rider_store_payments rsp
                WHERE rsp.order_id = oi.order_id
                  AND rsp.store_id = COALESCE(oi.store_id, p.store_id)
            )`,
            unsettledPeriod.clause || null
        ].filter(Boolean);
        const [unsettledRows] = await req.db.execute(
            `SELECT COALESCE(SUM(
                oi.quantity * (
                    oi.price - (
                        CASE
                            WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%discount%'
                                 AND COALESCE(s.store_discount_apply_all_products, 0) = 1
                                 AND COALESCE(s.store_discount_percent, 0) > 0
                                THEN oi.price * (COALESCE(s.store_discount_percent, 0) / 100)
                            WHEN oi.discount_type = 'percent' AND COALESCE(oi.discount_value, 0) > 0
                                THEN oi.price * (COALESCE(oi.discount_value, 0) / 100)
                            WHEN oi.discount_type = 'amount' AND COALESCE(oi.discount_value, 0) > 0
                                THEN COALESCE(oi.discount_value, 0)
                            ELSE 0
                        END
                    )
                )
            ), 0) AS total_unsettled_amount
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             JOIN products p ON p.id = oi.product_id
             JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
             WHERE ${unsettledWhere.join(' AND ')}`,
            unsettledPeriod.params
        );

        const deliveryPeriod = buildPeriodFilter('o.created_at');
        const deliveryWhere = [
            "o.status = 'delivered'",
            deliveryPeriod.clause || null
        ].filter(Boolean);
        const [deliveryChargesRows] = await req.db.execute(
            `SELECT COALESCE(SUM(COALESCE(o.delivery_fee, 0)), 0) AS total_delivery_charges
             FROM orders o
             WHERE ${deliveryWhere.join(' AND ')}`,
            deliveryPeriod.params
        );

        const storeEarnPeriod = buildPeriodFilter('o.created_at');
        const storePaidPeriod = buildPeriodFilter('ss.settlement_date');
        const [storeBalanceRows] = await req.db.execute(
            `SELECT COALESCE(SUM(
                CASE
                    WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) IN ('cash only', 'cash with discount')
                        THEN 0
                    ELSE GREATEST(COALESCE(earn.total_payable, 0) - COALESCE(paid.total_paid, 0), 0)
                END
            ), 0) AS total_store_balances
             FROM stores s
             LEFT JOIN (
                SELECT
                    COALESCE(oi.store_id, p.store_id) AS store_id,
                    SUM(
                        GREATEST(
                            0,
                            (oi.price * oi.quantity) -
                            (
                                oi.quantity * (
                                    CASE
                                        WHEN LOWER(TRIM(COALESCE(s2.payment_term, ''))) LIKE '%discount%'
                                             AND COALESCE(s2.store_discount_apply_all_products, 0) = 1
                                             AND COALESCE(s2.store_discount_percent, 0) > 0
                                            THEN oi.price * (COALESCE(s2.store_discount_percent, 0) / 100)
                                        WHEN oi.discount_type = 'percent' AND COALESCE(oi.discount_value, 0) > 0
                                            THEN oi.price * (COALESCE(oi.discount_value, 0) / 100)
                                        WHEN oi.discount_type = 'amount' AND COALESCE(oi.discount_value, 0) > 0
                                            THEN COALESCE(oi.discount_value, 0)
                                        ELSE 0
                                    END
                                )
                            )
                        )
                    ) AS total_payable
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                JOIN products p ON oi.product_id = p.id
                JOIN stores s2 ON s2.id = COALESCE(oi.store_id, p.store_id)
                WHERE o.status = 'delivered'
                  ${storeEarnPeriod.clause ? `AND ${storeEarnPeriod.clause}` : ''}
                GROUP BY COALESCE(oi.store_id, p.store_id)
             ) earn ON earn.store_id = s.id
             LEFT JOIN (
                SELECT ss.store_id, SUM(ss.net_amount) AS total_paid
                FROM store_settlements ss
                WHERE ss.status = 'paid'
                  ${storePaidPeriod.clause ? `AND ${storePaidPeriod.clause}` : ''}
                GROUP BY ss.store_id
             ) paid ON paid.store_id = s.id`,
            [...storeEarnPeriod.params, ...storePaidPeriod.params]
        );

        // Cash in hand should represent current office cash position (all-time net),
        // so do not apply period filter on this card.
        const [cashInHandResult] = await req.db.execute(`
            SELECT 
                SUM(CASE 
                    WHEN transaction_type = 'income' THEN amount 
                    WHEN transaction_type = 'adjustment' AND category = 'rider_cash' THEN amount 
                    WHEN transaction_type = 'adjustment' AND category = 'receipt' THEN amount 
                    WHEN transaction_type = 'adjustment' AND category = 'store_payable'
                         AND LOWER(TRIM(COALESCE(s.payment_term, ''))) IN ('credit', 'credit with discount')
                        THEN amount
                    WHEN transaction_type = 'expense' THEN -amount 
                    WHEN transaction_type = 'settlement' THEN -amount 
                    WHEN transaction_type = 'refund' THEN -amount 
                    ELSE 0 
                END) as total
            FROM financial_transactions ft
            LEFT JOIN stores s
              ON s.id = ft.related_entity_id
             AND ft.related_entity_type = 'store'
            WHERE payment_method = 'cash' 
            AND ft.status = 'completed'
            AND COALESCE(category, '') != 'rider_receivable'
        `);

        const stats = {
            income: 0,
            expense: 0,
            settlement: 0,
            refund: 0,
            adjustment: 0,
            paymentVouchers: parseFloat(paymentVouchers[0]?.total || 0),
            receiptVouchers: parseFloat(receiptVouchers[0]?.total || 0),
            riderCashSubmitted: 0,
            riderCashAdvance: 0,
            riderFuelPayments: parseFloat(riderFuelRows[0]?.total || 0),
            cashInHand: Number((
                parseFloat(cashInHandResult[0]?.total || 0) -
                parseFloat(allTimeRiderFuelRows[0]?.total || 0)
            ).toFixed(2)),
            ledgerCashInHand: parseFloat(cashInHandResult[0]?.total || 0),
            deliveryCharges: parseFloat(deliveryChargesRows?.[0]?.total_delivery_charges || 0),
            storeBalances: parseFloat(storeBalanceRows?.[0]?.total_store_balances || 0),
            totalUnsettledAmount: parseFloat(unsettledRows?.[0]?.total_unsettled_amount || 0),
            netProfitIfSettled: 0
        };

        transactions.forEach(t => {
            const transactionType = String(t.transaction_type || '').trim();
            const amount = parseFloat(t.total || 0);

            stats[transactionType] = (stats[transactionType] || 0) + amount;
        });

        riderCash.forEach(rc => {
            if (rc.movement_type === 'cash_submission') {
                stats.riderCashSubmitted += parseFloat(rc.total || 0);
            } else if (rc.movement_type === 'advance') {
                stats.riderCashAdvance += parseFloat(rc.total || 0);
            }
        });

        stats.net_profit = Number((
            stats.income -
            (stats.expense + stats.settlement + stats.refund + stats.riderFuelPayments)
        ).toFixed(2));
        stats.netProfitIfSettled = Number((stats.net_profit - stats.totalUnsettledAmount).toFixed(2));

        // Income, expenses, profit and cash come from the double-entry general ledger
        // (revenue on delivery; store payouts and rider cash are balance-sheet movements,
        // not income or expense). The previous cash-movement figures stay under `legacy`.
        try {
            await ledger.syncLedgerIfStale(req.db);
            const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            let from = null;
            let to = null;
            if (period === 'today') { from = ymd(today); to = from; }
            else if (period === 'week') { from = ymd(startOfWeek); to = ymd(new Date(endOfWeek.getTime() - 86400000)); }
            else if (period === 'month') { from = ymd(new Date(currentYear, currentMonth - 1, 1)); to = ymd(new Date(currentYear, currentMonth, 0)); }
            else if (period === 'year') { from = `${currentYear}-01-01`; to = `${currentYear}-12-31`; }
            const [pl, tb] = await Promise.all([
                ledger.profitAndLoss(req.db, { from, to }),
                ledger.trialBalance(req.db),
            ]);
            const balanceOf = (code) => (tb.accounts.find((a) => a.code === code) || { balance: 0 }).balance;
            stats.legacy = {
                income: stats.income,
                expense: stats.expense,
                net_profit: stats.net_profit,
                netProfitIfSettled: stats.netProfitIfSettled,
                cashInHand: stats.cashInHand,
            };
            stats.income = pl.total_income;
            stats.expense = pl.total_expenses;
            stats.net_profit = pl.net_profit;
            stats.netProfitIfSettled = pl.net_profit; // store payables are already accrued
            stats.cashInHand = balanceOf('1000');
            stats.gl = {
                from,
                to,
                income: pl.income.map(({ code, name, amount }) => ({ code, name, amount })),
                expenses: pl.expenses.map(({ code, name, amount }) => ({ code, name, amount })),
                office_cash: balanceOf('1000'),
                bank: balanceOf('1010'),
                rider_cash_receivable: balanceOf('1100'),
                store_payables: -balanceOf('2000'),
                customer_wallets: -balanceOf('2100'),
                suspense: balanceOf('3900'),
                trial_balance_ok: tb.balanced,
            };
        } catch (glError) {
            console.error('General ledger figures unavailable for dashboard:', glError);
        }

        // Credit-store balances from the store accounts (utils/storeAccount.js): every
        // payment to a store counts, and a store that was overpaid shows as store
        // credit instead of hiding inside "0 due". Balances are as of the period end;
        // the unsettled amount is what is still due after store credit, for order
        // lines delivered in the period.
        try {
            const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            let from = null;
            let to = null;
            if (period === 'today') { from = ymd(today); to = from; }
            else if (period === 'week') { from = ymd(startOfWeek); to = ymd(new Date(endOfWeek.getTime() - 86400000)); }
            else if (period === 'month') { from = ymd(new Date(currentYear, currentMonth - 1, 1)); to = ymd(new Date(currentYear, currentMonth, 0)); }
            else if (period === 'year') { from = `${currentYear}-01-01`; to = `${currentYear}-12-31`; }
            const { accounts } = await storeAccount.loadStoreAccounts(req.db);
            let owed = 0;
            let credit = 0;
            let unsettled = 0;
            for (const account of accounts.values()) {
                if (!account.exists || account.pickup_paid) continue;
                const position = storeAccount.accountPosition(account);
                const closing = storeAccount.accountPeriod(account, { to, orders: position.orders }).closing_c;
                owed += Math.max(0, closing);
                credit += Math.max(0, -closing);
                for (const line of position.open_lines) {
                    if ((!from || line.line.date >= from) && (!to || line.line.date <= to)) unsettled += line.due_c;
                }
            }
            stats.legacy = stats.legacy || {};
            stats.legacy.storeBalances = stats.storeBalances;
            stats.legacy.totalUnsettledAmount = stats.totalUnsettledAmount;
            stats.storeBalances = storeAccount.fromCents(owed);
            stats.storeCredits = storeAccount.fromCents(credit);
            stats.totalUnsettledAmount = storeAccount.fromCents(unsettled);
        } catch (storeError) {
            console.error('Store account balances unavailable for dashboard:', storeError);
        }

        res.json({
            success: true,
            stats,
            period
        });
    } catch (error) {
        console.error('Error fetching financial dashboard:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dashboard data',
            error: error.message
        });
    }
});

router.get('/cash-ledger', async (req, res) => {
    try {
        const { period = 'month', page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        
        let dateFilter = '';
        let params = [];
        const today = new Date();

        if (period === 'today') {
            const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            dateFilter = 'AND DATE(ft.created_at) = DATE(?)';
            params.push(startOfDay.toISOString().split('T')[0]);
        } else if (period === 'week') {
            const startOfWeek = new Date(today);
            startOfWeek.setDate(today.getDate() - today.getDay());
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 7);
            dateFilter = 'AND ft.created_at >= ? AND ft.created_at < ?';
            params.push(startOfWeek.toISOString(), endOfWeek.toISOString());
        } else if (period === 'month') {
            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            dateFilter = 'AND YEAR(ft.created_at) = ? AND MONTH(ft.created_at) = ?';
            params.push(startOfMonth.getFullYear(), startOfMonth.getMonth() + 1);
        } else if (period === 'year') {
            dateFilter = 'AND YEAR(ft.created_at) = ?';
            params.push(today.getFullYear());
        }

        const query = `
            SELECT ft.*, cu.first_name as created_by_name
            FROM financial_transactions ft
            LEFT JOIN users cu ON ft.created_by = cu.id
            WHERE ft.payment_method = 'cash' 
            AND ft.status = 'completed'
            AND ft.category != 'rider_receivable'
            ${dateFilter}
            ORDER BY ft.created_at DESC
            LIMIT ? OFFSET ?
        `;

        const countQuery = `
            SELECT COUNT(*) as total
            FROM financial_transactions ft
            WHERE ft.payment_method = 'cash' 
            AND ft.status = 'completed'
            AND ft.category != 'rider_receivable'
            ${dateFilter}
        `;

        const [transactions] = await req.db.execute(query, [...params, parseInt(limit), offset]);
        const [countResult] = await req.db.execute(countQuery, params);

        res.json({
            success: true,
            transactions,
            total: countResult[0]?.total || 0,
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        console.error('Error fetching cash ledger:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch cash ledger', error: error.message });
    }
});

router.get('/transactions', async (req, res) => {
    try {
        const { type, status, page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        let whereClause = 'WHERE 1=1';
        const params = [];

        if (type) {
            whereClause += ' AND transaction_type = ?';
            params.push(type);
        }
        if (status) {
            whereClause += ' AND status = ?';
            params.push(status);
        }

        const [transactions] = await req.db.execute(
            `SELECT ft.*, cu.first_name as created_by_name, au.first_name as approved_by_name
             FROM financial_transactions ft
             LEFT JOIN users cu ON ft.created_by = cu.id
             LEFT JOIN users au ON ft.approved_by = au.id
             ${whereClause}
             ORDER BY ft.created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );

        const [countResult] = await req.db.execute(
            `SELECT COUNT(*) as total FROM financial_transactions ft ${whereClause}`,
            params
        );

        res.json({
            success: true,
            transactions,
            total: countResult[0]?.total || 0,
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch transactions',
            error: error.message
        });
    }
});

router.post('/transactions', [
    body('transaction_type').isIn(['income', 'expense', 'settlement', 'refund', 'adjustment']),
    body('amount').isFloat({ min: 0.01 }),
    body('payment_method').isIn(['cash', 'card', 'bank_transfer', 'wallet', 'cheque']),
    body('description').optional().trim()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        // Direct ledger postings bypass voucher approval, so only admins may make them;
        // staff record money movements through vouchers.
        if (req.user.user_type !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Only an admin can post directly to the ledger; please use a voucher'
            });
        }

        const { transaction_type, category, description, amount, payment_method, reference_type, reference_id, notes } = req.body;
        
        const transactionId = await recordFinancialTransaction(req.db, {
            transaction_type,
            category,
            description,
            amount,
            payment_method,
            reference_type,
            reference_id,
            notes,
            created_by: req.user.id
        });

        if (!transactionId) {
            throw new Error('Failed to record transaction');
        }

        // Get the transaction number for the response
        const [rows] = await req.db.execute('SELECT transaction_number FROM financial_transactions WHERE id = ?', [transactionId]);

        res.status(201).json({
            success: true,
            message: 'Transaction recorded successfully',
            transaction: {
                id: transactionId,
                transaction_number: rows[0]?.transaction_number
            }
        });
    } catch (error) {
        console.error('Error creating transaction:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create transaction',
            error: error.message
        });
    }
});

router.get('/payment-vouchers', async (req, res) => {
    try {
        const { status, payment_method, page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        let whereClause = 'WHERE 1=1';
        const params = [];

        if (status) {
            whereClause += ' AND status = ?';
            params.push(status);
        }

        if (payment_method) {
            if (payment_method === 'cash') {
                whereClause += ' AND payment_method = \'cash\'';
            } else if (payment_method === 'bank') {
                whereClause += ' AND (payment_method = \'bank_transfer\' OR payment_method = \'cheque\')';
            }
        }

        const [vouchers] = await req.db.execute(
            `SELECT cpv.*, pb.first_name as prepared_by_name, ab.first_name as approved_by_name, pib.first_name as paid_by_name
             FROM cash_payment_vouchers cpv
             LEFT JOIN users pb ON cpv.prepared_by = pb.id
             LEFT JOIN users ab ON cpv.approved_by = ab.id
             LEFT JOIN users pib ON cpv.paid_by = pib.id
             ${whereClause}
             ORDER BY cpv.voucher_date DESC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );

        const [countResult] = await req.db.execute(
            `SELECT COUNT(*) as total FROM cash_payment_vouchers ${whereClause}`,
            params
        );

        res.json({
            success: true,
            vouchers,
            total: countResult[0]?.total || 0,
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        console.error('Error fetching payment vouchers:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payment vouchers',
            error: error.message
        });
    }
});

router.get('/entities', async (req, res) => {
    try {
        const { type } = req.query;
        let data = [];

        if (type === 'store') {
            const [stores] = await req.db.execute('SELECT id, name FROM stores ORDER BY name');
            data = stores;
        } else if (type === 'rider') {
            const [riders] = await req.db.execute('SELECT id, CONCAT(first_name, " ", last_name) as name FROM riders ORDER BY first_name');
            data = riders;
        } else if (type === 'employee') {
            const [employees] = await req.db.execute('SELECT id, CONCAT(first_name, " ", last_name) as name FROM users WHERE user_type IN ("admin", "staff") ORDER BY first_name');
            data = employees;
        } else if (type === 'expense') {
            const [expenses] = await req.db.execute(`
                SELECT DISTINCT name FROM (
                    SELECT category as name FROM admin_expenses WHERE category IS NOT NULL
                    UNION
                    SELECT payee_name as name FROM cash_payment_vouchers WHERE payee_type = 'expense' AND payee_name IS NOT NULL
                ) as combined_expenses 
                ORDER BY name
            `);
            data = expenses.map(e => ({ id: e.name, name: e.name }));
        } else if (type === 'customer') {
            const [customers] = await req.db.execute('SELECT id, CONCAT(first_name, " ", last_name) as name FROM users WHERE user_type = "customer" ORDER BY first_name');
            data = customers;
        } else if (type === 'bank') {
            const [banks] = await req.db.execute('SELECT id, name FROM banks WHERE is_active = true ORDER BY name');
            data = banks;
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('Error fetching entities:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch entities' });
    }
});

router.post('/payment-vouchers', [
    body('payee_name').trim().notEmpty(),
    body('payee_type').isIn(['store', 'rider', 'vendor', 'employee', 'expense', 'customer', 'bank', 'other']),
    body('amount').isFloat({ min: 0.01 }),
    body('payment_method').isIn(['cash', 'check', 'cheque', 'bank_transfer']),
    body('purpose').optional().trim()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { payee_name, payee_type, payee_id, amount, purpose, description, payment_method, check_number, cheque_number, bank_details } = req.body;
        const voucher_number = generateVoucherNumber('CPV');
        const voucher_date = new Date().toISOString().split('T')[0];

        // Normalize cheque number
        const finalChequeNumber = cheque_number || check_number || null;

        const [result] = await req.db.execute(
            `INSERT INTO cash_payment_vouchers 
             (voucher_number, voucher_date, payee_name, payee_type, payee_id, amount, purpose, description, payment_method, check_number, bank_details, prepared_by, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
            [voucher_number, voucher_date, payee_name, payee_type, payee_id || null, amount, purpose || null, description || null, payment_method, finalChequeNumber, bank_details || null, req.user.id]
        );

        res.status(201).json({
            success: true,
            message: 'Payment voucher created successfully',
            voucher: {
                id: result.insertId,
                voucher_number
            }
        });
    } catch (error) {
        console.error('Error creating payment voucher:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create payment voucher',
            error: error.message
        });
    }
});

router.put('/payment-vouchers/:id', [
    body('amount').optional().isFloat({ min: 0.01 }),
    body('status').optional().isIn(['draft', 'pending', 'approved', 'paid', 'cancelled']),
    body('payment_method').optional().isIn(['cash', 'check', 'cheque', 'bank_transfer'])
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { id } = req.params;
        // Internal controls: status transitions, posted-field locks, maker-checker
        const controlError = await checkDocumentUpdate(req.db, req.user, 'payment_voucher', id, req.body);
        if (controlError) {
            return res.status(controlError.status).json({ success: false, message: controlError.message });
        }
        const { payee_name, payee_type, payee_id, amount, status, description, payment_method, check_number, cheque_number } = req.body;

        // Get existing voucher data if we're moving voucher into an accounting-posted state
        let existingVoucher = null;
        const postingStatuses = new Set(['approved', 'paid']);
        const targetStatus = (status || '').toString().toLowerCase();
        if (postingStatuses.has(targetStatus)) {
            const [rows] = await req.db.execute('SELECT * FROM cash_payment_vouchers WHERE id = ?', [id]);
            if (rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Voucher not found' });
            }
            existingVoucher = rows[0];
            
            if (targetStatus === 'paid' && String(existingVoucher.status || '').toLowerCase() === 'paid') {
                return res.status(400).json({ success: false, message: 'Voucher is already marked as paid' });
            }
        }

        const updates = [];
        const params = [];

        if (payee_name) {
            updates.push('payee_name = ?');
            params.push(payee_name);
        }
        if (payee_type) {
            updates.push('payee_type = ?');
            params.push(payee_type);
        }
        if (payee_id !== undefined) { // Allow null to be passed
            updates.push('payee_id = ?');
            params.push(payee_id);
        }
        if (amount) {
            updates.push('amount = ?');
            params.push(amount);
        }
        if (status) {
            updates.push('status = ?');
            params.push(status);
            if (status === 'approved') {
                updates.push('approved_by = ?, approved_at = NOW()');
                params.push(req.user.id);
            } else if (status === 'paid') {
                updates.push('paid_by = ?, paid_at = NOW()');
                params.push(req.user.id);
            }
        }
        if (description) {
            updates.push('description = ?');
            params.push(description);
        }
        if (payment_method) {
            updates.push('payment_method = ?');
            params.push(payment_method);
        }
        
        const finalChequeNumber = cheque_number !== undefined ? cheque_number : (check_number !== undefined ? check_number : undefined);
        if (finalChequeNumber !== undefined) {
             updates.push('check_number = ?');
             params.push(finalChequeNumber);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No fields to update'
            });
        }

        params.push(id);

        await req.db.execute(
            `UPDATE cash_payment_vouchers SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        // Create CPV financial posting only once when voucher transitions into approved/paid.
        const previousStatus = String(existingVoucher?.status || '').toLowerCase();
        const movedIntoPostedState =
            postingStatuses.has(targetStatus) && !postingStatuses.has(previousStatus);

        if (movedIntoPostedState && existingVoucher) {
            const voucherAmount = amount || existingVoucher.amount;
            const voucherPayee = payee_name || existingVoucher.payee_name;
            const voucherDescription = description || existingVoucher.description || existingVoucher.purpose || 'Payment via voucher';
            const voucherRef = existingVoucher.voucher_number;

            // Prevent duplicate posting when status is toggled or retried.
            const [alreadyPosted] = await req.db.execute(
                `SELECT id
                 FROM financial_transactions
                 WHERE reference_type = 'payment_voucher' AND reference_id = ?
                 LIMIT 1`,
                [voucherRef]
            );

            if (!alreadyPosted.length) {
                await recordFinancialTransaction(req.db, {
                    transaction_type: 'expense',
                    category: 'payment',
                    description: `CPV ${voucherRef} | Payment to ${voucherPayee}: ${voucherDescription}`,
                    amount: voucherAmount,
                    payment_method: payment_method || existingVoucher.payment_method,
                    related_entity_type: existingVoucher.payee_type,
                    related_entity_id: existingVoucher.payee_id,
                    reference_type: 'payment_voucher',
                    reference_id: voucherRef,
                    created_by: req.user.id
                });

                // If payee is a rider, record cash settlement/advance and update wallet (Debit)
                const payeeType = payee_type || existingVoucher.payee_type;
                const payeeId = payee_id !== undefined ? payee_id : existingVoucher.payee_id;

                if (payeeType === 'rider' && payeeId) {
                    const movement_number = generateVoucherNumber('RCM');
                    const movement_date = new Date().toISOString().split('T')[0];
                    const movementType = 'settlement'; // Using settlement for payments to riders

                    const [existingMovement] = await req.db.execute(
                        `SELECT id
                         FROM rider_cash_movements
                         WHERE reference_type = 'payment_voucher'
                           AND reference_id = ?
                           AND movement_type = 'settlement'
                         LIMIT 1`,
                        [existingVoucher.id]
                    );
                    if (!existingMovement.length) {
                        const [movementResult] = await req.db.execute(
                            `INSERT INTO rider_cash_movements 
                             (movement_number, rider_id, movement_date, movement_type, amount, description, reference_type, reference_id, recorded_by, status, approved_by, approved_at)
                             VALUES (?, ?, ?, ?, ?, ?, 'payment_voucher', ?, ?, 'completed', ?, NOW())`,
                            [movement_number, payeeId, movement_date, movementType, voucherAmount, `Cash payment via CPV ${voucherRef}`, existingVoucher.id, req.user.id, req.user.id]
                        );

                        // Debit rider wallet (reduce company liability / increase rider liability)
                        await recordRiderWalletTransaction(
                            req.db,
                            payeeId,
                            'debit',
                            voucherAmount,
                            `Cash payment via CPV ${voucherRef}`,
                            movementResult.insertId,
                            movementType
                        );
                    }
                } else if (payeeType === 'store' && payeeId) {
                    // Debit store wallet (reduce company liability)
                    await recordStoreWalletTransaction(
                        req.db,
                        payeeId,
                        'debit',
                        voucherAmount,
                        `Payment via CPV ${voucherRef}`,
                        existingVoucher.id,
                        'payment_voucher'
                    );
                } else if (payeeType === 'employee' && payeeId) {
                    // Debit employee wallet (reduce company liability)
                    await recordUserWalletTransaction(
                        req.db,
                        payeeId,
                        'debit',
                        voucherAmount,
                        `Payment via CPV ${voucherRef}`,
                        existingVoucher.id,
                        'payment_voucher'
                    );
                }
            }
        }

        res.json({
            success: true,
            message: 'Payment voucher updated successfully'
        });
    } catch (error) {
        console.error('Error updating payment voucher:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update payment voucher',
            error: error.message
        });
    }
});

router.get('/receipt-vouchers', async (req, res) => {
    try {
        let { status, payment_method, page = 1, limit = 20 } = req.query;
        
        // Handle array parameters (take first item) to prevent SQL errors
        if (Array.isArray(status)) status = status[0];
        if (Array.isArray(payment_method)) payment_method = payment_method[0];

        const offset = (parseInt(page) - 1) * parseInt(limit);

        let whereClause = 'WHERE 1=1';
        const params = [];

        if (status) {
            whereClause += ' AND crv.status = ?';
            params.push(status);
        }

        if (payment_method) {
            if (payment_method === 'cash') {
                whereClause += ' AND crv.payment_method = \'cash\'';
            } else if (payment_method === 'bank') {
                whereClause += ' AND (crv.payment_method = \'bank_transfer\' OR crv.payment_method = \'cheque\')';
            }
        }

        const [vouchers] = await req.db.execute(
            `SELECT crv.*, pb.first_name as prepared_by_name, ab.first_name as approved_by_name, rb.first_name as received_by_name
             FROM cash_receipt_vouchers crv
             LEFT JOIN users pb ON crv.prepared_by = pb.id
             LEFT JOIN users ab ON crv.approved_by = ab.id
             LEFT JOIN users rb ON crv.received_by = rb.id
             ${whereClause}
             ORDER BY crv.voucher_date DESC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );

        const [countResult] = await req.db.execute(
            `SELECT COUNT(*) as total FROM cash_receipt_vouchers crv ${whereClause}`,
            params
        );

        res.json({
            success: true,
            vouchers,
            total: countResult[0]?.total || 0,
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        console.error('Error fetching receipt vouchers:', error);
        logDebugError(error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch receipt vouchers',
            error: error.message
        });
    }
});

router.post('/receipt-vouchers', [
    body('payer_name').trim().notEmpty(),
    body('payer_type').isIn(['customer', 'store', 'rider', 'vendor', 'employee', 'expense', 'bank', 'other']),
    body('amount').isFloat({ min: 0.01 }),
    body('payment_method').isIn(['cash', 'cheque', 'bank_transfer']),
    body('description').optional().trim()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { payer_name, payer_type, payer_id, amount, description, details, payment_method } = req.body;
        // Accept either cheque_number or check_number from client, normalize to one variable
        const cheque_number = req.body.cheque_number ?? req.body.check_number ?? null;
        const bank_details = req.body.bank_details ?? null;
        const voucher_number = generateVoucherNumber('CRV');
        const voucher_date = new Date().toISOString().split('T')[0];

        // Try insert with 'cheque_number', fallback to 'check_number' if column not found
        let result;
        try {
            const insertSqlCheque = `
                INSERT INTO cash_receipt_vouchers 
                (voucher_number, voucher_date, payer_name, payer_type, payer_id, amount, description, details, payment_method, cheque_number, bank_details, prepared_by, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
            `;
            const insertParamsCheque = [
                voucher_number,
                voucher_date,
                payer_name,
                payer_type,
                payer_id || null,
                amount,
                description || null,
                details || null,
                payment_method,
                cheque_number || null,
                bank_details || null,
                req.user.id
            ];
            [result] = await req.db.execute(insertSqlCheque, insertParamsCheque);
        } catch (e) {
            const msg = e && e.message ? e.message.toLowerCase() : '';
            if (msg.includes('unknown column') && msg.includes('cheque_number')) {
                const insertSqlCheck = `
                    INSERT INTO cash_receipt_vouchers 
                    (voucher_number, voucher_date, payer_name, payer_type, payer_id, amount, description, details, payment_method, check_number, bank_details, prepared_by, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
                `;
                const insertParamsCheck = [
                    voucher_number,
                    voucher_date,
                    payer_name,
                    payer_type,
                    payer_id || null,
                    amount,
                    description || null,
                    details || null,
                    payment_method,
                    cheque_number || null,
                    bank_details || null,
                    req.user.id
                ];
                [result] = await req.db.execute(insertSqlCheck, insertParamsCheck);
            } else {
                throw e;
            }
        }

        res.status(201).json({
            success: true,
            message: 'Receipt voucher created successfully',
            voucher: {
                id: result.insertId,
                voucher_number
            }
        });
    } catch (error) {
        console.error('Error creating receipt voucher:', error);
        logDebugError(error);
        res.status(500).json({
            success: false,
            message: 'Failed to create receipt voucher',
            error: error.message
        });
    }
});

router.put('/receipt-vouchers/:id', [
    body('amount').optional().isFloat({ min: 0.01 }),
    body('status').optional().isIn(['draft', 'pending', 'approved', 'received', 'cancelled'])
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { id } = req.params;
        // Receipt vouchers have no approval stage in the schema: approving one confirms the cash was received
        if (req.body.status === 'approved') req.body.status = 'received';
        // Internal controls: status transitions, posted-field locks, maker-checker
        const controlError = await checkDocumentUpdate(req.db, req.user, 'receipt_voucher', id, req.body);
        if (controlError) {
            return res.status(controlError.status).json({ success: false, message: controlError.message });
        }
        const { payer_name, payer_type, payer_id, amount, status, description } = req.body;

        // Get existing voucher data if we're marking it as received
        let existingVoucher = null;
        if (status === 'received') {
            const [rows] = await req.db.execute('SELECT * FROM cash_receipt_vouchers WHERE id = ?', [id]);
            if (rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Voucher not found' });
            }
            existingVoucher = rows[0];
            
            if (existingVoucher.status === 'received') {
                return res.status(400).json({ success: false, message: 'Voucher is already marked as received' });
            }
        }

        const updates = [];
        const params = [];

        if (payer_name) {
            updates.push('payer_name = ?');
            params.push(payer_name);
        }
        if (payer_type) {
            updates.push('payer_type = ?');
            params.push(payer_type);
        }
        if (payer_id !== undefined) { // Allow null to be passed
            updates.push('payer_id = ?');
            params.push(payer_id);
        }
        if (amount) {
            updates.push('amount = ?');
            params.push(amount);
        }
        if (status) {
            updates.push('status = ?');
            params.push(status);
            if (status === 'approved') {
                updates.push('approved_by = ?, approved_at = NOW()');
                params.push(req.user.id);
            } else if (status === 'received') {
                updates.push('received_by = ?, received_at = NOW()');
                params.push(req.user.id);
            }
        }
        if (description) {
            updates.push('description = ?');
            params.push(description);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No fields to update'
            });
        }

        params.push(id);

        // All-or-nothing: a voucher must not read "received" unless the payer's
        // wallet and cash records were posted with it.
        const isNewReceipt = (status === 'received' || status === 'approved') && existingVoucher;
        const voucherAmount = amount || existingVoucher?.amount;
        const conn = await req.db.getConnection();
        try {
            await conn.beginTransaction();
            await conn.execute(
                `UPDATE cash_receipt_vouchers SET ${updates.join(', ')} WHERE id = ?`,
                params
            );

            if (isNewReceipt) {
                // If payer is a rider, record cash submission and update wallet
                const payerType = payer_type || existingVoucher.payer_type;
                const payerId = payer_id !== undefined ? payer_id : existingVoucher.payer_id;

                if (payerType === 'rider' && payerId) {
                    const movement_number = generateVoucherNumber('RCM');
                    const movement_date = new Date().toISOString().split('T')[0];

                    const [movementResult] = await conn.execute(
                        `INSERT INTO rider_cash_movements
                         (movement_number, rider_id, movement_date, movement_type, amount, description, reference_type, reference_id, recorded_by, status, approved_by, approved_at)
                         VALUES (?, ?, ?, 'cash_submission', ?, ?, 'receipt_voucher', ?, ?, 'completed', ?, NOW())`,
                        [movement_number, payerId, movement_date, voucherAmount, `Cash submission via CRV ${existingVoucher.voucher_number}`, existingVoucher.id, req.user.id, req.user.id]
                    );

                    // Debit rider wallet: rider submitted cash to office, so rider-held cash decreases.
                    await recordRiderWalletTransaction(
                        conn,
                        payerId,
                        'debit',
                        voucherAmount,
                        `Cash submission via CRV ${existingVoucher.voucher_number}`,
                        movementResult.insertId,
                        'cash_submission'
                    );
                } else if (payerType === 'store' && payerId) {
                    // Credit store wallet (increase company liability / reduce store debt)
                    await recordStoreWalletTransaction(
                        conn,
                        payerId,
                        'credit',
                        voucherAmount,
                        `Receipt via CRV ${existingVoucher.voucher_number}`,
                        existingVoucher.id,
                        'receipt_voucher'
                    );
                } else if (payerType === 'employee' && payerId) {
                    // Credit employee wallet (increase company liability / reduce employee debt)
                    await recordUserWalletTransaction(
                        conn,
                        payerId,
                        'credit',
                        voucherAmount,
                        `Receipt via CRV ${existingVoucher.voucher_number}`,
                        existingVoucher.id,
                        'receipt_voucher'
                    );
                }
            }
            await conn.commit();
        } catch (postingError) {
            await conn.rollback();
            throw postingError;
        } finally {
            conn.release();
        }

        // Create financial transaction if status changed to received or approved
        if (isNewReceipt) {
            const voucherPayer = payer_name || existingVoucher.payer_name;
            const voucherDescription = description || existingVoucher.description || 'Receipt via voucher';

            await recordFinancialTransaction(req.db, {
                transaction_type: 'income',
                category: 'receipt',
                description: `Receipt from ${voucherPayer}: ${voucherDescription}`,
                amount: voucherAmount,
                payment_method: existingVoucher.payment_method,
                related_entity_type: existingVoucher.payer_type,
                related_entity_id: existingVoucher.payer_id,
                reference_type: 'receipt_voucher',
                reference_id: existingVoucher.voucher_number,
                created_by: req.user.id
            });
        }

        res.json({
            success: true,
            message: 'Receipt voucher updated successfully'
        });
    } catch (error) {
        console.error('Error updating receipt voucher:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update receipt voucher',
            error: error.message
        });
    }
});

router.get('/rider-cash', async (req, res) => {
    try {
        const { rider_id, type, status, page = 1, limit = 500, from, to, date } = req.query;
        const normalizedLimit = Math.max(1, Math.min(2000, parseInt(limit, 10) || 500));
        const normalizedPage = Math.max(1, parseInt(page, 10) || 1);
        const offset = (normalizedPage - 1) * normalizedLimit;

        let whereClause = 'WHERE 1=1';
        const params = [];

        if (rider_id) {
            whereClause += ' AND rcm.rider_id = ?';
            params.push(rider_id);
        }
        if (type) {
            whereClause += ' AND rcm.movement_type = ?';
            params.push(type);
        }
        if (status) {
            whereClause += ' AND rcm.status = ?';
            params.push(status);
        }
        if (date) {
            whereClause += ' AND DATE(rcm.movement_date) = ?';
            params.push(date);
        } else {
            if (from) {
                whereClause += ' AND DATE(rcm.movement_date) >= ?';
                params.push(from);
            }
            if (to) {
                whereClause += ' AND DATE(rcm.movement_date) <= ?';
                params.push(to);
            }
        }

        // Only show movements for active riders
        whereClause += ' AND r.is_active = true';

        const [movements] = await req.db.execute(
            `SELECT rcm.*, r.first_name, r.last_name, rb.first_name as recorded_by_name, ab.first_name as approved_by_name,
                    o.order_number
             FROM rider_cash_movements rcm
             LEFT JOIN riders r ON rcm.rider_id = r.id
             LEFT JOIN users rb ON rcm.recorded_by = rb.id
             LEFT JOIN users ab ON rcm.approved_by = ab.id
             LEFT JOIN orders o
               ON rcm.reference_type = 'order'
              AND CAST(rcm.reference_id AS UNSIGNED) = o.id
             ${whereClause}
             ORDER BY rcm.movement_date DESC, rcm.id DESC
             LIMIT ? OFFSET ?`,
            [...params, normalizedLimit, offset]
        );

        const [countResult] = await req.db.execute(
            `SELECT COUNT(*) as total FROM rider_cash_movements rcm
             LEFT JOIN riders r ON rcm.rider_id = r.id
             ${whereClause}`,
            params
        );

        res.json({
            success: true,
            movements,
            total: countResult[0]?.total || 0,
            page: normalizedPage,
            limit: normalizedLimit
        });
    } catch (error) {
        console.error('Error fetching rider cash movements:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch rider cash movements',
            error: error.message
        });
    }
});

// Helper function to get or create rider wallet
async function getOrCreateRiderWallet(db, riderId) {
    const [wallets] = await db.execute(
        `SELECT id, rider_id, balance, total_credited, total_spent FROM wallets WHERE rider_id = ?`,
        [riderId]
    );

    if (!wallets.length) {
        await db.execute(
            'INSERT INTO wallets (rider_id, user_type, balance) VALUES (?, ?, ?)',
            [riderId, 'rider', 0]
        );
        
        const [newWallet] = await db.execute(
            'SELECT id, rider_id, balance, total_credited, total_spent FROM wallets WHERE rider_id = ?',
            [riderId]
        );
        return newWallet[0];
    }
    return wallets[0];
}

async function assertNoWalletOrderCreditConflict(db, orderId, riderId, walletId) {
    try {
        const [existingCredits] = await db.execute(
            `SELECT wt.id, wt.wallet_id, w.rider_id AS wallet_rider_id
             FROM wallet_transactions wt
             JOIN wallets w ON w.id = wt.wallet_id
             WHERE wt.type = 'credit'
               AND wt.reference_type = 'order'
               AND CAST(wt.reference_id AS UNSIGNED) = ?
               AND w.rider_id IS NOT NULL
             LIMIT 5`,
            [orderId]
        );

        const conflictingCredit = existingCredits.find(
            (row) =>
                Number(row.wallet_id) !== Number(walletId) ||
                Number(row.wallet_rider_id) !== Number(riderId)
        );
        if (conflictingCredit) {
            console.warn(
                `[Wallet Credit Warning] Order ${orderId} already credited rider wallet ${conflictingCredit.wallet_id} / rider ${conflictingCredit.wallet_rider_id}. Skipping duplicate credit.`
            );
            return existingCredits;
        }

        return existingCredits;
    } catch (err) {
        console.warn('Error checking wallet order credit conflict:', err);
        return [];
    }
}

// Helper function to record wallet transaction and update balance
async function recordRiderWalletTransaction(db, riderId, type, amount, description, movementId, movementType) {
    // Idempotency guard: one wallet transaction per rider_cash_movement reference.
    // If already posted, do not post again.
    const [existingTx] = await db.execute(
        `SELECT wt.id, wt.type, wt.amount
         FROM wallet_transactions wt
         JOIN wallets w ON w.id = wt.wallet_id
         WHERE w.rider_id = ?
           AND wt.reference_type = 'rider_cash_movement'
           AND wt.reference_id = ?
         LIMIT 1`,
        [riderId, movementId]
    );
    if (existingTx.length > 0) {
        return { walletId: null, newBalance: null, skipped: true, existing: existingTx[0] };
    }

    const wallet = await getOrCreateRiderWallet(db, riderId);
    // Relative update: concurrent postings cannot overwrite each other
    const newBalance = await applyWalletDelta(db, wallet.id, type, amount);

    // Record wallet transaction
    await db.execute(
        `INSERT INTO wallet_transactions 
         (wallet_id, type, amount, description, reference_type, reference_id, balance_after) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [wallet.id, type, amount, description, 'rider_cash_movement', movementId, newBalance]
    );

    return { walletId: wallet.id, newBalance };
}

async function ensureWalletCreditsForSubmissionOrders(db, riderId, movementId) {
    try {
        await ensureRiderCashSubmissionOrdersTable(db);
        const wallet = await getOrCreateRiderWallet(db, riderId);
        if (!wallet || Number(wallet.rider_id || riderId) !== Number(riderId)) {
            console.warn(`Wallet for rider ${riderId} could not be resolved cleanly`);
            return { backfilledCount: 0, backfilledAmount: 0 };
        }

        // Find linked orders missing wallet credit entries for this rider
        const [missingRows] = await db.execute(
            `SELECT rcso.order_id,
                    rcso.order_number,
                    rcso.order_amount
             FROM rider_cash_submission_orders rcso
             JOIN orders o ON o.id = rcso.order_id AND o.rider_id = rcso.rider_id
             LEFT JOIN wallet_transactions wt
               ON wt.wallet_id = ?
              AND wt.type = 'credit'
              AND wt.reference_type = 'order'
              AND CAST(wt.reference_id AS UNSIGNED) = rcso.order_id
             WHERE rcso.movement_id = ?
               AND rcso.rider_id = ?
               AND wt.id IS NULL
             ORDER BY rcso.order_id ASC`,
            [wallet.id, movementId, riderId]
        );

        let runningBalance = parseFloat(wallet.balance || 0);
        let backfilledAmount = 0;
        for (const row of missingRows) {
            const amount = Number(row.order_amount || 0);
            if (amount <= 0) continue;
            const existingCredits = await assertNoWalletOrderCreditConflict(
                db,
                row.order_id,
                riderId,
                wallet.id
            );
            if (existingCredits && existingCredits.length > 0) continue;
            runningBalance += amount;
            backfilledAmount += amount;

            await db.execute(
                `INSERT INTO wallet_transactions
                 (wallet_id, type, amount, description, reference_type, reference_id, balance_after)
                 VALUES (?, 'credit', ?, ?, 'order', ?, ?)`,
                [
                    wallet.id,
                    amount,
                    `Auto backfill from submitted cash order #${row.order_number || row.order_id}`,
                    row.order_id,
                    runningBalance
                ]
            );
        }

        if (backfilledAmount > 0) {
            // Relative update so concurrent postings are not overwritten
            await db.execute(
                `UPDATE wallets
                 SET balance = balance + ?,
                     total_credited = total_credited + ?
                 WHERE id = ?`,
                [backfilledAmount, backfilledAmount, wallet.id]
            );
        }

        return {
            backfilledCount: missingRows.length,
            backfilledAmount
        };
    } catch (err) {
        console.warn('Non-fatal error in ensureWalletCreditsForSubmissionOrders:', err);
        return { backfilledCount: 0, backfilledAmount: 0 };
    }
}

router.post('/rider-cash', [
    body('rider_id').isInt({ min: 1 }),
    body('movement_type').isIn(['cash_collection', 'cash_submission', 'advance', 'settlement', 'adjustment', 'store_payment', 'fuel_payment']),
    body('amount').isFloat({ min: 0.01 }),
    body('description').optional().trim()
], async (req, res) => {
    try {
        await ensureRiderCashMovementTypes(req.db);
        await ensureRiderCashSubmissionOrdersTable(req.db);
        await ensureRiderFuelPaymentEntriesTable(req.db);
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { rider_id, movement_type, amount, description, reference_type, reference_id, notes } = req.body;

        if (movement_type === 'cash_collection') {
            return res.status(400).json({
                success: false,
                message: 'Cash collection is auto-created from delivered cash orders. Use cash submission when rider hands cash to office.'
            });
        }

        const linkedOrderIds = Array.from(
            new Set(
                (Array.isArray(req.body.linked_orders) ? req.body.linked_orders : [])
                    .map((v) => parseInt(v, 10))
                    .filter((v) => Number.isInteger(v) && v > 0)
            )
        );
        const linkedFuelEntryIds = Array.from(
            new Set(
                (Array.isArray(req.body.linked_fuel_entries) ? req.body.linked_fuel_entries : [])
                    .map((v) => parseInt(v, 10))
                    .filter((v) => Number.isInteger(v) && v > 0)
            )
        );
        const movement_number = generateVoucherNumber('RCM');
        const movement_date = new Date().toISOString().split('T')[0];

        let eligibleOrders = [];
        let eligibleFuelEntries = [];
        if (movement_type === 'cash_submission' && linkedOrderIds.length > 0) {
            const placeholders = linkedOrderIds.map(() => '?').join(',');
            const [orders] = await req.db.execute(
                `SELECT
                    o.id,
                    o.order_number,
                    o.total_amount AS order_total_amount,
                    COALESCE(sp.store_paid_amount, 0) AS store_paid_amount,
                    GREATEST(COALESCE(o.total_amount, 0) - COALESCE(sp.store_paid_amount, 0), 0) AS total_amount
                 FROM orders o
                 LEFT JOIN (
                    SELECT order_id, SUM(amount) AS store_paid_amount
                    FROM rider_store_payments
                    WHERE rider_id = ?
                    GROUP BY order_id
                 ) sp ON sp.order_id = o.id
                 WHERE o.rider_id = ?
                   AND o.status = 'delivered'
                   AND LOWER(TRIM(COALESCE(o.payment_method, ''))) = 'cash'
                   AND LOWER(TRIM(COALESCE(o.payment_status, ''))) = 'paid'
                   AND o.id IN (${placeholders})`,
                [rider_id, rider_id, ...linkedOrderIds]
            );
            eligibleOrders = orders || [];
            if (eligibleOrders.length !== linkedOrderIds.length) {
                return res.status(400).json({
                    success: false,
                    message: 'One or more selected orders are invalid for this rider cash submission'
                });
            }

            const [alreadyLinked] = await req.db.execute(
                `SELECT rcso.order_id, COALESCE(o.order_number, CONCAT('#', rcso.order_id)) AS order_number
                 FROM rider_cash_submission_orders rcso
                 JOIN rider_cash_movements rcm ON rcm.id = rcso.movement_id
                 LEFT JOIN orders o ON o.id = rcso.order_id
                 WHERE rcso.order_id IN (${placeholders})
                   AND rcm.movement_type = 'cash_submission'
                   AND rcm.status IN ('pending', 'approved', 'completed')`,
                linkedOrderIds
            );
            if (alreadyLinked.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Some orders are already submitted: ${alreadyLinked.map((r) => r.order_number).join(', ')}`
                });
            }

            const expectedAmount = eligibleOrders.reduce((s, o) => s + Number(o.total_amount || 0), 0);
            if (Math.abs(Number(amount || 0) - expectedAmount) > 0.01) {
                return res.status(400).json({
                    success: false,
                    message: `Amount must match selected orders total (${expectedAmount.toFixed(2)})`
                });
            }
        }

        if (movement_type === 'fuel_payment' && linkedFuelEntryIds.length > 0) {
            const placeholders = linkedFuelEntryIds.map(() => '?').join(',');
            const [fuelEntries] = await req.db.execute(
                `SELECT fh.id, fh.rider_id, fh.entry_date, fh.fuel_cost
                 FROM riders_fuel_history fh
                 WHERE fh.rider_id = ?
                   AND fh.id IN (${placeholders})`,
                [rider_id, ...linkedFuelEntryIds]
            );
            eligibleFuelEntries = fuelEntries || [];
            if (eligibleFuelEntries.length !== linkedFuelEntryIds.length) {
                return res.status(400).json({
                    success: false,
                    message: 'One or more selected fuel entries are invalid for this rider'
                });
            }

            const [alreadyLinkedFuel] = await req.db.execute(
                `SELECT rfpe.fuel_history_id
                 FROM rider_fuel_payment_entries rfpe
                 JOIN rider_cash_movements rcm ON rcm.id = rfpe.movement_id
                 WHERE rfpe.fuel_history_id IN (${placeholders})
                   AND rcm.movement_type = 'fuel_payment'
                   AND rcm.status IN ('pending', 'approved', 'completed')`,
                linkedFuelEntryIds
            );
            if (alreadyLinkedFuel.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Some selected fuel entries are already linked to fuel payment'
                });
            }

            const expectedFuelAmount = eligibleFuelEntries.reduce((s, r) => s + Number(r.fuel_cost || 0), 0);
            if (Math.abs(Number(amount || 0) - expectedFuelAmount) > 0.01) {
                return res.status(400).json({
                    success: false,
                    message: `Amount must match selected fuel entries total (${expectedFuelAmount.toFixed(2)})`
                });
            }
        }

        const [result] = await req.db.execute(
            `INSERT INTO rider_cash_movements 
             (movement_number, rider_id, movement_date, movement_type, amount, description, reference_type, reference_id, recorded_by, notes, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [movement_number, rider_id, movement_date, movement_type, amount, description || null, reference_type || null, reference_id || null, req.user.id, notes || null]
        );

        if (movement_type === 'cash_submission' && eligibleOrders.length > 0) {
            const valuesSql = eligibleOrders.map(() => '(?, ?, ?, ?, ?)').join(', ');
            const insertParams = [];
            eligibleOrders.forEach((o) => {
                insertParams.push(result.insertId, o.id, rider_id, o.order_number || null, Number(o.total_amount || 0));
            });
            await req.db.execute(
                `INSERT INTO rider_cash_submission_orders
                 (movement_id, order_id, rider_id, order_number, order_amount)
                 VALUES ${valuesSql}`,
                insertParams
            );
        }

        if (movement_type === 'fuel_payment' && eligibleFuelEntries.length > 0) {
            const valuesSql = eligibleFuelEntries.map(() => '(?, ?, ?, ?, ?)').join(', ');
            const insertParams = [];
            eligibleFuelEntries.forEach((f) => {
                insertParams.push(
                    result.insertId,
                    f.id,
                    rider_id,
                    f.entry_date || null,
                    Number(f.fuel_cost || 0)
                );
            });
            await req.db.execute(
                `INSERT INTO rider_fuel_payment_entries
                 (movement_id, fuel_history_id, rider_id, entry_date, fuel_cost)
                 VALUES ${valuesSql}`,
                insertParams
            );
        }

        // Auto-update wallet for advances (debit to rider wallet as they now owe the company)
        if (movement_type === 'advance') {
            await recordRiderWalletTransaction(
                req.db, 
                rider_id, 
                'debit', 
                amount, 
                `Cash advance via ${movement_number}`, 
                result.insertId,
                movement_type
            );
        }
        // Auto-update wallet for adjustments (could be credit or debit)
        else if (movement_type === 'adjustment' && parseFloat(amount) > 0) {
            await recordRiderWalletTransaction(
                req.db, 
                rider_id, 
                'credit', 
                amount, 
                `Adjustment credit via ${movement_number}`, 
                result.insertId,
                movement_type
            );
        }

        res.status(201).json({
            success: true,
            message: 'Rider cash movement recorded successfully',
            movement: {
                id: result.insertId,
                movement_number
            }
        });
    } catch (error) {
        console.error('Error creating rider cash movement:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to record rider cash movement',
            error: error.message
        });
    }
});

router.put('/rider-cash/:id', [
    body('status').optional().isIn(['pending', 'completed', 'approved', 'cancelled'])
], async (req, res) => {
    try {
        await ensureRiderCashMovementTypes(req.db);
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: errors.array().map(e => e.msg || e.param).join(', ') || 'Validation failed',
                errors: errors.array()
            });
        }

        const { id } = req.params;
        // Internal controls: status transitions, posted-field locks, maker-checker
        const controlError = await checkDocumentUpdate(req.db, req.user, 'rider_cash', id, req.body);
        if (controlError) {
            return res.status(controlError.status).json({ success: false, message: controlError.message });
        }
        const { status, amount, description, rider_id, movement_type, notes } = req.body;

        // Get current movement to check status transition
        const [movements] = await req.db.execute(
            'SELECT * FROM rider_cash_movements WHERE id = ?',
            [id]
        );

        if (!movements.length) {
            return res.status(404).json({
                success: false,
                message: 'Movement not found'
            });
        }

        const movement = movements[0];
        const updates = [];
        const params = [];
        const movementStatus = String(movement.status || '').toLowerCase().trim();
        const requestedAmountChange =
            amount !== undefined &&
            amount !== null &&
            parseFloat(amount) !== parseFloat(movement.amount);
        const requestedDescriptionChange = description !== undefined;

        // Finalized movements should be immutable in amount/description.
        if ((movementStatus === 'approved' || movementStatus === 'completed') &&
            (requestedAmountChange || requestedDescriptionChange)) {
            return res.status(400).json({
                success: false,
                message: 'Approved/completed movement cannot be edited'
            });
        }

        if (movementStatus === 'pending') {
            if (rider_id !== undefined && rider_id !== null && Number(rider_id) !== Number(movement.rider_id)) {
                updates.push('rider_id = ?');
                params.push(rider_id);
            }
            if (movement_type && movement_type !== movement.movement_type) {
                updates.push('movement_type = ?');
                params.push(movement_type);
            }
            if (notes !== undefined && notes !== movement.notes) {
                updates.push('notes = ?');
                params.push(notes);
            }
        }

        if (requestedAmountChange) {
            updates.push('amount = ?');
            params.push(amount);
        }
        if (description !== undefined && description !== movement.description) {
            updates.push('description = ?');
            params.push(description);
        }
        if (status && status !== movement.status) {
            // Validate status transitions
            if (movement.status === 'approved' && status !== 'cancelled') {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot change status of approved movement'
                });
            }

            updates.push('status = ?');
            params.push(status);
            
            if (status === 'approved') {
                const approvedBy = req.user?.id || movement.recorded_by || null;
                updates.push('approved_by = ?, approved_at = NOW()');
                params.push(approvedBy);

                // Handle wallet updates and financial transactions based on movement type
                const effectiveAmount = (amount !== undefined && amount !== null) ? amount : movement.amount;
                let transactionType = null;
                let descriptionPrefix = '';

                if (movement.movement_type === 'cash_submission') {
                    // Guard: ensure all linked submitted orders have wallet credits
                    // before debiting rider for submission, so ledger never drifts negative
                    // due to missing historical credit rows.
                    await ensureWalletCreditsForSubmissionOrders(req.db, movement.rider_id, movement.id);

                    // Debit rider wallet when cash submission is approved:
                    // rider has handed over cash to office.
                    await recordRiderWalletTransaction(
                        req.db,
                        movement.rider_id,
                        'debit',
                        effectiveAmount,
                        `Cash submission via ${movement.movement_number}`,
                        movement.id,
                        movement.movement_type
                    );
                    // This is cash INFLOW for the company
                    transactionType = 'income'; 
                    descriptionPrefix = 'Rider Cash Submission';
                } else if (movement.movement_type === 'cash_collection') {
                    // Cash collection from customer (if not linked to order)
                    if (movement.reference_type !== 'order') {
                        await recordRiderWalletTransaction(
                            req.db,
                            movement.rider_id,
                            'credit',
                            effectiveAmount,
                            `Cash collection via ${movement.movement_number}`,
                            movement.id,
                            movement.movement_type
                        );
                        transactionType = 'income';
                        descriptionPrefix = 'Rider Cash Collection (Manual)';
                    }
                } else if (movement.movement_type === 'settlement') {
                    // Credit to rider wallet for settlements (earnings)
                    await recordRiderWalletTransaction(
                        req.db,
                        movement.rider_id,
                        'credit',
                        effectiveAmount,
                        `Settlement via ${movement.movement_number}`,
                        movement.id,
                        movement.movement_type
                    );
                    transactionType = 'settlement';
                    descriptionPrefix = 'Rider Settlement';
                } else if (movement.movement_type === 'advance') {
                    transactionType = 'expense';
                    descriptionPrefix = 'Rider Advance';
                } else if (movement.movement_type === 'fuel_payment') {
                    transactionType = 'expense';
                    descriptionPrefix = 'Rider Fuel Payment';
                } else if (movement.movement_type === 'store_payment') {
                    transactionType = 'expense';
                    descriptionPrefix = 'Rider Store Payment';
                } else if (movement.movement_type === 'adjustment') {
                    transactionType = 'adjustment';
                    descriptionPrefix = 'Rider Cash Adjustment';
                }

                // Create financial transaction if applicable
                if (transactionType) {
                    const [riderRows] = await req.db.execute('SELECT first_name, last_name FROM riders WHERE id = ?', [movement.rider_id]);
                    const riderName = riderRows.length > 0 ? `${riderRows[0].first_name} ${riderRows[0].last_name}` : `Rider #${movement.rider_id}`;

                    await recordFinancialTransaction(req.db, {
                        transaction_type: transactionType,
                        category: 'rider_cash',
                        description: `${descriptionPrefix} - ${riderName}: ${movement.description || 'Processed'}`,
                        amount: effectiveAmount,
                        payment_method: 'cash',
                        related_entity_type: 'rider',
                        related_entity_id: movement.rider_id,
                        reference_type: 'rider_cash_movement',
                        reference_id: movement.id,
                        created_by: approvedBy
                    });
                }
            }
        }

        if (updates.length === 0) {
            return res.json({
                success: true,
                message: 'Rider cash movement unchanged'
            });
        }

        params.push(id);

        await req.db.execute(
            `UPDATE rider_cash_movements SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        res.json({
            success: true,
            message: status === 'approved' ? 'Rider cash movement approved successfully' : 'Rider cash movement updated successfully'
        });
    } catch (error) {
        console.error('Error updating rider cash movement:', error);
        logDebugError(error);
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || 'Failed to update rider cash movement',
            error: error.message
        });
    }
});

// Get unsettled items for a store
router.get('/store-settlements/unsettled-items', async (req, res) => {
    try {
        const { store_id, period_from, period_to } = req.query;
        const storeId = Number(store_id);
        if (!Number.isInteger(storeId) || storeId <= 0) {
            return res.status(400).json({ success: false, message: 'Store ID is required' });
        }

        // Read-only endpoint: carry on if the schema check cannot run (e.g. no DDL rights)
        await ensureStoreSettlementSchema(req.db).catch((e) => console.warn('Store settlement schema check skipped:', e.message));

        // The store's available credit (payments not matched to settled lines)
        // covers the oldest unsettled lines first; covered lines are listed as
        // covered and only the rest is due.
        const settlementCalc = await calculateStoreSettlementBalance(
            req.db,
            storeId,
            period_from && period_to ? `${period_from} 00:00:00` : null,
            period_from && period_to ? `${period_to} 23:59:59` : null
        );
        const position = settlementCalc.position;
        const balance = storeAccount.fromCents(position.balance_c);

        res.json({
            success: true,
            items: settlementCalc.displayItems,
            summary: {
                total_orders_amount: settlementCalc.grossTotal,
                total_gross_amount: settlementCalc.grossTotal,
                total_discount: settlementCalc.adjustmentTotal,
                commission_rate: 0,
                commissions: settlementCalc.adjustmentTotal,
                items_payable: settlementCalc.payableTotal,
                credit_available: settlementCalc.creditAvailable,
                credit_applied: settlementCalc.creditApplied,
                net_amount: settlementCalc.payableRemaining,
                item_count: settlementCalc.displayItems.length,
                covered_item_count: settlementCalc.displayItems.filter((i) => i.covered_by_credit === 'full').length,
                store_balance: balance,
                amount_due: Math.max(0, balance),
                store_credit: Math.max(0, -balance),
                total_payable: storeAccount.fromCents(position.payable_c),
                total_paid: storeAccount.fromCents(position.paid_c),
                open_settlements_amount: storeAccount.fromCents(position.open_settlements_c),
                // kept for older admin pages: credit deducted from the listed items
                legacy_paid_offset: settlementCalc.creditApplied
            }
        });

    } catch (error) {
        console.error('Error fetching unsettled items:', error);
        res.status(500).json({ success: false, message: 'Failed to load unsettled items' });
    }
});

// Credit stores with something to pay. pending_settlement is the store balance
// (payable of delivered lines minus every payment to the store, never below 0);
// current_settlement_balance is what a new settlement from unlinked lines would
// pay after the store's credit is applied.
router.get('/store-settlements/due-stores', async (req, res) => {
    try {
        const { period_from, period_to } = req.query;
        const balanceStart = period_from && period_to ? `${period_from} 00:00:00` : null;
        const balanceEnd = period_from && period_to ? `${period_to} 23:59:59` : null;

        // Read-only endpoint: carry on if the schema check cannot run (e.g. no DDL rights)
        await ensureStoreSettlementSchema(req.db).catch((e) => console.warn('Store settlement schema check skipped:', e.message));

        const { accounts } = await storeAccount.loadStoreAccounts(req.db);
        const dueStores = [];
        for (const account of accounts.values()) {
            if (!account.exists || account.pickup_paid) continue;
            const position = storeAccount.accountPosition(account);
            const settlementBalance = await calculateStoreSettlementBalance(
                req.db,
                account.store_id,
                balanceStart,
                balanceEnd,
                null,
                { creditCents: position.credit_c }
            );
            const currentSettlementBalance = Number(settlementBalance.payableRemaining || 0);
            const accountBalance = Math.max(0, storeAccount.fromCents(position.balance_c));
            const pending = balanceStart ? currentSettlementBalance : Math.max(accountBalance, currentSettlementBalance);
            if (pending <= 0.005) continue;

            dueStores.push({
                id: account.store_id,
                name: account.name,
                payment_term: account.payment_term,
                is_active: account.is_active,
                pending_settlement: pending,
                store_balance: storeAccount.fromCents(position.balance_c),
                current_settlement_balance: currentSettlementBalance,
                open_settlement_amount: storeAccount.fromCents(position.open_settlements_c),
                item_count: settlementBalance.displayItems.length,
                credit_applied: settlementBalance.creditApplied,
                legacy_paid_offset: settlementBalance.creditApplied
            });
        }

        dueStores.sort(
            (a, b) => Number(b.pending_settlement || 0) - Number(a.pending_settlement || 0)
        );

        res.json({
            success: true,
            stores: dueStores
        });
    } catch (error) {
        console.error('Error fetching settlement due stores:', error);
        res.status(500).json({ success: false, message: 'Failed to load due stores' });
    }
});

router.get('/store-settlements', async (req, res) => {
    try {
        const { store_id, status, page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        let whereClause = 'WHERE 1=1';
        const params = [];

        if (store_id) {
            whereClause += ' AND store_id = ?';
            params.push(store_id);
        }
        if (status) {
            if (status === 'unpaid') {
                whereClause += " AND status IN ('pending', 'approved')";
            } else {
                whereClause += ' AND status = ?';
                params.push(status);
            }
        }

        const [settlements] = await req.db.execute(
            `SELECT ss.*, s.name as store_name, ab.first_name as approved_by_name, pb.first_name as paid_by_name
             FROM store_settlements ss
             LEFT JOIN stores s ON ss.store_id = s.id
             LEFT JOIN users ab ON ss.approved_by = ab.id
             LEFT JOIN users pb ON ss.paid_by = pb.id
             ${whereClause}
             ORDER BY ss.settlement_date DESC, ss.id DESC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );

        const [countResult] = await req.db.execute(
            `SELECT COUNT(*) as total FROM store_settlements ${whereClause}`,
            params
        );

        res.json({
            success: true,
            settlements,
            total: countResult[0]?.total || 0,
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        console.error('Error fetching store settlements:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch store settlements',
            error: error.message
        });
    }
});

const isTruthyFlag = (value) => value === true || value === 'true' || value === 'on' || value === 1 || value === '1';

// settlement_kind: 'orders' (linked to order lines), 'manual' or 'on_account'
// (a lump-sum payment with no order lines). credit_applied: store credit used
// by an orders settlement, so net = total - commissions - deductions - credit_applied.
async function ensureSettlementKindColumns(db) {
    if (!(await storeAccount.hasColumnCached(db, 'store_settlements', 'settlement_kind'))) {
        await db.execute('ALTER TABLE store_settlements ADD COLUMN settlement_kind VARCHAR(20) NULL');
    }
    storeAccount.markColumnPresent('store_settlements', 'settlement_kind');
    if (!(await storeAccount.hasColumnCached(db, 'store_settlements', 'credit_applied'))) {
        await db.execute('ALTER TABLE store_settlements ADD COLUMN credit_applied DECIMAL(12,2) NOT NULL DEFAULT 0');
    }
    storeAccount.markColumnPresent('store_settlements', 'credit_applied');
}

router.post('/store-settlements', [
    body('store_id').isInt({ min: 1 }),
    body('payment_method').isIn(['cash', 'cheque', 'check', 'bank_transfer'])
], async (req, res) => {
    let conn;
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { store_id, period_from, period_to, total_orders_amount, commissions, deductions, net_amount, notes, auto_calculate, selected_item_ids, on_account } = req.body;
        // The column is ENUM('cash','check','bank_transfer'); the admin form says "cheque"
        const payment_method = req.body.payment_method === 'cheque' ? 'check' : req.body.payment_method;
        const autoCalculate = isTruthyFlag(auto_calculate);
        const onAccount = isTruthyFlag(on_account);

        if (onAccount && autoCalculate) {
            return res.status(400).json({ success: false, message: 'A payment on account is not linked to orders; turn off auto-calculate' });
        }
        // Settlements that are not built from order lines are admin-only
        if (!autoCalculate && req.user.user_type !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Manual settlements and payments on account can only be created by an admin; use auto-calculate'
            });
        }

        await ensureStoreSettlementSchema(req.db);
        // DDL commits implicitly, so it runs before the transaction starts
        await ensureSettlementKindColumns(req.db);

        conn = await req.db.getConnection();
        await conn.beginTransaction();

        // One settlement per store at a time, so store credit is applied once
        const [storeRows] = await conn.execute('SELECT id, payment_term FROM stores WHERE id = ? FOR UPDATE', [store_id]);
        if (!storeRows.length) {
            await conn.rollback();
            conn.release();
            return res.status(404).json({ success: false, message: 'Store not found' });
        }

        let final_total = total_orders_amount || 0;
        let final_commissions = commissions || 0;
        let final_deductions = deductions || 0;
        let final_net = net_amount || 0;
        let credit_applied = 0;
        let settlement_kind = 'manual';
        let settlement_items = [];

        if (autoCalculate) {
            const selectedItemIds = Array.isArray(selected_item_ids)
                ? selected_item_ids
                    .map((id) => Number(id))
                    .filter((id) => Number.isInteger(id) && id > 0)
                : null;
            const settlementCalc = await calculateStoreSettlementBalance(
                conn,
                store_id,
                period_from && period_to ? `${period_from} 00:00:00` : null,
                period_from && period_to ? `${period_to} 23:59:59` : null,
                selectedItemIds
            );

            if (!settlementCalc.allItemIds.length || settlementCalc.payableTotal <= 0.005) {
                await conn.rollback();
                conn.release();
                return res.status(400).json({
                    success: false,
                    message: 'No unpaid settlement balance found for this store'
                });
            }

            settlement_kind = 'orders';
            settlement_items = settlementCalc.allItemIds;
            final_total = Number(settlementCalc.grossTotal.toFixed(2));
            final_commissions = Number(settlementCalc.adjustmentTotal.toFixed(2));
            final_deductions = Number(parseFloat(deductions || 0).toFixed(2)) || 0;
            credit_applied = Number(settlementCalc.creditApplied.toFixed(2));
            final_net = Number((final_total - final_commissions - final_deductions - credit_applied).toFixed(2));
            if (final_deductions < 0 || final_net < -0.005) {
                await conn.rollback();
                conn.release();
                return res.status(400).json({ success: false, message: 'Deductions cannot exceed the amount due' });
            }
            final_net = Math.max(0, final_net);
        } else if (onAccount) {
            // Payment on account: a lump sum with no order lines. It reduces the
            // store balance; open lines are then shown as covered by the credit.
            const n = Number(final_net);
            if (!Number.isFinite(n) || n <= 0) {
                await conn.rollback();
                conn.release();
                return res.status(400).json({ success: false, message: 'Enter the amount paid on account' });
            }
            settlement_kind = 'on_account';
            final_total = 0;
            final_commissions = 0;
            final_deductions = 0;
            final_net = Number(n.toFixed(2));
        } else {
            // Manual settlements are not linked to order lines and their figures
            // must add up (net = total - commissions - deductions).
            const t = Number(final_total), c = Number(final_commissions), d = Number(final_deductions), n = Number(final_net);
            if (![t, c, d, n].every((v) => Number.isFinite(v) && v >= 0) || Math.abs(t - c - d - n) > 0.005) {
                await conn.rollback();
                conn.release();
                return res.status(400).json({
                    success: false,
                    message: 'Net amount must equal total minus commissions minus deductions (use "Payment on account" for a lump sum)'
                });
            }
        }

        const settlement_number = generateVoucherNumber('SS');
        const settlement_date = new Date().toISOString().split('T')[0];
        let finalNotes = notes || null;
        if (credit_applied > 0) {
            const creditNote = `Store credit applied: Rs ${credit_applied.toFixed(2)}`;
            finalNotes = finalNotes ? `${finalNotes}\n${creditNote}` : creditNote;
        }

        const [result] = await conn.execute(
            `INSERT INTO store_settlements
             (settlement_number, settlement_date, store_id, period_from, period_to, total_orders_amount, commissions, deductions, net_amount, payment_method, notes, status, settlement_kind, credit_applied)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
            [settlement_number, settlement_date, store_id, period_from || null, period_to || null, final_total, final_commissions, final_deductions, final_net, payment_method, finalNotes, settlement_kind, credit_applied]
        );

        const settlementId = result.insertId;

        // Link the items to this settlement so they aren't paid again
        if (settlement_items.length > 0) {
            const placeholders = settlement_items.map(() => '?').join(',');
            await conn.execute(
                `UPDATE order_items SET settlement_id = ? WHERE settlement_id IS NULL AND id IN (${placeholders})`,
                [settlementId, ...settlement_items]
            );
        }

        await conn.commit();
        conn.release();

        res.status(201).json({
            success: true,
            message: settlement_kind === 'on_account' ? 'Payment on account recorded' : 'Store settlement created successfully',
            settlement: {
                id: settlementId,
                settlement_number,
                settlement_kind,
                total_orders_amount: final_total,
                commissions: final_commissions,
                deductions: final_deductions,
                credit_applied,
                net_amount: final_net,
                items_count: settlement_items.length
            }
        });
    } catch (error) {
        if (conn) {
            await conn.rollback();
            conn.release();
        }
        console.error('Error creating store settlement:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create store settlement'
        });
    }
});

router.put('/store-settlements/:id', [
    body('status').optional().isIn(['pending', 'approved', 'paid', 'cancelled']),
    body('net_amount').optional().isFloat({ min: 0 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { id } = req.params;
        // Internal controls: status transitions, posted-field locks, maker-checker
        const controlError = await checkDocumentUpdate(req.db, req.user, 'settlement', id, req.body);
        if (controlError) {
            return res.status(controlError.status).json({ success: false, message: controlError.message });
        }
        const { status, net_amount, notes } = req.body;

        // Get existing settlement data if we're marking it as paid
        let existingSettlement = null;
        if (status === 'paid') {
            const [rows] = await req.db.execute('SELECT * FROM store_settlements WHERE id = ?', [id]);
            if (rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Settlement not found' });
            }
            existingSettlement = rows[0];
            
            if (existingSettlement.status === 'paid') {
                return res.status(400).json({ success: false, message: 'Settlement is already marked as paid' });
            }
        }

        const updates = [];
        const params = [];

        if (net_amount) {
            updates.push('net_amount = ?');
            params.push(net_amount);
        }
        if (status) {
            updates.push('status = ?');
            params.push(status);
            if (status === 'approved') {
                updates.push('approved_by = ?, approved_at = NOW()');
                params.push(req.user.id);
            } else if (status === 'paid') {
                updates.push('paid_by = ?, paid_at = NOW()');
                params.push(req.user.id);
            }
        }
        if (notes) {
            updates.push('notes = ?');
            params.push(notes);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No fields to update'
            });
        }

        params.push(id);

        await req.db.execute(
            `UPDATE store_settlements SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        // A cancelled (never paid) settlement releases its order lines so the
        // store payable is settled again later instead of being lost.
        if (status === 'cancelled') {
            await req.db.execute(
                'UPDATE order_items SET settlement_id = NULL WHERE settlement_id = ?',
                [id]
            );
        }

        // Create financial transaction if status changed to paid. A settlement fully
        // covered by store credit (net 0) moves no money, so nothing is recorded.
        if (status === 'paid' && existingSettlement && Number(net_amount || existingSettlement.net_amount) > 0) {
            const settlementAmount = net_amount || existingSettlement.net_amount;
            const [storeRows] = await req.db.execute('SELECT name FROM stores WHERE id = ?', [existingSettlement.store_id]);
            const storeName = storeRows.length > 0 ? storeRows[0].name : `Store #${existingSettlement.store_id}`;

            // Create financial transaction if status changed to paid
            // We need to record the FULL payout as a settlement expense
            // And the COMMISSION as income (if not already recorded, but usually commissions are implicit in the net deduction)
            // Wait, standard accounting:
            // 1. We collected Cash from Rider (Income/Asset).
            // 2. We owe Store (Liability).
            // 3. We pay Store (Asset decreases, Liability decreases).
            // 4. The Commission is the Revenue we keep.
            
            // Current Logic:
            // records 'settlement' transaction with amount = net_amount (what we paid).
            // This is correct for Cash Flow (money leaving).
            // But for Profit/Loss, 'settlement' is treated as an expense/deduction from Gross Income.
            
            // The issue user reported: "settlements not reflected in comprehensive report"
            // The Comprehensive Report queries `financial_transactions`.
            // So we MUST ensure a record exists here.
            
            await recordFinancialTransaction(req.db, {
                transaction_type: 'settlement',
                category: 'store_settlement',
                description: `Settlement for ${storeName}: ${existingSettlement.settlement_number}`,
                amount: settlementAmount,
                payment_method: existingSettlement.payment_method,
                related_entity_type: 'store',
                related_entity_id: existingSettlement.store_id,
                reference_type: 'store_settlement',
                reference_id: existingSettlement.settlement_number,
                created_by: req.user.id
            });

            // ALSO, we should record the Commission as explicit INCOME if it's not already.
            // When we do "Rider Cash Collection", we record the full cash amount as Income.
            // Example: Order 1000. Rider gives us 1000 (Income).
            // We pay Store 900 (Settlement).
            // Net Profit = 1000 - 900 = 100. Correct.
            
            // So the logic holds: 
            // Total Income (from riders) - Total Settlements (to stores) = Gross Profit.
            
            // If the user says it's "not reflected", maybe they haven't marked the settlement as 'paid'?
            // Only 'paid' status triggers this transaction creation.
            // Or maybe the date filter in the report misses the transaction date.
            
            // Debit store wallet (payment made, liability reduced)
            await recordStoreWalletTransaction(
                req.db,
                existingSettlement.store_id,
                'debit',
                settlementAmount,
                `Settlement Payment: ${existingSettlement.settlement_number}`,
                existingSettlement.id,
                'store_settlement'
            );
        }

        res.json({
            success: true,
            message: 'Store settlement updated successfully'
        });
    } catch (error) {
        console.error('Error updating store settlement:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update store settlement',
            error: error.message
        });
    }
});

router.get('/expenses/categories', async (req, res) => {
    try {
        const [categories] = await req.db.execute('SELECT DISTINCT category FROM admin_expenses ORDER BY category');
        res.json({ success: true, categories: categories.map(c => c.category) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/expenses', async (req, res) => {
    try {
        const { category, status, page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        let whereClause = 'WHERE 1=1';
        const params = [];

        if (category) {
            whereClause += ' AND category = ?';
            params.push(category);
        }
        if (status) {
            whereClause += ' AND status = ?';
            params.push(status);
        }

        const [expenses] = await req.db.execute(
            `SELECT ae.*, sb.first_name as submitted_by_name, ab.first_name as approved_by_name
             FROM admin_expenses ae
             LEFT JOIN users sb ON ae.submitted_by = sb.id
             LEFT JOIN users ab ON ae.approved_by = ab.id
             ${whereClause}
             ORDER BY ae.expense_date DESC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );

        const [countResult] = await req.db.execute(
            `SELECT COUNT(*) as total FROM admin_expenses ${whereClause}`,
            params
        );

        res.json({
            success: true,
            expenses,
            total: countResult[0]?.total || 0,
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        console.error('Error fetching expenses:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch expenses',
            error: error.message
        });
    }
});

router.post('/expenses', [
    body('category').trim().notEmpty(),
    body('amount').isFloat({ min: 0.01 }),
    body('payment_method').isIn(['cash', 'card', 'cheque', 'bank_transfer']),
    body('description').optional().trim()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { category, description, amount, payment_method, vendor_name, receipt_number, notes } = req.body;
        const expense_number = generateVoucherNumber('EXP');
        const expense_date = new Date().toISOString().split('T')[0];

        const [result] = await req.db.execute(
            `INSERT INTO admin_expenses 
             (expense_number, expense_date, category, description, amount, payment_method, vendor_name, receipt_number, notes, submitted_by, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [expense_number, expense_date, category, description || null, amount, payment_method, vendor_name || null, receipt_number || null, notes || null, req.user.id]
        );

        res.status(201).json({
            success: true,
            message: 'Expense recorded successfully',
            expense: {
                id: result.insertId,
                expense_number
            }
        });
    } catch (error) {
        console.error('Error creating expense:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create expense',
            error: error.message
        });
    }
});

router.put('/expenses/:id', [
    body('status').optional().isIn(['pending', 'approved', 'paid', 'rejected']),
    body('amount').optional().isFloat({ min: 0.01 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { id } = req.params;
        // Internal controls: status transitions, posted-field locks, maker-checker
        const controlError = await checkDocumentUpdate(req.db, req.user, 'expense', id, req.body);
        if (controlError) {
            return res.status(controlError.status).json({ success: false, message: controlError.message });
        }
        const { status, amount, notes } = req.body;

        // Get existing expense data if we're marking it as paid
        let existingExpense = null;
        if (status === 'paid') {
            const [rows] = await req.db.execute('SELECT * FROM admin_expenses WHERE id = ?', [id]);
            if (rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Expense not found' });
            }
            existingExpense = rows[0];
            
            if (existingExpense.status === 'paid') {
                return res.status(400).json({ success: false, message: 'Expense is already marked as paid' });
            }
        }

        const updates = [];
        const params = [];

        if (amount) {
            updates.push('amount = ?');
            params.push(amount);
        }
        if (status) {
            updates.push('status = ?');
            params.push(status);
            if (status === 'approved') {
                updates.push('approved_by = ?, approved_at = NOW()');
                params.push(req.user.id);
            }
        }
        if (notes) {
            updates.push('notes = ?');
            params.push(notes);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No fields to update'
            });
        }

        params.push(id);

        await req.db.execute(
            `UPDATE admin_expenses SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        // Create financial transaction if status changed to paid
        if (status === 'paid' && existingExpense) {
            const expenseAmount = amount || existingExpense.amount;
            const expenseDescription = existingExpense.description || 'Admin Expense';

            await recordFinancialTransaction(req.db, {
                transaction_type: 'expense',
                category: existingExpense.category,
                description: `Expense: ${existingExpense.category} - ${expenseDescription}`,
                amount: expenseAmount,
                payment_method: existingExpense.payment_method,
                related_entity_type: 'admin_expense',
                related_entity_id: existingExpense.id,
                reference_type: 'admin_expense',
                reference_id: existingExpense.expense_number,
                created_by: req.user.id
            });
        }

        res.json({
            success: true,
            message: 'Expense updated successfully'
        });
    } catch (error) {
        console.error('Error updating expense:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update expense',
            error: error.message
        });
    }
});

router.get('/reports', async (req, res) => {
    try {
        const { type, period_from, period_to } = req.query;

        let whereClause = 'WHERE 1=1';
        const params = [];

        if (type) {
            whereClause += ' AND report_type = ?';
            params.push(type);
        }
        if (period_from) {
            whereClause += ' AND period_from >= ?';
            params.push(period_from);
        }
        if (period_to) {
            whereClause += ' AND period_to <= ?';
            params.push(period_to);
        }

        const [reports] = await req.db.execute(
            `SELECT fr.*, u.first_name as generated_by_name
             FROM financial_reports fr
             LEFT JOIN users u ON fr.generated_by = u.id
             ${whereClause}
             ORDER BY fr.created_at DESC`,
            params
        );

        res.json({
            success: true,
            reports
        });
    } catch (error) {
        console.error('Error fetching reports:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch reports',
            error: error.message
        });
    }
});

router.post('/reports/generate', [
    body('report_type').isIn(SUPPORTED_FINANCIAL_REPORT_TYPES),
    body('period_from').optional({ checkFalsy: true }).isISO8601(),
    body('period_to').optional({ checkFalsy: true }).isISO8601(),
    body('rider_id').optional({ checkFalsy: true }).toInt(),
    body('store_id').optional({ checkFalsy: true }).toInt()
], async (req, res) => {
    try {
        await ensureOrderItemsCostPriceColumn(req.db);
        await ensureFinancialReportsReportTypeEnum(req.db);

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { report_type, period_from, period_to, rider_id, store_id } = req.body;

        // Auto backfill only for reports that actually read financial_transactions in detail.
        if (report_type === 'comprehensive_report' || report_type === 'transaction_summary') {
            try {
                await backfillLegacyPaymentVouchersToFinancialTransactions(req.db);
            } catch (backfillError) {
                console.error('CPV backfill skipped:', backfillError.message);
            }
        }

        // Permission Check for Reports
        // Admin always allowed. Standard User needs specific report permission.
        if (req.user.user_type !== 'admin') {
            // Map report_type to permission key
            const reportTypeToPermKey = {
                'daily_summary': 'report_daily_summary',
                'weekly_summary': 'report_weekly_summary',
                'monthly_summary': 'report_monthly_summary',
                'store_settlement': 'report_store_settlement',
                'store_financials': 'report_store_financials',
                'rider_cash_report': 'report_rider_cash',
                'rider_fuel_report': 'report_rider_fuel',
                'rider_orders_report': 'report_order_summary',
                'rider_payments_report': 'report_rider_cash',
                'rider_receivings_report': 'report_rider_cash',
                'rider_wallet_report': 'report_rider_cash',
                'rider_petrol_report': 'report_rider_fuel',
                'rider_daily_mileage_report': 'report_rider_fuel',
                'rider_daily_activity_report': 'report_order_summary',
                'rider_day_closing_report': 'report_rider_cash',
                'order_profit_report': 'report_order_summary',
                'comprehensive_report': 'report_comprehensive_cash',
                'store_payable_reconciliation': 'report_store_settlement',
                'unsettled_amounts_report': 'report_store_settlement',
                'store_order_settlement_report': 'report_store_settlement',
                'credit_store_order_reconciliation': 'report_store_settlement',
                'cash_discrepancy_report': 'report_comprehensive_cash',
                'transaction_summary': 'report_transactions_summary',
                'general_voucher': 'report_general_voucher',
                'expense_report': 'report_expense',
                'delivery_charges_breakdown': 'report_delivery_charges',
                'order_wise_sale_summary': 'report_order_summary',
                'periodic_sales_report': 'report_sales',
                'periodic_credit_cash_report': 'report_sales',
                'periodic_comprehensive_summary_report': 'report_sales',
                'periodic_store_payments_balance_report': 'report_store_settlement',
                'custom': 'report_custom'
            };

            const permKey = reportTypeToPermKey[report_type] || `report_${report_type}`;

            try {
                const [perms] = await req.db.execute(
                    'SELECT 1 FROM user_permissions WHERE user_id = ? AND permission_key = ?',
                    [req.user.id, permKey]
                );
                if (perms.length === 0) {
                     return res.status(403).json({ 
                         success: false, 
                         message: `Access denied. You do not have permission to generate ${report_type.replace(/_/g, ' ')}.` 
                     });
                }
            } catch (e) {
                console.error('Report permission check error:', e);
                return res.status(500).json({ success: false, message: 'Permission check failed' });
            }
        }
        
        let prefix = 'RPT';
        switch (report_type) {
            case 'store_financials': prefix = 'SFR'; break;
            case 'daily_summary': prefix = 'DSR'; break;
            case 'weekly_summary': prefix = 'WSR'; break;
            case 'monthly_summary': prefix = 'MSR'; break;
            case 'rider_cash_report': prefix = 'RCR'; break;
            case 'rider_fuel_report': prefix = 'RFR'; break;
            case 'rider_orders_report': prefix = 'ROR'; break;
            case 'rider_payments_report': prefix = 'RPR'; break;
            case 'rider_receivings_report': prefix = 'RRR'; break;
            case 'rider_wallet_report': prefix = 'RWR'; break;
            case 'rider_petrol_report': prefix = 'RPT'; break;
            case 'rider_daily_mileage_report': prefix = 'RDM'; break;
            case 'rider_daily_activity_report': prefix = 'RDA'; break;
            case 'rider_day_closing_report': prefix = 'RDC'; break;
            case 'order_profit_report': prefix = 'OPR'; break;
            case 'comprehensive_report': prefix = 'CPR'; break;
            case 'store_payable_reconciliation': prefix = 'SPR'; break;
            case 'unsettled_amounts_report': prefix = 'UAR'; break;
            case 'cash_discrepancy_report': prefix = 'CDR'; break;
            case 'store_order_settlement_report': prefix = 'SOS'; break;
            case 'credit_store_order_reconciliation': prefix = 'CSR'; break;
            case 'expense_report': prefix = 'EXR'; break;
            case 'delivery_charges_breakdown': prefix = 'DCB'; break;
            case 'general_voucher': prefix = 'GVR'; break;
            case 'store_settlement': prefix = 'SSR'; break;
            case 'order_wise_sale_summary': prefix = 'OWS'; break;
            case 'periodic_sales_report': prefix = 'PSR'; break;
            case 'periodic_credit_cash_report': prefix = 'PCC'; break;
            case 'periodic_comprehensive_summary_report': prefix = 'PCS'; break;
            case 'periodic_store_payments_balance_report': prefix = 'SPB'; break;
            case 'custom': prefix = 'CUS'; break;
        }

        const today = new Date();
        const day = String(today.getDate()).padStart(2, '0');
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const month = monthNames[today.getMonth()];
        const year = today.getFullYear();
        const dateStr = `${day}${month}${year}`;
        
        const searchPattern = `${prefix}-${dateStr}-%`;
        const [lastReports] = await req.db.execute(
            `SELECT report_number FROM financial_reports 
             WHERE report_number LIKE ? 
             ORDER BY id DESC LIMIT 1`,
            [searchPattern]
        );
        
        let serial = 1;
        if (lastReports.length > 0) {
            const lastNum = lastReports[0].report_number;
            const parts = lastNum.split('-');
            if (parts.length === 3) {
                serial = parseInt(parts[2]) + 1;
            }
        }
        report_number = `${prefix}-${dateStr}-${String(serial).padStart(4, '0')}`;

        let riderName = null;
        if (rider_id) {
            const [riders] = await req.db.execute('SELECT first_name, last_name FROM riders WHERE id = ?', [rider_id]);
            if (riders.length > 0) {
                riderName = `${riders[0].first_name} ${riders[0].last_name}`;
            }
        }

        let reportData = {};
        let total_income = 0, total_expense = 0, total_settlements = 0, total_refunds = 0, total_adjustments = 0;

        const dateFilterFT = period_from && period_to ? 'AND ft.created_at BETWEEN ? AND ?' : '';
        // Inclusive end date: a bare YYYY-MM-DD would exclude everything after midnight on the last day
        const periodToEndOfDay = period_to && /^\d{4}-\d{2}-\d{2}$/.test(String(period_to)) ? `${period_to} 23:59:59` : period_to;
        const dateParams = period_from && period_to ? [period_from, periodToEndOfDay] : [];

        // Base financial summary (always useful)
        const [transactions] = await req.db.execute(
            `SELECT transaction_type, SUM(amount) as total FROM financial_transactions ft WHERE 1=1 ${dateFilterFT} GROUP BY transaction_type`,
            dateParams
        );

        transactions.forEach(t => {
            const amount = parseFloat(t.total || 0);
            switch (t.transaction_type) {
                case 'income': total_income += amount; break;
                case 'expense': total_expense += amount; break;
                case 'settlement': total_settlements += amount; break;
                case 'refund': total_refunds += amount; break;
                case 'adjustment': total_adjustments += amount; break;
            }
        });

        if (report_type === 'rider_cash_report') {
            const riderDateFilter = period_from && period_to ? 'AND movement_date BETWEEN ? AND ?' : '';
            const riderFilter = rider_id ? 'AND rcm.rider_id = ?' : '';
            
            const params = [];
            if (period_from && period_to) {
                params.push(period_from, period_to);
            }
            if (rider_id) {
                params.push(rider_id);
            }

            const [movements] = await req.db.execute(
                `SELECT * FROM (
                    SELECT 
                        rcm.id,
                        rcm.movement_number,
                        rcm.rider_id,
                        rcm.movement_date,
                        rcm.movement_type,
                        rcm.amount,
                        rcm.description,
                        rcm.status,
                        rcm.reference_type,
                        rcm.reference_id,
                        r.first_name,
                        r.last_name,
                        o.order_number
                    FROM rider_cash_movements rcm
                    JOIN riders r ON rcm.rider_id = r.id
                    LEFT JOIN orders o
                      ON rcm.reference_type = 'order'
                     AND CAST(rcm.reference_id AS UNSIGNED) = o.id
                    WHERE 1=1 ${riderDateFilter} ${riderFilter}

                    UNION ALL

                    SELECT
                        NULL AS id,
                        CONCAT('AUTO-ORD-', o.id) AS movement_number,
                        o.rider_id,
                        DATE(o.created_at) AS movement_date,
                        'cash_collection' AS movement_type,
                        o.total_amount AS amount,
                        CONCAT('Auto backfill from delivered cash order #', o.order_number) AS description,
                        'completed' AS status,
                        'order' AS reference_type,
                        CAST(o.id AS CHAR) AS reference_id,
                        r2.first_name,
                        r2.last_name,
                        o.order_number
                    FROM orders o
                    JOIN riders r2 ON r2.id = o.rider_id
                    WHERE o.status = 'delivered'
                      AND LOWER(TRIM(COALESCE(o.payment_method, ''))) = 'cash'
                      ${period_from && period_to ? 'AND DATE(o.created_at) BETWEEN ? AND ?' : ''}
                      ${rider_id ? 'AND o.rider_id = ?' : ''}
                      AND NOT EXISTS (
                          SELECT 1
                          FROM rider_cash_movements x
                          WHERE x.reference_type = 'order'
                            AND CAST(x.reference_id AS UNSIGNED) = o.id
                            AND x.movement_type = 'cash_collection'
                      )
                ) t
                ORDER BY t.movement_date DESC, t.id DESC, t.order_number DESC`,
                [
                    ...params,
                    ...(period_from && period_to ? [period_from, period_to] : []),
                    ...(rider_id ? [rider_id] : [])
                ]
            );

            const summaryMap = {};
            for (const m of movements) {
                const k = String(m.movement_type || '').trim() || 'unknown';
                summaryMap[k] = (summaryMap[k] || 0) + Number(m.amount || 0);
            }
            const summary = Object.entries(summaryMap).map(([movement_type, total]) => ({ movement_type, total }));
            const totalCashIncome = Number(summaryMap.cash_collection || 0);

            const orderKpiParams = [];
            const orderKpiDateFilter = period_from && period_to ? 'AND o.created_at BETWEEN ? AND ?' : '';
            const orderKpiRiderFilter = rider_id ? 'AND o.rider_id = ?' : '';
            if (period_from && period_to) {
                orderKpiParams.push(period_from, `${period_to} 23:59:59`);
            }
            if (rider_id) {
                orderKpiParams.push(rider_id);
            }
            const [orderKpiRows] = await req.db.execute(
                `SELECT 
                    COUNT(*) AS total_orders,
                    COALESCE(SUM(o.delivery_fee), 0) AS total_delivery_charges
                 FROM orders o
                 WHERE o.status = 'delivered'
                   ${orderKpiDateFilter}
                   ${orderKpiRiderFilter}`,
                orderKpiParams
            );
            const orderKpis = orderKpiRows?.[0] || {};

            // For rider cash report, expose cash-collection income explicitly in report totals.
            total_income = totalCashIncome;

            reportData = {
                type: 'rider_cash',
                rider_name: riderName,
                movements,
                kpis: {
                    total_income: totalCashIncome,
                    total_orders: Number(orderKpis.total_orders || 0),
                    total_delivery_charges: Number(orderKpis.total_delivery_charges || 0)
                },
                summary: summary.reduce((acc, curr) => {
                    acc[curr.movement_type] = curr.total;
                    return acc;
                }, {})
            };
        } else if (report_type === 'rider_orders_report') {
            const dateFilter = period_from && period_to ? 'AND o.created_at BETWEEN ? AND ?' : '';
            const riderFilter = rider_id ? 'AND o.rider_id = ?' : '';
            const params = [];
            if (period_from && period_to) params.push(period_from, `${period_to} 23:59:59`);
            if (rider_id) params.push(rider_id);

            const [orders] = await req.db.execute(
                `SELECT
                    o.id,
                    o.order_number,
                    o.created_at,
                    o.status,
                    o.payment_method,
                    o.payment_status,
                    o.total_amount,
                    o.delivery_fee,
                    CONCAT(r.first_name, ' ', r.last_name) as rider_name,
                    CONCAT(u.first_name, ' ', u.last_name) as customer_name
                 FROM orders o
                 JOIN riders r ON o.rider_id = r.id
                 LEFT JOIN users u ON o.user_id = u.id
                 WHERE o.rider_id IS NOT NULL ${dateFilter} ${riderFilter}
                 ORDER BY o.created_at DESC`,
                params
            );
            const summary = {
                total_orders: 0,
                delivered_orders: 0,
                cancelled_orders: 0,
                active_orders: 0,
                total_order_amount: 0,
                total_delivery_fee: 0
            };
            (orders || []).forEach((o) => {
                const status = String(o.status || '').toLowerCase();
                summary.total_orders += 1;
                if (status === 'delivered') summary.delivered_orders += 1;
                else if (status === 'cancelled') summary.cancelled_orders += 1;
                else summary.active_orders += 1;
                summary.total_order_amount += parseFloat(o.total_amount || 0);
                summary.total_delivery_fee += parseFloat(o.delivery_fee || 0);
            });
            total_income = summary.total_delivery_fee;
            reportData = {
                type: 'rider_orders',
                rider_name: riderName,
                orders,
                summary
            };
        } else if (report_type === 'rider_payments_report') {
            const dateFilter = period_from && period_to ? 'AND rcm.movement_date BETWEEN ? AND ?' : '';
            const riderFilter = rider_id ? 'AND rcm.rider_id = ?' : '';
            const params = [];
            if (period_from && period_to) params.push(period_from, period_to);
            if (rider_id) params.push(rider_id);

            const [entries] = await req.db.execute(
                `SELECT rcm.*, r.first_name, r.last_name
                 FROM rider_cash_movements rcm
                 JOIN riders r ON rcm.rider_id = r.id
                 WHERE rcm.movement_type IN ('store_payment', 'fuel_payment', 'cash_submission')
                   ${dateFilter} ${riderFilter}
                 ORDER BY rcm.movement_date DESC, rcm.id DESC`,
                params
            );
            const [summaryRows] = await req.db.execute(
                `SELECT rcm.movement_type, SUM(rcm.amount) as total
                 FROM rider_cash_movements rcm
                 WHERE rcm.movement_type IN ('store_payment', 'fuel_payment', 'cash_submission')
                   ${dateFilter} ${riderFilter}
                 GROUP BY rcm.movement_type`,
                params
            );
            const summary = {
                store_payment: 0,
                fuel_payment: 0,
                cash_submission: 0,
                total_payments: 0
            };
            (summaryRows || []).forEach((r) => {
                const key = String(r.movement_type || '');
                const val = parseFloat(r.total || 0);
                if (summary[key] !== undefined) summary[key] = val;
                summary.total_payments += val;
            });
            total_expense = summary.total_payments;
            reportData = {
                type: 'rider_payments',
                rider_name: riderName,
                entries,
                summary
            };
        } else if (report_type === 'rider_receivings_report') {
            const dateFilter = period_from && period_to ? 'AND rcm.movement_date BETWEEN ? AND ?' : '';
            const riderFilter = rider_id ? 'AND rcm.rider_id = ?' : '';
            const params = [];
            if (period_from && period_to) params.push(period_from, period_to);
            if (rider_id) params.push(rider_id);

            const [entries] = await req.db.execute(
                `SELECT rcm.*, r.first_name, r.last_name
                 FROM rider_cash_movements rcm
                 JOIN riders r ON rcm.rider_id = r.id
                 WHERE rcm.movement_type IN ('cash_collection', 'advance', 'settlement')
                   ${dateFilter} ${riderFilter}
                 ORDER BY rcm.movement_date DESC, rcm.id DESC`,
                params
            );
            const [summaryRows] = await req.db.execute(
                `SELECT rcm.movement_type, SUM(rcm.amount) as total
                 FROM rider_cash_movements rcm
                 WHERE rcm.movement_type IN ('cash_collection', 'advance', 'settlement')
                   ${dateFilter} ${riderFilter}
                 GROUP BY rcm.movement_type`,
                params
            );
            const summary = {
                cash_collection: 0,
                advance: 0,
                settlement: 0,
                total_receivings: 0
            };
            (summaryRows || []).forEach((r) => {
                const key = String(r.movement_type || '');
                const val = parseFloat(r.total || 0);
                if (summary[key] !== undefined) summary[key] = val;
                summary.total_receivings += val;
            });
            total_income = summary.total_receivings;
            reportData = {
                type: 'rider_receivings',
                rider_name: riderName,
                entries,
                summary
            };
        } else if (report_type === 'rider_wallet_report') {
            const hasRange = Boolean(period_from && period_to);
            const dateFilter = hasRange ? 'AND wt.created_at BETWEEN ? AND ?' : '';
            const riderFilter = rider_id ? 'AND w.rider_id = ?' : '';
            const params = [];
            if (hasRange) params.push(`${period_from} 00:00:00`, `${period_to} 23:59:59`);
            if (rider_id) params.push(rider_id);

            const [entries] = await req.db.execute(
                `SELECT
                    wt.id,
                    wt.created_at,
                    wt.type,
                    wt.amount,
                    wt.description,
                    wt.reference_type,
                    wt.reference_id,
                    wt.balance_after,
                    w.id AS wallet_id,
                    w.rider_id,
                    w.balance AS current_balance,
                    w.total_credited,
                    w.total_spent,
                    CONCAT(r.first_name, ' ', r.last_name) AS rider_name,
                    r.first_name,
                    r.last_name
                 FROM wallet_transactions wt
                 JOIN wallets w ON w.id = wt.wallet_id
                 JOIN riders r ON r.id = w.rider_id
                 WHERE w.user_type = 'rider'
                   AND w.rider_id IS NOT NULL
                   ${dateFilter}
                   ${riderFilter}
                 ORDER BY wt.created_at DESC, wt.id DESC`,
                params
            );

            const [walletRows] = await req.db.execute(
                `SELECT
                    w.id AS wallet_id,
                    w.rider_id,
                    w.balance,
                    w.total_credited,
                    w.total_spent,
                    CONCAT(r.first_name, ' ', r.last_name) AS rider_name
                 FROM wallets w
                 JOIN riders r ON r.id = w.rider_id
                 WHERE w.user_type = 'rider'
                   AND w.rider_id IS NOT NULL
                   ${rider_id ? 'AND w.rider_id = ?' : ''}
                 ORDER BY rider_name ASC`,
                rider_id ? [rider_id] : []
            );

            const walletSummaryById = new Map();
            (walletRows || []).forEach((wallet) => {
                walletSummaryById.set(Number(wallet.wallet_id), {
                    wallet_id: wallet.wallet_id,
                    rider_id: wallet.rider_id,
                    rider_name: wallet.rider_name || `Rider #${wallet.rider_id}`,
                    current_balance: parseFloat(wallet.balance || 0),
                    total_credited_lifetime: parseFloat(wallet.total_credited || 0),
                    total_spent_lifetime: parseFloat(wallet.total_spent || 0),
                    credits: 0,
                    debits: 0,
                    refunds: 0,
                    transfers: 0,
                    net_credit_debit: 0,
                    entries: 0
                });
            });
            (entries || []).forEach((entry) => {
                const walletId = Number(entry.wallet_id);
                if (!walletSummaryById.has(walletId)) {
                    walletSummaryById.set(walletId, {
                        wallet_id: walletId,
                        rider_id: entry.rider_id,
                        rider_name: entry.rider_name || `Rider #${entry.rider_id}`,
                        current_balance: parseFloat(entry.current_balance || 0),
                        total_credited_lifetime: parseFloat(entry.total_credited || 0),
                        total_spent_lifetime: parseFloat(entry.total_spent || 0),
                        credits: 0,
                        debits: 0,
                        refunds: 0,
                        transfers: 0,
                        net_credit_debit: 0,
                        entries: 0
                    });
                }
                const row = walletSummaryById.get(walletId);
                const amount = parseFloat(entry.amount || 0);
                row.entries += 1;
                if (entry.type === 'credit') {
                    row.credits += amount;
                    row.net_credit_debit += amount;
                } else if (entry.type === 'debit') {
                    row.debits += amount;
                    row.net_credit_debit -= amount;
                }
                else if (entry.type === 'refund') row.refunds += amount;
                else if (entry.type === 'transfer') row.transfers += amount;
            });

            const summaryRows = Array.from(walletSummaryById.values());
            const summary = summaryRows.reduce((acc, row) => {
                acc.total_wallets += 1;
                acc.total_current_balance += row.current_balance;
                acc.total_credits += row.credits;
                acc.total_debits += row.debits;
                acc.total_refunds += row.refunds;
                acc.total_transfers += row.transfers;
                acc.total_net_credit_debit += row.net_credit_debit;
                acc.total_entries += row.entries;
                return acc;
            }, {
                total_wallets: 0,
                total_current_balance: 0,
                total_credits: 0,
                total_debits: 0,
                total_refunds: 0,
                total_transfers: 0,
                total_net_credit_debit: 0,
                total_entries: 0
            });
            total_income = summary.total_credits + summary.total_refunds + summary.total_transfers;
            total_expense = summary.total_debits;
            reportData = {
                type: 'rider_wallet',
                rider_name: riderName,
                entries,
                wallet_summary: summaryRows,
                summary
            };
        } else if (report_type === 'rider_daily_activity_report') {
            const dateFilter = period_from && period_to ? 'AND o.created_at BETWEEN ? AND ?' : '';
            const riderFilter = rider_id ? 'AND o.rider_id = ?' : '';
            const params = [];
            if (period_from && period_to) params.push(period_from, `${period_to} 23:59:59`);
            if (rider_id) params.push(rider_id);

            const [orders] = await req.db.execute(
                `SELECT
                    o.id,
                    o.order_number,
                    o.created_at,
                    o.status,
                    o.payment_method,
                    o.total_amount,
                    o.delivery_fee,
                    CONCAT(r.first_name, ' ', r.last_name) as rider_name,
                    CAST((
                        SELECT COUNT(DISTINCT oi.store_id)
                        FROM order_items oi
                        WHERE oi.order_id = o.id
                    ) AS SIGNED) as stores_count,
                    COALESCE((
                        SELECT SUM(rsp.amount)
                        FROM rider_store_payments rsp
                        WHERE rsp.order_id = o.id AND rsp.rider_id = o.rider_id
                    ), 0) as paid_to_cash_only_stores,
                    COALESCE((
                        SELECT SUM(
                            oi.quantity * (
                                oi.price - (
                                    CASE
                                        WHEN oi.discount_type = 'percent' AND oi.discount_value IS NOT NULL
                                            THEN GREATEST(0, ROUND(oi.price - (oi.price * oi.discount_value / 100), 2))
                                        WHEN oi.discount_type = 'amount' AND oi.discount_value IS NOT NULL
                                            THEN GREATEST(0, ROUND(oi.price - oi.discount_value, 2))
                                        ELSE oi.price
                                    END
                                )
                            )
                        )
                        FROM order_items oi
                        JOIN stores s ON s.id = oi.store_id
                        JOIN products p ON p.id = oi.product_id
                        LEFT JOIN product_size_prices psp
                          ON psp.product_id = oi.product_id
                         AND (
                           (oi.size_id IS NOT NULL AND psp.size_id = oi.size_id AND psp.unit_id IS NULL)
                           OR
                           (oi.unit_id IS NOT NULL AND psp.unit_id = oi.unit_id AND psp.size_id IS NULL)
                         )
                        WHERE oi.order_id = o.id
                          AND LOWER(TRIM(COALESCE(s.payment_term, ''))) = 'cash only'
                    ), 0) as cash_only_profit
                 FROM orders o
                 JOIN riders r ON o.rider_id = r.id
                 WHERE o.rider_id IS NOT NULL ${dateFilter} ${riderFilter}
                 ORDER BY o.created_at DESC`,
                params
            );

            const normalized = (orders || []).map((o) => {
                const paymentMethod = String(o.payment_method || '').toLowerCase().trim();
                const cashCollected = paymentMethod === 'cash'
                    ? parseFloat(o.total_amount || 0)
                    : 0;
                return {
                    ...o,
                    cash_collected: cashCollected,
                    paid_to_cash_only_stores: parseFloat(o.paid_to_cash_only_stores || 0),
                    cash_only_profit: parseFloat(o.cash_only_profit || 0),
                    delivery_fee: parseFloat(o.delivery_fee || 0),
                    stores_count: parseInt(o.stores_count || 0, 10)
                };
            });

            const summary = normalized.reduce((acc, o) => {
                acc.total_orders += 1;
                acc.total_stores_served += Number(o.stores_count || 0);
                acc.total_cash_collected += Number(o.cash_collected || 0);
                acc.total_paid_to_cash_only_stores += Number(o.paid_to_cash_only_stores || 0);
                acc.total_cash_only_profit += Number(o.cash_only_profit || 0);
                acc.total_delivery_fee += Number(o.delivery_fee || 0);
                return acc;
            }, {
                total_orders: 0,
                total_stores_served: 0,
                total_cash_collected: 0,
                total_paid_to_cash_only_stores: 0,
                total_cash_only_profit: 0,
                total_delivery_fee: 0
            });

            total_income = summary.total_cash_only_profit + summary.total_delivery_fee;
            reportData = {
                type: 'rider_daily_activity',
                rider_name: riderName,
                orders: normalized,
                summary
            };
        } else if (report_type === 'rider_day_closing_report') {
            const movementDateFilter = period_from && period_to ? 'AND rcm.movement_date BETWEEN ? AND ?' : '';
            const riderFilter = rider_id ? 'AND rcm.rider_id = ?' : '';
            const params = [];
            if (period_from && period_to) params.push(period_from, period_to);
            if (rider_id) params.push(rider_id);

            const [movementRows] = await req.db.execute(
                `SELECT
                    rcm.rider_id,
                    CONCAT(r.first_name, ' ', r.last_name) as rider_name,
                    DATE(rcm.movement_date) as closing_date,
                    SUM(CASE WHEN rcm.movement_type = 'cash_collection' THEN rcm.amount ELSE 0 END) as cash_collection,
                    SUM(CASE WHEN rcm.movement_type = 'advance' THEN rcm.amount ELSE 0 END) as office_advance,
                    SUM(CASE WHEN rcm.movement_type = 'settlement' THEN rcm.amount ELSE 0 END) as office_settlement,
                    SUM(CASE WHEN rcm.movement_type = 'store_payment' THEN rcm.amount ELSE 0 END) as store_payment,
                    SUM(CASE WHEN rcm.movement_type = 'fuel_payment' THEN rcm.amount ELSE 0 END) as fuel_payment,
                    SUM(CASE WHEN rcm.movement_type = 'cash_submission' THEN rcm.amount ELSE 0 END) as cash_submission
                 FROM rider_cash_movements rcm
                 JOIN riders r ON r.id = rcm.rider_id
                 WHERE 1=1 ${movementDateFilter} ${riderFilter}
                 GROUP BY rcm.rider_id, DATE(rcm.movement_date), r.first_name, r.last_name
                 ORDER BY closing_date DESC, rider_name ASC`,
                params
            );

            const [deliveryRows] = await req.db.execute(
                `SELECT
                    o.rider_id,
                    DATE(o.updated_at) as closing_date,
                    SUM(COALESCE(o.delivery_fee, 0)) as delivery_fee_earned
                 FROM orders o
                 WHERE o.status = 'delivered'
                   ${period_from && period_to ? 'AND DATE(o.updated_at) BETWEEN ? AND ?' : ''}
                   ${rider_id ? 'AND o.rider_id = ?' : ''}
                 GROUP BY o.rider_id, DATE(o.updated_at)`,
                [
                    ...(period_from && period_to ? [period_from, period_to] : []),
                    ...(rider_id ? [rider_id] : []),
                ]
            );
            const deliveryMap = new Map(
                (deliveryRows || []).map((d) => [`${d.rider_id}|${d.closing_date}`, parseFloat(d.delivery_fee_earned || 0)])
            );

            const [closingRows] = await req.db.execute(
                `SELECT
                    rider_id,
                    closed_date,
                    wallet_balance,
                    cash_collection as closed_cash_collection,
                    office_advance as closed_office_advance,
                    store_payment as closed_store_payment,
                    fuel_payment as closed_fuel_payment,
                    delivery_fee_earned as closed_delivery_fee_earned,
                    notes,
                    closed_at
                 FROM rider_day_closings
                 WHERE 1=1
                   ${period_from && period_to ? 'AND closed_date BETWEEN ? AND ?' : ''}
                   ${rider_id ? 'AND rider_id = ?' : ''}`,
                [
                    ...(period_from && period_to ? [period_from, period_to] : []),
                    ...(rider_id ? [rider_id] : []),
                ]
            );
            const closingMap = new Map(
                (closingRows || []).map((c) => [`${c.rider_id}|${c.closed_date}`, c])
            );

            const rows = (movementRows || []).map((r) => {
                const key = `${r.rider_id}|${r.closing_date}`;
                const deliveryFee = deliveryMap.get(key) || 0;
                const dayClosing = closingMap.get(key) || null;

                const cashCollection = parseFloat(r.cash_collection || 0);
                const officeAdvance = parseFloat(r.office_advance || 0);
                const officeSettlement = parseFloat(r.office_settlement || 0);
                const storePayment = parseFloat(r.store_payment || 0);
                const fuelPayment = parseFloat(r.fuel_payment || 0);
                const cashSubmission = parseFloat(r.cash_submission || 0);

                const takenTotal = cashCollection + officeAdvance + officeSettlement;
                const givenTotal = storePayment + fuelPayment + cashSubmission;
                const netInHand = takenTotal - givenTotal;

                return {
                    ...r,
                    delivery_fee_earned: deliveryFee,
                    taken_total: takenTotal,
                    given_total: givenTotal,
                    net_in_hand: netInHand,
                    day_closing: dayClosing,
                };
            });

            const summary = rows.reduce((acc, r) => {
                acc.days += 1;
                acc.cash_collection += Number(r.cash_collection || 0);
                acc.office_advance += Number(r.office_advance || 0);
                acc.office_settlement += Number(r.office_settlement || 0);
                acc.store_payment += Number(r.store_payment || 0);
                acc.fuel_payment += Number(r.fuel_payment || 0);
                acc.cash_submission += Number(r.cash_submission || 0);
                acc.delivery_fee_earned += Number(r.delivery_fee_earned || 0);
                acc.taken_total += Number(r.taken_total || 0);
                acc.given_total += Number(r.given_total || 0);
                acc.net_in_hand += Number(r.net_in_hand || 0);
                return acc;
            }, {
                days: 0,
                cash_collection: 0,
                office_advance: 0,
                office_settlement: 0,
                store_payment: 0,
                fuel_payment: 0,
                cash_submission: 0,
                delivery_fee_earned: 0,
                taken_total: 0,
                given_total: 0,
                net_in_hand: 0
            });

            total_income = summary.taken_total + summary.delivery_fee_earned;
            total_expense = summary.given_total;
            reportData = {
                type: 'rider_day_closing',
                rider_name: riderName,
                rows,
                summary
            };
        } else if (report_type === 'order_profit_report') {
            const dateFilter = period_from && period_to ? 'AND o.created_at BETWEEN ? AND ?' : '';
            const params = period_from && period_to ? [period_from, `${period_to} 23:59:59`] : [];

            const [rows] = await req.db.execute(
                `SELECT
                    o.id,
                    o.order_number,
                    o.created_at,
                    o.status,
                    o.total_amount,
                    o.delivery_fee,
                    COALESCE(SUM(oi.quantity * oi.price), 0) AS gross_item_sales,
                    COALESCE(SUM(
                        oi.quantity * (
                            CASE
                                WHEN oi.discount_type = 'percent' AND oi.discount_value IS NOT NULL
                                    THEN GREATEST(0, ROUND(oi.price - (oi.price * oi.discount_value / 100), 2))
                                WHEN oi.discount_type = 'amount' AND oi.discount_value IS NOT NULL
                                    THEN GREATEST(0, ROUND(oi.price - oi.discount_value, 2))
                                ELSE oi.price
                            END
                        )
                    ), 0) AS paid_to_store_expected,
                    COALESCE(SUM(
                        CASE
                            WHEN LOWER(TRIM(COALESCE(NULLIF(oi.discount_type, ''), 'percent'))) IN ('percent', '%')
                                THEN oi.quantity * oi.price * (COALESCE(s.commission_rate, 0) / 100)
                            ELSE 0
                        END
                    ), 0) AS percent_commission_profit,
                    COALESCE(SUM(
                        CASE
                            WHEN LOWER(TRIM(COALESCE(NULLIF(oi.discount_type, ''), 'percent'))) IN ('percent', '%')
                                THEN 0
                            ELSE oi.quantity * (
                                oi.price - (
                                    CASE
                                        WHEN oi.discount_type = 'amount' AND oi.discount_value IS NOT NULL
                                            THEN GREATEST(0, ROUND(oi.price - oi.discount_value, 2))
                                        WHEN oi.discount_type = 'percent' AND oi.discount_value IS NOT NULL
                                            THEN GREATEST(0, ROUND(oi.price - (oi.price * oi.discount_value / 100), 2))
                                        ELSE oi.price
                                    END
                                )
                            )
                        END
                    ), 0) AS fixed_discount_margin_profit,
                    COALESCE((
                        SELECT SUM(rsp.amount)
                        FROM rider_store_payments rsp
                        WHERE rsp.order_id = o.id
                    ), 0) AS paid_to_store_actual
                 FROM orders o
                 LEFT JOIN order_items oi ON oi.order_id = o.id
                 LEFT JOIN products p ON p.id = oi.product_id
                 LEFT JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
                 LEFT JOIN product_size_prices psp
                   ON psp.product_id = oi.product_id
                  AND (
                    (oi.size_id IS NOT NULL AND psp.size_id = oi.size_id AND psp.unit_id IS NULL)
                    OR
                    (oi.unit_id IS NOT NULL AND psp.unit_id = oi.unit_id AND psp.size_id IS NULL)
                  )
                 WHERE o.status = 'delivered' ${dateFilter}
                 GROUP BY o.id, o.order_number, o.created_at, o.status, o.total_amount, o.delivery_fee
                 ORDER BY o.created_at DESC`,
                params
            );

            const orders = (rows || []).map((r) => {
                const billTotal = parseFloat(r.total_amount || 0);
                const deliveryFee = parseFloat(r.delivery_fee || 0);
                const paidToStoreExpected = parseFloat(r.paid_to_store_expected || 0);
                const paidToStoreActual = parseFloat(r.paid_to_store_actual || 0);
                const grossItemSales = parseFloat(r.gross_item_sales || 0);
                const percentCommissionProfit = parseFloat(r.percent_commission_profit || 0);
                const fixedDiscountMarginProfit = parseFloat(r.fixed_discount_margin_profit || 0);
                const itemProfit = percentCommissionProfit + fixedDiscountMarginProfit;
                const overallProfit = itemProfit + deliveryFee;
                return {
                    ...r,
                    bill_total: billTotal,
                    delivery_fee: deliveryFee,
                    gross_item_sales: grossItemSales,
                    item_profit: itemProfit,
                    overall_profit: overallProfit,
                    paid_to_store: paidToStoreActual,
                    paid_to_store_expected: paidToStoreExpected,
                    percent_commission_profit: percentCommissionProfit,
                    fixed_discount_margin_profit: fixedDiscountMarginProfit
                };
            });

            const summary = orders.reduce((acc, o) => {
                acc.total_orders += 1;
                acc.bill_total += Number(o.bill_total || 0);
                acc.delivery_fee += Number(o.delivery_fee || 0);
                acc.item_profit += Number(o.item_profit || 0);
                acc.overall_profit += Number(o.overall_profit || 0);
                acc.paid_to_store += Number(o.paid_to_store || 0);
                acc.paid_to_store_expected += Number(o.paid_to_store_expected || 0);
                return acc;
            }, {
                total_orders: 0,
                bill_total: 0,
                delivery_fee: 0,
                item_profit: 0,
                overall_profit: 0,
                paid_to_store: 0,
                paid_to_store_expected: 0
            });

            total_income = summary.overall_profit;
            reportData = {
                type: 'order_profit',
                orders,
                summary
            };
        } else if (report_type === 'store_settlement') {
            const dateFilter = period_from && period_to ? 'AND settlement_date BETWEEN ? AND ?' : '';
            const params = period_from && period_to ? [period_from, `${period_to} 23:59:59`] : [];
            
            const [settlements] = await req.db.execute(
                `SELECT ss.*, s.name as store_name
                 FROM store_settlements ss
                 JOIN stores s ON ss.store_id = s.id
                 WHERE 1=1 ${dateFilter}
                 ORDER BY settlement_date DESC`,
                params
            );

            // Calculate totals
            let total_settled_amount = 0;
            let total_commissions = 0;
            
            settlements.forEach(s => {
                total_settled_amount += parseFloat(s.net_amount || 0);
                total_commissions += parseFloat(s.commissions || 0);
            });

            // Update main report totals
            total_settlements = total_settled_amount;
            // Commissions are income for the platform
            total_income = total_commissions; 

            reportData = {
                type: 'store_settlement',
                settlements,
                summary: {
                    total_settled_amount,
                    total_commissions
                }
            };
        } else if (report_type === 'general_voucher') {
            const jnvDateFilter = period_from && period_to ? 'AND voucher_date BETWEEN ? AND ?' : '';
            const [vouchers] = await req.db.execute(
                `SELECT jnv.*, u.first_name as prepared_by_name 
                 FROM journal_vouchers jnv
                 LEFT JOIN users u ON jnv.prepared_by = u.id
                 WHERE 1=1 ${jnvDateFilter}
                 ORDER BY voucher_date DESC`,
                dateParams
            );

            // Get entries for these vouchers
            for (let v of vouchers) {
                const [entries] = await req.db.execute(
                    `SELECT * FROM journal_voucher_entries WHERE jnv_id = ?`,
                    [v.id]
                );
                v.entries = entries;
            }

            reportData = {
                type: 'general_voucher',
                vouchers
            };
        } else if (report_type === 'delivery_charges_breakdown') {
            const dateFilter = period_from && period_to ? 'AND o.created_at BETWEEN ? AND ?' : '';
            const riderFilter = rider_id ? 'AND o.rider_id = ?' : '';
            const storeFilter = store_id ? 'AND (oi.store_id = ? OR (oi.store_id IS NULL AND p.store_id = ?))' : '';
            
            const params = [];
            if (period_from && period_to) {
                params.push(period_from, `${period_to} 23:59:59`);
            }
            if (rider_id) {
                params.push(rider_id);
            }
            if (store_id) {
                params.push(store_id, store_id);
            }

            // Join with order_items to get accurate store names (handling multi-store orders)
            const [orders] = await req.db.execute(
                `SELECT 
                    o.order_number, 
                    o.created_at as order_date,
                    o.delivery_fee,
                    CONCAT(r.first_name, ' ', r.last_name) as rider_name,
                    GROUP_CONCAT(DISTINCT s.name SEPARATOR ', ') as store_names
                 FROM orders o
                 JOIN riders r ON o.rider_id = r.id
                 JOIN order_items oi ON o.id = oi.order_id
                 JOIN products p ON oi.product_id = p.id
                 JOIN stores s ON COALESCE(oi.store_id, p.store_id, s.id) = s.id
                 WHERE o.status = 'delivered' ${dateFilter} ${riderFilter} ${storeFilter}
                 GROUP BY o.id
                 ORDER BY o.created_at DESC`,
                params
            );

            const total_fees = orders.reduce((sum, o) => sum + parseFloat(o.delivery_fee || 0), 0);
            
            // Delivery fees are income for the platform
            total_income = total_fees;

            reportData = {
                type: 'delivery_charges_breakdown',
                rider_name: riderName,
                orders,
                summary: {
                    total_orders: orders.length,
                    total_delivery_fees: total_fees
                }
            };
        } else if (report_type === 'order_wise_sale_summary') {
            const dateFilter = period_from && period_to ? 'AND o.created_at BETWEEN ? AND ?' : '';
            const riderFilter = rider_id ? 'AND o.rider_id = ?' : '';
            // Store filter: Check if any item in the order belongs to the store
            const storeFilter = store_id ? 'AND (oi.store_id = ? OR (oi.store_id IS NULL AND p.store_id = ?))' : '';
            
            const params = [];
            if (period_from && period_to) {
                params.push(period_from, `${period_to} 23:59:59`);
            }
            if (rider_id) {
                params.push(rider_id);
            }
            if (store_id) {
                params.push(store_id, store_id);
            }

            const query = `
                SELECT 
                    o.id as order_id,
                    o.order_number, 
                    o.created_at,
                    o.total_amount,
                    o.delivery_fee,
                    p.name as item_name,
                    oi.quantity,
                    oi.price,
                    oi.discount_type,
                    oi.discount_value,
                    CASE
                        WHEN oi.discount_type = 'percent' AND oi.discount_value IS NOT NULL
                            THEN GREATEST(0, ROUND(oi.price - (oi.price * oi.discount_value / 100), 2))
                        WHEN oi.discount_type = 'amount' AND oi.discount_value IS NOT NULL
                            THEN GREATEST(0, ROUND(oi.price - oi.discount_value, 2))
                        ELSE oi.price
                    END as cost_price,
                    COALESCE(s.commission_rate, 10) as commission_rate
                FROM orders o
                JOIN order_items oi ON o.id = oi.order_id
                JOIN products p ON oi.product_id = p.id
                LEFT JOIN product_size_prices psp ON oi.product_id = psp.product_id
                    AND (
                        (oi.size_id IS NOT NULL AND psp.size_id = oi.size_id) OR
                        (oi.unit_id IS NOT NULL AND psp.unit_id = oi.unit_id)
                    )
                JOIN stores s ON COALESCE(oi.store_id, p.store_id) = s.id
                WHERE o.status = 'delivered' ${dateFilter} ${riderFilter} ${storeFilter}
                ORDER BY o.created_at DESC
            `;

            const [rows] = await req.db.execute(query, params);

            // Group by Order in JavaScript to avoid JSON_ARRAYAGG compatibility issues
            const ordersMap = new Map();
            rows.forEach(row => {
                if (!ordersMap.has(row.order_id)) {
                    ordersMap.set(row.order_id, {
                        id: row.order_id,
                        order_number: row.order_number,
                        created_at: row.created_at,
                        total_amount: parseFloat(row.total_amount || 0),
                        delivery_fee: parseFloat(row.delivery_fee || 0),
                        items: [],
                        item_sales_gross: 0,
                        total_cost_price: 0,
                        estimated_commission: 0,
                        calculated_total: 0
                    });
                }
                const order = ordersMap.get(row.order_id);
                
                const qty = parseFloat(row.quantity || 0);
                const price = parseFloat(row.price || 0);
                const cost = parseFloat(row.cost_price || 0);
                const commRate = parseFloat(row.commission_rate || 10);
                // Use historical order-item discount fields only.
                // Do not fallback to current product discount config, otherwise old orders can be misclassified.
                const discountType = String(row.discount_type || '').toLowerCase().trim();
                const isPercentDiscount = discountType === 'percent' || discountType === '%' || discountType === 'percentage';
                const isFixedAmountDiscount = discountType === 'amount' || discountType.includes('fixed');
                const hasKnownDiscountType = isPercentDiscount || isFixedAmountDiscount;

                order.items.push({
                    name: row.item_name,
                    qty: qty,
                    price: price,
                    cost: cost
                });
                
                const itemTotal = price * qty;
                const itemCost = cost * qty;
                const itemGrossProfit = itemTotal - itemCost;
                // Business rule:
                // - Fixed amount items => use gross margin.
                // - Percent items => use commission rate.
                // - Unknown/missing type (legacy rows) => use gross margin to avoid undercount from wrong fallback.
                const commissionValue = isFixedAmountDiscount
                    ? itemGrossProfit
                    : (isPercentDiscount
                        ? (itemTotal * (commRate / 100))
                        : (hasKnownDiscountType ? (itemTotal * (commRate / 100)) : itemGrossProfit));
                order.item_sales_gross += itemTotal;
                order.total_cost_price += itemCost;
                order.estimated_commission += commissionValue;
            });

            const orders = Array.from(ordersMap.values());
            orders.forEach((order) => {
                order.item_sales_gross = Number(order.item_sales_gross.toFixed(2));
                order.total_cost_price = Number(order.total_cost_price.toFixed(2));
                order.estimated_commission = Number(order.estimated_commission.toFixed(2));
                order.delivery_fee = Number(Number(order.delivery_fee || 0).toFixed(2));
                order.calculated_total = Number((order.item_sales_gross + order.delivery_fee).toFixed(2));
            });

            const summary = orders.reduce((acc, o) => {
                acc.total_item_sales += parseFloat(o.item_sales_gross || 0);
                acc.total_cost += parseFloat(o.total_cost_price || 0);
                acc.total_commission += parseFloat(o.estimated_commission || 0);
                acc.total_delivery += parseFloat(o.delivery_fee || 0);
                acc.grand_total += parseFloat(o.calculated_total || 0);
                return acc;
            }, { total_item_sales: 0, total_cost: 0, total_commission: 0, total_delivery: 0, grand_total: 0 });

            Object.keys(summary).forEach((key) => {
                summary[key] = Number(Number(summary[key] || 0).toFixed(2));
            });

            // Header totals must come from this report's own summary, not the generic ledger totals.
            total_income = Number((summary.total_commission + summary.total_delivery).toFixed(2));
            total_expense = 0;
            total_settlements = 0;
            total_refunds = 0;
            total_adjustments = 0;

            reportData = {
                type: 'order_wise_sale_summary',
                orders,
                summary
            };

        } else if (report_type === 'periodic_sales_report') {
            const hasRange = !!(period_from && period_to);
            const hasStore = !!store_id;
            const rangeFrom = hasRange ? `${period_from} 00:00:00` : null;
            const rangeTo = hasRange ? `${period_to} 23:59:59` : null;
            const params = [
                ...(hasRange ? [rangeFrom, rangeTo] : []),
                ...(hasStore ? [store_id] : [])
            ];

            const [rows] = await req.db.execute(
                `SELECT
                    COALESCE(oi.store_id, p.store_id) AS store_id,
                    s.name AS store_name,
                    c.name AS category_name,
                    p.id AS product_id,
                    p.name AS product_name,
                    CASE
                        WHEN LOWER(TRIM(COALESCE(p.description, ''))) = 'created from admin manual order'
                            THEN 'manual'
                        ELSE 'store'
                    END AS sale_type,
                    ROUND(
                        SUM(oi.quantity * COALESCE(oi.cost_price, psp.cost_price, p.cost_price, 0))
                        / NULLIF(SUM(oi.quantity), 0),
                        2
                    ) AS avg_cost_price,
                    ROUND(
                        SUM(oi.quantity * oi.price) / NULLIF(SUM(oi.quantity), 0),
                        2
                    ) AS avg_sale_price,
                    SUM(oi.quantity) AS qty_sold,
                    ROUND(SUM(oi.quantity * oi.price), 2) AS gross_sales,
                    ROUND(SUM(
                        oi.quantity * (
                            CASE
                                WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%discount%'
                                     AND COALESCE(s.store_discount_apply_all_products, 0) = 1
                                     AND COALESCE(s.store_discount_percent, 0) > 0
                                    THEN oi.price * (COALESCE(s.store_discount_percent, 0) / 100)
                                WHEN oi.discount_type = 'percent' AND COALESCE(oi.discount_value, 0) > 0
                                    THEN oi.price * (COALESCE(oi.discount_value, 0) / 100)
                                WHEN oi.discount_type = 'amount' AND COALESCE(oi.discount_value, 0) > 0
                                    THEN COALESCE(oi.discount_value, 0)
                                ELSE 0
                            END
                        )
                    ), 2) AS total_discount,
                    ROUND(SUM(oi.quantity * oi.price), 2) AS net_sales,
                    ROUND(SUM(
                        oi.quantity * COALESCE(oi.cost_price, psp.cost_price, p.cost_price, 0)
                    ), 2) AS total_cost,
                    ROUND(SUM(
                        oi.quantity * (
                            oi.price - COALESCE(oi.cost_price, psp.cost_price, p.cost_price, 0)
                        )
                    ), 2) AS profit
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN products p ON p.id = oi.product_id
                 LEFT JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
                 LEFT JOIN categories c ON c.id = p.category_id
                 LEFT JOIN product_size_prices psp ON oi.product_id = psp.product_id
                    AND (
                        (oi.size_id IS NOT NULL AND psp.size_id = oi.size_id)
                        OR
                        (oi.unit_id IS NOT NULL AND psp.unit_id = oi.unit_id)
                    )
                 WHERE o.status = 'delivered'
                   ${hasRange ? 'AND o.created_at BETWEEN ? AND ?' : ''}
                   ${hasStore ? 'AND COALESCE(oi.store_id, p.store_id) = ?' : ''}
                 GROUP BY COALESCE(oi.store_id, p.store_id), s.name, c.name, p.id, p.name, sale_type
                 ORDER BY s.name ASC, sale_type DESC, p.name ASC`,
                params
            );

            const summary = (rows || []).reduce((acc, row) => {
                acc.total_rows += 1;
                acc.total_qty_sold += Number(row.qty_sold || 0);
                acc.total_cost += Number(row.total_cost || 0);
                acc.gross_sales += Number(row.gross_sales || 0);
                acc.net_sales += Number(row.net_sales || 0);
                acc.profit += Number(row.profit || 0);
                return acc;
            }, {
                total_rows: 0,
                total_qty_sold: 0,
                total_cost: 0,
                gross_sales: 0,
                net_sales: 0,
                profit: 0
            });

            summary.average_cost_price = summary.total_qty_sold > 0
                ? Number((summary.total_cost / summary.total_qty_sold).toFixed(2))
                : 0;
            summary.average_sale_price = summary.total_qty_sold > 0
                ? Number((summary.gross_sales / summary.total_qty_sold).toFixed(2))
                : 0;
            summary.total_cost = Number(summary.total_cost.toFixed(2));
            summary.gross_sales = Number(summary.gross_sales.toFixed(2));
            summary.net_sales = Number(summary.net_sales.toFixed(2));
            summary.profit = Number(summary.profit.toFixed(2));

            const deliveryParams = [
                ...(hasRange ? [rangeFrom, rangeTo] : []),
                ...(hasStore ? [store_id] : [])
            ];
            const [deliveryRowsRaw] = await req.db.execute(
                `SELECT
                    o.id AS order_id,
                    o.order_number,
                    o.created_at AS order_date,
                    ROUND(COALESCE(o.delivery_fee, 0), 2) AS delivery_fee,
                    CONCAT(COALESCE(r.first_name, ''), ' ', COALESCE(r.last_name, '')) AS rider_name,
                    GROUP_CONCAT(DISTINCT s.name ORDER BY s.name SEPARATOR ', ') AS store_names
                 FROM orders o
                 LEFT JOIN riders r ON r.id = o.rider_id
                 LEFT JOIN order_items oi ON oi.order_id = o.id
                 LEFT JOIN products p ON p.id = oi.product_id
                 LEFT JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
                 WHERE o.status = 'delivered'
                   ${hasRange ? 'AND o.created_at BETWEEN ? AND ?' : ''}
                   ${hasStore ? `AND EXISTS (
                        SELECT 1
                        FROM order_items doi
                        JOIN products dp ON dp.id = doi.product_id
                        WHERE doi.order_id = o.id
                          AND COALESCE(doi.store_id, dp.store_id) = ?
                   )` : ''}
                 GROUP BY o.id, o.order_number, o.created_at, o.delivery_fee, rider_name
                 ORDER BY o.created_at DESC, o.id DESC`,
                deliveryParams
            );
            const deliveryRows = (deliveryRowsRaw || []).map((row) => ({
                order_id: Number(row.order_id || 0) || null,
                order_number: row.order_number || '-',
                order_date: row.order_date || null,
                rider_name: (row.rider_name || '').trim() || '-',
                store_names: row.store_names || '-',
                delivery_fee: Number(parseFloat(row.delivery_fee || 0).toFixed(2))
            }));
            const deliverySummary = deliveryRows.reduce((acc, row) => {
                acc.total_orders += 1;
                acc.total_delivery_charges += Number(row.delivery_fee || 0);
                return acc;
            }, { total_orders: 0, total_delivery_charges: 0 });
            deliverySummary.total_delivery_charges = Number(deliverySummary.total_delivery_charges.toFixed(2));

            const settlementParams = [
                ...(hasRange ? [period_from, `${period_to} 23:59:59`] : []),
                ...(hasStore ? [store_id] : [])
            ];
            const [settlementRowsRaw] = await req.db.execute(
                `SELECT
                    ss.id,
                    ss.settlement_number,
                    ss.settlement_date,
                    s.name AS store_name,
                    ROUND(COALESCE(ss.total_orders_amount, 0), 2) AS total_orders_amount,
                    ROUND(COALESCE(ss.commissions, 0), 2) AS commissions,
                    ROUND(COALESCE(ss.deductions, 0), 2) AS deductions,
                    ROUND(COALESCE(ss.net_amount, 0), 2) AS net_amount,
                    ss.payment_method,
                    ss.status,
                    ss.notes
                 FROM store_settlements ss
                 JOIN stores s ON s.id = ss.store_id
                 WHERE ss.status = 'paid'
                   ${hasRange ? 'AND ss.settlement_date BETWEEN ? AND ?' : ''}
                   ${hasStore ? 'AND ss.store_id = ?' : ''}
                 ORDER BY ss.settlement_date DESC, ss.id DESC`,
                settlementParams
            );
            const settlementRows = (settlementRowsRaw || []).map((row) => ({
                id: Number(row.id || 0) || null,
                settlement_number: row.settlement_number || '-',
                settlement_date: row.settlement_date || null,
                store_name: row.store_name || '-',
                total_orders_amount: Number(parseFloat(row.total_orders_amount || 0).toFixed(2)),
                commissions: Number(parseFloat(row.commissions || 0).toFixed(2)),
                deductions: Number(parseFloat(row.deductions || 0).toFixed(2)),
                net_amount: Number(parseFloat(row.net_amount || 0).toFixed(2)),
                payment_method: row.payment_method || '-',
                status: row.status || 'paid',
                notes: row.notes || ''
            }));
            const settlementSummary = settlementRows.reduce((acc, row) => {
                acc.total_records += 1;
                acc.total_orders_amount += Number(row.total_orders_amount || 0);
                acc.total_commissions += Number(row.commissions || 0);
                acc.total_deductions += Number(row.deductions || 0);
                acc.total_paid_settlements += Number(row.net_amount || 0);
                return acc;
            }, {
                total_records: 0,
                total_orders_amount: 0,
                total_commissions: 0,
                total_deductions: 0,
                total_paid_settlements: 0
            });
            settlementSummary.total_orders_amount = Number(settlementSummary.total_orders_amount.toFixed(2));
            settlementSummary.total_commissions = Number(settlementSummary.total_commissions.toFixed(2));
            settlementSummary.total_deductions = Number(settlementSummary.total_deductions.toFixed(2));
            settlementSummary.total_paid_settlements = Number(settlementSummary.total_paid_settlements.toFixed(2));

            const fuelParams = hasRange ? [period_from, period_to] : [];
            const [fuelRowsRaw] = await req.db.execute(
                `SELECT
                    rcm.id,
                    rcm.movement_number,
                    rcm.movement_date,
                    CONCAT(COALESCE(r.first_name, ''), ' ', COALESCE(r.last_name, '')) AS rider_name,
                    ROUND(COALESCE(rcm.amount, 0), 2) AS amount,
                    rcm.status,
                    rcm.description
                 FROM rider_cash_movements rcm
                 JOIN riders r ON r.id = rcm.rider_id
                 WHERE rcm.movement_type = 'fuel_payment'
                   AND rcm.status IN ('approved', 'completed')
                   ${hasRange ? 'AND rcm.movement_date BETWEEN ? AND ?' : ''}
                 ORDER BY rcm.movement_date DESC, rcm.id DESC`,
                fuelParams
            );
            const fuelRows = (fuelRowsRaw || []).map((row) => ({
                id: Number(row.id || 0) || null,
                movement_number: row.movement_number || '-',
                movement_date: row.movement_date || null,
                rider_name: (row.rider_name || '').trim() || '-',
                amount: Number(parseFloat(row.amount || 0).toFixed(2)),
                status: row.status || '-',
                description: row.description || ''
            }));
            const fuelSummary = fuelRows.reduce((acc, row) => {
                acc.total_records += 1;
                acc.total_fuel_payments += Number(row.amount || 0);
                return acc;
            }, { total_records: 0, total_fuel_payments: 0 });
            fuelSummary.total_fuel_payments = Number(fuelSummary.total_fuel_payments.toFixed(2));

            const expenseParams = hasRange ? [period_from, period_to] : [];
            const [expenseRowsRaw] = await req.db.execute(
                `SELECT
                    ae.id,
                    ae.expense_number,
                    ae.expense_date,
                    ae.category,
                    ae.description,
                    ROUND(COALESCE(ae.amount, 0), 2) AS amount,
                    ae.payment_method,
                    ae.vendor_name,
                    ae.status
                 FROM admin_expenses ae
                 WHERE ae.status = 'paid'
                   ${hasRange ? 'AND ae.expense_date BETWEEN ? AND ?' : ''}
                 ORDER BY ae.expense_date DESC, ae.id DESC`,
                expenseParams
            );
            const expenseRows = (expenseRowsRaw || []).map((row) => ({
                id: Number(row.id || 0) || null,
                expense_number: row.expense_number || '-',
                expense_date: row.expense_date || null,
                category: row.category || '-',
                description: row.description || '',
                amount: Number(parseFloat(row.amount || 0).toFixed(2)),
                payment_method: row.payment_method || '-',
                vendor_name: row.vendor_name || '-',
                status: row.status || 'paid'
            }));
            const expenseSummary = expenseRows.reduce((acc, row) => {
                acc.total_records += 1;
                acc.total_paid_expenses += Number(row.amount || 0);
                return acc;
            }, { total_records: 0, total_paid_expenses: 0 });
            expenseSummary.total_paid_expenses = Number(expenseSummary.total_paid_expenses.toFixed(2));

            total_income = Number((summary.net_sales + deliverySummary.total_delivery_charges).toFixed(2));
            total_expense = Number((summary.total_cost + fuelSummary.total_fuel_payments + expenseSummary.total_paid_expenses).toFixed(2));
            total_settlements = Number(settlementSummary.total_paid_settlements.toFixed(2));

            const closingSummary = {
                cost_price: Number(summary.average_cost_price || 0),
                sale_price: Number(summary.average_sale_price || 0),
                qty_sold: Number(summary.total_qty_sold || 0),
                gross_sales: Number(summary.gross_sales || 0),
                net_sales: Number(summary.net_sales || 0),
                profit: Number(summary.profit || 0),
                delivery_charges: Number(deliverySummary.total_delivery_charges || 0),
                store_settlement_payments: Number(settlementSummary.total_paid_settlements || 0),
                fuel_payments: Number(fuelSummary.total_fuel_payments || 0),
                expenses: Number(expenseSummary.total_paid_expenses || 0),
                net_closing: Number((total_income - total_expense - total_settlements).toFixed(2))
            };

            reportData = {
                type: 'periodic_sales_report',
                filters: {
                    period_from: period_from || null,
                    period_to: period_to || null,
                    store_id: store_id || null
                },
                rows: (rows || []).map((row) => ({
                    store_id: Number(row.store_id || 0) || null,
                    store_name: row.store_name || '-',
                    category_name: row.category_name || 'Uncategorized',
                    product_id: Number(row.product_id || 0) || null,
                    product_name: row.product_name || '-',
                    sale_type: row.sale_type || 'store',
                    cost_price: Number(parseFloat(row.avg_cost_price || 0).toFixed(2)),
                    sale_price: Number(parseFloat(row.avg_sale_price || 0).toFixed(2)),
                    qty_sold: Number(row.qty_sold || 0),
                    gross_sales: Number(parseFloat(row.gross_sales || 0).toFixed(2)),
                    net_sales: Number(parseFloat(row.net_sales || 0).toFixed(2)),
                    profit: Number(parseFloat(row.profit || 0).toFixed(2))
                })),
                summary,
                delivery_rows: deliveryRows,
                delivery_summary: deliverySummary,
                settlement_rows: settlementRows,
                settlement_summary: settlementSummary,
                fuel_rows: fuelRows,
                fuel_summary: fuelSummary,
                expense_rows: expenseRows,
                expense_summary: expenseSummary,
                closing_summary: closingSummary
            };
        } else if (report_type === 'periodic_credit_cash_report') {
            const hasRange = Boolean(period_from && period_to);
            const rangeFrom = hasRange ? `${period_from} 00:00:00` : null;
            const rangeTo = hasRange ? `${period_to} 23:59:59` : null;
            const hasStore = Boolean(store_id);
            const params = [
                ...(hasRange ? [rangeFrom, rangeTo] : []),
                ...(hasStore ? [store_id] : [])
            ];

            const [salesRows] = await req.db.execute(
                `SELECT
                    DATE(o.created_at) AS report_date,
                    ROUND(SUM(
                        CASE
                            WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%credit%'
                                THEN oi.quantity * oi.price
                            ELSE 0
                        END
                    ), 2) AS credit_sale,
                    ROUND(SUM(
                        CASE
                            WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%credit%'
                                THEN 0
                            ELSE oi.quantity * oi.price
                        END
                    ), 2) AS cash_sale,
                    ROUND(SUM(
                        oi.quantity * (
                            oi.price - COALESCE(oi.cost_price, psp.cost_price, p.cost_price, 0)
                        )
                    ), 2) AS profit
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN products p ON p.id = oi.product_id
                 LEFT JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
                 LEFT JOIN product_size_prices psp ON oi.product_id = psp.product_id
                    AND (
                        (oi.size_id IS NOT NULL AND psp.size_id = oi.size_id)
                        OR
                        (oi.unit_id IS NOT NULL AND psp.unit_id = oi.unit_id)
                    )
                 WHERE o.status = 'delivered'
                   ${hasRange ? 'AND o.created_at BETWEEN ? AND ?' : ''}
                   ${hasStore ? 'AND COALESCE(oi.store_id, p.store_id) = ?' : ''}
                 GROUP BY DATE(o.created_at)
                 ORDER BY DATE(o.created_at) DESC`,
                params
            );

            const [deliveryRows] = await req.db.execute(
                `SELECT
                    DATE(o.created_at) AS report_date,
                    ROUND(SUM(COALESCE(o.delivery_fee, 0)), 2) AS delivery_charges
                 FROM orders o
                 LEFT JOIN order_items oi ON oi.order_id = o.id
                 LEFT JOIN products p ON p.id = oi.product_id
                 WHERE o.status = 'delivered'
                   ${hasRange ? 'AND o.created_at BETWEEN ? AND ?' : ''}
                   ${hasStore ? `AND EXISTS (
                        SELECT 1
                        FROM order_items doi
                        JOIN products dp ON dp.id = doi.product_id
                        WHERE doi.order_id = o.id
                          AND COALESCE(doi.store_id, dp.store_id) = ?
                   )` : ''}
                 GROUP BY DATE(o.created_at)
                 ORDER BY DATE(o.created_at) DESC`,
                params
            );

            const deliveryMap = new Map();
            (deliveryRows || []).forEach((row) => {
                deliveryMap.set(String(row.report_date), Number(parseFloat(row.delivery_charges || 0).toFixed(2)));
            });

            const rowMap = new Map();
            (salesRows || []).forEach((row) => {
                const key = String(row.report_date);
                rowMap.set(key, {
                    report_date: key,
                    credit_sale: Number(parseFloat(row.credit_sale || 0).toFixed(2)),
                    cash_sale: Number(parseFloat(row.cash_sale || 0).toFixed(2)),
                    profit: Number(parseFloat(row.profit || 0).toFixed(2)),
                    delivery_charges: Number(parseFloat(deliveryMap.get(key) || 0).toFixed(2))
                });
            });
            deliveryMap.forEach((deliveryCharges, key) => {
                if (!rowMap.has(key)) {
                    rowMap.set(key, {
                        report_date: key,
                        credit_sale: 0,
                        cash_sale: 0,
                        profit: 0,
                        delivery_charges: Number(parseFloat(deliveryCharges || 0).toFixed(2))
                    });
                }
            });

            const rows = Array.from(rowMap.values())
                .sort((a, b) => String(b.report_date).localeCompare(String(a.report_date)))
                .map((row) => ({
                    ...row,
                    total: Number((
                        Number(row.credit_sale || 0) +
                        Number(row.cash_sale || 0) +
                        Number(row.delivery_charges || 0)
                    ).toFixed(2))
                }));

            const summary = rows.reduce((acc, row) => {
                acc.total_credit_sale += Number(row.credit_sale || 0);
                acc.total_cash_sale += Number(row.cash_sale || 0);
                acc.total_profit += Number(row.profit || 0);
                acc.total_delivery_charges += Number(row.delivery_charges || 0);
                acc.grand_total += Number(row.total || 0);
                return acc;
            }, {
                total_credit_sale: 0,
                total_cash_sale: 0,
                total_profit: 0,
                total_delivery_charges: 0,
                grand_total: 0
            });

            summary.total_credit_sale = Number(summary.total_credit_sale.toFixed(2));
            summary.total_cash_sale = Number(summary.total_cash_sale.toFixed(2));
            summary.total_profit = Number(summary.total_profit.toFixed(2));
            summary.total_delivery_charges = Number(summary.total_delivery_charges.toFixed(2));
            summary.grand_total = Number(summary.grand_total.toFixed(2));

            total_income = Number((
                summary.total_credit_sale +
                summary.total_cash_sale +
                summary.total_delivery_charges
            ).toFixed(2));

            reportData = {
                type: 'periodic_credit_cash_report',
                filters: {
                    period_from: period_from || null,
                    period_to: period_to || null,
                    store_id: store_id || null
                },
                rows,
                summary
            };

        } else if (report_type === 'periodic_comprehensive_summary_report') {
            const hasRange = Boolean(period_from && period_to);
            const rangeFrom = hasRange ? `${period_from} 00:00:00` : null;
            const rangeTo = hasRange ? `${period_to} 23:59:59` : null;
            const hasStore = Boolean(store_id);
            const params = [
                ...(hasRange ? [rangeFrom, rangeTo] : []),
                ...(hasStore ? [store_id] : [])
            ];

            const [salesRows] = await req.db.execute(
                `SELECT
                    DATE(o.created_at) AS report_date,
                    ROUND(SUM(oi.quantity * oi.price), 2) AS total_sale,
                    ROUND(SUM(
                        CASE
                            WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%credit%'
                                THEN oi.quantity * oi.price
                            ELSE 0
                        END
                    ), 2) AS credit_sale,
                    ROUND(SUM(
                        CASE
                            WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%credit%'
                                THEN 0
                            ELSE oi.quantity * oi.price
                        END
                    ), 2) AS cash_sale
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN products p ON p.id = oi.product_id
                 LEFT JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
                 WHERE o.status = 'delivered'
                   ${hasRange ? 'AND o.created_at BETWEEN ? AND ?' : ''}
                   ${hasStore ? 'AND COALESCE(oi.store_id, p.store_id) = ?' : ''}
                 GROUP BY DATE(o.created_at)
                 ORDER BY DATE(o.created_at) DESC`,
                params
            );

            const [deliveryRows] = await req.db.execute(
                `SELECT
                    DATE(o.created_at) AS report_date,
                    ROUND(SUM(COALESCE(o.delivery_fee, 0)), 2) AS delivery_charges
                 FROM orders o
                 WHERE o.status = 'delivered'
                   ${hasRange ? 'AND o.created_at BETWEEN ? AND ?' : ''}
                   ${hasStore ? `AND EXISTS (
                        SELECT 1
                        FROM order_items doi
                        JOIN products dp ON dp.id = doi.product_id
                        WHERE doi.order_id = o.id
                          AND COALESCE(doi.store_id, dp.store_id) = ?
                   )` : ''}
                 GROUP BY DATE(o.created_at)
                 ORDER BY DATE(o.created_at) DESC`,
                params
            );

            const expenseParams = [
                ...(period_from && period_to ? [period_from, period_to] : [])
            ];
            const [expenseRows] = await req.db.execute(
                `SELECT
                    DATE(ae.expense_date) AS report_date,
                    ROUND(SUM(COALESCE(ae.amount, 0)), 2) AS expense_amount
                 FROM admin_expenses ae
                 WHERE ae.status = 'paid'
                   ${period_from && period_to ? 'AND ae.expense_date BETWEEN ? AND ?' : ''}
                 GROUP BY DATE(ae.expense_date)
                 ORDER BY DATE(ae.expense_date) DESC`,
                expenseParams
            );

            const fuelParams = [
                ...(period_from && period_to ? [period_from, period_to] : [])
            ];
            const [fuelRows] = await req.db.execute(
                `SELECT
                    DATE(rcm.movement_date) AS report_date,
                    ROUND(SUM(COALESCE(rcm.amount, 0)), 2) AS fuel_amount
                 FROM rider_cash_movements rcm
                 WHERE rcm.movement_type = 'fuel_payment'
                   AND rcm.status IN ('approved', 'completed')
                   ${period_from && period_to ? 'AND rcm.movement_date BETWEEN ? AND ?' : ''}
                 GROUP BY DATE(rcm.movement_date)
                 ORDER BY DATE(rcm.movement_date) DESC`,
                fuelParams
            );

            const rowMap = new Map();
            const ensureRow = (key) => {
                if (!rowMap.has(key)) {
                    rowMap.set(key, {
                        report_date: key,
                        total_sale: 0,
                        credit_sale: 0,
                        cash_sale: 0,
                        delivery_charges: 0,
                        expense: 0,
                        fuel: 0
                    });
                }
                return rowMap.get(key);
            };

            (salesRows || []).forEach((row) => {
                const key = String(row.report_date);
                const target = ensureRow(key);
                target.total_sale = Number(parseFloat(row.total_sale || 0).toFixed(2));
                target.credit_sale = Number(parseFloat(row.credit_sale || 0).toFixed(2));
                target.cash_sale = Number(parseFloat(row.cash_sale || 0).toFixed(2));
            });
            (deliveryRows || []).forEach((row) => {
                const key = String(row.report_date);
                ensureRow(key).delivery_charges = Number(parseFloat(row.delivery_charges || 0).toFixed(2));
            });
            (expenseRows || []).forEach((row) => {
                const key = String(row.report_date);
                ensureRow(key).expense = Number(parseFloat(row.expense_amount || 0).toFixed(2));
            });
            (fuelRows || []).forEach((row) => {
                const key = String(row.report_date);
                ensureRow(key).fuel = Number(parseFloat(row.fuel_amount || 0).toFixed(2));
            });

            const rows = Array.from(rowMap.values())
                .sort((a, b) => String(b.report_date).localeCompare(String(a.report_date)));

            const summary = rows.reduce((acc, row) => {
                acc.total_sale += Number(row.total_sale || 0);
                acc.total_credit_sale += Number(row.credit_sale || 0);
                acc.total_cash_sale += Number(row.cash_sale || 0);
                acc.total_delivery_charges += Number(row.delivery_charges || 0);
                acc.total_expense += Number(row.expense || 0);
                acc.total_fuel += Number(row.fuel || 0);
                return acc;
            }, {
                total_sale: 0,
                total_credit_sale: 0,
                total_cash_sale: 0,
                total_delivery_charges: 0,
                total_expense: 0,
                total_fuel: 0
            });
            Object.keys(summary).forEach((key) => {
                summary[key] = Number(summary[key].toFixed(2));
            });

            total_income = Number((summary.total_sale + summary.total_delivery_charges).toFixed(2));
            total_expense = Number((summary.total_expense + summary.total_fuel).toFixed(2));

            reportData = {
                type: 'periodic_comprehensive_summary_report',
                filters: {
                    period_from: period_from || null,
                    period_to: period_to || null,
                    store_id: store_id || null
                },
                rows,
                summary
            };

        } else if (report_type === 'periodic_store_payments_balance_report') {
            const hasRange = Boolean(period_from && period_to);
            const periodStart = hasRange ? `${period_from} 00:00:00` : null;
            const periodEnd = hasRange ? `${period_to} 23:59:59` : null;
            const hasStore = Boolean(store_id);
            const payableSql = getStorePayableSqlExpression('s');

            const [stores] = await req.db.execute(
                `SELECT id, name, payment_term
                 FROM stores
                 ${hasStore ? 'WHERE id = ?' : ''}
                 ORDER BY name ASC`,
                hasStore ? [store_id] : []
            );

            const [generatedRows] = await req.db.execute(
                `SELECT
                    COALESCE(oi.store_id, p.store_id) AS store_id,
                    SUM(${payableSql}) AS generated_payable
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN products p ON p.id = oi.product_id
                 JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
                 WHERE o.status = 'delivered'
                   AND o.payment_status = 'paid'
                   AND LOWER(TRIM(COALESCE(s.payment_term, ''))) NOT IN ('cash only', 'cash with discount')
                   AND LOWER(TRIM(COALESCE(p.description, ''))) <> 'created from admin manual order'
                   AND NOT EXISTS (
                       SELECT 1
                       FROM rider_store_payments rsp
                       WHERE rsp.order_id = oi.order_id
                         AND rsp.store_id = COALESCE(oi.store_id, p.store_id)
                   )
                   ${hasRange ? 'AND o.created_at BETWEEN ? AND ?' : ''}
                   ${hasStore ? 'AND s.id = ?' : ''}
                 GROUP BY COALESCE(oi.store_id, p.store_id)`,
                [
                    ...(hasRange ? [periodStart, periodEnd] : []),
                    ...(hasStore ? [store_id] : [])
                ]
            );

            const [paidRows] = await req.db.execute(
                `SELECT
                    ss.store_id,
                    SUM(ss.net_amount) AS paid_amount
                 FROM store_settlements ss
                 WHERE ss.status = 'paid'
                   ${hasRange ? 'AND ss.settlement_date BETWEEN ? AND ?' : ''}
                   ${hasStore ? 'AND ss.store_id = ?' : ''}
                 GROUP BY ss.store_id`,
                [
                    ...(hasRange ? [period_from, `${period_to} 23:59:59`] : []),
                    ...(hasStore ? [store_id] : [])
                ]
            );

            const [outstandingRows] = await req.db.execute(
                `SELECT
                    COALESCE(oi.store_id, p.store_id) AS store_id,
                    SUM(${payableSql}) AS balance_amount
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN products p ON p.id = oi.product_id
                 JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
                 WHERE o.status = 'delivered'
                   AND o.payment_status = 'paid'
                   AND oi.settlement_id IS NULL
                   AND LOWER(TRIM(COALESCE(s.payment_term, ''))) NOT IN ('cash only', 'cash with discount')
                   AND LOWER(TRIM(COALESCE(p.description, ''))) <> 'created from admin manual order'
                   AND NOT EXISTS (
                       SELECT 1
                       FROM rider_store_payments rsp
                       WHERE rsp.order_id = oi.order_id
                         AND rsp.store_id = COALESCE(oi.store_id, p.store_id)
                   )
                   ${hasStore ? 'AND s.id = ?' : ''}
                 GROUP BY COALESCE(oi.store_id, p.store_id)`,
                hasStore ? [store_id] : []
            );

            const generatedMap = new Map((generatedRows || []).map((r) => [Number(r.store_id), Number(r.generated_payable || 0)]));
            const paidMap = new Map((paidRows || []).map((r) => [Number(r.store_id), Number(r.paid_amount || 0)]));
            const balanceMap = new Map((outstandingRows || []).map((r) => [Number(r.store_id), Number(r.balance_amount || 0)]));

            const rows = (stores || []).map((store) => ({
                store_id: Number(store.id) || null,
                store_name: store.name || '-',
                payment_term: store.payment_term || '-',
                generated_payable: Number((generatedMap.get(Number(store.id)) || 0).toFixed(2)),
                paid_amount: Number((paidMap.get(Number(store.id)) || 0).toFixed(2)),
                balance_amount: Number((balanceMap.get(Number(store.id)) || 0).toFixed(2))
            })).filter((row) =>
                row.generated_payable !== 0 ||
                row.paid_amount !== 0 ||
                row.balance_amount !== 0
            );

            const summary = rows.reduce((acc, row) => {
                acc.total_generated_payable += Number(row.generated_payable || 0);
                acc.total_paid_amount += Number(row.paid_amount || 0);
                acc.total_balance_amount += Number(row.balance_amount || 0);
                return acc;
            }, {
                total_generated_payable: 0,
                total_paid_amount: 0,
                total_balance_amount: 0
            });
            Object.keys(summary).forEach((key) => {
                summary[key] = Number(summary[key].toFixed(2));
            });

            total_income = summary.total_generated_payable;
            total_expense = summary.total_paid_amount;

            reportData = {
                type: 'periodic_store_payments_balance_report',
                filters: {
                    period_from: period_from || null,
                    period_to: period_to || null,
                    store_id: store_id || null
                },
                rows,
                summary
            };

        } else if (report_type === 'cash_discrepancy_report') {
            const dateFilter = period_from && period_to ? 'AND o.created_at BETWEEN ? AND ?' : '';
            const dateParamsFull = period_from && period_to ? [period_from, `${period_to} 23:59:59`] : [];
            const dateParamsDateOnly = period_from && period_to ? [period_from, period_to] : [];

            const [detailRows] = await req.db.execute(
                `SELECT
                    o.id AS order_id,
                    o.order_number,
                    DATE(o.created_at) AS order_date,
                    DATE_FORMAT(o.created_at, '%Y-%m') AS month_key,
                    YEAR(o.created_at) AS year_key,
                    o.payment_method,
                    o.payment_status,
                    ROUND(COALESCE(o.total_amount,0),2) AS order_total,
                    COALESCE(r.id, 0) AS rider_id,
                    CONCAT(COALESCE(r.first_name,''), ' ', COALESCE(r.last_name,'')) AS rider_name,
                    s.id AS store_id,
                    s.name AS store_name,
                    COALESCE(s.payment_term,'') AS payment_term,
                    ROUND(SUM(oi.quantity * oi.price),2) AS store_gross,
                    ROUND(SUM(
                        GREATEST(
                            0,
                            (oi.quantity * oi.price) -
                            (
                                oi.quantity * (
                                    CASE
                                        WHEN LOWER(TRIM(COALESCE(s.payment_term,''))) LIKE '%discount%'
                                             AND COALESCE(s.store_discount_apply_all_products,0)=1
                                             AND COALESCE(s.store_discount_percent,0) > 0
                                            THEN oi.price * (COALESCE(s.store_discount_percent,0)/100)
                                        WHEN oi.discount_type='percent' AND COALESCE(oi.discount_value,0) > 0
                                            THEN oi.price * (COALESCE(oi.discount_value,0)/100)
                                        WHEN oi.discount_type='amount' AND COALESCE(oi.discount_value,0) > 0
                                            THEN COALESCE(oi.discount_value,0)
                                        ELSE 0
                                    END
                                )
                            )
                        )
                    ),2) AS store_payable
                 FROM orders o
                 JOIN order_items oi ON oi.order_id = o.id
                 LEFT JOIN products p ON p.id = oi.product_id
                 LEFT JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id, o.store_id)
                 LEFT JOIN riders r ON r.id = o.rider_id
                 WHERE o.status = 'delivered' ${dateFilter}
                 GROUP BY o.id, o.order_number, DATE(o.created_at), DATE_FORMAT(o.created_at, '%Y-%m'), YEAR(o.created_at),
                          o.payment_method, o.payment_status, o.total_amount, r.id, r.first_name, r.last_name, s.id, s.name, s.payment_term
                 ORDER BY o.created_at DESC, o.id DESC`,
                dateParamsFull
            );

            const [orderGrossRows] = await req.db.execute(
                `SELECT oi.order_id, ROUND(SUM(oi.quantity * oi.price),2) AS order_gross
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 WHERE o.status = 'delivered' ${dateFilter}
                 GROUP BY oi.order_id`,
                dateParamsFull
            );
            const orderGrossMap = {};
            (orderGrossRows || []).forEach((r) => { orderGrossMap[r.order_id] = Number(r.order_gross || 0); });

            const [submissionRows] = await req.db.execute(
                `SELECT rcso.order_id, ROUND(SUM(rcso.order_amount),2) AS submitted
                 FROM rider_cash_submission_orders rcso
                 JOIN orders o ON o.id = rcso.order_id
                 WHERE o.status = 'delivered' ${dateFilter}
                 GROUP BY rcso.order_id`,
                dateParamsFull
            );
            const submissionMap = {};
            (submissionRows || []).forEach((r) => { submissionMap[r.order_id] = Number(r.submitted || 0); });

            const [fuelHistoryRows] = await req.db.execute(
                `SELECT DATE(entry_date) AS d, ROUND(SUM(COALESCE(fuel_cost,0)),2) AS fuel_history
                 FROM riders_fuel_history
                 WHERE 1=1 ${period_from && period_to ? 'AND DATE(entry_date) BETWEEN ? AND ?' : ''}
                 GROUP BY DATE(entry_date)`,
                dateParamsDateOnly
            );
            const fuelHistoryMap = {};
            (fuelHistoryRows || []).forEach((r) => { fuelHistoryMap[String(r.d)] = Number(r.fuel_history || 0); });

            const [fuelPaidRows] = await req.db.execute(
                `SELECT DATE(entry_date) AS d, ROUND(SUM(COALESCE(fuel_cost,0)),2) AS fuel_paid
                 FROM rider_fuel_payment_entries
                 WHERE 1=1 ${period_from && period_to ? 'AND DATE(entry_date) BETWEEN ? AND ?' : ''}
                 GROUP BY DATE(entry_date)`,
                dateParamsDateOnly
            );
            const fuelPaidMap = {};
            (fuelPaidRows || []).forEach((r) => { fuelPaidMap[String(r.d)] = Number(r.fuel_paid || 0); });

            const details = (detailRows || []).map((r) => {
                const orderGross = Number(orderGrossMap[r.order_id] || 0);
                const ratio = orderGross > 0 ? (Number(r.store_gross || 0) / orderGross) : 0;
                const riderCollectedOrder = (
                    String(r.payment_method || '').toLowerCase().trim() === 'cash' &&
                    String(r.payment_status || '').toLowerCase().trim() === 'paid'
                ) ? Number(r.order_total || 0) : 0;
                const riderSubmittedOrder = Number(submissionMap[r.order_id] || 0);
                const riderCollected = Number((riderCollectedOrder * ratio).toFixed(2));
                const riderSubmitted = Number((riderSubmittedOrder * ratio).toFixed(2));
                const storePayable = Number(r.store_payable || 0);
                const storeGross = Number(r.store_gross || 0);
                const share = Number((storeGross - storePayable).toFixed(2));
                return {
                    order_number: r.order_number,
                    order_date: r.order_date,
                    month_key: r.month_key,
                    year_key: r.year_key,
                    store_name: r.store_name || '-',
                    payment_term: r.payment_term || '-',
                    rider_name: r.rider_name || '-',
                    store_gross: storeGross,
                    store_payable: storePayable,
                    servenow_share: share,
                    rider_collected_cash: riderCollected,
                    rider_submitted_cash: riderSubmitted,
                    cash_gap: Number((riderCollected - riderSubmitted).toFixed(2)),
                    software_cash_estimate: Number((riderSubmitted - storePayable).toFixed(2))
                };
            });

            const dayMap = {};
            details.forEach((d) => {
                const key = String(d.order_date);
                if (!dayMap[key]) {
                    dayMap[key] = {
                        period: key,
                        total_orders: 0,
                        store_gross: 0,
                        store_payable: 0,
                        servenow_share: 0,
                        rider_collected_cash: 0,
                        rider_submitted_cash: 0,
                        fuel_history: Number(fuelHistoryMap[key] || 0),
                        fuel_paid: Number(fuelPaidMap[key] || 0)
                    };
                }
                dayMap[key].total_orders += 1;
                dayMap[key].store_gross += Number(d.store_gross || 0);
                dayMap[key].store_payable += Number(d.store_payable || 0);
                dayMap[key].servenow_share += Number(d.servenow_share || 0);
                dayMap[key].rider_collected_cash += Number(d.rider_collected_cash || 0);
                dayMap[key].rider_submitted_cash += Number(d.rider_submitted_cash || 0);
            });
            const daily_totals = Object.values(dayMap)
                .map((x) => ({
                    ...x,
                    store_gross: Number(x.store_gross.toFixed(2)),
                    store_payable: Number(x.store_payable.toFixed(2)),
                    servenow_share: Number(x.servenow_share.toFixed(2)),
                    rider_collected_cash: Number(x.rider_collected_cash.toFixed(2)),
                    rider_submitted_cash: Number(x.rider_submitted_cash.toFixed(2)),
                    cash_gap: Number((x.rider_collected_cash - x.rider_submitted_cash).toFixed(2)),
                    software_cash_estimate: Number((x.rider_submitted_cash - x.store_payable - x.fuel_paid).toFixed(2))
                }))
                .sort((a, b) => a.period.localeCompare(b.period));

            const monthMap = {};
            daily_totals.forEach((d) => {
                const m = String(d.period).slice(0, 7);
                if (!monthMap[m]) {
                    monthMap[m] = {
                        period: m,
                        total_days: 0,
                        total_orders: 0,
                        store_gross: 0,
                        store_payable: 0,
                        servenow_share: 0,
                        rider_collected_cash: 0,
                        rider_submitted_cash: 0,
                        fuel_history: 0,
                        fuel_paid: 0
                    };
                }
                monthMap[m].total_days += 1;
                monthMap[m].total_orders += Number(d.total_orders || 0);
                monthMap[m].store_gross += Number(d.store_gross || 0);
                monthMap[m].store_payable += Number(d.store_payable || 0);
                monthMap[m].servenow_share += Number(d.servenow_share || 0);
                monthMap[m].rider_collected_cash += Number(d.rider_collected_cash || 0);
                monthMap[m].rider_submitted_cash += Number(d.rider_submitted_cash || 0);
                monthMap[m].fuel_history += Number(d.fuel_history || 0);
                monthMap[m].fuel_paid += Number(d.fuel_paid || 0);
            });
            const monthly_totals = Object.values(monthMap).map((x) => ({
                ...x,
                store_gross: Number(x.store_gross.toFixed(2)),
                store_payable: Number(x.store_payable.toFixed(2)),
                servenow_share: Number(x.servenow_share.toFixed(2)),
                rider_collected_cash: Number(x.rider_collected_cash.toFixed(2)),
                rider_submitted_cash: Number(x.rider_submitted_cash.toFixed(2)),
                fuel_history: Number(x.fuel_history.toFixed(2)),
                fuel_paid: Number(x.fuel_paid.toFixed(2)),
                cash_gap: Number((x.rider_collected_cash - x.rider_submitted_cash).toFixed(2)),
                software_cash_estimate: Number((x.rider_submitted_cash - x.store_payable - x.fuel_paid).toFixed(2))
            })).sort((a, b) => a.period.localeCompare(b.period));

            const yearMap = {};
            monthly_totals.forEach((m) => {
                const y = String(m.period).slice(0, 4);
                if (!yearMap[y]) {
                    yearMap[y] = {
                        period: y,
                        total_months: 0,
                        total_orders: 0,
                        store_gross: 0,
                        store_payable: 0,
                        servenow_share: 0,
                        rider_collected_cash: 0,
                        rider_submitted_cash: 0,
                        fuel_history: 0,
                        fuel_paid: 0
                    };
                }
                yearMap[y].total_months += 1;
                yearMap[y].total_orders += Number(m.total_orders || 0);
                yearMap[y].store_gross += Number(m.store_gross || 0);
                yearMap[y].store_payable += Number(m.store_payable || 0);
                yearMap[y].servenow_share += Number(m.servenow_share || 0);
                yearMap[y].rider_collected_cash += Number(m.rider_collected_cash || 0);
                yearMap[y].rider_submitted_cash += Number(m.rider_submitted_cash || 0);
                yearMap[y].fuel_history += Number(m.fuel_history || 0);
                yearMap[y].fuel_paid += Number(m.fuel_paid || 0);
            });
            const yearly_totals = Object.values(yearMap).map((x) => ({
                ...x,
                store_gross: Number(x.store_gross.toFixed(2)),
                store_payable: Number(x.store_payable.toFixed(2)),
                servenow_share: Number(x.servenow_share.toFixed(2)),
                rider_collected_cash: Number(x.rider_collected_cash.toFixed(2)),
                rider_submitted_cash: Number(x.rider_submitted_cash.toFixed(2)),
                fuel_history: Number(x.fuel_history.toFixed(2)),
                fuel_paid: Number(x.fuel_paid.toFixed(2)),
                cash_gap: Number((x.rider_collected_cash - x.rider_submitted_cash).toFixed(2)),
                software_cash_estimate: Number((x.rider_submitted_cash - x.store_payable - x.fuel_paid).toFixed(2))
            })).sort((a, b) => a.period.localeCompare(b.period));

            const summary = daily_totals.reduce((acc, d) => {
                acc.total_days += 1;
                acc.total_orders += Number(d.total_orders || 0);
                acc.store_gross += Number(d.store_gross || 0);
                acc.store_payable += Number(d.store_payable || 0);
                acc.servenow_share += Number(d.servenow_share || 0);
                acc.rider_collected_cash += Number(d.rider_collected_cash || 0);
                acc.rider_submitted_cash += Number(d.rider_submitted_cash || 0);
                acc.fuel_history += Number(d.fuel_history || 0);
                acc.fuel_paid += Number(d.fuel_paid || 0);
                return acc;
            }, {
                total_days: 0, total_orders: 0, store_gross: 0, store_payable: 0, servenow_share: 0,
                rider_collected_cash: 0, rider_submitted_cash: 0, fuel_history: 0, fuel_paid: 0
            });
            summary.cash_gap = Number((summary.rider_collected_cash - summary.rider_submitted_cash).toFixed(2));
            summary.software_cash_estimate = Number((summary.rider_submitted_cash - summary.store_payable - summary.fuel_paid).toFixed(2));
            Object.keys(summary).forEach((k) => {
                if (k !== 'total_days' && k !== 'total_orders') summary[k] = Number(Number(summary[k] || 0).toFixed(2));
            });

            total_income = Number(summary.rider_submitted_cash || 0);
            total_expense = Number((summary.store_payable || 0) + (summary.fuel_paid || 0));
            reportData = {
                type: 'cash_discrepancy_report',
                details,
                daily_totals,
                monthly_totals,
                yearly_totals,
                summary
            };
        } else if (report_type === 'store_financials') {
            const orderDateFilter = period_from && period_to ? 'AND o.created_at BETWEEN ? AND ?' : '';
            const storeFilter = store_id ? 'AND (oi.store_id = ? OR (oi.store_id IS NULL AND p.store_id = ?))' : '';
            
            // Adjust params
            const queryParams = [];
            if (period_from && period_to) {
                queryParams.push(period_from, `${period_to} 23:59:59`);
            }
            if (store_id) {
                queryParams.push(store_id, store_id);
            }

            const [financials] = await req.db.execute(
                `SELECT 
                    s.name as store_name,
                    SUM(oi.quantity * oi.price) as total_sales,
                    SUM(oi.quantity * (
                        CASE 
                            WHEN oi.discount_type = 'percent' AND oi.discount_value IS NOT NULL
                                THEN GREATEST(0, ROUND(oi.price - (oi.price * oi.discount_value / 100), 2))
                            WHEN oi.discount_type = 'amount' AND oi.discount_value IS NOT NULL
                                THEN GREATEST(0, ROUND(oi.price - oi.discount_value, 2))
                            ELSE oi.price
                        END
                    )) as total_cost,
                    SUM(oi.quantity * (
                        oi.price - (
                            CASE 
                                WHEN oi.discount_type = 'percent' AND oi.discount_value IS NOT NULL
                                    THEN GREATEST(0, ROUND(oi.price - (oi.price * oi.discount_value / 100), 2))
                                WHEN oi.discount_type = 'amount' AND oi.discount_value IS NOT NULL
                                    THEN GREATEST(0, ROUND(oi.price - oi.discount_value, 2))
                                ELSE oi.price
                            END
                        )
                    )) as estimated_profit,
                    SUM(CASE 
                        WHEN oi.discount_type = 'percent' THEN oi.quantity * oi.price * (oi.discount_value / 100)
                        WHEN oi.discount_type = 'amount' THEN oi.quantity * oi.discount_value
                        ELSE 0 
                    END) as total_discount
                 FROM order_items oi
                 JOIN orders o ON oi.order_id = o.id
                 JOIN products p ON oi.product_id = p.id
                 LEFT JOIN product_size_prices psp ON oi.product_id = psp.product_id 
                    AND (
                        (oi.size_id IS NOT NULL AND psp.size_id = oi.size_id) OR 
                        (oi.unit_id IS NOT NULL AND psp.unit_id = oi.unit_id)
                    )
                 LEFT JOIN stores s ON COALESCE(oi.store_id, p.store_id) = s.id
                 WHERE o.status = 'delivered' ${orderDateFilter} ${storeFilter}
                 GROUP BY s.id, s.name`,
                queryParams
            );

            // Fetch item-level breakdown for the same filter
            let itemsBreakdown = [];
            if (store_id) {
                 const [items] = await req.db.execute(
                    `SELECT 
                        COALESCE(oi.variant_label, p.name) as item_name,
                        SUM(oi.quantity) as total_qty,
                        SUM(oi.quantity * oi.price) as total_sales,
                        SUM(oi.quantity * (
                            CASE 
                                WHEN oi.discount_type = 'percent' AND oi.discount_value IS NOT NULL
                                    THEN GREATEST(0, ROUND(oi.price - (oi.price * oi.discount_value / 100), 2))
                                WHEN oi.discount_type = 'amount' AND oi.discount_value IS NOT NULL
                                    THEN GREATEST(0, ROUND(oi.price - oi.discount_value, 2))
                                ELSE oi.price
                            END
                        )) as total_cost,
                        SUM(oi.quantity * (
                            oi.price - (
                                CASE 
                                    WHEN oi.discount_type = 'percent' AND oi.discount_value IS NOT NULL
                                        THEN GREATEST(0, ROUND(oi.price - (oi.price * oi.discount_value / 100), 2))
                                    WHEN oi.discount_type = 'amount' AND oi.discount_value IS NOT NULL
                                        THEN GREATEST(0, ROUND(oi.price - oi.discount_value, 2))
                                    ELSE oi.price
                                END
                            )
                        )) as estimated_profit,
                        SUM(CASE 
                            WHEN oi.discount_type = 'percent' THEN oi.quantity * oi.price * (oi.discount_value / 100)
                            WHEN oi.discount_type = 'amount' THEN oi.quantity * oi.discount_value
                            ELSE 0 
                        END) as total_discount
                     FROM order_items oi
                     JOIN orders o ON oi.order_id = o.id
                     JOIN products p ON oi.product_id = p.id
                     LEFT JOIN product_size_prices psp ON oi.product_id = psp.product_id 
                        AND (
                            (oi.size_id IS NOT NULL AND psp.size_id = oi.size_id) OR 
                            (oi.unit_id IS NOT NULL AND psp.unit_id = oi.unit_id)
                        )
                     WHERE o.status = 'delivered' ${orderDateFilter} 
                     AND (oi.store_id = ? OR (oi.store_id IS NULL AND p.store_id = ?))
                     GROUP BY p.id, oi.variant_label
                     ORDER BY total_sales DESC`,
                    [...queryParams] // Reuse params including store_id
                );
                itemsBreakdown = items;
            }

            reportData = {
                type: 'store_financials',
                stores: financials,
                items: itemsBreakdown,
                overall: financials.reduce((acc, curr) => {
                    acc.total_sales += parseFloat(curr.total_sales || 0);
                    acc.total_cost += parseFloat(curr.total_cost || 0);
                    acc.total_profit += parseFloat(curr.estimated_profit || 0);
                    acc.total_discount += parseFloat(curr.total_discount || 0);
                    return acc;
                }, { total_sales: 0, total_cost: 0, total_profit: 0, total_discount: 0 })
            };
        } else if (report_type === 'rider_fuel_report') {
            const fuelDateFilter = period_from && period_to ? 'AND rfh.entry_date BETWEEN ? AND ?' : '';
            const riderFilter = rider_id ? 'AND rfh.rider_id = ?' : '';
            
            // Build params array carefully
            const params = [];
            if (period_from && period_to) {
                params.push(period_from, period_to);
            }
            if (rider_id) {
                params.push(rider_id);
            }

            const [fuelEntries] = await req.db.execute(
                `SELECT rfh.*, r.first_name, r.last_name 
                 FROM riders_fuel_history rfh
                 JOIN riders r ON rfh.rider_id = r.id
                 WHERE 1=1 ${fuelDateFilter} ${riderFilter}
                 ORDER BY rfh.entry_date DESC`,
                params
            );

            const [summary] = await req.db.execute(
                `SELECT SUM(fuel_cost) as total_cost, SUM(distance) as total_distance
                 FROM riders_fuel_history rfh
                 WHERE 1=1 ${fuelDateFilter} ${riderFilter}`,
                params
            );

            reportData = {
                type: 'rider_fuel',
                rider_name: riderName,
                entries: fuelEntries,
                summary: summary[0] || { total_cost: 0, total_distance: 0 }
            };
        } else if (report_type === 'rider_petrol_report') {
            const fuelDateFilter = period_from && period_to ? 'AND rfh.entry_date BETWEEN ? AND ?' : '';
            const riderFilter = rider_id ? 'AND rfh.rider_id = ?' : '';
            const params = [];
            if (period_from && period_to) params.push(period_from, period_to);
            if (rider_id) params.push(rider_id);

            const [fuelEntries] = await req.db.execute(
                `SELECT rfh.*, r.first_name, r.last_name
                 FROM riders_fuel_history rfh
                 JOIN riders r ON rfh.rider_id = r.id
                 WHERE 1=1 ${fuelDateFilter} ${riderFilter}
                 ORDER BY rfh.entry_date DESC, rfh.id DESC`,
                params
            );
            const [summary] = await req.db.execute(
                `SELECT SUM(fuel_cost) as total_cost, SUM(distance) as total_distance
                 FROM riders_fuel_history rfh
                 WHERE 1=1 ${fuelDateFilter} ${riderFilter}`,
                params
            );
            total_expense = parseFloat(summary?.[0]?.total_cost || 0);
            reportData = {
                type: 'rider_petrol',
                rider_name: riderName,
                entries: fuelEntries,
                summary: summary[0] || { total_cost: 0, total_distance: 0 }
            };
        } else if (report_type === 'rider_daily_mileage_report') {
            const fuelDateFilter = period_from && period_to ? 'AND rfh.entry_date BETWEEN ? AND ?' : '';
            const riderFilter = rider_id ? 'AND rfh.rider_id = ?' : '';
            const params = [];
            if (period_from && period_to) params.push(period_from, period_to);
            if (rider_id) params.push(rider_id);

            const [rows] = await req.db.execute(
                `SELECT
                    rfh.rider_id,
                    CONCAT(r.first_name, ' ', r.last_name) as rider_name,
                    DATE(rfh.entry_date) as mileage_date,
                    COUNT(*) as trips_logged,
                    SUM(COALESCE(rfh.distance, 0)) as total_distance,
                    SUM(COALESCE(rfh.fuel_cost, 0)) as total_fuel_cost
                 FROM riders_fuel_history rfh
                 JOIN riders r ON rfh.rider_id = r.id
                 WHERE 1=1 ${fuelDateFilter} ${riderFilter}
                 GROUP BY rfh.rider_id, DATE(rfh.entry_date), r.first_name, r.last_name
                 ORDER BY mileage_date DESC, rider_name ASC`,
                params
            );
            const summary = {
                total_days_logged: (rows || []).length,
                total_distance: (rows || []).reduce((s, r) => s + parseFloat(r.total_distance || 0), 0),
                total_fuel_cost: (rows || []).reduce((s, r) => s + parseFloat(r.total_fuel_cost || 0), 0)
            };
            total_expense = summary.total_fuel_cost;
            reportData = {
                type: 'rider_daily_mileage',
                rider_name: riderName,
                rows,
                summary
            };
        } else if (report_type === 'expense_report') {
            const hasRange = Boolean(period_from && period_to);
            const params = [];
            const rangeFrom = hasRange ? `${period_from} 00:00:00` : null;
            const rangeTo = hasRange ? `${period_to} 23:59:59` : null;
            const dateFilter = hasRange ? 'AND ft.created_at BETWEEN ? AND ?' : '';
            if (hasRange) params.push(rangeFrom, rangeTo);

            const [expenses] = await req.db.execute(
                `SELECT
                    ft.id,
                    ft.transaction_number,
                    ft.created_at AS expense_date,
                    ft.category,
                    ft.description,
                    ft.amount,
                    ft.payment_method,
                    ft.status,
                    CASE
                        WHEN ft.related_entity_type = 'rider' THEN CONCAT(r.first_name, ' ', r.last_name)
                        WHEN ft.related_entity_type = 'store' THEN s.name
                        WHEN ft.related_entity_type = 'employee' OR ft.related_entity_type = 'user' THEN CONCAT(u.first_name, ' ', u.last_name)
                        ELSE NULL
                    END AS entity_name
                 FROM financial_transactions ft
                 LEFT JOIN riders r ON ft.related_entity_type = 'rider' AND ft.related_entity_id = r.id
                 LEFT JOIN stores s ON ft.related_entity_type = 'store' AND ft.related_entity_id = s.id
                 LEFT JOIN users u ON (ft.related_entity_type = 'employee' OR ft.related_entity_type = 'user') AND ft.related_entity_id = u.id
                 WHERE ft.transaction_type = 'expense'
                   ${dateFilter}
                 ORDER BY ft.created_at DESC, ft.id DESC`,
                params
            );

            const summary = (expenses || []).reduce((acc, e) => {
                const amount = parseFloat(e.amount || 0);
                acc.total_recorded += amount;
                if (String(e.status || '').toLowerCase() === 'completed') {
                    acc.total_paid += amount;
                }
                acc.total_count += 1;
                return acc;
            }, { total_recorded: 0, total_paid: 0, total_count: 0 });

            total_expense = summary.total_recorded;
            reportData = {
                type: 'expense_report',
                expenses,
                summary
            };
        } else if (report_type === 'comprehensive_report') {
            // Add end-of-day time to period_to if it doesn't have time component
            let endDate = period_to;
            if (period_to && period_to.length === 10) {
                 endDate = period_to + ' 23:59:59';
            }

            const dateFilter = period_from && endDate ? 'AND ft.created_at BETWEEN ? AND ?' : '';
            const params = period_from && endDate ? [period_from, endDate] : [];

            const [details] = await req.db.execute(`
                SELECT 
                    ft.*,
                    CASE 
                        WHEN ft.related_entity_type = 'rider' THEN CONCAT(r.first_name, ' ', r.last_name)
                        WHEN ft.related_entity_type = 'store' THEN s.name
                        WHEN ft.related_entity_type = 'employee' OR ft.related_entity_type = 'user' THEN CONCAT(u.first_name, ' ', u.last_name)
                        ELSE NULL 
                    END as entity_name,
                    ft.reference_id as reference_number_display
                FROM financial_transactions ft
                LEFT JOIN riders r ON ft.related_entity_type = 'rider' AND ft.related_entity_id = r.id
                LEFT JOIN stores s ON ft.related_entity_type = 'store' AND ft.related_entity_id = s.id
                LEFT JOIN users u ON (ft.related_entity_type = 'employee' OR ft.related_entity_type = 'user') AND ft.related_entity_id = u.id
                WHERE 1=1 ${dateFilter}
                ORDER BY ft.created_at DESC
            `, params);

            // Reset totals to avoid double counting from the initial summary query
            total_income = 0;
            total_expense = 0;
            total_settlements = 0;
            total_refunds = 0;
            total_adjustments = 0;

            details.forEach(t => {
                const amt = parseFloat(t.amount || 0);
                if (t.transaction_type === 'income') total_income += amt;
                else if (t.transaction_type === 'expense') total_expense += amt;
                else if (t.transaction_type === 'settlement') total_settlements += amt;
                else if (t.transaction_type === 'refund') total_refunds += amt;
                else if (t.transaction_type === 'adjustment') total_adjustments += amt;
            });

            // Calculate profit from store items
            const orderDateFilter = period_from && period_to ? 'AND o.created_at BETWEEN ? AND ?' : '';
            const orderParams = period_from && period_to ? [period_from, `${period_to} 23:59:59`] : [];
            
            // Item Cost Calculation: SUM(Quantity * CostPrice) - Total Discount
            // According to user logic: Item Cost is the amount payable to store (Selling Price - Discount)
            // But we have Cost Price field. If user sets Cost = Selling Price, then Profit = 0.
            // And "Payable to Store" becomes "Cost - Discount".
            
            // Let's recalculate "Net Item Cost" (Payable to Store)
            // It is: (Quantity * CostPrice) - Discount
            // Wait, standard logic:
            // Store Settlement = (Sales - Commission).
            // User says: "sale price is 300 so after 10 % discount is costs Rs. 270"
            // This means Cost = Price - Discount.
            // So "Item Cost" in the report should be 1422 (which is 1580 - 158).
            
            // So we need to calculate `total_item_cost_net` = `total_item_cost` - `total_item_discount`.
            
             // Item Sales Calculation: SUM(Quantity * Price) - Gross Sales
            const [salesData] = await req.db.execute(
                `SELECT 
                    SUM(oi.quantity * oi.price) as total_item_sales
                 FROM order_items oi
                 JOIN orders o ON oi.order_id = o.id
                 WHERE o.status = 'delivered' ${orderDateFilter}`,
                orderParams
            );
            const total_item_sales_gross = parseFloat(salesData[0].total_item_sales || 0);
            
            // Calculate Delivery Charges
            const [deliveryData] = await req.db.execute(
                `SELECT SUM(delivery_fee) as total_delivery_fees
                 FROM orders o
                 WHERE o.status = 'delivered' ${orderDateFilter}`,
                orderParams
            );
            const total_delivery_fees = parseFloat(deliveryData[0].total_delivery_fees || 0);

            // Calculate Total Discounts
            const [discountData] = await req.db.execute(
                `SELECT 
                    SUM(CASE 
                        WHEN oi.discount_type = 'percent' THEN oi.quantity * oi.price * (oi.discount_value / 100)
                        WHEN oi.discount_type = 'amount' THEN oi.quantity * oi.discount_value
                        ELSE 0 
                    END) as total_discount
                 FROM order_items oi
                 JOIN orders o ON oi.order_id = o.id
                 WHERE o.status = 'delivered' ${orderDateFilter}`,
                orderParams
            );
            const total_item_discount = parseFloat(discountData[0].total_discount || 0);

            // Correct Net Item Sales (Cash from items)
            const total_item_sales_net = total_item_sales_gross - total_item_discount;

            // Calculate Item Profit from historical order item adjustment model only.
            // Do not fallback to live product cost to avoid retroactive profit distortion.
            const [profitData] = await req.db.execute(
                `SELECT 
                    SUM(
                        oi.quantity * (
                            oi.price - (
                                CASE
                                    WHEN oi.discount_type = 'percent' AND oi.discount_value IS NOT NULL
                                        THEN GREATEST(0, ROUND(oi.price - (oi.price * oi.discount_value / 100), 2))
                                    WHEN oi.discount_type = 'amount' AND oi.discount_value IS NOT NULL
                                        THEN GREATEST(0, ROUND(oi.price - oi.discount_value, 2))
                                    ELSE oi.price
                                END
                            )
                        )
                    ) as total_item_profit
                 FROM order_items oi
                 JOIN orders o ON oi.order_id = o.id
                 WHERE o.status = 'delivered' ${orderDateFilter}`,
                orderParams
            );
            const total_item_profit = parseFloat(profitData[0].total_item_profit || 0);

            // Calculate Store Commission (Platform Profit)
            const [commissionData] = await req.db.execute(
                `SELECT 
                    SUM(oi.quantity * oi.price * (COALESCE(s.commission_rate, 0) / 100)) as total_commission
                 FROM order_items oi
                 JOIN orders o ON oi.order_id = o.id
                 JOIN products p ON oi.product_id = p.id
                 JOIN stores s ON COALESCE(oi.store_id, p.store_id) = s.id
                 WHERE o.status = 'delivered' ${orderDateFilter}`,
                orderParams
            );
            const total_store_commission = parseFloat(commissionData[0].total_commission || 0);
            const gross_store_payable = Math.max(0, total_item_sales_net - total_store_commission);

            // Paid settlements should reduce payable liability shown in comprehensive report.
            const settlementDateFilter = period_from && endDate ? 'AND settlement_date BETWEEN ? AND ?' : '';
            const settlementParams = period_from && endDate ? [period_from, endDate] : [];
            const [settledData] = await req.db.execute(
                `SELECT COALESCE(SUM(net_amount), 0) AS total_store_settlement_paid
                 FROM store_settlements
                 WHERE status = 'paid'
                 ${settlementDateFilter}`,
                settlementParams
            );
            const total_store_settlement_paid = parseFloat(settledData[0].total_store_settlement_paid || 0);
            const period_store_payable_flow = gross_store_payable - total_store_settlement_paid;

            // Real current liability (all-time outstanding) from unsettled delivered+paid items.
            // This is the balance figure that should never be confused with period flow.
            const [outstandingData] = await req.db.execute(
                `SELECT COALESCE(SUM(
                    (oi.quantity * oi.price)
                    - (oi.quantity * oi.price * (COALESCE(s.commission_rate, 0) / 100))
                ), 0) AS current_outstanding_store_payable
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN products p ON p.id = oi.product_id
                 JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
                 WHERE o.status = 'delivered'
                   AND o.payment_status = 'paid'
                   AND oi.settlement_id IS NULL
                   AND LOWER(TRIM(COALESCE(s.payment_term, ''))) NOT IN ('cash only', 'cash with discount')
                   AND LOWER(TRIM(COALESCE(p.description, ''))) <> 'created from admin manual order'
                   AND NOT EXISTS (
                       SELECT 1
                       FROM rider_store_payments rsp
                       WHERE rsp.order_id = oi.order_id
                         AND rsp.store_id = COALESCE(oi.store_id, p.store_id)
                   )`
            );
            const current_outstanding_store_payable = Math.max(
                0,
                parseFloat(outstandingData[0].current_outstanding_store_payable || 0)
            );

            const net_flow = total_income - total_expense - total_settlements - total_refunds;

            reportData = {
                type: 'comprehensive_report',
                transactions: details,
                summary: {
                    total_income,
                    total_expense,
                    total_settlements,
                    total_refunds,
                    total_adjustments,
                    net_flow,
                    // Extra metrics for P&L analysis
                    total_delivery_fees,
                    total_item_profit,
                    total_item_sales_gross, // Gross Sales (before discount)
                    total_item_sales_net,   // Net Sales (after discount)
                    total_item_discount,
                    total_store_commission, // The 10% profit from stores
                    estimated_gross_profit: total_delivery_fees + total_store_commission,
                    gross_store_payable,
                    total_store_settlement_paid,
                    period_store_payable_flow,
                    current_outstanding_store_payable
                }
            };
        } else if (report_type === 'store_payable_reconciliation' || report_type === 'unsettled_amounts_report') {
            const hasRange = Boolean(period_from && period_to);
            const periodStart = hasRange ? `${period_from} 00:00:00` : null;
            const periodEnd = hasRange ? `${period_to} 23:59:59` : null;
            const hasStore = Boolean(store_id);
            const payableSql = getStorePayableSqlExpression('s');

            const [stores] = await req.db.execute(
                `SELECT id, name
                 FROM stores
                 ${hasStore ? 'WHERE id = ?' : ''}
                 ORDER BY name ASC`,
                hasStore ? [store_id] : []
            );

            const [generatedRows] = await req.db.execute(
                `SELECT
                    COALESCE(oi.store_id, p.store_id) AS store_id,
                    SUM(${payableSql}) AS period_generated_payable
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN products p ON p.id = oi.product_id
                 JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
                 WHERE o.status = 'delivered'
                   AND o.payment_status = 'paid'
                   AND LOWER(TRIM(COALESCE(s.payment_term, ''))) NOT IN ('cash only', 'cash with discount')
                   AND LOWER(TRIM(COALESCE(p.description, ''))) <> 'created from admin manual order'
                   AND NOT EXISTS (
                       SELECT 1
                       FROM rider_store_payments rsp
                       WHERE rsp.order_id = oi.order_id
                         AND rsp.store_id = COALESCE(oi.store_id, p.store_id)
                   )
                   ${hasRange ? 'AND o.created_at BETWEEN ? AND ?' : ''}
                   ${hasStore ? 'AND s.id = ?' : ''}
                 GROUP BY COALESCE(oi.store_id, p.store_id)`,
                [
                    ...(hasRange ? [periodStart, periodEnd] : []),
                    ...(hasStore ? [store_id] : [])
                ]
            );

            const [paidRows] = await req.db.execute(
                `SELECT
                    ss.store_id,
                    SUM(ss.net_amount) AS period_paid_settlements
                 FROM store_settlements ss
                 WHERE ss.status = 'paid'
                   ${hasRange ? 'AND ss.settlement_date BETWEEN ? AND ?' : ''}
                   ${hasStore ? 'AND ss.store_id = ?' : ''}
                 GROUP BY ss.store_id`,
                [
                    ...(hasRange ? [periodStart, periodEnd] : []),
                    ...(hasStore ? [store_id] : [])
                ]
            );

            const [outstandingRows] = await req.db.execute(
                `SELECT
                    COALESCE(oi.store_id, p.store_id) AS store_id,
                    SUM(${payableSql}) AS current_outstanding
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN products p ON p.id = oi.product_id
                 JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
                 WHERE o.status = 'delivered'
                   AND o.payment_status = 'paid'
                   AND oi.settlement_id IS NULL
                   AND LOWER(TRIM(COALESCE(s.payment_term, ''))) NOT IN ('cash only', 'cash with discount')
                   AND LOWER(TRIM(COALESCE(p.description, ''))) <> 'created from admin manual order'
                   AND NOT EXISTS (
                       SELECT 1
                       FROM rider_store_payments rsp
                       WHERE rsp.order_id = oi.order_id
                         AND rsp.store_id = COALESCE(oi.store_id, p.store_id)
                   )
                   ${hasStore ? 'AND s.id = ?' : ''}
                 GROUP BY COALESCE(oi.store_id, p.store_id)`,
                hasStore ? [store_id] : []
            );

            const [orderRows] = await req.db.execute(
                `SELECT
                    o.id AS order_id,
                    o.order_number,
                    o.created_at AS order_date,
                    COALESCE(oi.store_id, p.store_id) AS store_id,
                    s.name AS store_name,
                    SUM(${payableSql}) AS unsettled_amount
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN products p ON p.id = oi.product_id
                 JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
                 WHERE o.status = 'delivered'
                   AND o.payment_status = 'paid'
                   AND oi.settlement_id IS NULL
                   AND LOWER(TRIM(COALESCE(s.payment_term, ''))) NOT IN ('cash only', 'cash with discount')
                   AND LOWER(TRIM(COALESCE(p.description, ''))) <> 'created from admin manual order'
                   AND NOT EXISTS (
                       SELECT 1
                       FROM rider_store_payments rsp
                       WHERE rsp.order_id = oi.order_id
                         AND rsp.store_id = COALESCE(oi.store_id, p.store_id)
                   )
                   ${hasRange ? 'AND o.created_at BETWEEN ? AND ?' : ''}
                   ${hasStore ? 'AND s.id = ?' : ''}
                 GROUP BY o.id, o.order_number, o.created_at, COALESCE(oi.store_id, p.store_id), s.name
                 ORDER BY o.created_at DESC, o.id DESC`,
                [
                    ...(hasRange ? [periodStart, periodEnd] : []),
                    ...(hasStore ? [store_id] : [])
                ]
            );

            const generatedMap = new Map((generatedRows || []).map(r => [Number(r.store_id), Number(r.period_generated_payable || 0)]));
            const paidMap = new Map((paidRows || []).map(r => [Number(r.store_id), Number(r.period_paid_settlements || 0)]));
            const outstandingMap = new Map((outstandingRows || []).map(r => [Number(r.store_id), Number(r.current_outstanding || 0)]));

            const rows = (stores || []).map(s => {
                const sid = Number(s.id);
                const generated = Number(generatedMap.get(sid) || 0);
                const paid = Number(paidMap.get(sid) || 0);
                const flow = generated - paid;
                const outstanding = Math.max(0, Number(outstandingMap.get(sid) || 0));
                return {
                    store_id: sid,
                    store_name: s.name,
                    period_generated_payable: generated,
                    period_paid_settlements: paid,
                    period_flow: flow,
                    current_outstanding: outstanding
                };
            }).filter(r =>
                r.period_generated_payable !== 0 ||
                r.period_paid_settlements !== 0 ||
                r.current_outstanding !== 0
            );

            const summary = rows.reduce((acc, r) => {
                acc.period_generated_payable += Number(r.period_generated_payable || 0);
                acc.period_paid_settlements += Number(r.period_paid_settlements || 0);
                acc.period_flow += Number(r.period_flow || 0);
                acc.current_outstanding += Number(r.current_outstanding || 0);
                return acc;
            }, {
                period_generated_payable: 0,
                period_paid_settlements: 0,
                period_flow: 0,
                current_outstanding: 0
            });

            total_income = summary.period_generated_payable;
            total_expense = summary.period_paid_settlements;
            total_settlements = 0;
            total_refunds = 0;
            total_adjustments = 0;

            reportData = {
                type: report_type === 'unsettled_amounts_report'
                    ? 'unsettled_amounts_report'
                    : 'store_payable_reconciliation',
                filters: {
                    period_from: period_from || null,
                    period_to: period_to || null,
                    store_id: store_id || null
                },
                rows,
                order_rows: orderRows || [],
                summary
            };
        } else if (report_type === 'store_order_settlement_report') {
            const hasRange = Boolean(period_from && period_to);
            const periodStart = hasRange ? `${period_from} 00:00:00` : null;
            const periodEnd = hasRange ? `${period_to} 23:59:59` : null;
            const hasStore = Boolean(store_id);

            const [rows] = await req.db.execute(
                `SELECT
                    COALESCE(oi.store_id, p.store_id) AS store_id,
                    s.name AS store_name,
                    o.id AS order_id,
                    o.order_number,
                    o.created_at AS order_date,
                    o.payment_method,
                    o.payment_status,
                    ROUND(SUM(oi.quantity * oi.price), 2) AS gross_sales,
                    ROUND(SUM(
                        GREATEST(
                            0,
                            (oi.quantity * oi.price) -
                            (
                                oi.quantity * (
                                    CASE
                                        WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%discount%'
                                             AND COALESCE(s.store_discount_apply_all_products, 0) = 1
                                             AND COALESCE(s.store_discount_percent, 0) > 0
                                            THEN oi.price * (COALESCE(s.store_discount_percent, 0) / 100)
                                        WHEN oi.discount_type = 'percent' AND COALESCE(oi.discount_value, 0) > 0
                                            THEN oi.price * (COALESCE(oi.discount_value, 0) / 100)
                                        WHEN oi.discount_type = 'amount' AND COALESCE(oi.discount_value, 0) > 0
                                            THEN COALESCE(oi.discount_value, 0)
                                        ELSE 0
                                    END
                                )
                            )
                        )
                    ), 2) AS expected_payable,
                    ROUND(SUM(
                        CASE
                            WHEN oi.settlement_id IS NOT NULL AND ss.status = 'paid'
                                THEN GREATEST(
                                    0,
                                    (oi.quantity * oi.price) -
                                    (
                                        oi.quantity * (
                                            CASE
                                                WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%discount%'
                                                     AND COALESCE(s.store_discount_apply_all_products, 0) = 1
                                                     AND COALESCE(s.store_discount_percent, 0) > 0
                                                    THEN oi.price * (COALESCE(s.store_discount_percent, 0) / 100)
                                                WHEN oi.discount_type = 'percent' AND COALESCE(oi.discount_value, 0) > 0
                                                    THEN oi.price * (COALESCE(oi.discount_value, 0) / 100)
                                                WHEN oi.discount_type = 'amount' AND COALESCE(oi.discount_value, 0) > 0
                                                    THEN COALESCE(oi.discount_value, 0)
                                                ELSE 0
                                            END
                                        )
                                    )
                                )
                            ELSE 0
                        END
                    ), 2) AS paid_settlement_amount,
                    ROUND(SUM(
                        CASE
                            WHEN oi.settlement_id IS NULL
                                THEN GREATEST(
                                    0,
                                    (oi.quantity * oi.price) -
                                    (
                                        oi.quantity * (
                                            CASE
                                                WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%discount%'
                                                     AND COALESCE(s.store_discount_apply_all_products, 0) = 1
                                                     AND COALESCE(s.store_discount_percent, 0) > 0
                                                    THEN oi.price * (COALESCE(s.store_discount_percent, 0) / 100)
                                                WHEN oi.discount_type = 'percent' AND COALESCE(oi.discount_value, 0) > 0
                                                    THEN oi.price * (COALESCE(oi.discount_value, 0) / 100)
                                                WHEN oi.discount_type = 'amount' AND COALESCE(oi.discount_value, 0) > 0
                                                    THEN COALESCE(oi.discount_value, 0)
                                                ELSE 0
                                            END
                                        )
                                    )
                                )
                            ELSE 0
                        END
                    ), 2) AS unsettled_amount,
                    GROUP_CONCAT(DISTINCT CASE WHEN oi.settlement_id IS NOT NULL THEN ss.settlement_number END ORDER BY ss.id DESC SEPARATOR ', ') AS settlement_numbers,
                    GROUP_CONCAT(DISTINCT CASE WHEN oi.settlement_id IS NOT NULL THEN ss.status END ORDER BY ss.id DESC SEPARATOR ', ') AS settlement_statuses
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN products p ON p.id = oi.product_id
                 JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
                 LEFT JOIN store_settlements ss ON ss.id = oi.settlement_id
                 WHERE o.status = 'delivered'
                   AND o.payment_status = 'paid'
                   AND LOWER(TRIM(COALESCE(s.payment_term, ''))) NOT IN ('cash only', 'cash with discount')
                   AND LOWER(TRIM(COALESCE(p.description, ''))) <> 'created from admin manual order'
                   AND NOT EXISTS (
                       SELECT 1
                       FROM rider_store_payments rsp
                       WHERE rsp.order_id = oi.order_id
                         AND rsp.store_id = COALESCE(oi.store_id, p.store_id)
                   )
                   ${hasRange ? 'AND o.created_at BETWEEN ? AND ?' : ''}
                   ${hasStore ? 'AND s.id = ?' : ''}
                 GROUP BY COALESCE(oi.store_id, p.store_id), s.name, o.id, o.order_number, o.created_at, o.payment_method, o.payment_status
                 ORDER BY s.name ASC, o.created_at DESC, o.id DESC`,
                [
                    ...(hasRange ? [periodStart, periodEnd] : []),
                    ...(hasStore ? [store_id] : [])
                ]
            );

            const order_rows = (rows || []).map((r) => {
                const expected = Number(r.expected_payable || 0);
                const paid = Number(r.paid_settlement_amount || 0);
                const unsettled = Number(r.unsettled_amount || 0);
                return {
                    ...r,
                    expected_payable: expected,
                    paid_settlement_amount: paid,
                    unsettled_amount: unsettled,
                    discrepancy: Number((expected - paid).toFixed(2))
                };
            });

            const storeMap = new Map();
            order_rows.forEach((r) => {
                const sid = Number(r.store_id || 0);
                if (!storeMap.has(sid)) {
                    storeMap.set(sid, {
                        store_id: sid,
                        store_name: r.store_name || '-',
                        total_orders: 0,
                        gross_sales: 0,
                        expected_payable: 0,
                        paid_settlement_amount: 0,
                        unsettled_amount: 0,
                        discrepancy: 0
                    });
                }
                const srow = storeMap.get(sid);
                srow.total_orders += 1;
                srow.gross_sales += Number(r.gross_sales || 0);
                srow.expected_payable += Number(r.expected_payable || 0);
                srow.paid_settlement_amount += Number(r.paid_settlement_amount || 0);
                srow.unsettled_amount += Number(r.unsettled_amount || 0);
                srow.discrepancy += Number(r.discrepancy || 0);
            });

            const store_rows = Array.from(storeMap.values())
                .map((r) => ({
                    ...r,
                    gross_sales: Number(r.gross_sales.toFixed(2)),
                    expected_payable: Number(r.expected_payable.toFixed(2)),
                    paid_settlement_amount: Number(r.paid_settlement_amount.toFixed(2)),
                    unsettled_amount: Number(r.unsettled_amount.toFixed(2)),
                    discrepancy: Number(r.discrepancy.toFixed(2))
                }))
                .sort((a, b) => a.store_name.localeCompare(b.store_name));

            const summary = store_rows.reduce((acc, r) => {
                acc.total_stores += 1;
                acc.total_orders += Number(r.total_orders || 0);
                acc.gross_sales += Number(r.gross_sales || 0);
                acc.expected_payable += Number(r.expected_payable || 0);
                acc.paid_settlement_amount += Number(r.paid_settlement_amount || 0);
                acc.unsettled_amount += Number(r.unsettled_amount || 0);
                acc.discrepancy += Number(r.discrepancy || 0);
                return acc;
            }, {
                total_stores: 0,
                total_orders: 0,
                gross_sales: 0,
                expected_payable: 0,
                paid_settlement_amount: 0,
                unsettled_amount: 0,
                discrepancy: 0
            });
            Object.keys(summary).forEach((k) => {
                if (k !== 'total_stores' && k !== 'total_orders') {
                    summary[k] = Number(Number(summary[k] || 0).toFixed(2));
                }
            });

            total_income = Number(summary.expected_payable || 0);
            total_expense = Number(summary.paid_settlement_amount || 0);
            reportData = {
                type: 'store_order_settlement_report',
                filters: {
                    period_from: period_from || null,
                    period_to: period_to || null,
                    store_id: store_id || null
                },
                store_rows,
                order_rows,
                summary
            };
        } else if (report_type === 'credit_store_order_reconciliation') {
            const hasRange = Boolean(period_from && period_to);
            const periodStart = hasRange ? `${period_from} 00:00:00` : null;
            const periodEnd = hasRange ? `${period_to} 23:59:59` : null;
            const hasStore = Boolean(store_id);

            const discountSql = `
                CASE
                    WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%discount%'
                         AND COALESCE(s.store_discount_apply_all_products, 0) = 1
                         AND COALESCE(s.store_discount_percent, 0) > 0
                        THEN oi.price * (COALESCE(s.store_discount_percent, 0) / 100)
                    WHEN oi.discount_type = 'percent' AND COALESCE(oi.discount_value, 0) > 0
                        THEN oi.price * (COALESCE(oi.discount_value, 0) / 100)
                    WHEN oi.discount_type = 'amount' AND COALESCE(oi.discount_value, 0) > 0
                        THEN COALESCE(oi.discount_value, 0)
                    ELSE 0
                END`;
            const grossSql = '(oi.quantity * oi.price)';
            const discountAmountSql = `LEAST(${grossSql}, GREATEST(0, oi.quantity * (${discountSql})))`;
            const payableSql = `GREATEST(0, ${grossSql} - (${discountAmountSql}))`;
            const costSql = 'COALESCE(oi.cost_price, psp.cost_price, p.cost_price, oi.price)';
            const storePayableSql = `
                CASE
                    WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%discount%'
                        THEN ${payableSql}
                    ELSE LEAST(${grossSql}, GREATEST(0, oi.quantity * (${costSql})))
                END`;
            const profitSql = `GREATEST(0, ${grossSql} - (${storePayableSql}))`;

            const [rows] = await req.db.execute(
                `SELECT
                    COALESCE(oi.store_id, p.store_id) AS store_id,
                    s.name AS store_name,
                    s.payment_term,
                    o.id AS order_id,
                    o.order_number,
                    o.created_at AS order_date,
                    o.status AS order_status,
                    o.payment_method,
                    o.payment_status,
                    ROUND(SUM(
                        CASE
                            WHEN o.status = 'delivered' AND o.payment_status = 'paid'
                                THEN ${grossSql}
                            ELSE 0
                        END
                    ), 2) AS gross_sales,
                    ROUND(SUM(${profitSql}), 2) AS discount_amount,
                    ROUND(SUM(
                        CASE
                            WHEN o.status = 'delivered' AND o.payment_status = 'paid'
                                THEN ${storePayableSql}
                            ELSE 0
                        END
                    ), 2) AS net_sales,
                    ROUND(SUM(
                        CASE
                            WHEN o.status = 'delivered' AND o.payment_status = 'paid'
                                THEN ${storePayableSql}
                            ELSE 0
                        END
                    ), 2) AS store_payable,
                    ROUND(SUM(
                        CASE
                            WHEN o.status = 'delivered' AND o.payment_status = 'paid'
                                THEN ${profitSql}
                            ELSE 0
                        END
                    ), 2) AS sale_profit,
                    ROUND(SUM(
                        CASE
                            WHEN NOT (o.status = 'delivered' AND o.payment_status = 'paid')
                                THEN ${profitSql}
                            ELSE 0
                        END
                    ), 2) AS cancelled_unpaid_discount,
                    ROUND(SUM(
                        CASE
                            WHEN o.status = 'cancelled'
                                THEN ${grossSql}
                            ELSE 0
                        END
                    ), 2) AS cancelled_sales,
                    ROUND(SUM(
                        CASE
                            WHEN oi.settlement_id IS NOT NULL AND ss.status = 'paid'
                                THEN ${storePayableSql}
                            ELSE 0
                        END
                    ), 2) AS paid_to_store,
                    GROUP_CONCAT(DISTINCT CASE WHEN oi.settlement_id IS NOT NULL THEN ss.settlement_number END ORDER BY ss.id DESC SEPARATOR ', ') AS settlement_numbers,
                    GROUP_CONCAT(DISTINCT CASE WHEN oi.settlement_id IS NOT NULL THEN ss.status END ORDER BY ss.id DESC SEPARATOR ', ') AS settlement_statuses
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN products p ON p.id = oi.product_id
                 JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
                 LEFT JOIN product_size_prices psp ON oi.product_id = psp.product_id
                    AND (
                        (oi.size_id IS NOT NULL AND psp.size_id = oi.size_id)
                        OR
                        (oi.unit_id IS NOT NULL AND psp.unit_id = oi.unit_id)
                    )
                 LEFT JOIN store_settlements ss ON ss.id = oi.settlement_id
                 WHERE LOWER(TRIM(COALESCE(s.payment_term, ''))) IN ('credit', 'credit with discount')
                   AND LOWER(TRIM(COALESCE(p.description, ''))) <> 'created from admin manual order'
                   ${hasRange ? 'AND o.created_at BETWEEN ? AND ?' : ''}
                   ${hasStore ? 'AND s.id = ?' : ''}
                 GROUP BY COALESCE(oi.store_id, p.store_id), s.name, s.payment_term, o.id, o.order_number, o.created_at, o.status, o.payment_method, o.payment_status
                 ORDER BY s.name ASC, o.created_at DESC, o.id DESC`,
                [
                    ...(hasRange ? [periodStart, periodEnd] : []),
                    ...(hasStore ? [store_id] : [])
                ]
            );

            const order_rows = (rows || []).map((r) => {
                const payable = Number(r.store_payable || 0);
                const paid = Number(r.paid_to_store || 0);
                return {
                    ...r,
                    gross_sales: Number(r.gross_sales || 0),
                    discount_amount: Number(r.discount_amount || 0),
                    net_sales: Number(r.net_sales || 0),
                    store_payable: payable,
                    sale_profit: Number(r.sale_profit || 0),
                    cancelled_unpaid_discount: Number(r.cancelled_unpaid_discount || 0),
                    cancelled_sales: Number(r.cancelled_sales || 0),
                    paid_to_store: paid,
                    pending_store_balance: Number((payable - paid).toFixed(2))
                };
            });

            const storeMap = new Map();
            order_rows.forEach((r) => {
                const sid = Number(r.store_id);
                if (!storeMap.has(sid)) {
                    storeMap.set(sid, {
                        store_id: sid,
                        store_name: r.store_name,
                        payment_term: r.payment_term,
                        total_orders: 0,
                        delivered_orders: 0,
                        cancelled_orders: 0,
                        gross_sales: 0,
                        discount_amount: 0,
                        net_sales: 0,
                        store_payable: 0,
                        sale_profit: 0,
                        cancelled_unpaid_discount: 0,
                        paid_to_store: 0,
                        pending_store_balance: 0,
                        cancelled_sales: 0
                    });
                }
                const srow = storeMap.get(sid);
                srow.total_orders += 1;
                if (r.order_status === 'delivered') srow.delivered_orders += 1;
                if (r.order_status === 'cancelled') srow.cancelled_orders += 1;
                srow.gross_sales += Number(r.gross_sales || 0);
                srow.discount_amount += Number(r.discount_amount || 0);
                srow.net_sales += Number(r.net_sales || 0);
                srow.store_payable += Number(r.store_payable || 0);
                srow.sale_profit += Number(r.sale_profit || 0);
                srow.cancelled_unpaid_discount += Number(r.cancelled_unpaid_discount || 0);
                srow.paid_to_store += Number(r.paid_to_store || 0);
                srow.pending_store_balance += Number(r.pending_store_balance || 0);
                srow.cancelled_sales += Number(r.cancelled_sales || 0);
            });

            const store_rows = Array.from(storeMap.values())
                .map((r) => {
                    ['gross_sales', 'discount_amount', 'net_sales', 'store_payable', 'sale_profit', 'cancelled_unpaid_discount', 'paid_to_store', 'pending_store_balance', 'cancelled_sales']
                        .forEach((key) => { r[key] = Number(Number(r[key] || 0).toFixed(2)); });
                    return r;
                })
                .sort((a, b) => a.store_name.localeCompare(b.store_name));

            const summary = store_rows.reduce((acc, r) => {
                acc.total_stores += 1;
                acc.total_orders += Number(r.total_orders || 0);
                acc.delivered_orders += Number(r.delivered_orders || 0);
                acc.cancelled_orders += Number(r.cancelled_orders || 0);
                acc.gross_sales += Number(r.gross_sales || 0);
                acc.discount_amount += Number(r.discount_amount || 0);
                acc.net_sales += Number(r.net_sales || 0);
                acc.store_payable += Number(r.store_payable || 0);
                acc.sale_profit += Number(r.sale_profit || 0);
                acc.cancelled_unpaid_discount += Number(r.cancelled_unpaid_discount || 0);
                acc.paid_to_store += Number(r.paid_to_store || 0);
                acc.pending_store_balance += Number(r.pending_store_balance || 0);
                acc.cancelled_sales += Number(r.cancelled_sales || 0);
                return acc;
            }, {
                total_stores: 0,
                total_orders: 0,
                delivered_orders: 0,
                cancelled_orders: 0,
                gross_sales: 0,
                discount_amount: 0,
                net_sales: 0,
                store_payable: 0,
                sale_profit: 0,
                cancelled_unpaid_discount: 0,
                paid_to_store: 0,
                pending_store_balance: 0,
                cancelled_sales: 0
            });
            Object.keys(summary).forEach((key) => {
                if (!['total_stores', 'total_orders', 'delivered_orders', 'cancelled_orders'].includes(key)) {
                    summary[key] = Number(Number(summary[key] || 0).toFixed(2));
                }
            });
            summary.store_name = store_rows.length === 1 ? store_rows[0].store_name : 'All Credit Stores';

            total_income = Number((Number(summary.store_payable || 0) + Number(summary.sale_profit || 0)).toFixed(2));
            total_expense = Number(summary.store_payable || 0);
            total_settlements = 0;
            reportData = {
                type: 'credit_store_order_reconciliation',
                filters: {
                    period_from: period_from || null,
                    period_to: period_to || null,
                    store_id: store_id || null
                },
                store_rows,
                order_rows,
                summary
            };
        } else if (report_type === 'transaction_summary') {
            const dateFilter = period_from && period_to ? 'AND ft.created_at BETWEEN ? AND ?' : '';
            const params = period_from && period_to ? [period_from, `${period_to} 23:59:59`] : [];

            // Fetch all transactions
            const [transactions] = await req.db.execute(
                `SELECT 
                    ft.*,
                    CASE 
                        WHEN ft.related_entity_type = 'rider' THEN CONCAT(r.first_name, ' ', r.last_name)
                        WHEN ft.related_entity_type = 'store' THEN s.name
                        WHEN ft.related_entity_type = 'employee' OR ft.related_entity_type = 'user' THEN CONCAT(u.first_name, ' ', u.last_name)
                        ELSE NULL 
                    END as entity_name
                 FROM financial_transactions ft
                 LEFT JOIN riders r ON ft.related_entity_type = 'rider' AND ft.related_entity_id = r.id
                 LEFT JOIN stores s ON ft.related_entity_type = 'store' AND ft.related_entity_id = s.id
                 LEFT JOIN users u ON (ft.related_entity_type = 'employee' OR ft.related_entity_type = 'user') AND ft.related_entity_id = u.id
                 WHERE 1=1 ${dateFilter}
                 ORDER BY ft.created_at DESC`,
                params
            );

            // Calculate summaries
            const summary = {
                total_income: 0,
                total_expense: 0,
                total_settlements: 0,
                total_refunds: 0,
                total_adjustments: 0,
                net_cash_flow: 0
            };

            transactions.forEach(t => {
                const amt = parseFloat(t.amount || 0);
                if (t.transaction_type === 'income') summary.total_income += amt;
                else if (t.transaction_type === 'expense') summary.total_expense += amt;
                else if (t.transaction_type === 'settlement') summary.total_settlements += amt;
                else if (t.transaction_type === 'refund') summary.total_refunds += amt;
                else if (t.transaction_type === 'adjustment') summary.total_adjustments += amt;
            });

            summary.net_cash_flow = summary.total_income - summary.total_expense - summary.total_settlements - summary.total_refunds;

            // Set main report totals
            total_income = summary.total_income;
            total_expense = summary.total_expense;
            total_settlements = summary.total_settlements;
            total_refunds = summary.total_refunds;
            total_adjustments = summary.total_adjustments;

            reportData = {
                type: 'transaction_summary',
                transactions,
                summary
            };
        } else {
            reportData = {
                transactions: transactions.map(t => ({ type: t.transaction_type, total: t.total })),
                summary: { 
                    total_income, 
                    total_expense, 
                    total_settlements, 
                    total_refunds,
                    total_adjustments,
                    net_profit: total_income - total_expense - total_settlements - total_refunds
                }
            };
        }

        const net_profit = total_income - total_expense - total_settlements - total_refunds;

        let description = null;
        if (report_type === 'store_financials') {
            if (store_id) {
                const [stores] = await req.db.execute('SELECT name FROM stores WHERE id = ?', [store_id]);
                if (stores.length > 0) {
                    description = `Store Financials - ${stores[0].name}`;
                }
            } else {
                description = 'Store Financials - All Stores';
            }
        } else if (report_type === 'periodic_sales_report') {
            if (store_id) {
                const [stores] = await req.db.execute('SELECT name FROM stores WHERE id = ?', [store_id]);
                if (stores.length > 0) {
                    description = `Periodic Sales Report - ${stores[0].name}`;
                }
            } else {
                description = 'Periodic Sales Report - All Stores';
            }
        } else if (report_type === 'periodic_credit_cash_report') {
            description = 'Periodic Credit Cash Report';
        } else if (report_type === 'periodic_comprehensive_summary_report') {
            if (store_id) {
                const [stores] = await req.db.execute('SELECT name FROM stores WHERE id = ?', [store_id]);
                if (stores.length > 0) {
                    description = `Periodic Comprehensive Summary Report - ${stores[0].name}`;
                }
            } else {
                description = 'Periodic Comprehensive Summary Report - All Stores';
            }
        } else if (report_type === 'periodic_store_payments_balance_report') {
            if (store_id) {
                const [stores] = await req.db.execute('SELECT name FROM stores WHERE id = ?', [store_id]);
                if (stores.length > 0) {
                    description = `Periodic Store Payments & Balance Report - ${stores[0].name}`;
                }
            } else {
                description = 'Periodic Store Payments & Balance Report - All Stores';
            }
        } else if (report_type === 'credit_store_order_reconciliation') {
            if (store_id) {
                const [stores] = await req.db.execute('SELECT name FROM stores WHERE id = ?', [store_id]);
                if (stores.length > 0) {
                    description = `Credit Store Order Reconciliation - ${stores[0].name}`;
                }
            } else {
                description = 'Credit Store Order Reconciliation - All Credit Stores';
            }
        }

        if (req.body.preview) {
            return res.json({
                success: true,
                message: 'Report preview generated',
                report: {
                    report_number,
                    report_type,
                    period_from,
                    period_to,
                    total_income,
                    total_expense,
                    total_commissions: total_settlements,
                    net_profit,
                    data: reportData,
                    created_at: new Date().toISOString(),
                    description
                }
            });
        }

        const [result] = await req.db.execute(
            `INSERT INTO financial_reports 
             (report_number, report_type, period_from, period_to, total_income, total_expense, total_commissions, net_profit, data, generated_by, description)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                report_number, 
                report_type, 
                period_from || null, 
                period_to || null, 
                total_income, 
                total_expense + total_refunds, // Group refunds with expenses for legacy schema compatibility
                total_settlements, // Store settlements in total_commissions column
                net_profit, 
                JSON.stringify(reportData), 
                req.user.id,
                description
            ]
        );

        res.status(201).json({
            success: true,
            message: 'Report generated successfully',
            report: {
                id: result.insertId,
                report_number,
                total_income,
                total_expense,
                total_settlements,
                net_profit
            }
        });
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate report',
            error: error.message
        });
    }
});

// Get pending cash orders for a rider
router.get('/riders/:id/pending-cash-orders', async (req, res) => {
    try {
        await ensureRiderCashSubmissionOrdersTable(req.db);
        await backfillLegacyRiderCashSubmissionLinks(req.db);
        const { id } = req.params;

        const [pendingOrders] = await req.db.execute(
            `SELECT
                o.id,
                o.order_number,
                o.total_amount AS order_total_amount,
                COALESCE(sp.store_paid_amount, 0) AS store_paid_amount,
                GREATEST(COALESCE(o.total_amount, 0) - COALESCE(sp.store_paid_amount, 0), 0) AS total_amount,
                o.created_at
             FROM orders o
             LEFT JOIN (
                SELECT order_id, SUM(amount) AS store_paid_amount
                FROM rider_store_payments
                WHERE rider_id = ?
                GROUP BY order_id
             ) sp ON sp.order_id = o.id
             WHERE o.rider_id = ?
               AND o.status = 'delivered'
               AND LOWER(TRIM(COALESCE(o.payment_method, ''))) = 'cash'
               AND LOWER(TRIM(COALESCE(o.payment_status, ''))) = 'paid'
               AND NOT EXISTS (
                   SELECT 1
                   FROM rider_cash_submission_orders rcso
                   JOIN rider_cash_movements rcm ON rcm.id = rcso.movement_id
                   WHERE rcso.order_id = o.id
                     AND rcm.movement_type IN ('cash_submission', 'cash_collection')
                     AND rcm.status IN ('pending', 'approved', 'completed')
               )
             ORDER BY o.created_at DESC`,
            [id, id]
        );
        const total = pendingOrders.reduce((sum, order) => sum + parseFloat(order.total_amount || 0), 0);

        res.json({ success: true, orders: pendingOrders, total });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/riders/:id/pending-fuel-entries', async (req, res) => {
    try {
        await ensureRiderFuelPaymentEntriesTable(req.db);
        const { id } = req.params;

        const [entries] = await req.db.execute(
            `SELECT fh.id, fh.entry_date, fh.fuel_cost, fh.distance, fh.notes
             FROM riders_fuel_history fh
             WHERE fh.rider_id = ?
               AND COALESCE(fh.fuel_cost, 0) > 0
               AND NOT EXISTS (
                   SELECT 1
                   FROM rider_fuel_payment_entries rfpe
                   JOIN rider_cash_movements rcm ON rcm.id = rfpe.movement_id
                   WHERE rfpe.fuel_history_id = fh.id
                     AND rcm.movement_type = 'fuel_payment'
                     AND rcm.status IN ('pending', 'approved', 'completed')
               )
             ORDER BY fh.entry_date DESC, fh.id DESC`,
            [id]
        );

        const total = entries.reduce((sum, row) => sum + parseFloat(row.fuel_cost || 0), 0);
        res.json({ success: true, entries, total });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/riders/:id/submitted-fuel-entries', async (req, res) => {
    try {
        await ensureRiderFuelPaymentEntriesTable(req.db);
        const { id } = req.params;

        const [rows] = await req.db.execute(
            `SELECT
                rfpe.id,
                rfpe.fuel_history_id,
                rfpe.entry_date,
                rfpe.fuel_cost,
                rcm.movement_number,
                rcm.status
             FROM rider_fuel_payment_entries rfpe
             JOIN rider_cash_movements rcm ON rcm.id = rfpe.movement_id
             WHERE rfpe.rider_id = ?
               AND rcm.movement_type = 'fuel_payment'
               AND rcm.status IN ('pending', 'approved', 'completed')
             ORDER BY rfpe.entry_date DESC, rfpe.id DESC`,
            [id]
        );

        const total = rows.reduce((sum, row) => sum + parseFloat(row.fuel_cost || 0), 0);
        res.json({ success: true, entries: rows, total });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/riders/:id/submitted-cash-orders', async (req, res) => {
    try {
        await ensureRiderCashSubmissionOrdersTable(req.db);
        await backfillLegacyRiderCashSubmissionLinks(req.db);
        const { id } = req.params;
        const [rows] = await req.db.execute(
            `SELECT 
                rcso.order_id AS id,
                COALESCE(o.order_number, rcso.order_number) AS order_number,
                COALESCE(o.total_amount, rcso.order_amount, 0) AS order_total_amount,
                COALESCE(sp.store_paid_amount, 0) AS store_paid_amount,
                COALESCE(rcso.order_amount, 0) AS total_amount,
                COALESCE(o.created_at, rcso.created_at) AS created_at,
                rcm.movement_number,
                rcm.movement_type,
                rcm.status AS submission_status,
                rcm.movement_date AS submitted_at
             FROM rider_cash_submission_orders rcso
             JOIN rider_cash_movements rcm ON rcm.id = rcso.movement_id
             LEFT JOIN orders o ON o.id = rcso.order_id
             LEFT JOIN (
                SELECT order_id, rider_id, SUM(amount) AS store_paid_amount
                FROM rider_store_payments
                GROUP BY order_id, rider_id
             ) sp ON sp.order_id = rcso.order_id AND sp.rider_id = rcso.rider_id
             WHERE rcso.rider_id = ?
               AND rcm.movement_type IN ('cash_submission', 'cash_collection')
               AND rcm.status IN ('pending', 'approved', 'completed')
             ORDER BY rcm.movement_date DESC, rcso.id DESC`,
            [id]
        );
        const total = rows.reduce((sum, r) => sum + parseFloat(r.total_amount || 0), 0);
        res.json({ success: true, orders: rows, total });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/reports/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await req.db.execute('DELETE FROM financial_reports WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Report not found'
            });
        }

        res.json({
            success: true,
            message: 'Report deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting report:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete report',
            error: error.message
        });
    }
});

// ===== CUSTOM REPORTS =====

// Rider Report
router.get('/reports/rider/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { start_date, end_date } = req.query;
        let dateFilter = '';
        let params = [id];

        if (start_date && end_date) {
            dateFilter = ' AND created_at BETWEEN ? AND ?';
            params.push(start_date, end_date);
        }

        // i. Number of Orders (Delivered, Cancelled, Pending)
        const [orderStats] = await req.db.execute(
            `SELECT status, COUNT(*) as count FROM orders WHERE rider_id = ? ${dateFilter} GROUP BY status`,
            params
        );

        // ii. Reviews and Ratings (Placeholder as table doesn't exist yet, but checking stores for pattern)
        // For now returning default
        const ratings = { average: 0, total_reviews: 0 };

        // iv. Payment in Credit
        // Usually means orders paid via Card/Wallet where Rider gets credited in their wallet
        const [creditPayments] = await req.db.execute(
            `SELECT SUM(amount) as total FROM wallet_transactions wt
             JOIN wallets w ON wt.wallet_id = w.id
             WHERE w.rider_id = ? AND wt.type = 'credit' AND wt.reference_type = 'order' ${dateFilter.replace('created_at', 'wt.created_at')}`,
            params
        );

        // v. Kilometers Travelled
        const [kmStats] = await req.db.execute(
            `SELECT SUM(distance) as total_km FROM riders_fuel_history WHERE rider_id = ? ${dateFilter.replace('created_at', 'entry_date')}`,
            params
        );

        res.json({
            success: true,
            report: {
                rider_id: id,
                orders: orderStats,
                ratings,
                payment_in_credit: parseFloat(creditPayments[0]?.total || 0),
                km_travelled: parseFloat(kmStats[0]?.total_km || 0)
            }
        });
    } catch (error) {
        console.error('Error fetching rider report:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch rider report', error: error.message });
    }
});

// Store Report
router.get('/reports/store/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { start_date, end_date } = req.query;
        let dateFilter = '';
        let params = [id];

        if (start_date && end_date) {
            dateFilter = ' AND created_at BETWEEN ? AND ?';
            params.push(start_date, end_date);
        }

        // i. Number of Purchases (Product-wise)
        const [productStats] = await req.db.execute(
            `SELECT p.name, SUM(oi.quantity) as total_quantity, SUM(oi.price * oi.quantity) as total_amount
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             JOIN orders o ON oi.order_id = o.id
             WHERE oi.store_id = ? ${dateFilter.replace('created_at', 'o.created_at')}
             GROUP BY p.id, p.name`,
            params
        );

        // ii. Total Purchases after Less Discount
        const [totalStats] = await req.db.execute(
            `SELECT SUM(total_amount) as total_gross FROM orders WHERE store_id = ? AND status = 'delivered' ${dateFilter}`,
            params
        );

        res.json({
            success: true,
            report: {
                store_id: id,
                product_wise_purchases: productStats,
                total_purchases: parseFloat(totalStats[0]?.total_gross || 0)
            }
        });
    } catch (error) {
        console.error('Error fetching store report:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch store report', error: error.message });
    }
});

// ===== JOURNAL VOUCHERS (JNV) =====

router.get('/journal-vouchers', async (req, res) => {
    try {
        const [vouchers] = await req.db.execute(
            `SELECT j.*, u.first_name as prepared_by_name FROM journal_vouchers j
             LEFT JOIN users u ON j.prepared_by = u.id ORDER BY j.voucher_date DESC`
        );
        res.json({ success: true, vouchers });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/journal-vouchers/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [vouchers] = await req.db.execute(
            `SELECT j.*, u.first_name as prepared_by_name, ab.first_name as approved_by_name 
             FROM journal_vouchers j
             LEFT JOIN users u ON j.prepared_by = u.id 
             LEFT JOIN users ab ON j.approved_by = ab.id
             WHERE j.id = ?`,
            [id]
        );

        if (vouchers.length === 0) {
            return res.status(404).json({ success: false, message: 'Journal Voucher not found' });
        }

        const [entries] = await req.db.execute(
            `SELECT * FROM journal_voucher_entries WHERE jnv_id = ?`,
            [id]
        );

        res.json({ success: true, voucher: vouchers[0], entries });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/journal-vouchers', [
    body('voucher_date').isDate(),
    body('total_amount').isFloat({ min: 0 }),
    body('entries').isArray().isLength({ min: 2 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

        const { voucher_date, description, reference_number, total_amount, entries } = req.body;

        // Double-entry check in whole paisa: every line is a positive debit or
        // credit, and total debits must equal total credits.
        let debitPaisa = 0;
        let creditPaisa = 0;
        for (const entry of entries) {
            const paisa = Math.round(Number(entry?.amount) * 100);
            if (!Number.isFinite(paisa) || paisa <= 0 || !['debit', 'credit'].includes(entry?.entry_type)) {
                return res.status(400).json({ success: false, message: 'Each entry needs a positive amount and an entry_type of debit or credit' });
            }
            if (entry.entry_type === 'debit') debitPaisa += paisa;
            else creditPaisa += paisa;
        }
        if (debitPaisa !== creditPaisa) {
            return res.status(400).json({
                success: false,
                message: `Journal voucher is not balanced: debits ${(debitPaisa / 100).toFixed(2)} vs credits ${(creditPaisa / 100).toFixed(2)}`
            });
        }
        if (Math.round(Number(total_amount) * 100) !== debitPaisa) {
            return res.status(400).json({ success: false, message: 'Total amount must equal the total of the debit entries' });
        }

        const voucher_number = generateVoucherNumber('JNV');

        const [result] = await req.db.execute(
            `INSERT INTO journal_vouchers (voucher_number, voucher_date, description, reference_number, total_amount, prepared_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [voucher_number, voucher_date, description, reference_number, total_amount, req.user.id]
        );

        const jnv_id = result.insertId;

        for (const entry of entries) {
            await req.db.execute(
                `INSERT INTO journal_voucher_entries (jnv_id, account_name, entity_type, entity_id, entry_type, amount, description)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [jnv_id, entry.account_name, entry.entity_type, entry.entity_id, entry.entry_type, entry.amount, entry.description]
            );
        }

        res.status(201).json({ success: true, message: 'Journal Voucher created successfully', voucher_number });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/journal-vouchers/:id/post', async (req, res) => {
    try {
        const { id } = req.params;
        const [vouchers] = await req.db.execute('SELECT * FROM journal_vouchers WHERE id = ?', [id]);
        
        if (vouchers.length === 0) return res.status(404).json({ success: false, message: 'Voucher not found' });
        const voucher = vouchers[0];

        if (voucher.status !== 'draft') {
            return res.status(400).json({ success: false, message: `Cannot post voucher with status: ${voucher.status}` });
        }

        // Maker-checker: the preparer cannot post their own journal voucher
        if (voucher.prepared_by && Number(voucher.prepared_by) === Number(req.user.id) && makerCheckerApplies(req.user)) {
            return res.status(403).json({ success: false, message: 'The person who prepared this journal voucher cannot post it' });
        }

        const [entries] = await req.db.execute('SELECT * FROM journal_voucher_entries WHERE jnv_id = ?', [id]);
        if (entries.length === 0) return res.status(400).json({ success: false, message: 'Voucher has no entries' });

        // Update voucher status (conditional, so concurrent requests cannot post it twice)
        const [postResult] = await req.db.execute(
            'UPDATE journal_vouchers SET status = \'posted\', approved_by = ?, posted_at = NOW() WHERE id = ? AND status = \'draft\'',
            [req.user.id, id]
        );
        if (Number(postResult?.affectedRows || 0) === 0) {
            return res.status(409).json({ success: false, message: 'Voucher was already posted' });
        }

        // Post each entry to the master ledger
        for (const entry of entries) {
            await recordFinancialTransaction(req.db, {
                transaction_type: 'adjustment',
                category: 'journal_entry',
                description: entry.description || voucher.description || `JNV Posting: ${entry.account_name}`,
                amount: entry.amount,
                payment_method: 'bank_transfer', // JNVs are usually non-cash/bank
                related_entity_type: entry.entity_type,
                related_entity_id: entry.entity_id,
                reference_type: 'journal_voucher_entry',
                reference_id: entry.id,
                created_by: req.user.id,
                notes: `Voucher: ${voucher.voucher_number} | Type: ${entry.entry_type.toUpperCase()}`
            });

            // Update entity wallets if applicable
            if (entry.entity_type === 'rider' && entry.entity_id) {
                await recordRiderWalletTransaction(
                    req.db,
                    entry.entity_id,
                    entry.entry_type, // 'debit' or 'credit'
                    entry.amount,
                    `JNV: ${voucher.voucher_number} - ${entry.description || entry.account_name}`,
                    entry.id,
                    'journal_voucher'
                );
            } else if (entry.entity_type === 'store' && entry.entity_id) {
                await recordStoreWalletTransaction(
                    req.db,
                    entry.entity_id,
                    entry.entry_type,
                    entry.amount,
                    `JNV: ${voucher.voucher_number} - ${entry.description || entry.account_name}`,
                    entry.id,
                    'journal_voucher'
                );
            } else if ((entry.entity_type === 'employee' || entry.entity_type === 'user') && entry.entity_id) {
                await recordUserWalletTransaction(
                    req.db,
                    entry.entity_id,
                    entry.entry_type,
                    entry.amount,
                    `JNV: ${voucher.voucher_number} - ${entry.description || entry.account_name}`,
                    entry.id,
                    'journal_voucher'
                );
            }
        }

        res.json({ success: true, message: 'Journal Voucher posted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/journal-vouchers/:id/cancel', async (req, res) => {
    try {
        const { id } = req.params;
        const [vouchers] = await req.db.execute('SELECT status FROM journal_vouchers WHERE id = ?', [id]);
        
        if (vouchers.length === 0) return res.status(404).json({ success: false, message: 'Voucher not found' });
        if (vouchers[0].status === 'posted') {
            return res.status(400).json({ success: false, message: 'Cannot cancel a posted voucher' });
        }

        await req.db.execute('UPDATE journal_vouchers SET status = \'cancelled\' WHERE id = ?', [id]);
        res.json({ success: true, message: 'Journal Voucher cancelled successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Platform Summary Report
router.get('/reports/platform-summary', async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        let dateFilter = '';
        let params = [];

        if (start_date && end_date) {
            dateFilter = ' AND created_at BETWEEN ? AND ?';
            const endOfDay = /^\d{4}-\d{2}-\d{2}$/.test(String(end_date)) ? `${end_date} 23:59:59` : end_date;
            params.push(start_date, endOfDay);
        }

        // Cancelled orders are not sales
        const [orders] = await req.db.execute(
            `SELECT COUNT(*) as total_orders, SUM(total_amount) as gross_sales, SUM(delivery_fee) as total_delivery_fees 
             FROM orders WHERE status <> 'cancelled' ${dateFilter}`,
            params
        );

        const [stores] = await req.db.execute('SELECT COUNT(*) as active_stores FROM stores WHERE is_active = true');
        const [riders] = await req.db.execute('SELECT COUNT(*) as active_riders FROM riders WHERE is_active = true');
        const [users] = await req.db.execute('SELECT COUNT(*) as total_customers FROM users WHERE user_type = \'customer\'');

        res.json({
            success: true,
            report: {
                ...orders[0],
                active_stores: stores[0].active_stores,
                active_riders: riders[0].active_riders,
                total_customers: users[0].total_customers
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Top Selling Products Report
router.get('/reports/top-products', async (req, res) => {
    try {
        const { limit = 10 } = req.query;
        const [products] = await req.db.execute(
            `SELECT p.name, s.name as store_name, SUM(oi.quantity) as total_sold, SUM(oi.price * oi.quantity) as total_revenue
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id AND o.status <> 'cancelled'
             JOIN products p ON oi.product_id = p.id
             JOIN stores s ON p.store_id = s.id
             GROUP BY p.id, p.name, s.name
             ORDER BY total_sold DESC
             LIMIT ?`,
            [parseInt(limit)]
        );
        res.json({ success: true, products });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Rider Performance Ranking
router.get('/reports/rider-performance', async (req, res) => {
    try {
        const [riders] = await req.db.execute(
            `SELECT r.id, r.first_name, r.last_name, 
                    COUNT(o.id) as total_deliveries, 
                    SUM(o.total_amount) as total_cash_handled,
                    (SELECT SUM(distance) FROM riders_fuel_history WHERE rider_id = r.id) as total_km
             FROM riders r
             LEFT JOIN orders o ON r.id = o.rider_id AND o.status = 'delivered'
             GROUP BY r.id, r.first_name, r.last_name
             ORDER BY total_deliveries DESC`
        );
        res.json({ success: true, riders });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Store Performance Ranking
router.get('/reports/store-performance', async (req, res) => {
    try {
        const [stores] = await req.db.execute(
            `SELECT s.id, s.name, s.rating, 
                    COUNT(o.id) as total_orders, 
                    SUM(o.total_amount) as total_sales
             FROM stores s
             LEFT JOIN orders o ON s.id = o.store_id AND o.status = 'delivered'
             GROUP BY s.id, s.name, s.rating
             ORDER BY total_sales DESC`
        );
        res.json({ success: true, stores });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Cash Flow Analysis (Rider Collections vs Submissions)
router.get('/reports/cash-flow', async (req, res) => {
    try {
        const [collections] = await req.db.execute(
            `SELECT SUM(amount) as total FROM rider_cash_movements WHERE movement_type = 'cash_collection' AND status IN ('approved', 'completed')`
        );
        const [submissions] = await req.db.execute(
            `SELECT SUM(amount) as total FROM rider_cash_movements WHERE movement_type = 'cash_submission' AND status IN ('approved', 'completed')`
        );
        const [vouchers] = await req.db.execute(
            `SELECT SUM(amount) as total FROM cash_receipt_vouchers WHERE status = 'received'`
        );

        res.json({
            success: true,
            summary: {
                total_rider_collections: parseFloat(collections[0]?.total || 0),
                total_rider_submissions: parseFloat(submissions[0]?.total || 0),
                total_other_receipts: parseFloat(vouchers[0]?.total || 0),
                pending_with_riders: parseFloat(collections[0]?.total || 0) - parseFloat(submissions[0]?.total || 0)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Category Wise Sales Report
router.get('/reports/category-sales', async (req, res) => {
    try {
        const [categories] = await req.db.execute(
            `SELECT c.name, COUNT(oi.id) as items_sold, SUM(oi.price * oi.quantity) as revenue
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id AND o.status <> 'cancelled'
             JOIN products p ON oi.product_id = p.id
             JOIN categories c ON p.category_id = c.id
             GROUP BY c.id, c.name
             ORDER BY revenue DESC`
        );
        res.json({ success: true, categories });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Detailed Rider Report
router.get('/reports/riders-detailed', async (req, res) => {
    try {
        const { start_date, end_date, rider_id } = req.query;
        let dateFilter = '';
        let riderFilter = '';
        let params = [];

        if (start_date && end_date) {
            dateFilter = ' AND o.created_at BETWEEN ? AND ?';
            params.push(`${start_date} 00:00:00`, `${end_date} 23:59:59`);
        }

        if (rider_id && rider_id !== 'all') {
            riderFilter = ' WHERE r.id = ?';
            params.push(rider_id);
        }

        const [riders] = await req.db.execute(
            `SELECT 
                r.id, 
                r.first_name, 
                r.last_name, 
                r.email, 
                r.phone,
                COUNT(o.id) as total_assigned,
                COUNT(CASE WHEN o.status = 'delivered' THEN 1 END) as total_delivered,
                COUNT(CASE WHEN o.status = 'cancelled' THEN 1 END) as total_cancelled,
                SUM(CASE WHEN o.status = 'delivered' THEN o.delivery_fee ELSE 0 END) as total_fees,
                COALESCE((SELECT SUM(amount) FROM rider_cash_movements WHERE rider_id = r.id AND movement_type = 'cash_collection' AND status IN ('approved', 'completed')), 0) as cash_collection,
                COALESCE((SELECT SUM(amount) FROM rider_cash_movements WHERE rider_id = r.id AND movement_type = 'cash_submission' AND status IN ('approved', 'completed')), 0) as cash_submission
            FROM riders r
            LEFT JOIN orders o ON r.id = o.rider_id ${dateFilter}
            ${riderFilter}
            GROUP BY r.id, r.first_name, r.last_name, r.email, r.phone
            ORDER BY total_delivered DESC`,
            params
        );
        res.json({ success: true, riders });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Comprehensive Rider Activity & Cash Movement Statement (Advance to Closing Submission)
router.get('/reports/rider-statement', async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        let rider_id = req.query.rider_id;

        // If rider_id is missing or 'all', pick the first available active rider or fail gracefully
        if (!rider_id || rider_id === 'all') {
            const [firstRider] = await req.db.execute('SELECT id FROM riders ORDER BY id ASC LIMIT 1');
            if (firstRider && firstRider.length > 0) {
                rider_id = firstRider[0].id;
            } else {
                return res.status(400).json({ success: false, message: 'No riders found to generate statement' });
            }
        }

        // 1. Fetch Rider Profile & Wallet Balance
        const [riderRows] = await req.db.execute(
            `SELECT r.*, COALESCE(w.balance, 0) as wallet_balance
             FROM riders r
             LEFT JOIN wallets w ON w.rider_id = r.id
             WHERE r.id = ?`,
            [rider_id]
        );

        if (!riderRows.length) {
            return res.status(404).json({ success: false, message: 'Rider not found' });
        }
        const rider = riderRows[0];
        const riderName = (rider.full_name || `${rider.first_name || ''} ${rider.last_name || ''}`).trim();
        const riderStatus = rider.status || (rider.is_active ? 'active' : 'inactive');

        // 2. Build Date Filters
        let movementDateFilter = '';
        let orderDateFilter = '';
        let fuelDateFilter = '';
        const mParams = [rider_id];
        const oParams = [rider_id];
        const fParams = [rider_id];

        if (start_date && end_date) {
            movementDateFilter = ' AND rcm.movement_date BETWEEN ? AND ?';
            mParams.push(start_date, end_date);

            orderDateFilter = ' AND DATE(o.created_at) BETWEEN ? AND ?';
            oParams.push(start_date, end_date);

            fuelDateFilter = ' AND rfh.entry_date BETWEEN ? AND ?';
            fParams.push(start_date, end_date);
        } else if (start_date) {
            movementDateFilter = ' AND rcm.movement_date >= ?';
            mParams.push(start_date);

            orderDateFilter = ' AND DATE(o.created_at) >= ?';
            oParams.push(start_date);

            fuelDateFilter = ' AND rfh.entry_date >= ?';
            fParams.push(start_date);
        } else if (end_date) {
            movementDateFilter = ' AND rcm.movement_date <= ?';
            mParams.push(end_date);

            orderDateFilter = ' AND DATE(o.created_at) <= ?';
            oParams.push(end_date);

            fuelDateFilter = ' AND rfh.entry_date <= ?';
            fParams.push(end_date);
        }

        // 3. Cash Movements (Advance, Collections, Store Payments, Fuel, Submission, Settlement, Adjustments)
        const [movements] = await req.db.execute(
            `SELECT rcm.id, rcm.movement_number, rcm.movement_date, rcm.movement_type,
                    rcm.amount, rcm.description, rcm.reference_type, rcm.reference_id,
                    rcm.status, rcm.notes, rcm.created_at,
                    CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as recorded_by_name
             FROM rider_cash_movements rcm
             LEFT JOIN users u ON u.id = rcm.recorded_by
             WHERE rcm.rider_id = ? ${movementDateFilter}
             ORDER BY rcm.movement_date ASC, rcm.id ASC`,
            mParams
        );

        // 4. Order Activities
        const [orders] = await req.db.execute(
            `SELECT o.id, o.order_number, o.created_at, o.updated_at, o.status,
                    o.payment_method, o.payment_status, o.total_amount, o.delivery_fee,
                    CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as customer_name,
                    u.phone as customer_phone,
                    COALESCE(
                        (SELECT GROUP_CONCAT(DISTINCT s.name SEPARATOR ', ')
                         FROM order_items oi
                         JOIN stores s ON s.id = oi.store_id
                         WHERE oi.order_id = o.id),
                        (SELECT s2.name FROM stores s2 WHERE s2.id = o.store_id),
                        'Store'
                    ) as store_names,
                    COALESCE((
                        SELECT SUM(rsp.amount)
                        FROM rider_store_payments rsp
                        WHERE rsp.order_id = o.id AND rsp.rider_id = o.rider_id
                    ), 0) as paid_to_stores
             FROM orders o
             LEFT JOIN users u ON u.id = o.user_id
             WHERE o.rider_id = ? ${orderDateFilter}
             ORDER BY o.created_at ASC`,
            oParams
        );

        // 5. Fuel History (if any)
        let fuelHistory = [];
        try {
            const [fuelRows] = await req.db.execute(
                `SELECT rfh.*
                 FROM riders_fuel_history rfh
                 WHERE rfh.rider_id = ? ${fuelDateFilter}
                 ORDER BY rfh.entry_date ASC`,
                fParams
            );
            fuelHistory = fuelRows || [];
        } catch (_) {
            fuelHistory = [];
        }

        // 6. Day Closing Record (if closed)
        let dayClosings = [];
        try {
            const [closingRows] = await req.db.execute(
                `SELECT *
                 FROM rider_day_closings
                 WHERE rider_id = ? ${start_date && end_date ? 'AND closed_date BETWEEN ? AND ?' : ''}
                 ORDER BY closed_date DESC`,
                [rider_id, ...(start_date && end_date ? [start_date, end_date] : [])]
            );
            dayClosings = closingRows || [];
        } catch (_) {
            dayClosings = [];
        }

        // 7. Calculate Shift Financial Metrics & Running Balances
        let advance_taken = 0;
        let cash_collected = 0;
        let settlement_received = 0;
        let store_payments = 0;
        let fuel_payments = 0;
        let cash_submitted = 0;
        let other_adjustments = 0;

        let runningBalance = 0;
        const movementAudit = (movements || []).map((m, idx) => {
            const amt = parseFloat(m.amount || 0);
            let isInflow = false;
            let isOutflow = false;

            if (m.movement_type === 'advance') {
                advance_taken += amt;
                isInflow = true;
            } else if (m.movement_type === 'cash_collection') {
                cash_collected += amt;
                isInflow = true;
            } else if (m.movement_type === 'settlement') {
                settlement_received += amt;
                isInflow = true;
            } else if (m.movement_type === 'store_payment') {
                store_payments += amt;
                isOutflow = true;
            } else if (m.movement_type === 'fuel_payment') {
                fuel_payments += amt;
                isOutflow = true;
            } else if (m.movement_type === 'cash_submission') {
                cash_submitted += amt;
                isOutflow = true;
            } else if (m.movement_type === 'adjustment') {
                other_adjustments += amt;
                if (amt >= 0) isInflow = true;
                else isOutflow = true;
            }

            if (isInflow) runningBalance += Math.abs(amt);
            if (isOutflow) runningBalance -= Math.abs(amt);

            return {
                ...m,
                index: idx + 1,
                amount: amt,
                is_inflow: isInflow,
                is_outflow: isOutflow,
                running_balance: runningBalance
            };
        });

        // Compute order delivery statistics & customer COD cash
        let cod_cash_orders_total = 0;
        let delivery_fees_earned = 0;
        let delivered_count = 0;
        let cancelled_count = 0;
        let other_count = 0;

        (orders || []).forEach(o => {
            delivery_fees_earned += parseFloat(o.delivery_fee || 0);
            const isCash = String(o.payment_method || '').toLowerCase().trim() === 'cash';
            const orderAmt = parseFloat(o.total_amount || 0);
            o.cash_collected = (o.status === 'delivered' && isCash) ? orderAmt : 0;

            if (o.status === 'delivered') {
                delivered_count++;
                if (isCash) cod_cash_orders_total += orderAmt;
            } else if (o.status === 'cancelled') {
                cancelled_count++;
            } else {
                other_count++;
            }
        });

        // If no cash_collection movements are logged, use COD orders delivered as effective collections
        const effectiveCashCollection = cash_collected > 0 ? cash_collected : cod_cash_orders_total;
        const total_inflow = advance_taken + effectiveCashCollection + settlement_received;
        const total_disbursements = store_payments + fuel_payments + Math.max(0, other_adjustments);
        const expected_closing_cash = Math.max(0, total_inflow - total_disbursements);
        const cash_variance = cash_submitted - expected_closing_cash;
        const pending_cash_in_hand = Math.max(0, expected_closing_cash - cash_submitted);

        res.json({
            success: true,
            statement: {
                rider: {
                    id: rider.id,
                    name: riderName,
                    email: rider.email || '',
                    phone: rider.phone || '',
                    vehicle_type: rider.vehicle_type || 'Motorcycle',
                    license_number: rider.license_number || 'N/A',
                    id_card_num: rider.id_card_num || 'N/A',
                    status: riderStatus,
                    wallet_balance: parseFloat(rider.wallet_balance || 0)
                },
                period: {
                    start_date: start_date || null,
                    end_date: end_date || null,
                    label: start_date && end_date
                        ? `${start_date} to ${end_date}`
                        : (start_date ? `From ${start_date}` : (end_date ? `Until ${end_date}` : 'All Dates'))
                },
                summary: {
                    advance_taken,
                    cash_collected: effectiveCashCollection,
                    settlement_received,
                    total_inflow,
                    store_payments,
                    fuel_payments,
                    total_disbursements,
                    expected_closing_cash,
                    cash_submitted,
                    cash_variance,
                    pending_cash_in_hand,
                    is_balanced: Math.abs(cash_variance) < 0.01,
                    // Operational stats
                    total_orders: (orders || []).length,
                    delivered_count,
                    cancelled_count,
                    other_count,
                    delivery_fees_earned
                },
                movements: movementAudit,
                orders,
                fuelHistory,
                dayClosings,
                generated_at: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error generating rider statement:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Detailed Store Report
router.get('/reports/stores-detailed', async (req, res) => {
    try {
        const { start_date, end_date, store_id } = req.query;
        let dateFilter = '';
        let storeFilter = '';
        let params = [];

        if (start_date && end_date) {
            dateFilter = ' AND o.created_at BETWEEN ? AND ?';
            params.push(`${start_date} 00:00:00`, `${end_date} 23:59:59`);
        }

        if (store_id && store_id !== 'all') {
            storeFilter = ' WHERE s.id = ?';
            params.push(store_id);
        }

        const reportParams = [];
        if (start_date && end_date) {
            // earn subquery date window
            reportParams.push(`${start_date} 00:00:00`, `${end_date} 23:59:59`);
            // paid subquery date window
            reportParams.push(`${start_date} 00:00:00`, `${end_date} 23:59:59`);
        }
        if (store_id && store_id !== 'all') {
            reportParams.push(store_id);
        }
        const payableSql = getStorePayableSqlExpression('s2');

        const [stores] = await req.db.execute(
            `SELECT 
                s.id, 
                s.name, 
                s.email, 
                s.phone,
                s.payment_term,
                s.payment_grace_days,
                s.payment_grace_start_date,
                CASE
                    WHEN s.payment_grace_start_date IS NOT NULL
                         AND s.payment_grace_days IS NOT NULL
                         AND s.payment_grace_days > 0
                        THEN DATE_ADD(s.payment_grace_start_date, INTERVAL s.payment_grace_days DAY)
                    ELSE NULL
                END AS grace_due_date,
                CASE
                    WHEN s.payment_grace_start_date IS NOT NULL
                         AND s.payment_grace_days IS NOT NULL
                         AND s.payment_grace_days > 0
                        THEN DATEDIFF(DATE_ADD(s.payment_grace_start_date, INTERVAL s.payment_grace_days DAY), CURDATE())
                    ELSE NULL
                END AS grace_days_left,
                COALESCE(earn.total_orders, 0) AS total_orders,
                COALESCE(earn.total_earnings, 0) AS total_earnings,
                COALESCE(earn.total_payable, 0) AS total_payable,
                COALESCE(paid.total_paid, 0) AS total_paid,
                CASE
                    WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) IN ('cash only', 'cash with discount')
                        THEN 0
                    ELSE GREATEST(0, COALESCE(earn.total_payable, 0) - COALESCE(paid.total_paid, 0))
                END AS pending_settlement
            FROM stores s
            LEFT JOIN (
                SELECT
                    COALESCE(oi.store_id, p.store_id) AS store_id,
                    COUNT(DISTINCT o.id) AS total_orders,
                    SUM(oi.price * oi.quantity) AS total_earnings,
                    SUM(${payableSql}) AS total_payable
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                JOIN products p ON oi.product_id = p.id
                JOIN stores s2 ON s2.id = COALESCE(oi.store_id, p.store_id)
                WHERE o.status = 'delivered'
                AND o.payment_status = 'paid'
                ${start_date && end_date ? 'AND o.created_at BETWEEN ? AND ?' : ''}
                GROUP BY COALESCE(oi.store_id, p.store_id)
            ) earn ON earn.store_id = s.id
            LEFT JOIN (
                SELECT store_id, SUM(net_amount) AS total_paid
                FROM store_settlements
                WHERE status = 'paid'
                ${start_date && end_date ? 'AND settlement_date BETWEEN ? AND ?' : ''}
                GROUP BY store_id
            ) paid ON paid.store_id = s.id
            ${storeFilter}
            ORDER BY COALESCE(earn.total_earnings, 0) DESC`,
            reportParams
        );

        const balanceStart = start_date && end_date ? `${start_date} 00:00:00` : null;
        const balanceEnd = start_date && end_date ? `${end_date} 23:59:59` : null;
        // Balances come from the store accounts (utils/storeAccount.js): every payment
        // to the store counts (settlements, rider pickup payments, vouchers) and an
        // overpaid store shows store_credit. total_paid = payments in the period.
        const { accounts: storeAccounts } = await storeAccount.loadStoreAccounts(req.db, {
            storeId: store_id && store_id !== 'all' ? Number(store_id) : null
        });
        const periodFrom = isoDate(start_date) && isoDate(end_date) ? start_date : null;
        const periodTo = isoDate(start_date) && isoDate(end_date) ? end_date : null;
        for (const storeRow of stores) {
            const account = storeAccounts.get(Number(storeRow.id));
            const position = account ? storeAccount.accountPosition(account) : null;
            const periodFigures = account
                ? storeAccount.accountPeriod(account, { from: periodFrom, to: periodTo, orders: position.orders })
                : null;
            const closing = periodFigures ? storeAccount.fromCents(periodFigures.closing_c) : 0;
            storeRow.total_paid = periodFigures ? storeAccount.fromCents(periodFigures.total_paid_c) : 0;
            storeRow.store_balance = closing;
            storeRow.store_credit = Math.max(0, -closing);

            const paymentTerm = String(storeRow.payment_term || '').toLowerCase().trim();
            if (paymentTerm === 'cash only' || paymentTerm === 'cash with discount') {
                storeRow.current_settlement_balance = 0;
                storeRow.pending_settlement = 0;
                continue;
            }

            const settlementBalance = await calculateStoreSettlementBalance(
                req.db,
                storeRow.id,
                balanceStart,
                balanceEnd,
                null,
                { creditCents: position ? position.credit_c : 0 }
            );
            const accountingPending = Math.max(0, closing);
            storeRow.current_settlement_balance = Number(settlementBalance.payableRemaining || 0);
            storeRow.accounting_pending_balance = accountingPending;
            storeRow.pending_settlement = accountingPending;
        }

        let storeDetails = null;
        if (store_id && store_id !== 'all') {
            const detailParams = [];
            if (start_date && end_date) {
                detailParams.push(`${start_date} 00:00:00`, `${end_date} 23:59:59`);
            }
            detailParams.push(store_id);

            const [itemOrders] = await req.db.execute(
                `SELECT
                    o.id,
                    o.order_number,
                    o.created_at AS order_date,
                    o.payment_method,
                    o.payment_status,
                    CASE WHEN o.payment_status = 'paid' THEN o.updated_at ELSE NULL END AS payment_date,
                    SUM(oi.price * oi.quantity) AS total_earnings,
                    SUM(${payableSql}) AS total_payable
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                JOIN products p ON oi.product_id = p.id
                JOIN stores s2 ON s2.id = COALESCE(oi.store_id, p.store_id)
                WHERE o.status = 'delivered'
                AND o.payment_status = 'paid'
                ${start_date && end_date ? 'AND o.created_at BETWEEN ? AND ?' : ''}
                AND s2.id = ?
                GROUP BY o.id, o.order_number, o.created_at, o.updated_at, o.payment_method, o.payment_status, o.parent_order_number
                ORDER BY COALESCE(NULLIF(o.parent_order_number, ''), o.order_number) DESC, o.created_at DESC`,
                detailParams
            );

            const paymentParams = [];
            if (start_date && end_date) {
                paymentParams.push(`${start_date} 00:00:00`, `${end_date} 23:59:59`);
            }
            paymentParams.push(store_id);

            const [payments] = await req.db.execute(
                `SELECT
                    ss.id,
                    ss.settlement_number,
                    ss.settlement_date,
                    ss.paid_at,
                    ss.payment_method,
                    ss.status,
                    ss.net_amount
                FROM store_settlements ss
                WHERE ss.status = 'paid'
                ${start_date && end_date ? 'AND ss.settlement_date BETWEEN ? AND ?' : ''}
                AND ss.store_id = ?
                ORDER BY COALESCE(ss.paid_at, ss.settlement_date) DESC, ss.id DESC`,
                paymentParams
            );

            storeDetails = {
                store: stores[0] || null,
                delivered_orders: itemOrders,
                payments
            };
        }

        res.json({ success: true, stores, store_details: storeDetails });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Helper function to get or create store wallet
async function getOrCreateStoreWallet(db, storeId) {
    const [wallets] = await db.execute(
        `SELECT id, balance, total_credited, total_spent FROM wallets WHERE store_id = ?`,
        [storeId]
    );

    if (!wallets.length) {
        // Create new wallet for store
        await db.execute(
            'INSERT INTO wallets (store_id, user_type, balance) VALUES (?, ?, ?)',
            [storeId, 'store', 0]
        );
        
        const [newWallet] = await db.execute(
            'SELECT id, balance, total_credited, total_spent FROM wallets WHERE store_id = ?',
            [storeId]
        );
        return newWallet[0];
    }
    return wallets[0];
}

// Helper function to record store wallet transaction
async function recordStoreWalletTransaction(db, storeId, type, amount, description, referenceId, referenceType) {
    const wallet = await getOrCreateStoreWallet(db, storeId);
    // Relative update: concurrent postings cannot overwrite each other
    const newBalance = await applyWalletDelta(db, wallet.id, type, amount);

    // Record wallet transaction
    await db.execute(
        `INSERT INTO wallet_transactions 
         (wallet_id, type, amount, description, reference_type, reference_id, balance_after) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [wallet.id, type, amount, description, referenceType, referenceId, newBalance]
    );

    return { walletId: wallet.id, newBalance };
}

// Helper function to get or create user wallet (for employees/admin)
async function getOrCreateUserWallet(db, userId) {
    const [wallets] = await db.execute(
        `SELECT id, balance, total_credited, total_spent FROM wallets WHERE user_id = ?`,
        [userId]
    );

    if (!wallets.length) {
        // Get user type from users table
        const [users] = await db.execute('SELECT user_type FROM users WHERE id = ?', [userId]);
        const userType = users.length > 0 ? users[0].user_type : 'customer';

        // Create new wallet for user
        await db.execute(
            'INSERT INTO wallets (user_id, user_type, balance) VALUES (?, ?, ?)',
            [userId, userType, 0]
        );
        
        const [newWallet] = await db.execute(
            'SELECT id, balance, total_credited, total_spent FROM wallets WHERE user_id = ?',
            [userId]
        );
        return newWallet[0];
    }
    return wallets[0];
}

// Helper function to record user wallet transaction
async function recordUserWalletTransaction(db, userId, type, amount, description, referenceId, referenceType) {
    const wallet = await getOrCreateUserWallet(db, userId);
    // Relative update: concurrent postings cannot overwrite each other
    const newBalance = await applyWalletDelta(db, wallet.id, type, amount);

    // Record wallet transaction
    await db.execute(
        `INSERT INTO wallet_transactions 
         (wallet_id, type, amount, description, reference_type, reference_id, balance_after) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [wallet.id, type, amount, description, referenceType, referenceId, newBalance]
    );

    return { walletId: wallet.id, newBalance };
}

router.post('/banks', [
    body('name').trim().notEmpty(),
    body('account_number').optional().trim(),
    body('bank_code').optional().trim(),
    body('branch_name').optional().trim(),
    body('account_title').optional().trim()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { name, account_number, bank_code, branch_name, account_title } = req.body;
        const [result] = await req.db.execute(
            'INSERT INTO banks (name, account_number, bank_code, branch_name, account_title) VALUES (?, ?, ?, ?, ?)',
            [name, account_number || null, bank_code || null, branch_name || null, account_title || null]
        );

        res.status(201).json({ success: true, message: 'Bank added successfully', id: result.insertId });
    } catch (error) {
        console.error('Error adding bank:', error);
        res.status(500).json({ success: false, message: 'Failed to add bank' });
    }
});

// Detailed Credit Store Ledger & Order-Wise History Endpoints (Ascending by Store Name)
router.get('/reports/credit-stores-history', async (req, res) => {
    try {
        const payableSql = getStorePayableSqlExpression('s2');

        const [stores] = await req.db.execute(
            `SELECT 
                s.id AS store_id,
                s.name AS store_name,
                s.email,
                s.phone,
                s.address,
                s.payment_term,
                s.is_active,
                COALESCE(orders_data.total_orders, 0) AS total_orders,
                COALESCE(orders_data.delivered_orders, 0) AS delivered_orders,
                COALESCE(orders_data.gross_sales, 0) AS gross_sales,
                COALESCE(orders_data.total_payable, 0) AS total_payable,
                COALESCE(paid_data.total_paid, 0) AS total_paid,
                GREATEST(0, COALESCE(orders_data.total_payable, 0) - COALESCE(paid_data.total_paid, 0)) AS pending_balance,
                last_settlement.last_settlement_date,
                last_settlement.last_settlement_number,
                last_settlement.last_settlement_status
            FROM stores s
            LEFT JOIN (
                SELECT
                    COALESCE(oi.store_id, p.store_id) AS store_id,
                    COUNT(DISTINCT o.id) AS total_orders,
                    COUNT(DISTINCT CASE WHEN o.status = 'delivered' THEN o.id END) AS delivered_orders,
                    ROUND(SUM(CASE WHEN o.status = 'delivered' THEN oi.price * oi.quantity ELSE 0 END), 2) AS gross_sales,
                    ROUND(SUM(CASE WHEN o.status = 'delivered' THEN ${payableSql} ELSE 0 END), 2) AS total_payable
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                JOIN products p ON oi.product_id = p.id
                JOIN stores s2 ON s2.id = COALESCE(oi.store_id, p.store_id)
                GROUP BY COALESCE(oi.store_id, p.store_id)
            ) orders_data ON orders_data.store_id = s.id
            LEFT JOIN (
                SELECT 
                    store_id, 
                    ROUND(SUM(net_amount), 2) AS total_paid
                FROM store_settlements
                WHERE status = 'paid'
                GROUP BY store_id
            ) paid_data ON paid_data.store_id = s.id
            LEFT JOIN (
                SELECT 
                    ss.store_id,
                    ss.settlement_date AS last_settlement_date,
                    ss.settlement_number AS last_settlement_number,
                    ss.status AS last_settlement_status
                FROM store_settlements ss
                INNER JOIN (
                    SELECT store_id, MAX(id) AS max_id
                    FROM store_settlements
                    GROUP BY store_id
                ) latest ON ss.id = latest.max_id
            ) last_settlement ON last_settlement.store_id = s.id
            WHERE LOWER(TRIM(COALESCE(s.payment_term, ''))) NOT IN ('cash only', 'cash with discount')
               OR LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%credit%'
            ORDER BY s.name ASC`
        );

        // Calculate summary
        const summary = {
            total_stores: stores.length,
            total_delivered_orders: 0,
            total_gross_sales: 0,
            total_payable: 0,
            total_paid: 0,
            total_pending_balance: 0,
            total_store_credit: 0,
            stores_with_balance: 0,
            stores_with_credit: 0
        };

        // Paid and balance come from the store accounts (utils/storeAccount.js):
        // every payment to the store counts, and overpayment shows as store credit.
        const { accounts } = await storeAccount.loadStoreAccounts(req.db);
        const formattedStores = stores.map((s) => {
            const account = accounts.get(Number(s.store_id));
            const position = account ? storeAccount.accountPosition(account) : null;
            const payable = Number(Number(s.total_payable || 0).toFixed(2));
            const paid = position ? storeAccount.fromCents(position.paid_c) : Number(Number(s.total_paid || 0).toFixed(2));
            const balance = position ? storeAccount.fromCents(position.balance_c) : Number((payable - paid).toFixed(2));
            const pendingBalance = Math.max(0, balance);
            const storeCredit = Math.max(0, -balance);
            summary.total_store_credit += storeCredit;
            if (storeCredit > 0.01) summary.stores_with_credit += 1;
            const gross = Number(Number(s.gross_sales || 0).toFixed(2));
            const ordersCount = parseInt(s.delivered_orders || s.total_orders || 0, 10);

            summary.total_delivered_orders += ordersCount;
            summary.total_gross_sales += gross;
            summary.total_payable += payable;
            summary.total_paid += paid;
            summary.total_pending_balance += pendingBalance;
            if (pendingBalance > 0.01) summary.stores_with_balance += 1;

            return {
                store_id: s.store_id,
                store_name: s.store_name,
                email: s.email || '-',
                phone: s.phone || '-',
                address: s.address || '-',
                payment_term: s.payment_term || 'Credit',
                is_active: Boolean(s.is_active),
                total_orders: parseInt(s.total_orders || 0, 10),
                delivered_orders: ordersCount,
                gross_sales: gross,
                total_payable: payable,
                total_paid: paid,
                pending_balance: pendingBalance,
                balance,
                store_credit: storeCredit,
                unsettled_amount: position ? storeAccount.fromCents(position.unsettled_c) : pendingBalance,
                covered_by_credit: position ? storeAccount.fromCents(position.covered_c) : 0,
                last_settlement_date: s.last_settlement_date || null,
                last_settlement_number: s.last_settlement_number || null,
                last_settlement_status: s.last_settlement_status || null
            };
        });

        // Round summary numbers
        summary.total_gross_sales = Number(summary.total_gross_sales.toFixed(2));
        summary.total_payable = Number(summary.total_payable.toFixed(2));
        summary.total_paid = Number(summary.total_paid.toFixed(2));
        summary.total_pending_balance = Number(summary.total_pending_balance.toFixed(2));
        summary.total_store_credit = Number(summary.total_store_credit.toFixed(2));

        res.json({
            success: true,
            summary,
            stores: formattedStores
        });
    } catch (error) {
        console.error('Error in /reports/credit-stores-history:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/reports/credit-stores-history/:storeId', async (req, res) => {
    try {
        const { storeId } = req.params;
        const payableSql = getStorePayableSqlExpression('s');

        // 1. Fetch store info
        const [storeRows] = await req.db.execute(
            `SELECT id, name, email, phone, address, payment_term, is_active, 
                    store_discount_percent, store_discount_apply_all_products
             FROM stores WHERE id = ?`,
            [storeId]
        );

        if (!storeRows.length) {
            return res.status(404).json({ success: false, message: 'Store not found' });
        }
        const store = storeRows[0];

        // 2. Fetch order items and orders
        const [orderRows] = await req.db.execute(
            `SELECT 
                o.id AS order_id,
                o.order_number,
                o.created_at AS order_date,
                o.status AS order_status,
                o.payment_method AS customer_payment_method,
                o.payment_status AS customer_payment_status,
                CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) AS customer_name,
                u.phone AS customer_phone,
                o.delivery_address,
                oi.id AS order_item_id,
                oi.quantity,
                oi.price AS unit_price,
                oi.cost_price,
                oi.settlement_id,
                p.name AS product_name,
                (oi.quantity * oi.price) AS item_gross,
                ${payableSql} AS item_payable,
                ss.settlement_number,
                ss.settlement_date,
                ss.paid_at AS settlement_paid_at,
                ss.payment_method AS settlement_payment_method,
                ss.net_amount AS settlement_net_amount,
                ss.notes AS settlement_notes,
                ss.status AS settlement_status,
                CONCAT(COALESCE(pb.first_name, ''), ' ', COALESCE(pb.last_name, '')) AS paid_by_name
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             JOIN products p ON p.id = oi.product_id
             JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
             LEFT JOIN users u ON u.id = o.user_id
             LEFT JOIN store_settlements ss ON ss.id = oi.settlement_id
             LEFT JOIN users pb ON pb.id = ss.paid_by
             WHERE COALESCE(oi.store_id, p.store_id) = ?
               AND o.status = 'delivered'
             ORDER BY o.created_at DESC, o.id DESC, oi.id ASC`,
            [storeId]
        );

        // Group by order
        const ordersMap = new Map();
        for (const row of orderRows) {
            const oid = row.order_id;
            if (!ordersMap.has(oid)) {
                ordersMap.set(oid, {
                    order_id: row.order_id,
                    order_number: row.order_number,
                    order_date: row.order_date,
                    order_status: row.order_status,
                    customer_payment_method: row.customer_payment_method,
                    customer_payment_status: row.customer_payment_status,
                    customer_name: (row.customer_name || '').trim() || 'Customer',
                    customer_phone: row.customer_phone || '-',
                    delivery_address: row.delivery_address || '-',
                    items: [],
                    gross_amount: 0,
                    amount_to_pay: 0,
                    commission_or_discount: 0,
                    is_paid: false,
                    settlement_status: null,
                    settlement_id: null,
                    paid_details: null
                });
            }

            const order = ordersMap.get(oid);
            const itemGross = Number(row.item_gross || 0);
            const itemPayable = Number(row.item_payable || 0);

            order.gross_amount += itemGross;
            order.amount_to_pay += itemPayable;
            order.items.push({
                item_id: row.order_item_id,
                product_name: row.product_name,
                quantity: row.quantity,
                unit_price: Number(row.unit_price || 0),
                item_gross: itemGross,
                item_payable: itemPayable,
                settlement_id: row.settlement_id
            });

            // Settlement check
            if (row.settlement_id) {
                order.settlement_id = row.settlement_id;
                order.settlement_status = row.settlement_status;
                if (row.settlement_status === 'paid') {
                    order.is_paid = true;
                    order.paid_details = {
                        settlement_id: row.settlement_id,
                        settlement_number: row.settlement_number || `SS-${row.settlement_id}`,
                        settlement_date: row.settlement_date,
                        paid_at: row.settlement_paid_at || row.settlement_date,
                        payment_method: row.settlement_payment_method || 'Bank Transfer',
                        paid_amount: Number(row.settlement_net_amount || 0),
                        notes: row.settlement_notes || '-',
                        paid_by: (row.paid_by_name || '').trim() || 'Finance Admin'
                    };
                }
            }
        }

        const ordersList = Array.from(ordersMap.values()).map(o => {
            o.gross_amount = Number(o.gross_amount.toFixed(2));
            o.amount_to_pay = Number(o.amount_to_pay.toFixed(2));
            o.commission_or_discount = Number(Math.max(0, o.gross_amount - o.amount_to_pay).toFixed(2));
            o.items_summary = o.items.map(i => `${i.product_name} (x${i.quantity})`).join(', ');
            return o;
        });

        // 3. Fetch all settlement vouchers for this store
        const [settlements] = await req.db.execute(
            `SELECT ss.*, 
                    CONCAT(COALESCE(ab.first_name, ''), ' ', COALESCE(ab.last_name, '')) AS approved_by_name,
                    CONCAT(COALESCE(pb.first_name, ''), ' ', COALESCE(pb.last_name, '')) AS paid_by_name
             FROM store_settlements ss
             LEFT JOIN users ab ON ab.id = ss.approved_by
             LEFT JOIN users pb ON pb.id = ss.paid_by
             WHERE ss.store_id = ?
             ORDER BY ss.settlement_date DESC, ss.id DESC`,
            [storeId]
        );

        // Store summary from the store account (utils/storeAccount.js): every payment
        // to the store counts, and unsettled orders covered by the store's credit
        // (e.g. a lump-sum payment not linked to orders) are marked as covered.
        const { position } = await storeAccount.getStoreAccount(req.db, storeId);
        const coverByOrder = new Map();
        for (const line of position.open_lines) {
            const c = coverByOrder.get(line.line.order_id) || { covered: 0, due: 0 };
            c.covered += line.covered_c;
            c.due += line.due_c;
            coverByOrder.set(line.line.order_id, c);
        }
        for (const order of ordersList) {
            const c = coverByOrder.get(Number(order.order_id));
            order.covered_by_credit = c ? storeAccount.fromCents(c.covered) : 0;
            order.due_amount = c ? storeAccount.fromCents(c.due) : 0;
            if (!order.is_paid && c && c.due === 0 && c.covered > 0) order.settlement_status = order.settlement_status || 'covered_by_credit';
        }
        const totalPayable = ordersList.reduce((sum, o) => sum + o.amount_to_pay, 0);
        const totalPaid = storeAccount.fromCents(position.paid_c);
        const balance = storeAccount.fromCents(position.balance_c);
        const pendingBalance = Math.max(0, balance);

        res.json({
            success: true,
            store: {
                ...store,
                email: store.email || '-',
                phone: store.phone || '-',
                address: store.address || '-',
                payment_term: store.payment_term || 'Credit'
            },
            summary: {
                total_orders: ordersList.length,
                paid_orders: ordersList.filter(o => o.is_paid).length,
                unpaid_orders: ordersList.filter(o => !o.is_paid && !(o.due_amount === 0 && o.covered_by_credit > 0)).length,
                covered_orders: ordersList.filter(o => !o.is_paid && o.due_amount === 0 && o.covered_by_credit > 0).length,
                gross_sales: Number(ordersList.reduce((sum, o) => sum + o.gross_amount, 0).toFixed(2)),
                total_payable: Number(totalPayable.toFixed(2)),
                total_paid: Number(totalPaid.toFixed(2)),
                pending_balance: Number(pendingBalance.toFixed(2)),
                balance,
                store_credit: Math.max(0, -balance),
                unsettled_amount: storeAccount.fromCents(position.unsettled_c),
                covered_by_credit: storeAccount.fromCents(position.covered_c)
            },
            orders: ordersList,
            settlements
        });
    } catch (error) {
        console.error('Error in /reports/credit-stores-history/:storeId:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===== GENERAL LEDGER (double-entry, see services/ledger.js) =====

const isoDate = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null);

function glRoute(handler) {
    return async (req, res) => {
        try {
            await ledger.syncLedgerIfStale(req.db);
            res.json({ success: true, data: await handler(req) });
        } catch (error) {
            console.error(`Error in GL ${req.path}:`, error);
            res.status(500).json({ success: false, message: 'Failed to load general ledger' });
        }
    };
}

router.get('/gl/accounts', glRoute(async () => ledger.ACCOUNTS.map(([code, name, type]) => ({ code, name, type }))));

router.get('/gl/trial-balance', glRoute((req) =>
    ledger.trialBalance(req.db, { from: isoDate(req.query.from), to: isoDate(req.query.to) })));

router.get('/gl/profit-loss', glRoute((req) =>
    ledger.profitAndLoss(req.db, { from: isoDate(req.query.from), to: isoDate(req.query.to) })));

router.get('/gl/balance-sheet', glRoute((req) =>
    ledger.balanceSheet(req.db, { to: isoDate(req.query.to) })));

router.get('/gl/account/:code', glRoute((req) =>
    ledger.accountStatement(req.db, String(req.params.code), {
        entityType: req.query.entity_type ? String(req.query.entity_type) : null,
        entityId: req.query.entity_id != null ? String(req.query.entity_id) : null,
        from: isoDate(req.query.from),
        to: isoDate(req.query.to),
        limit: req.query.limit,
    })));

router.get('/gl/entity-balances/:code', glRoute((req) =>
    ledger.entityBalances(req.db, String(req.params.code), { to: isoDate(req.query.to) })));

router.get('/gl/reconciliation', glRoute((req) => ledger.reconciliation(req.db)));

// ===== STORE PAYMENTS & BALANCES (see utils/storeAccount.js) =====
// Balance = store payable of delivered order lines - every payment to the store.
// It equals -(GL account 2000 for the store); scripts/store-payments/check-store-balances.js
// proves it. Read-only.

const rsAmount = (cents) => storeAccount.fromCents(cents);

function storePaymentsDateRange(query) {
    const from = isoDate(query.from);
    const to = isoDate(query.to);
    if (from && to && from > to) return { error: 'From date must be on or before To date' };
    return { from, to };
}

function storePaymentsRow(account, { from, to, today }) {
    const position = storeAccount.accountPosition(account, { today });
    const period = storeAccount.accountPeriod(account, { from, to, orders: position.orders });
    const issues = storeAccount.accountIssues(account, position);
    const closing = period.closing_c;
    return {
        row: {
            store_id: account.store_id,
            name: account.name,
            exists: account.exists,
            is_active: account.is_active,
            payment_term: account.payment_term,
            pickup_paid: account.pickup_paid,
            discount_percent: account.discount_percent,
            grace_days: account.grace_days,
            delivered_orders: period.delivered_orders,
            gross_sales: rsAmount(period.gross_c),
            commission: rsAmount(period.commission_c),
            credit_given: rsAmount(period.credit_given_c),
            paid_cash: rsAmount(period.paid.cash || 0),
            paid_bank: rsAmount(period.paid.bank || 0),
            paid_cheque: rsAmount(period.paid.cheque || 0),
            paid_pickup: rsAmount(period.paid.pickup || 0),
            paid_vouchers: rsAmount(period.paid.voucher || 0),
            paid_adjustments: rsAmount(period.paid.adjustment || 0),
            total_paid: rsAmount(period.total_paid_c),
            opening_balance: rsAmount(period.opening_c),
            closing_balance: rsAmount(closing),
            balance_status: closing > 0 ? 'owed_to_store' : closing < 0 ? 'store_credit' : 'settled',
            current_balance: rsAmount(position.balance_c),
            store_credit_available: rsAmount(position.credit_left_c),
            covered_by_credit: rsAmount(position.covered_c),
            unsettled_orders: position.unsettled_orders,
            unsettled_amount: rsAmount(position.unsettled_c),
            oldest_unpaid: position.oldest_unpaid,
            days_outstanding: position.days_outstanding,
            overdue: position.overdue,
            aging: {
                d0_7: rsAmount(position.aging.d0_7),
                d8_15: rsAmount(position.aging.d8_15),
                d16_30: rsAmount(position.aging.d16_30),
                d30_plus: rsAmount(position.aging.d30_plus)
            },
            open_settlements: position.open_settlements,
            open_settlements_amount: rsAmount(position.open_settlements_c),
            last_payment_date: period.last_payment ? period.last_payment.date : null,
            last_payment_amount: period.last_payment ? rsAmount(period.last_payment.amount_c) : null,
            last_payment_ref: period.last_payment ? period.last_payment.ref : null,
            issue_count: (issues.store_credit_c > 0 ? 1 : 0) + issues.unlinked_payments.filter((u) => !u.on_account).length +
                issues.net_mismatches.length + issues.double_payments.length
        },
        position,
        issues
    };
}

function storePaymentsIssuesOut(account, issues) {
    const base = { store_id: account.store_id, store_name: account.name, payment_term: account.payment_term };
    return {
        credit: issues.store_credit_c > 0 ? [{ ...base, store_credit: rsAmount(issues.store_credit_c) }] : [],
        unlinked: issues.unlinked_payments.map((u) => ({
            ...base, settlement_id: u.settlement_id, settlement_number: u.settlement_number, date: u.date,
            amount: rsAmount(u.net_c), on_account: u.on_account, payment_method: u.method
        })),
        mismatch: issues.net_mismatches.map((m) => ({
            ...base, settlement_id: m.settlement_id, settlement_number: m.settlement_number, status: m.status, date: m.date,
            total_orders_amount: rsAmount(m.total_c), commissions: rsAmount(m.commissions_c), deductions: rsAmount(m.deductions_c),
            credit_applied: rsAmount(m.credit_applied_c), net_amount: rsAmount(m.net_c), expected_net: rsAmount(m.expected_c),
            difference: rsAmount(m.difference_c)
        })),
        double: issues.double_payments.map((d) => ({
            ...base, settlement_id: d.settlement_id, settlement_number: d.settlement_number, settlement_status: d.settlement_status,
            settlement_date: d.settlement_date, double_paid: rsAmount(d.double_paid_c), items_from: d.items_from, items_to: d.items_to,
            lump_payments: d.lump_payments.map((l) => ({ ref: l.ref, amount: rsAmount(l.amount_c) }))
        }))
    };
}

router.get('/reports/store-payments', async (req, res) => {
    try {
        const range = storePaymentsDateRange(req.query);
        if (range.error) return res.status(400).json({ success: false, message: range.error });
        const { from, to } = range;
        const storeId = req.query.store_id && req.query.store_id !== 'all' ? Number(req.query.store_id) : null;
        if (storeId !== null && (!Number.isInteger(storeId) || storeId <= 0)) {
            return res.status(400).json({ success: false, message: 'Invalid store' });
        }
        const term = String(req.query.payment_term || '').trim().toLowerCase();
        const onlyBalance = ['1', 'true', 'yes'].includes(String(req.query.only_balance || '').toLowerCase());
        const search = String(req.query.search || '').trim().toLowerCase().slice(0, 100);
        const today = storeAccount.todayYmd();

        const { accounts, raw } = await storeAccount.loadStoreAccounts(req.db, { storeId });
        const stores = [];
        const flags = { stores_with_credit: [], unlinked_payments: [], net_mismatches: [], double_payments: [] };
        for (const account of accounts.values()) {
            if (!account.exists && !account.items.length && !account.payments.length) continue;
            if (term && term !== 'all' && String(account.payment_term || '').trim().toLowerCase() !== term) continue;
            if (search && !String(account.name || '').toLowerCase().includes(search)) continue;
            const { row, issues } = storePaymentsRow(account, { from, to, today });
            if (onlyBalance && Math.abs(row.closing_balance) < 0.005) continue;
            stores.push(row);
            const out = storePaymentsIssuesOut(account, issues);
            flags.stores_with_credit.push(...out.credit);
            flags.unlinked_payments.push(...out.unlinked);
            flags.net_mismatches.push(...out.mismatch);
            flags.double_payments.push(...out.double);
        }
        stores.sort((a, b) => Math.abs(b.closing_balance) - Math.abs(a.closing_balance) || String(a.name).localeCompare(String(b.name)));
        flags.stores_with_credit.sort((a, b) => b.store_credit - a.store_credit);
        flags.double_payments.sort((a, b) => b.double_paid - a.double_paid);

        const sumKeys = ['delivered_orders', 'gross_sales', 'commission', 'credit_given', 'paid_cash', 'paid_bank', 'paid_cheque',
            'paid_pickup', 'paid_vouchers', 'paid_adjustments', 'total_paid', 'opening_balance', 'closing_balance',
            'unsettled_orders', 'unsettled_amount', 'covered_by_credit'];
        const totals = {};
        for (const key of sumKeys) {
            const cents = stores.reduce((s, r) => s + Math.round(Number(r[key] || 0) * 100), 0);
            totals[key] = ['delivered_orders', 'unsettled_orders'].includes(key) ? Math.round(cents / 100) : rsAmount(cents);
        }
        totals.aging = {};
        for (const key of ['d0_7', 'd8_15', 'd16_30', 'd30_plus']) {
            totals.aging[key] = rsAmount(stores.reduce((s, r) => s + Math.round(r.aging[key] * 100), 0));
        }
        totals.owed_to_stores = rsAmount(stores.reduce((s, r) => s + Math.max(0, Math.round(r.closing_balance * 100)), 0));
        totals.store_credit = rsAmount(stores.reduce((s, r) => s + Math.max(0, -Math.round(r.closing_balance * 100)), 0));
        totals.overdue_stores = stores.filter((r) => r.overdue).length;

        // Store payments that the GL cannot assign to a store (e.g. CPV-40)
        let unallocated = 0;
        if (!storeId) {
            const [vouchers] = await req.db.execute(
                `SELECT voucher_number, payee_type, payee_id, payee_name, purpose, amount
                 FROM cash_payment_vouchers WHERE status IN ('approved', 'paid')`
            );
            for (const v of vouchers) {
                if (v.payee_type === 'store' && v.payee_id) continue;
                if (/store purchase/i.test(`${v.payee_name || ''} ${v.purpose || ''}`)) unallocated += storeAccount.toCents(v.amount);
            }
        }

        res.json({
            success: true,
            from, to, today,
            stores,
            totals,
            flags,
            notes: {
                unallocated_store_payments: rsAmount(unallocated),
                unidentified_pickup_payments: rsAmount((raw.unidentifiedPickupPayments || []).reduce((s, p) => s + p.amount_c, 0))
            }
        });
    } catch (error) {
        console.error('Error in /reports/store-payments:', error);
        res.status(500).json({ success: false, message: 'Failed to load store payments report' });
    }
});

router.get('/reports/store-payments/:storeId/statement', async (req, res) => {
    try {
        const storeId = Number(req.params.storeId);
        if (!Number.isInteger(storeId) || storeId <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid store' });
        }
        const range = storePaymentsDateRange(req.query);
        if (range.error) return res.status(400).json({ success: false, message: range.error });
        const { from, to } = range;
        const today = storeAccount.todayYmd();

        const { accounts } = await storeAccount.loadStoreAccounts(req.db, { storeId });
        const account = accounts.get(storeId);
        if (!account || (!account.exists && !account.items.length && !account.payments.length)) {
            return res.status(404).json({ success: false, message: 'Store not found' });
        }
        const { row, position, issues } = storePaymentsRow(account, { from, to, today });
        const statement = storeAccount.accountStatement(account, { from, to });

        // Open (unsettled) order lines per order, with the part covered by store credit
        const openByOrder = new Map();
        for (const line of position.open_lines) {
            const key = line.line.order_id;
            if (!openByOrder.has(key)) {
                openByOrder.set(key, { order_id: key, order_number: line.line.order_number, date: line.line.date, lines: 0, payable_c: 0, covered_c: 0, due_c: 0 });
            }
            const o = openByOrder.get(key);
            o.lines += 1;
            o.payable_c += line.payable_c;
            o.covered_c += line.covered_c;
            o.due_c += line.due_c;
        }
        const openOrders = [...openByOrder.values()].map((o) => ({
            order_id: o.order_id, order_number: o.order_number, date: o.date, lines: o.lines,
            payable: rsAmount(o.payable_c), covered_by_credit: rsAmount(o.covered_c), due: rsAmount(o.due_c),
            days: storeAccount.daysBetween(o.date, today),
            status: o.due_c === 0 ? 'covered' : (o.covered_c > 0 ? 'partly_covered' : 'due')
        }));

        res.json({
            success: true,
            from, to, today,
            store: row,
            statement: {
                opening_balance: rsAmount(statement.opening_c),
                closing_balance: rsAmount(statement.closing_c),
                total_credit_given: rsAmount(statement.total_credit_given_c),
                total_paid: rsAmount(statement.total_paid_c),
                entries: statement.entries.map((e) => ({
                    date: e.date,
                    type: e.type,
                    label: e.label,
                    ref: e.ref,
                    order_id: e.order_id || null,
                    settlement_id: e.settlement_id || null,
                    payment_method: e.method || null,
                    linked_items: e.linked_items,
                    lines: e.lines || null,
                    gross: e.gross_c != null ? rsAmount(e.gross_c) : null,
                    credit_given: rsAmount(e.credit_given_c),
                    paid: rsAmount(e.paid_c),
                    balance: rsAmount(e.balance_c)
                }))
            },
            position: {
                total_payable: rsAmount(position.payable_c),
                total_paid: rsAmount(position.paid_c),
                balance: rsAmount(position.balance_c),
                settled_payable: rsAmount(position.settled_payable_c),
                credit_before_open_orders: rsAmount(position.credit_c),
                open_payable: rsAmount(position.open_payable_c),
                covered_by_credit: rsAmount(position.covered_c),
                credit_left: rsAmount(position.credit_left_c),
                unsettled_amount: rsAmount(position.unsettled_c)
            },
            open_orders: openOrders,
            settlements: account.settlements.map((s) => ({
                id: s.id, settlement_number: s.number, status: s.status, date: s.date, paid_date: s.status === 'paid' ? String(s.paid_ts || '').slice(0, 10) : null,
                kind: s.kind, on_account: s.on_account, linked_items: s.linked_items, payment_method: s.method,
                total_orders_amount: rsAmount(s.total_c), commissions: rsAmount(s.commissions_c), deductions: rsAmount(s.deductions_c),
                credit_applied: rsAmount(s.credit_applied_c), net_amount: rsAmount(s.net_c), notes: s.notes
            })),
            flags: storePaymentsIssuesOut(account, issues)
        });
    } catch (error) {
        console.error('Error in /reports/store-payments/:storeId/statement:', error);
        res.status(500).json({ success: false, message: 'Failed to load store statement' });
    }
});

router.post('/gl/sync', requireAdmin, async (req, res) => {
    try {
        res.json({ success: true, data: await ledger.syncLedger(req.db) });
    } catch (error) {
        console.error('Error in GL sync:', error);
        res.status(500).json({ success: false, message: 'Ledger sync failed' });
    }
});

module.exports = router;

// Schema helpers run their DDL once per process (see utils/runOnce.js)
const { runOncePerProcess } = require("../utils/runOnce");
ensureOrderItemsCostPriceColumn = runOncePerProcess(ensureOrderItemsCostPriceColumn);
ensureRiderStorePaymentsTable = runOncePerProcess(ensureRiderStorePaymentsTable);
ensureStoreSettlementColumns = runOncePerProcess(ensureStoreSettlementColumns);
ensureStoreSettlementSchema = runOncePerProcess(ensureStoreSettlementSchema);
ensureFinancialReportsReportTypeEnum = runOncePerProcess(ensureFinancialReportsReportTypeEnum);
ensureRiderCashMovementTypes = runOncePerProcess(ensureRiderCashMovementTypes);
ensureRiderCashSubmissionOrdersTable = runOncePerProcess(ensureRiderCashSubmissionOrdersTable);
ensureRiderFuelPaymentEntriesTable = runOncePerProcess(ensureRiderFuelPaymentEntriesTable);
