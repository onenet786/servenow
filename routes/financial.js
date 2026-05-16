const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { recordFinancialTransaction } = require('../utils/dbHelpers');
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

async function getLegacyPaidSettlementOffset(db, storeId, startDate = null, endDate = null) {
    const params = [storeId];
    const dateFilter = startDate && endDate ? 'AND ss.settlement_date BETWEEN ? AND ?' : '';
    if (startDate && endDate) {
        params.push(startDate, endDate);
    }

    const [paidRows] = await db.execute(
        `SELECT
            COALESCE(SUM(ss.net_amount), 0) AS total_paid,
            COALESCE(SUM(
                CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM order_items oi
                        JOIN products p ON oi.product_id = p.id
                        WHERE oi.settlement_id = ss.id
                          AND COALESCE(oi.store_id, p.store_id) = ss.store_id
                    )
                    THEN ss.net_amount
                    ELSE 0
                END
            ), 0) AS linked_paid
         FROM store_settlements ss
         WHERE ss.store_id = ?
           AND ss.status = 'paid'
           ${dateFilter}`,
        params
    );

    const totalPaid = Number(paidRows?.[0]?.total_paid || 0);
    const linkedPaid = Number(paidRows?.[0]?.linked_paid || 0);
    return Math.max(0, totalPaid - linkedPaid);
}

function applyLegacyPaidOffsetToSettlementItems(items, legacyPaidOffset) {
    let remainingOffset = Number(legacyPaidOffset || 0);
    const displayItems = [];
    const allItemIds = [];
    let coveredGross = 0;
    let coveredAdjustment = 0;
    let payableRemaining = 0;
    let grossRemaining = 0;
    let adjustmentRemaining = 0;

    (items || []).forEach((item) => {
        const amounts = buildSettlementItemAmounts(item);
        const itemWithAmounts = {
            ...item,
            line_gross: amounts.lineGross,
            line_discount: amounts.lineDiscount,
            line_net: amounts.lineNet,
            line_commission: amounts.lineCommission,
            line_payable: amounts.linePayable
        };
        allItemIds.push(item.id);

        if (remainingOffset > 0) {
            const coveredPayable = Math.min(remainingOffset, amounts.linePayable);
            const coverageRatio = amounts.linePayable > 0 ? coveredPayable / amounts.linePayable : 1;
            coveredGross += amounts.lineGross * coverageRatio;
            coveredAdjustment += (amounts.lineGross - amounts.linePayable) * coverageRatio;
            remainingOffset -= coveredPayable;

            const remainingPayable = Math.max(0, amounts.linePayable - coveredPayable);
            if (remainingPayable <= 0.005) {
                return;
            }

            const remainingRatio = amounts.linePayable > 0 ? remainingPayable / amounts.linePayable : 0;
            itemWithAmounts.line_gross = amounts.lineGross * remainingRatio;
            itemWithAmounts.line_discount = amounts.lineDiscount * remainingRatio;
            itemWithAmounts.line_net = amounts.lineNet * remainingRatio;
            itemWithAmounts.line_commission = amounts.lineCommission * remainingRatio;
            itemWithAmounts.line_payable = remainingPayable;
        }

        displayItems.push(itemWithAmounts);
        grossRemaining += Number(itemWithAmounts.line_gross || 0);
        adjustmentRemaining += Number((itemWithAmounts.line_gross || 0) - (itemWithAmounts.line_payable || 0));
        payableRemaining += Number(itemWithAmounts.line_payable || 0);
    });

    return {
        displayItems,
        allItemIds,
        grossRemaining,
        adjustmentRemaining,
        payableRemaining,
        coveredGross,
        coveredAdjustment,
        legacyPaidApplied: Math.max(0, Number(legacyPaidOffset || 0) - Math.max(0, remainingOffset))
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
    selectedItemIds = null
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
    return applyLegacyPaidOffsetToSettlementItems(items, 0);
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
    else if (path.startsWith('/reports')) {
        // Delegate permission checks to the specific route handlers
        return next();
    }

    if (requiredPerm) {
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
            cashInHand: parseFloat(cashInHandResult[0]?.total || 0),
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

        stats.net_profit = stats.income - (stats.expense + stats.settlement + stats.refund);
        stats.netProfitIfSettled = stats.net_profit - stats.totalUnsettledAmount;

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
                        [voucherRef]
                    );
                    if (!existingMovement.length) {
                        const [movementResult] = await req.db.execute(
                            `INSERT INTO rider_cash_movements 
                             (movement_number, rider_id, movement_date, movement_type, amount, description, reference_type, reference_id, recorded_by, status, approved_by, approved_at)
                             VALUES (?, ?, ?, ?, ?, ?, 'payment_voucher', ?, ?, 'completed', ?, NOW())`,
                            [movement_number, payeeId, movement_date, movementType, voucherAmount, `Cash payment via CPV ${voucherRef}`, voucherRef, req.user.id, req.user.id]
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

        await req.db.execute(
            `UPDATE cash_receipt_vouchers SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        // Create financial transaction if status changed to received or approved
        if ((status === 'received' || status === 'approved') && existingVoucher) {
            const voucherAmount = amount || existingVoucher.amount;
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

            // If payer is a rider, record cash submission and update wallet
            const payerType = payer_type || existingVoucher.payer_type;
            const payerId = payer_id !== undefined ? payer_id : existingVoucher.payer_id;

            if (payerType === 'rider' && payerId) {
                const movement_number = generateVoucherNumber('RCM');
                const movement_date = new Date().toISOString().split('T')[0];

                const [movementResult] = await req.db.execute(
                    `INSERT INTO rider_cash_movements 
                     (movement_number, rider_id, movement_date, movement_type, amount, description, reference_type, reference_id, recorded_by, status, approved_by, approved_at)
                     VALUES (?, ?, ?, 'cash_submission', ?, ?, 'receipt_voucher', ?, ?, 'completed', ?, NOW())`,
                    [movement_number, payerId, movement_date, voucherAmount, `Cash submission via CRV ${existingVoucher.voucher_number}`, existingVoucher.voucher_number, req.user.id, req.user.id]
                );

                // Debit rider wallet: rider submitted cash to office, so rider-held cash decreases.
                await recordRiderWalletTransaction(
                    req.db,
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
                    req.db,
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
                    req.db,
                    payerId,
                    'credit',
                    voucherAmount,
                    `Receipt via CRV ${existingVoucher.voucher_number}`,
                    existingVoucher.id,
                    'receipt_voucher'
                );
            }
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
        `SELECT id, balance, total_credited, total_spent FROM wallets WHERE rider_id = ?`,
        [riderId]
    );

    if (!wallets.length) {
        await db.execute(
            'INSERT INTO wallets (rider_id, user_type, balance) VALUES (?, ?, ?)',
            [riderId, 'rider', 0]
        );
        
        const [newWallet] = await db.execute(
            'SELECT id, balance, total_credited, total_spent FROM wallets WHERE rider_id = ?',
            [riderId]
        );
        return newWallet[0];
    }
    return wallets[0];
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
    const newBalance = type === 'credit' 
        ? parseFloat(wallet.balance || 0) + parseFloat(amount)
        : parseFloat(wallet.balance || 0) - parseFloat(amount);

    // Update wallet balance
    if (type === 'credit') {
        await db.execute(
            'UPDATE wallets SET balance = ?, total_credited = total_credited + ? WHERE id = ?',
            [newBalance, amount, wallet.id]
        );
    } else {
        await db.execute(
            'UPDATE wallets SET balance = ?, total_spent = total_spent + ? WHERE id = ?',
            [newBalance, amount, wallet.id]
        );
    }

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
    await ensureRiderCashSubmissionOrdersTable(db);
    const wallet = await getOrCreateRiderWallet(db, riderId);

    // Find linked orders missing wallet credit entries.
    const [missingRows] = await db.execute(
        `SELECT rcso.order_id,
                rcso.order_number,
                rcso.order_amount
         FROM rider_cash_submission_orders rcso
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
    for (const row of missingRows) {
        const amount = Number(row.order_amount || 0);
        if (amount <= 0) continue;
        runningBalance += amount;

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

    if (missingRows.length > 0) {
        await db.execute(
            `UPDATE wallets
             SET balance = ?,
                 total_credited = total_credited + ?
             WHERE id = ?`,
            [
                runningBalance,
                missingRows.reduce((s, r) => s + Number(r.order_amount || 0), 0),
                wallet.id
            ]
        );
    }

    return {
        backfilledCount: missingRows.length,
        backfilledAmount: missingRows.reduce((s, r) => s + Number(r.order_amount || 0), 0)
    };
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
                `SELECT id, order_number, total_amount
                 FROM orders
                 WHERE rider_id = ?
                   AND status = 'delivered'
                   AND LOWER(TRIM(COALESCE(payment_method, ''))) = 'cash'
                   AND LOWER(TRIM(COALESCE(payment_status, ''))) = 'paid'
                   AND id IN (${placeholders})`,
                [rider_id, ...linkedOrderIds]
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
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { id } = req.params;
        const { status, amount, description } = req.body;

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

        if (requestedAmountChange) {
            updates.push('amount = ?');
            params.push(amount);
        }
        if (description !== undefined) {
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
                updates.push('approved_by = ?, approved_at = NOW()');
                params.push(req.user.id);

                // Handle wallet updates and financial transactions based on movement type
                const effectiveAmount = amount || movement.amount;
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
                    // If it IS linked to an order, it was already income. 
                    // But if this is a manual entry, treat as income.
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
                    // If reference_type === 'order', it's already handled. 
                    // But if user manually created it and wants it in report, we might need to log it?
                    // Usually cash_collection is auto-created by orders.
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
                    // Rider settlement is an expense/payout for the platform
                    transactionType = 'settlement';
                    descriptionPrefix = 'Rider Settlement';
                } else if (movement.movement_type === 'advance') {
                    // Advances are already debited on POST
                    transactionType = 'expense';
                    descriptionPrefix = 'Rider Advance';
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
                        created_by: req.user.id
                    });
                }
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No fields to update'
            });
        }

        params.push(id);

        await req.db.execute(
            `UPDATE rider_cash_movements SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        res.json({
            success: true,
            message: 'Rider cash movement updated successfully'
        });
    } catch (error) {
        console.error('Error updating rider cash movement:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update rider cash movement',
            error: error.message
        });
    }
});

// Get unsettled items for a store
router.get('/store-settlements/unsettled-items', async (req, res) => {
    try {
        const { store_id, period_from, period_to } = req.query;
        if (!store_id) {
            return res.status(400).json({ success: false, message: 'Store ID is required' });
        }

        await ensureStoreSettlementSchema(req.db);

        const settlementCalc = await calculateStoreSettlementBalance(
            req.db,
            store_id,
            period_from && period_to ? `${period_from} 00:00:00` : null,
            period_from && period_to ? `${period_to} 23:59:59` : null
        );
        const commission_rate = 0;
        const gross_amount = settlementCalc.grossRemaining;
        const total_discount = settlementCalc.adjustmentRemaining;
        const net_amount = settlementCalc.payableRemaining;

        res.json({
            success: true,
            items: settlementCalc.displayItems,
            summary: {
                total_orders_amount: gross_amount,
                total_gross_amount: gross_amount,
                total_discount,
                commission_rate,
                commissions: total_discount,
                net_amount,
                item_count: settlementCalc.displayItems.length,
                legacy_paid_offset: settlementCalc.legacyPaidApplied
            }
        });

    } catch (error) {
        console.error('Error fetching unsettled items:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get stores with payment due. The visible amount matches Store Reports
// (total payable minus paid settlements), while current_settlement_balance
// tells the UI whether a fresh settlement can be created from unlinked items.
router.get('/store-settlements/due-stores', async (req, res) => {
    try {
        const { period_from, period_to } = req.query;
        const balanceStart = period_from && period_to ? `${period_from} 00:00:00` : null;
        const balanceEnd = period_from && period_to ? `${period_to} 23:59:59` : null;

        await ensureStoreSettlementSchema(req.db);

        const payableSql = getStorePayableSqlExpression('s2');
        const reportParams = [];
        if (period_from && period_to) {
            reportParams.push(balanceStart, balanceEnd);
            reportParams.push(period_from, period_to);
            reportParams.push(period_from, period_to);
        }

        const [stores] = await req.db.execute(
            `SELECT
                s.id,
                s.name,
                s.payment_term,
                s.is_active,
                COALESCE(earn.total_payable, 0) AS total_payable,
                COALESCE(paid.total_paid, 0) AS total_paid,
                COALESCE(open_settlements.total_unpaid_settlements, 0) AS open_settlement_amount
             FROM stores s
             LEFT JOIN (
                SELECT
                    COALESCE(oi.store_id, p.store_id) AS store_id,
                    SUM(${payableSql}) AS total_payable
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                JOIN products p ON oi.product_id = p.id
                JOIN stores s2 ON s2.id = COALESCE(oi.store_id, p.store_id)
                WHERE o.status = 'delivered'
                  AND o.payment_status = 'paid'
                  ${period_from && period_to ? 'AND o.created_at BETWEEN ? AND ?' : ''}
                GROUP BY COALESCE(oi.store_id, p.store_id)
             ) earn ON earn.store_id = s.id
             LEFT JOIN (
                SELECT store_id, SUM(net_amount) AS total_paid
                FROM store_settlements
                WHERE status = 'paid'
                  ${period_from && period_to ? 'AND settlement_date BETWEEN ? AND ?' : ''}
                GROUP BY store_id
             ) paid ON paid.store_id = s.id
             LEFT JOIN (
                SELECT store_id, SUM(net_amount) AS total_unpaid_settlements
                FROM store_settlements
                WHERE status IN ('pending', 'approved')
                  ${period_from && period_to ? 'AND settlement_date BETWEEN ? AND ?' : ''}
                GROUP BY store_id
             ) open_settlements ON open_settlements.store_id = s.id
             WHERE LOWER(TRIM(COALESCE(s.payment_term, ''))) NOT IN ('cash only', 'cash with discount')
             ORDER BY s.name ASC`,
            reportParams
        );

        const dueStores = [];
        for (const store of stores) {
            const settlementBalance = await calculateStoreSettlementBalance(
                req.db,
                store.id,
                balanceStart,
                balanceEnd
            );
            const currentSettlementBalance = Number(settlementBalance.payableRemaining || 0);
            const pendingSettlement = Math.max(
                0,
                Number(store.total_payable || 0) - Number(store.total_paid || 0)
            );
            if (pendingSettlement <= 0.005) continue;

            dueStores.push({
                id: store.id,
                name: store.name,
                payment_term: store.payment_term || null,
                is_active: !!store.is_active,
                pending_settlement: pendingSettlement,
                current_settlement_balance: currentSettlementBalance,
                open_settlement_amount: Number(store.open_settlement_amount || 0),
                item_count: settlementBalance.displayItems.length,
                legacy_paid_offset: Number(settlementBalance.legacyPaidApplied || 0)
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
        res.status(500).json({ success: false, error: error.message });
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

router.post('/store-settlements', [
    body('store_id').isInt({ min: 1 }),
    body('payment_method').isIn(['cash', 'cheque', 'bank_transfer'])
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

        await ensureStoreSettlementSchema(req.db);

        conn = await req.db.getConnection();
        await conn.beginTransaction();

        const { store_id, period_from, period_to, total_orders_amount, commissions, deductions, net_amount, payment_method, notes, auto_calculate, selected_item_ids } = req.body;
        
        let final_total = total_orders_amount || 0;
        let final_commissions = commissions || 0;
        let final_deductions = deductions || 0;
        let final_net = net_amount || 0;
        let settlement_items = [];

        // If auto-calculation is requested, calculate from unsettled items
        if (auto_calculate === true || auto_calculate === 'true' || auto_calculate === 'on') {
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

            if (settlementCalc.payableRemaining <= 0.005) {
                await conn.rollback();
                conn.release();
                 return res.status(400).json({
                    success: false,
                    message: 'No unpaid settlement balance found for this store'
                });
            }

            settlement_items = settlementCalc.allItemIds;
            final_total = settlementCalc.grossRemaining;
            final_commissions = settlementCalc.adjustmentRemaining;
            final_deductions = parseFloat(deductions || 0);
            final_net = final_total - final_commissions - final_deductions;
        }

        const settlement_number = generateVoucherNumber('SS');
        const settlement_date = new Date().toISOString().split('T')[0];

        // Create the settlement record
        const [result] = await conn.execute(
            `INSERT INTO store_settlements 
             (settlement_number, settlement_date, store_id, period_from, period_to, total_orders_amount, commissions, deductions, net_amount, payment_method, notes, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [settlement_number, settlement_date, store_id, period_from || null, period_to || null, final_total, final_commissions, final_deductions, final_net, payment_method, notes || null]
        );

        const settlementId = result.insertId;

        // Link the items to this settlement so they aren't paid again
        if (auto_calculate && settlement_items.length > 0) {
             const placeholders = settlement_items.map(() => '?').join(',');
             await conn.execute(
                `UPDATE order_items SET settlement_id = ? WHERE id IN (${placeholders})`,
                [settlementId, ...settlement_items]
             );
        }

        await conn.commit();
        conn.release();

        res.status(201).json({
            success: true,
            message: 'Store settlement created successfully',
            settlement: {
                id: settlementId,
                settlement_number,
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
            message: 'Failed to create store settlement',
            error: error.message
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

        // Create financial transaction if status changed to paid
        if (status === 'paid' && existingSettlement) {
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
        const dateParams = period_from && period_to ? [period_from, period_to] : [];

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
                        estimated_commission: 0
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

            const summary = orders.reduce((acc, o) => {
                acc.total_item_sales += parseFloat(o.item_sales_gross || 0);
                acc.total_cost += parseFloat(o.total_cost_price || 0);
                acc.total_commission += parseFloat(o.estimated_commission || 0);
                acc.total_delivery += parseFloat(o.delivery_fee || 0);
                acc.grand_total += parseFloat(o.total_amount || 0);
                return acc;
            }, { total_item_sales: 0, total_cost: 0, total_commission: 0, total_delivery: 0, grand_total: 0 });

            // Set main report totals (optional, but good for consistency)
            total_income = summary.total_commission + summary.total_delivery; // Platform income

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
            `SELECT o.id, o.order_number, o.total_amount, o.created_at
             FROM orders o
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
            [id]
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
                COALESCE(o.total_amount, rcso.order_amount, 0) AS total_amount,
                COALESCE(o.created_at, rcso.created_at) AS created_at,
                rcm.movement_number,
                rcm.movement_type,
                rcm.status AS submission_status,
                rcm.movement_date AS submitted_at
             FROM rider_cash_submission_orders rcso
             JOIN rider_cash_movements rcm ON rcm.id = rcso.movement_id
             LEFT JOIN orders o ON o.id = rcso.order_id
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

        const [entries] = await req.db.execute('SELECT * FROM journal_voucher_entries WHERE jnv_id = ?', [id]);
        if (entries.length === 0) return res.status(400).json({ success: false, message: 'Voucher has no entries' });

        // Update voucher status
        await req.db.execute(
            'UPDATE journal_vouchers SET status = \'posted\', approved_by = ?, posted_at = NOW() WHERE id = ?',
            [req.user.id, id]
        );

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
            dateFilter = ' WHERE created_at BETWEEN ? AND ?';
            params.push(start_date, end_date);
        }

        const [orders] = await req.db.execute(
            `SELECT COUNT(*) as total_orders, SUM(total_amount) as gross_sales, SUM(delivery_fee) as total_delivery_fees 
             FROM orders ${dateFilter}`,
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
        for (const storeRow of stores) {
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
                balanceEnd
            );
            const accountingPending = Math.max(
                0,
                Number(storeRow.total_payable || 0) - Number(storeRow.total_paid || 0)
            );
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
    const newBalance = type === 'credit' 
        ? parseFloat(wallet.balance || 0) + parseFloat(amount)
        : parseFloat(wallet.balance || 0) - parseFloat(amount);

    // Update wallet balance
    if (type === 'credit') {
        await db.execute(
            'UPDATE wallets SET balance = ?, total_credited = total_credited + ? WHERE id = ?',
            [newBalance, amount, wallet.id]
        );
    } else {
        await db.execute(
            'UPDATE wallets SET balance = ?, total_spent = total_spent + ? WHERE id = ?',
            [newBalance, amount, wallet.id]
        );
    }

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
    const newBalance = type === 'credit' 
        ? parseFloat(wallet.balance || 0) + parseFloat(amount)
        : parseFloat(wallet.balance || 0) - parseFloat(amount);

    // Update wallet balance
    if (type === 'credit') {
        await db.execute(
            'UPDATE wallets SET balance = ?, total_credited = total_credited + ? WHERE id = ?',
            [newBalance, amount, wallet.id]
        );
    } else {
        await db.execute(
            'UPDATE wallets SET balance = ?, total_spent = total_spent + ? WHERE id = ?',
            [newBalance, amount, wallet.id]
        );
    }

    // Record wallet transaction
    await db.execute(
        `INSERT INTO wallet_transactions 
         (wallet_id, type, amount, description, reference_type, reference_id, balance_after) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [wallet.id, type, amount, description, referenceType, referenceId, newBalance]
    );

    return { walletId: wallet.id, newBalance };
}

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

module.exports = router;
