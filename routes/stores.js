const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken, requireAdmin, requireStoreOwner } = require('../middleware/auth');
const { sendPushToUser, ensurePushDeviceTokensTable, getPushServiceStatus } = require('../services/pushNotifications');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = (() => {
    try { return require('sharp'); } catch (e) { console.warn('sharp not installed, image resizing disabled'); return null; }
})();
const upload = multer({ dest: path.join(__dirname, '..', 'uploads', 'tmp') });
const {
    ensureStoreOfferCampaignTables,
    getActiveStoreCampaignsMap,
    campaignsForProduct,
    applyBestCampaignToPrice,
    campaignBadge,
    isCampaignActiveNow
} = require('../utils/offerCampaigns');

const router = express.Router();

const routeEnsureCache = new Map();

async function ensureOnce(key, fn) {
    if (!routeEnsureCache.has(key)) {
        routeEnsureCache.set(
            key,
            Promise.resolve()
                .then(fn)
                .catch((error) => {
                    routeEnsureCache.delete(key);
                    throw error;
                })
        );
    }
    return routeEnsureCache.get(key);
}

async function ensureStoreStatusMessagesTable(db) {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS store_status_messages (
            id INT PRIMARY KEY AUTO_INCREMENT,
            store_id INT NOT NULL,
            status_message TEXT NULL,
            is_closed BOOLEAN DEFAULT FALSE,
            updated_by INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_store_status_message_store (store_id)
        )
    `);
}

async function ensureGlobalDeliveryStatusTable(db) {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS global_delivery_status (
            id INT PRIMARY KEY AUTO_INCREMENT,
            is_enabled BOOLEAN DEFAULT FALSE,
            block_ordering BOOLEAN DEFAULT FALSE,
            title VARCHAR(120) NULL,
            status_message TEXT NULL,
            start_at DATETIME NULL,
            end_at DATETIME NULL,
            updated_by INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
    const [cols] = await db.execute(
        `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'global_delivery_status'
           AND COLUMN_NAME = 'block_ordering'
         LIMIT 1`
    );
    if (!cols || !cols.length) {
        await db.execute(
            `ALTER TABLE global_delivery_status
             ADD COLUMN block_ordering BOOLEAN DEFAULT FALSE`
        );
    }
}

async function ensureLivePromotionsTable(db) {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS live_promotions (
            id INT PRIMARY KEY AUTO_INCREMENT,
            is_enabled BOOLEAN DEFAULT FALSE,
            title VARCHAR(120) NULL,
            status_message TEXT NULL,
            start_at DATETIME NULL,
            end_at DATETIME NULL,
            widget_images_json LONGTEXT NULL,
            updated_by INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
}

async function ensureCustomerFlashMessagesTable(db) {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS customer_flash_messages (
            id INT PRIMARY KEY AUTO_INCREMENT,
            is_enabled BOOLEAN DEFAULT FALSE,
            title VARCHAR(120) NULL,
            status_message TEXT NULL,
            image_url VARCHAR(2048) NULL,
            start_at DATETIME NULL,
            end_at DATETIME NULL,
            notification_target VARCHAR(16) DEFAULT 'all',
            customer_ids_json LONGTEXT NULL,
            updated_by INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
}

async function ensureSystemSettingsTable(db) {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS system_settings (
            setting_key VARCHAR(120) PRIMARY KEY,
            setting_value VARCHAR(255) NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
}

async function saveAppUpdateSettings(db, {
    version,
    title,
    message,
    playStoreUrl,
    minimumSupportedVersion,
    forceUpdate,
    reminderHour
}) {
    await ensureSystemSettingsTable(db);
    const entries = [
        ['app_update_latest_version', version || ''],
        ['app_update_title', title || 'App Update Available'],
        ['app_update_message', message || 'A new version of ServeNow is available on Play Store.'],
        ['app_update_play_store_url', playStoreUrl || 'https://play.google.com/store/apps/details?id=com.onenetsol.servenow'],
        ['app_update_minimum_supported_version', minimumSupportedVersion || ''],
        ['app_update_force_update', forceUpdate ? '1' : '0'],
        ['app_update_customer_reminder_hour', String(Number.isFinite(Number(reminderHour)) ? Number(reminderHour) : 12)]
    ];

    for (const [key, value] of entries) {
        await db.execute(
            `INSERT INTO system_settings (setting_key, setting_value)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
            [key, value]
        );
    }
}

async function getAppUpdateSettings(db) {
    await ensureSystemSettingsTable(db);
    const [rows] = await db.execute(
        `SELECT setting_key, setting_value
         FROM system_settings
         WHERE setting_key IN (
            'app_update_latest_version',
            'app_update_title',
            'app_update_message',
            'app_update_play_store_url',
            'app_update_minimum_supported_version',
            'app_update_force_update',
            'app_update_customer_reminder_hour'
         )`
    );

    const settings = new Map((rows || []).map((row) => [row.setting_key, row.setting_value]));
    const reminderHourRaw = Number.parseInt(String(settings.get('app_update_customer_reminder_hour') || '12'), 10);
    const reminderHour = Number.isFinite(reminderHourRaw) && reminderHourRaw >= 0 && reminderHourRaw <= 23
        ? reminderHourRaw
        : 12;

    return {
        latest_version: String(settings.get('app_update_latest_version') || '').trim(),
        title: String(settings.get('app_update_title') || 'App Update Available').trim(),
        message: String(settings.get('app_update_message') || 'A new version of ServeNow is available on Play Store.').trim(),
        play_store_url: String(settings.get('app_update_play_store_url') || 'https://play.google.com/store/apps/details?id=com.onenetsol.servenow').trim(),
        minimum_supported_version: String(settings.get('app_update_minimum_supported_version') || '').trim(),
        force_update: String(settings.get('app_update_force_update') || '0').trim() === '1',
        reminder_hour: reminderHour
    };
}

async function ensureStoreFinancialColumns(db) {
    const [rows] = await db.execute(
        `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'stores'
           AND COLUMN_NAME = 'payment_grace_days'
         LIMIT 1`
    );
    if (!rows || !rows.length) {
        await db.execute(
            `ALTER TABLE stores
             ADD COLUMN payment_grace_days INT NULL`
        );
    }
    const [startCols] = await db.execute(
        `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'stores'
           AND COLUMN_NAME = 'payment_grace_start_date'
         LIMIT 1`
    );
    if (!startCols || !startCols.length) {
        await db.execute(
            `ALTER TABLE stores
             ADD COLUMN payment_grace_start_date DATE NULL`
        );
    }
    const [muteCols] = await db.execute(
        `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'stores'
           AND COLUMN_NAME = 'grace_alert_muted_until'
         LIMIT 1`
    );
    if (!muteCols || !muteCols.length) {
        await db.execute(
            `ALTER TABLE stores
             ADD COLUMN grace_alert_muted_until DATETIME NULL`
        );
    }
    const [discountApplyCols] = await db.execute(
        `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'stores'
           AND COLUMN_NAME = 'store_discount_apply_all_products'
         LIMIT 1`
    );
    if (!discountApplyCols || !discountApplyCols.length) {
        await db.execute(
            `ALTER TABLE stores
             ADD COLUMN store_discount_apply_all_products TINYINT(1) NOT NULL DEFAULT 0`
        );
    }
    const [discountPctCols] = await db.execute(
        `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'stores'
           AND COLUMN_NAME = 'store_discount_percent'
         LIMIT 1`
    );
    if (!discountPctCols || !discountPctCols.length) {
        await db.execute(
            `ALTER TABLE stores
             ADD COLUMN store_discount_percent DECIMAL(10,2) NULL`
        );
    }
}

async function ensureStoreCustomerVisibilityColumn(db) {
    const [rows] = await db.execute(
        `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'stores'
           AND COLUMN_NAME = 'is_customer_visible'
         LIMIT 1`
    );
    if (!rows || !rows.length) {
        await db.execute(
            `ALTER TABLE stores
             ADD COLUMN is_customer_visible TINYINT(1) NOT NULL DEFAULT 1`
        );
    }
}

async function ensureStoreBankColumn(db) {
    const [rows] = await db.execute(
        `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'stores'
           AND COLUMN_NAME = 'bank_id'
         LIMIT 1`
    );
    if (!rows || !rows.length) {
        await db.execute(
            `ALTER TABLE stores
             ADD COLUMN bank_id INT NULL`
        );
    }
}

async function ensureStoreBankDetailsColumns(db) {
    const [titleRows] = await db.execute(
        `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'stores'
           AND COLUMN_NAME = 'store_bank_account_title'
         LIMIT 1`
    );
    if (!titleRows || !titleRows.length) {
        await db.execute(
            `ALTER TABLE stores
             ADD COLUMN store_bank_account_title VARCHAR(255) NULL`
        );
    }

    const [numberRows] = await db.execute(
        `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'stores'
           AND COLUMN_NAME = 'store_bank_account_number'
         LIMIT 1`
    );
    if (!numberRows || !numberRows.length) {
        await db.execute(
            `ALTER TABLE stores
             ADD COLUMN store_bank_account_number VARCHAR(120) NULL`
        );
    }
}

function normalizeDateOnlyInput(raw) {
    const value = String(raw || '').trim();
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    return value;
}

function isGraceApplicablePaymentTerm(term) {
    const t = String(term || '').toLowerCase().trim();
    if (!t) return false;
    return t !== 'cash only' && t !== 'credit';
}

function calculateGraceDueDate(startDate, graceDays) {
    const start = normalizeDateOnlyInput(startDate);
    const days = Number.parseInt(String(graceDays ?? ''), 10);
    if (!start || !Number.isInteger(days) || days < 0) return null;
    const due = new Date(`${start}T00:00:00`);
    due.setDate(due.getDate() + days);
    return due.toISOString().slice(0, 10);
}

async function tableExists(db, tableName) {
    const [rows] = await db.execute(
        `SELECT COUNT(*) AS cnt
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?`,
        [tableName]
    );
    return Number(rows?.[0]?.cnt || 0) > 0;
}

function normalizeCustomerIds(input) {
    const raw = Array.isArray(input)
        ? input
        : String(input || '')
            .split(',')
            .map((x) => x.trim());
    const uniq = new Set();
    for (const v of raw) {
        const n = parseInt(String(v), 10);
        if (Number.isInteger(n) && n > 0) uniq.add(n);
    }
    return Array.from(uniq);
}

async function getTargetCustomers(db, target, customIds) {
    const normTarget = String(target || 'all').toLowerCase() === 'custom' ? 'custom' : 'all';
    const ids = normalizeCustomerIds(customIds);
    const params = [];
    let where = `
        WHERE (u.user_type IS NULL OR u.user_type = '' OR LOWER(u.user_type) IN ('customer', 'standard_user'))
          AND (u.is_active IS NULL OR u.is_active = 1)
    `;
    if (normTarget === 'custom') {
        if (!ids.length) return [];
        where += ` AND u.id IN (${ids.map(() => '?').join(',')})`;
        params.push(...ids);
    }
    const [rows] = await db.execute(
        `SELECT u.id, COALESCE(NULLIF(LOWER(u.user_type), ''), 'standard_user') AS user_type
         FROM users u
         ${where}
         ORDER BY u.id ASC`,
        params
    );
    return rows.map((r) => ({
        id: Number(r.id),
        user_type: (r.user_type || 'standard_user').toString().toLowerCase()
    }));
}

async function getTargetAppUsers(db, audience) {
    await ensurePushDeviceTokensTable(db);
    const normalizedAudience = String(audience || 'all').toLowerCase().trim();
    const allowedAudiences = new Set(['all', 'customers', 'riders', 'store_owners', 'admins']);
    const finalAudience = allowedAudiences.has(normalizedAudience) ? normalizedAudience : 'all';
    const params = [];

    let where = `WHERE pdt.is_active = 1 AND LOWER(COALESCE(pdt.platform, 'unknown')) IN ('android', 'ios')`;
    if (finalAudience === 'customers') {
        where += ` AND LOWER(COALESCE(pdt.user_type, '')) IN ('customer', 'standard_user')`;
    } else if (finalAudience === 'riders') {
        where += ` AND LOWER(COALESCE(pdt.user_type, '')) = 'rider'`;
    } else if (finalAudience === 'store_owners') {
        where += ` AND LOWER(COALESCE(pdt.user_type, '')) = 'store_owner'`;
    } else if (finalAudience === 'admins') {
        where += ` AND LOWER(COALESCE(pdt.user_type, '')) IN ('admin', 'staff')`;
    }

    const [rows] = await db.execute(
        `SELECT DISTINCT pdt.user_id, LOWER(COALESCE(pdt.user_type, '')) AS user_type
         FROM push_device_tokens pdt
         ${where}
         ORDER BY pdt.user_id ASC`,
        params
    );

    return (rows || [])
        .map((row) => ({
            id: Number(row.user_id || 0),
            user_type: String(row.user_type || '').trim().toLowerCase()
        }))
        .filter((row) => row.id > 0 && row.user_type);
}

function normalizeDateTimeInput(raw) {
    const value = (raw ?? '').toString().trim();
    if (!value) return null;
    const normalized = value.replace('T', ' ').replace(/\.\d+Z?$/, '');
    const withSeconds = /^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(normalized)
        ? `${normalized}:00`
        : normalized;
    return withSeconds;
}

function getGlobalDeliveryStatusPayload(row) {
    const now = new Date();
    const start = row?.start_at ? new Date(row.start_at) : null;
    const end = row?.end_at ? new Date(row.end_at) : null;
    const inWindow = !!(
        row?.is_enabled &&
        start &&
        end &&
        !Number.isNaN(start.getTime()) &&
        !Number.isNaN(end.getTime()) &&
        now >= start &&
        now <= end
    );

    const blockOrderingActive = !!(inWindow && row?.block_ordering);
    return {
        is_enabled: !!row?.is_enabled,
        block_ordering: !!row?.block_ordering,
        title: row?.title || 'Delivery Update',
        status_message: row?.status_message || '',
        start_at: row?.start_at || null,
        end_at: row?.end_at || null,
        is_window_active: inWindow,
        is_delivery_available: !inWindow,
        block_ordering_active: blockOrderingActive,
        updated_at: row?.updated_at || null
    };
}

function normalizeWidgetImages(raw) {
    const input = Array.isArray(raw) ? raw : [];
    const out = [];
    for (const item of input) {
        const url = (item ?? '').toString().trim();
        if (!url) continue;
        if (url.length > 2048) continue;
        out.push(url);
        if (out.length >= 5) break;
    }
    return out;
}

function parseWidgetImages(rawJson) {
    if (!rawJson) return [];
    try {
        const parsed = JSON.parse(rawJson);
        return normalizeWidgetImages(parsed);
    } catch (_) {
        return [];
    }
}

function getLivePromotionsPayload(row) {
    const now = new Date();
    const start = row?.start_at ? new Date(row.start_at) : null;
    const end = row?.end_at ? new Date(row.end_at) : null;
    const inWindow = !!(
        row?.is_enabled &&
        start &&
        end &&
        !Number.isNaN(start.getTime()) &&
        !Number.isNaN(end.getTime()) &&
        now >= start &&
        now <= end
    );
    const images = parseWidgetImages(row?.widget_images_json);
    return {
        is_enabled: !!row?.is_enabled,
        title: row?.title || 'Live Promotions',
        status_message: row?.status_message || '',
        start_at: row?.start_at || null,
        end_at: row?.end_at || null,
        widget_images: images,
        is_window_active: inWindow,
        is_visible: !!(inWindow && images.length),
        updated_at: row?.updated_at || null
    };
}

function parseCustomerIdsJson(rawJson) {
    if (!rawJson) return [];
    try {
        const parsed = JSON.parse(rawJson);
        return normalizeCustomerIds(parsed);
    } catch (_) {
        return [];
    }
}

function getCustomerFlashPayload(row, userId = null) {
    const now = new Date();
    const start = row?.start_at ? new Date(row.start_at) : null;
    const end = row?.end_at ? new Date(row.end_at) : null;
    const inWindow = !!(
        row?.is_enabled &&
        start &&
        end &&
        !Number.isNaN(start.getTime()) &&
        !Number.isNaN(end.getTime()) &&
        now >= start &&
        now <= end
    );
    const target = String(row?.notification_target || 'all').toLowerCase() === 'custom' ? 'custom' : 'all';
    const customerIds = parseCustomerIdsJson(row?.customer_ids_json);
    const numericUserId = Number(userId);
    const targetMatched = target === 'all'
        ? true
        : (Number.isInteger(numericUserId) && numericUserId > 0 && customerIds.includes(numericUserId));
    return {
        is_enabled: !!row?.is_enabled,
        title: row?.title || 'Flash Message',
        status_message: row?.status_message || '',
        image_url: row?.image_url || '',
        start_at: row?.start_at || null,
        end_at: row?.end_at || null,
        notification_target: target,
        customer_ids: customerIds,
        is_window_active: inWindow,
        is_target_matched: targetMatched,
        is_visible: !!(inWindow && targetMatched),
        updated_at: row?.updated_at || null
    };
}

async function loadProductSizeVariants(db, productIds) {
    try {
        const ids = (Array.isArray(productIds) ? productIds : [])
            .map(x => parseInt(String(x), 10))
            .filter(x => Number.isInteger(x) && x > 0);
        if (!ids.length) return {};

        const placeholders = ids.map(() => '?').join(',');
        const [rows] = await db.execute(
            `
                SELECT psp.product_id, psp.size_id, psp.unit_id, psp.price, psp.cost_price, psp.sort_order,
                       sz.label as size_label, u.name as unit_name, u.abbreviation as unit_abbreviation
                FROM product_size_prices psp
                LEFT JOIN sizes sz ON psp.size_id = sz.id
                LEFT JOIN units u ON psp.unit_id = u.id
                WHERE psp.product_id IN (${placeholders})
                ORDER BY psp.product_id ASC, psp.sort_order ASC, psp.id ASC
            `,
            ids
        );

        const out = {};
        for (const r of rows || []) {
            const pid = r.product_id;
            if (!out[pid]) out[pid] = [];
            out[pid].push({
                size_id: r.size_id,
                size_label: r.size_label || null,
                unit_id: r.unit_id === null || r.unit_id === undefined ? null : Number(r.unit_id),
                unit_name: r.unit_name || null,
                unit_abbreviation: r.unit_abbreviation || null,
                price: Number(r.price),
                cost_price: r.cost_price === null || r.cost_price === undefined ? null : Number(r.cost_price)
            });
        }
        return out;
    } catch (e) {
        return {};
    }
}

async function ensureServiceGeoLimitsTable(db) {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS service_geo_limits (
            id INT PRIMARY KEY AUTO_INCREMENT,
            is_active BOOLEAN DEFAULT TRUE,
            city VARCHAR(120) NULL,
            center_latitude DECIMAL(10, 8) NULL,
            center_longitude DECIMAL(11, 8) NULL,
            radius_km DECIMAL(10, 2) NULL,
            require_location BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
}

function haversineKm(lat1, lon1, lat2, lon2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Helper to calculate if store is open based on current time
const calculateIsOpen = (opening_time, closing_time) => {
    if (!opening_time || !closing_time) return false;
    try {
        const now = new Date();
        const nowTime = now.getHours() + now.getMinutes() / 60.0;
        
        const parseTime = (t) => {
            const [h, m] = t.split(':').map(Number);
            return h + m / 60.0;
        };
        const start = parseTime(opening_time);
        const end = parseTime(closing_time);
        
        if (start <= end) {
            return nowTime >= start && nowTime <= end;
        } else {
            // Overnight case: e.g., 22:00 to 02:00
            return nowTime >= start || nowTime <= end;
        }
    } catch (e) {
        return false;
    }
};

// Get all stores (optionally filter by category via products)
router.get('/', async (req, res) => {
    try {
        await ensureOnce('stores-list-schema', async () => {
            await ensureStoreStatusMessagesTable(req.db);
            await ensureServiceGeoLimitsTable(req.db);
            await ensureStoreFinancialColumns(req.db);
            await ensureStoreCustomerVisibilityColumn(req.db);
            await ensureStoreBankColumn(req.db);
            await ensureStoreBankDetailsColumns(req.db);
        });
        const { category, category_id, search, admin, lite, latitude, longitude, city } = req.query;
        const liteMode = String(lite || '').toLowerCase() === '1' || String(lite || '').toLowerCase() === 'true';
        const whereClauses = admin === '1' ? [] : ['s.is_active = true', 'COALESCE(s.is_customer_visible, 1) = 1'];
        const params = [];

        if (search) {
            const searchTerm = `%${search}%`;
            whereClauses.push(`(
                EXISTS (
                    SELECT 1 FROM products p 
                    WHERE p.store_id = s.id 
                    AND p.is_available = true 
                    AND p.name LIKE ?
                )
            )`);
            params.push(searchTerm);
        }

        if (category_id || category) {
            if (category_id && /^\d+$/.test(String(category_id))) {
                whereClauses.push(`
                    EXISTS (
                        SELECT 1
                        FROM products p
                        WHERE p.store_id = s.id
                          AND p.is_available = true
                          AND p.category_id = ?
                    )
                `);
                params.push(parseInt(category_id, 10));
            } else if (category) {
                whereClauses.push(`
                    EXISTS (
                        SELECT 1
                        FROM products p
                        LEFT JOIN categories c ON p.category_id = c.id
                        WHERE p.store_id = s.id
                          AND p.is_available = true
                          AND LOWER(c.name) = LOWER(REPLACE(?, "-", " "))
                    )
                `);
                params.push(String(category));
            }
        }

        const whereClause = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';
        const [stores] = await req.db.execute(
            liteMode
                ? `
            SELECT s.id, s.name, s.payment_term, s.is_active, s.is_customer_visible, sm.is_closed, sm.status_message
                 , s.payment_grace_days, s.payment_grace_start_date, s.grace_alert_muted_until
                 , s.store_discount_apply_all_products, s.store_discount_percent, s.bank_id
            FROM stores s
            LEFT JOIN store_status_messages sm ON sm.store_id = s.id
            ${whereClause}
            ORDER BY s.name ASC
        `
                : `
            SELECT s.*, sm.is_closed, sm.status_message, u.email as owner_email, CONCAT(u.first_name, ' ', u.last_name) as owner_name,
                   b.name AS bank_name, b.account_number AS bank_account_number, b.bank_code AS bank_code,
                   b.branch_name AS bank_branch_name, b.account_title AS bank_account_title
            FROM stores s
            LEFT JOIN store_status_messages sm ON sm.store_id = s.id
            LEFT JOIN users u ON s.owner_id = u.id
            LEFT JOIN banks b ON b.id = s.bank_id
            ${whereClause}
            ORDER BY s.is_active DESC, s.priority DESC, s.id DESC
        `,
            params
        );

        // Apply DB-driven service-area limitation (customer app only, admin requests bypass).
        if (String(admin || '') !== '1') {
            const [geoRows] = await req.db.execute(
                `SELECT *
                 FROM service_geo_limits
                 WHERE is_active = true
                   AND (
                     require_location = true
                     OR (radius_km IS NOT NULL AND center_latitude IS NOT NULL AND center_longitude IS NOT NULL)
                     OR (city IS NOT NULL AND TRIM(city) <> '')
                   )
                 ORDER BY
                   (radius_km IS NULL OR center_latitude IS NULL OR center_longitude IS NULL) ASC,
                   radius_km ASC,
                   require_location DESC,
                   id DESC
                 LIMIT 1`
            );
            const geo = (geoRows && geoRows.length) ? geoRows[0] : null;

            let locationAllowed = true;
            let geoMessage = null;
            const qLat = latitude !== undefined ? Number(latitude) : NaN;
            const qLng = longitude !== undefined ? Number(longitude) : NaN;
            const hasCoords = Number.isFinite(qLat) && Number.isFinite(qLng);
            const qCity = String(city || '').trim().toLowerCase();

            if (geo) {
                const ruleCity = String(geo.city || '').trim().toLowerCase();
                const ruleLat = Number(geo.center_latitude);
                const ruleLng = Number(geo.center_longitude);
                const ruleRadiusKm = Number(geo.radius_km);
                const hasRadiusRule =
                    Number.isFinite(ruleLat) &&
                    Number.isFinite(ruleLng) &&
                    Number.isFinite(ruleRadiusKm) &&
                    ruleRadiusKm > 0;
                const requireLocation = !!geo.require_location || hasRadiusRule;

                if (requireLocation && !hasCoords) {
                    locationAllowed = false;
                    geoMessage = 'Location is required for this service area.';
                }

                // Strict radius enforcement when configured in DB (e.g. 1 km, 5 km, X km).
                if (locationAllowed && hasRadiusRule && hasCoords) {
                    const d = haversineKm(qLat, qLng, ruleLat, ruleLng);
                    if (d > ruleRadiusKm) {
                        locationAllowed = false;
                        geoMessage = `Service is available within ${ruleRadiusKm} km only.`;
                    }
                }

                // Optional city lock (only if DB city is set).
                if (locationAllowed && ruleCity) {
                    if (!qCity) {
                        locationAllowed = false;
                        geoMessage = `Service is currently available only in ${geo.city}.`;
                    } else if (qCity !== ruleCity && !qCity.includes(ruleCity)) {
                        locationAllowed = false;
                        geoMessage = `Service is currently available only in ${geo.city}.`;
                    }
                }

                if (!locationAllowed) {
                    return res.json({
                        success: true,
                        stores: [],
                        service_limited: true,
                        service_message: geoMessage || 'Service is not available in your area.'
                    });
                }
            }
        }

        if (liteMode) {
            return res.json({
                success: true,
                stores: (stores || []).map((store) => ({
                    id: store.id,
                    name: store.name,
                    payment_term: store.payment_term || null,
                    payment_grace_days: store.payment_grace_days === null || store.payment_grace_days === undefined ? null : Number(store.payment_grace_days),
                    payment_grace_start_date: store.payment_grace_start_date || null,
                    payment_grace_due_date: calculateGraceDueDate(store.payment_grace_start_date, store.payment_grace_days),
                    grace_alert_muted_until: store.grace_alert_muted_until || null,
                    store_discount_apply_all_products: Number(store.store_discount_apply_all_products || 0),
                    store_discount_percent: store.store_discount_percent === null || store.store_discount_percent === undefined ? null : Number(store.store_discount_percent),
                    bank_id: store.bank_id === null || store.bank_id === undefined ? null : Number(store.bank_id),
                    store_bank_account_title: store.store_bank_account_title || null,
                    store_bank_account_number: store.store_bank_account_number || null,
                    is_active: !!store.is_active,
                    is_customer_visible: Number(store.is_customer_visible ?? 1) === 1,
                    is_closed: !!store.is_closed,
                    status_message: store.status_message || ''
                }))
            });
        }

        res.json({
            success: true,
            stores: stores.map(store => {
                const manuallyClosed = !!store.is_closed;
                const scheduleOpen = calculateIsOpen(store.opening_time, store.closing_time);
                return {
                    id: store.id,
                    name: store.name,
                    location: store.location,
                    opening_time: store.opening_time || null,
                    closing_time: store.closing_time || null,
                    payment_term: store.payment_term || null,
                    payment_grace_days: store.payment_grace_days === null || store.payment_grace_days === undefined ? null : Number(store.payment_grace_days),
                    payment_grace_start_date: store.payment_grace_start_date || null,
                    payment_grace_due_date: calculateGraceDueDate(store.payment_grace_start_date, store.payment_grace_days),
                    grace_alert_muted_until: store.grace_alert_muted_until || null,
                    store_discount_apply_all_products: Number(store.store_discount_apply_all_products || 0),
                    store_discount_percent: store.store_discount_percent === null || store.store_discount_percent === undefined ? null : Number(store.store_discount_percent),
                    latitude: store.latitude,
                    longitude: store.longitude,
                    rating: store.rating,
                    delivery_time: store.delivery_time,
                    phone: store.phone,
                    email: store.email,
                    address: store.address,
                    description: store.description,
                    image_url: store.cover_image || null,
                    is_active: store.is_active,
                    is_customer_visible: Number(store.is_customer_visible ?? 1) === 1,
                    is_closed: manuallyClosed,
                    status_message: store.status_message || '',
                    is_open: !manuallyClosed && scheduleOpen,
                    priority: store.priority || null,
                    owner_id: store.owner_id || null,
                    owner_email: store.owner_email || null,
                    owner_name: store.owner_name || null,
                    bank_id: store.bank_id === null || store.bank_id === undefined ? null : Number(store.bank_id),
                    store_bank_account_title: store.store_bank_account_title || null,
                    store_bank_account_number: store.store_bank_account_number || null,
                    bank_info: store.bank_id ? {
                        id: Number(store.bank_id),
                        name: store.bank_name || null,
                        account_number: store.bank_account_number || null,
                        bank_code: store.bank_code || null,
                        branch_name: store.bank_branch_name || null,
                        account_title: store.bank_account_title || null
                    } : null
                };
            }).sort((a, b) => (b.is_open === true ? 1 : 0) - (a.is_open === true ? 1 : 0))
        });

    } catch (error) {
        console.error('Error fetching stores:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch stores',
            error: error.message
        });
    }
});

router.get('/bank-options', authenticateToken, requireStoreOwner, async (req, res) => {
    try {
        const banksTableExists = await tableExists(req.db, 'banks');
        if (!banksTableExists) {
            return res.json({ success: true, banks: [] });
        }

        const requestedStoreId = parseInt(String(req.query.store_id || ''), 10);
        const requestedIncludeBankId = parseInt(String(req.query.include_bank_id || ''), 10);
        const hasStoreFilter = Number.isInteger(requestedStoreId) && requestedStoreId > 0;

        let banks = [];
        if (hasStoreFilter) {
            const storeQuery = req.user.user_type === 'admin'
                ? 'SELECT id, bank_id FROM stores WHERE id = ? LIMIT 1'
                : 'SELECT id, bank_id FROM stores WHERE id = ? AND owner_id = ? LIMIT 1';
            const storeParams = req.user.user_type === 'admin'
                ? [requestedStoreId]
                : [requestedStoreId, req.user.id];
            const [storeRows] = await req.db.execute(storeQuery, storeParams);

            if (!storeRows.length) {
                return res.status(404).json({
                    success: false,
                    message: 'Store not found'
                });
            }

            const bankIds = [];
            const storeBankId = parseInt(String(storeRows[0].bank_id || ''), 10);
            if (Number.isInteger(storeBankId) && storeBankId > 0) {
                bankIds.push(storeBankId);
            }

            if (
                Number.isInteger(requestedIncludeBankId) &&
                requestedIncludeBankId > 0 &&
                !bankIds.includes(requestedIncludeBankId)
            ) {
                bankIds.push(requestedIncludeBankId);
            }

            if (!bankIds.length) {
                return res.json({ success: true, banks: [] });
            }

            const placeholders = bankIds.map(() => '?').join(', ');
            const [filteredBanks] = await req.db.execute(
                `SELECT id, name, account_number, bank_code, branch_name, account_title
                 FROM banks
                 WHERE id IN (${placeholders})
                 ORDER BY name ASC`,
                bankIds
            );
            banks = filteredBanks || [];
        } else {
            const [allBanks] = await req.db.execute(
                `SELECT id, name, account_number, bank_code, branch_name, account_title
                 FROM banks
                 ORDER BY name ASC`
            );
            banks = allBanks || [];
        }

        return res.json({
            success: true,
            banks: (banks || []).map((b) => ({
                id: Number(b.id),
                name: b.name || '',
                account_number: b.account_number || null,
                bank_code: b.bank_code || null,
                branch_name: b.branch_name || null,
                account_title: b.account_title || null
            }))
        });
    } catch (error) {
        console.error('Error fetching bank options:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch bank options',
            error: error.message
        });
    }
});

// Get store by ID
router.get('/status-message', authenticateToken, requireStoreOwner, async (req, res) => {
    try {
        await ensureStoreStatusMessagesTable(req.db);

        const requestedStoreId = req.query.store_id === undefined
            ? null
            : parseInt(String(req.query.store_id), 10);

        let storeId = null;
        if (req.user.user_type === 'admin') {
            if (!Number.isInteger(requestedStoreId) || requestedStoreId <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'store_id is required for admin users'
                });
            }
            storeId = requestedStoreId;
        } else {
            if (Number.isInteger(requestedStoreId) && requestedStoreId > 0) {
                const [owned] = await req.db.execute(
                    'SELECT id FROM stores WHERE id = ? AND owner_id = ? LIMIT 1',
                    [requestedStoreId, req.user.id]
                );
                if (!owned.length) {
                    return res.status(403).json({
                        success: false,
                        message: 'You do not have permission for this store'
                    });
                }
                storeId = requestedStoreId;
            } else {
                const [ownedStores] = await req.db.execute(
                    'SELECT id FROM stores WHERE owner_id = ? ORDER BY id ASC LIMIT 1',
                    [req.user.id]
                );
                if (!ownedStores.length) {
                    return res.status(404).json({
                        success: false,
                        message: 'No store found for this owner'
                    });
                }
                storeId = ownedStores[0].id;
            }
        }

        const [existingStore] = await req.db.execute(
            'SELECT id FROM stores WHERE id = ? LIMIT 1',
            [storeId]
        );
        if (!existingStore.length) {
            return res.status(404).json({
                success: false,
                message: 'Store not found'
            });
        }

        const [rows] = await req.db.execute(
            'SELECT status_message, is_closed, updated_at FROM store_status_messages WHERE store_id = ? LIMIT 1',
            [storeId]
        );

        const row = rows[0] || null;
        return res.json({
            success: true,
            store_id: storeId,
            status_message: row?.status_message || '',
            is_closed: !!row?.is_closed,
            updated_at: row?.updated_at || null
        });
    } catch (error) {
        console.error('Error fetching store status message:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch store status message',
            error: error.message
        });
    }
});

router.put('/status-message', authenticateToken, requireStoreOwner, async (req, res) => {
    try {
        await ensureStoreStatusMessagesTable(req.db);

        const requestedStoreId = req.body.store_id === undefined
            ? null
            : parseInt(String(req.body.store_id), 10);
        const rawMessage = (req.body.status_message ?? '').toString();
        const isClosed = !!req.body.is_closed;
        const statusMessage = rawMessage.trim();

        if (statusMessage.length > 500) {
            return res.status(400).json({
                success: false,
                message: 'Status message must be 500 characters or less'
            });
        }

        let storeId = null;
        if (req.user.user_type === 'admin') {
            if (!Number.isInteger(requestedStoreId) || requestedStoreId <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'store_id is required for admin users'
                });
            }
            storeId = requestedStoreId;
        } else {
            if (Number.isInteger(requestedStoreId) && requestedStoreId > 0) {
                const [owned] = await req.db.execute(
                    'SELECT id FROM stores WHERE id = ? AND owner_id = ? LIMIT 1',
                    [requestedStoreId, req.user.id]
                );
                if (!owned.length) {
                    return res.status(403).json({
                        success: false,
                        message: 'You do not have permission for this store'
                    });
                }
                storeId = requestedStoreId;
            } else {
                const [ownedStores] = await req.db.execute(
                    'SELECT id FROM stores WHERE owner_id = ? ORDER BY id ASC LIMIT 1',
                    [req.user.id]
                );
                if (!ownedStores.length) {
                    return res.status(404).json({
                        success: false,
                        message: 'No store found for this owner'
                    });
                }
                storeId = ownedStores[0].id;
            }
        }

        const [existingStore] = await req.db.execute(
            'SELECT id FROM stores WHERE id = ? LIMIT 1',
            [storeId]
        );
        if (!existingStore.length) {
            return res.status(404).json({
                success: false,
                message: 'Store not found'
            });
        }

        await req.db.execute(
            `
            INSERT INTO store_status_messages (store_id, status_message, is_closed, updated_by)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                status_message = VALUES(status_message),
                is_closed = VALUES(is_closed),
                updated_by = VALUES(updated_by),
                updated_at = CURRENT_TIMESTAMP
            `,
            [storeId, statusMessage || null, isClosed ? 1 : 0, req.user.id]
        );

        return res.json({
            success: true,
            message: 'Store status message updated successfully',
            store_id: storeId,
            status_message: statusMessage,
            is_closed: isClosed
        });
    } catch (error) {
        console.error('Error updating store status message:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to update store status message',
            error: error.message
        });
    }
});

router.get('/global-delivery-status', async (req, res) => {
    try {
        await ensureOnce('global-delivery-status-schema', () => ensureGlobalDeliveryStatusTable(req.db));
        const [rows] = await req.db.execute(
            `SELECT id, is_enabled, block_ordering, title, status_message, start_at, end_at, updated_at
             FROM global_delivery_status
             ORDER BY id DESC
             LIMIT 1`
        );
        let row = rows[0] || null;
        if (row?.is_enabled && row?.end_at) {
            const endAt = new Date(row.end_at);
            if (!Number.isNaN(endAt.getTime()) && new Date() > endAt) {
                await req.db.execute(
                    `UPDATE global_delivery_status
                     SET is_enabled = 0,
                         block_ordering = 0,
                         title = NULL,
                         status_message = NULL,
                         start_at = NULL,
                         end_at = NULL,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [row.id]
                );
                row = null;
            }
        }
        const payload = getGlobalDeliveryStatusPayload(row);
        return res.json({
            success: true,
            global_delivery_status: payload
        });
    } catch (error) {
        console.error('Error fetching global delivery status:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch global delivery status',
            error: error.message
        });
    }
});

router.get('/notification-customers', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [rows] = await req.db.execute(
            `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.address,
                    (
                        SELECT o.delivery_address
                        FROM orders o
                        WHERE o.user_id = u.id
                        ORDER BY o.created_at DESC, o.id DESC
                        LIMIT 1
                    ) AS recent_delivery_address,
                    (
                        SELECT o.special_instructions
                        FROM orders o
                        WHERE o.user_id = u.id
                        ORDER BY o.created_at DESC, o.id DESC
                        LIMIT 1
                    ) AS recent_special_instructions
             FROM users u
             WHERE (u.user_type IS NULL OR u.user_type = '' OR LOWER(u.user_type) IN ('customer', 'standard_user'))
               AND (u.is_active IS NULL OR u.is_active = 1)
             ORDER BY u.id DESC
             LIMIT 500`
        );
        return res.json({
            success: true,
            customers: rows || []
        });
    } catch (error) {
        console.error('Error fetching notification customers:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch customers',
            error: error.message
        });
    }
});

router.post('/customer-push-notification', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const notificationTarget = (req.body.notification_target || 'all').toString().toLowerCase() === 'custom' ? 'custom' : 'all';
        const customCustomerIds = normalizeCustomerIds(req.body.customer_ids);
        const title = (req.body.title ?? '').toString().trim();
        const message = (req.body.message ?? '').toString().trim();
        const category = (req.body.category ?? 'general').toString().trim() || 'general';

        if (!title || title.length > 120) {
            return res.status(400).json({
                success: false,
                message: 'Title is required and must be 120 characters or less'
            });
        }
        if (!message || message.length > 500) {
            return res.status(400).json({
                success: false,
                message: 'Message is required and must be 500 characters or less'
            });
        }
        if (notificationTarget === 'custom' && !customCustomerIds.length) {
            return res.status(400).json({
                success: false,
                message: 'Please select at least one customer for custom push notifications'
            });
        }

        const recipients = await getTargetCustomers(req.db, notificationTarget, customCustomerIds);
        let pushed = 0;
        for (const recipient of recipients) {
            await sendPushToUser(req.db, {
                userId: recipient.id,
                userType: recipient.user_type,
                title,
                message,
                data: {
                    type: 'customer_broadcast',
                    category,
                    notification_target: notificationTarget
                },
                collapseKey: `customer_broadcast_${category}`
            });
            try {
                req.io?.to(`user_${recipient.id}`).emit('user_notification', {
                    user_id: recipient.id,
                    type: 'customer_broadcast',
                    title,
                    message,
                    category
                });
            } catch (_) {}
            pushed++;
        }

        return res.json({
            success: true,
            message: 'Customer push notification sent successfully',
            push_notification: {
                target: notificationTarget,
                category,
                recipient_count: recipients.length,
                pushed_count: pushed
            }
        });
    } catch (error) {
        console.error('Error sending customer push notification:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to send customer push notification',
            error: error.message
        });
    }
});

router.get('/app-update-status', authenticateToken, async (req, res) => {
    try {
        const settings = await getAppUpdateSettings(req.db);
        return res.json({
            success: true,
            app_update: settings
        });
    } catch (error) {
        console.error('Error fetching app update status:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch app update status',
            error: error.message
        });
    }
});

router.post('/app-update-notification', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const audience = (req.body.audience || 'all').toString().trim().toLowerCase();
        const version = (req.body.version || '').toString().trim();
        const title = (req.body.title || '').toString().trim() || 'App Update Available';
        const message = (req.body.message || '').toString().trim();
        const playStoreUrl = (req.body.play_store_url || '').toString().trim() ||
            'https://play.google.com/store/apps/details?id=com.onenetsol.servenow';
        const minimumSupportedVersion = (req.body.minimum_supported_version || '').toString().trim();
        const forceUpdate = !!req.body.force_update;

        if (title.length > 120) {
            return res.status(400).json({
                success: false,
                message: 'Title must be 120 characters or less'
            });
        }
        if (!message || message.length > 500) {
            return res.status(400).json({
                success: false,
                message: 'Message is required and must be 500 characters or less'
            });
        }
        if (version && version.length > 40) {
            return res.status(400).json({
                success: false,
                message: 'Version must be 40 characters or less'
            });
        }
        if (minimumSupportedVersion && minimumSupportedVersion.length > 40) {
            return res.status(400).json({
                success: false,
                message: 'Minimum supported version must be 40 characters or less'
            });
        }

        if (version) {
            await saveAppUpdateSettings(req.db, {
                version,
                title,
                message,
                playStoreUrl,
                minimumSupportedVersion,
                forceUpdate,
                reminderHour: 12
            });
        }

        const recipients = await getTargetAppUsers(req.db, audience);
        if (!recipients.length) {
            return res.status(404).json({
                success: false,
                message: 'No active app device tokens found for the selected audience'
            });
        }

        let pushed = 0;
        let failed = 0;
        let skipped = 0;
        const skipReasons = new Set();
        for (const recipient of recipients) {
            const result = await sendPushToUser(req.db, {
                userId: recipient.id,
                userType: recipient.user_type,
                title,
                message,
                data: {
                    type: 'app_update_available',
                    version,
                    play_store_url: playStoreUrl,
                    android_package: 'com.onenetsol.servenow',
                    minimum_supported_version: minimumSupportedVersion,
                    force_update: forceUpdate ? '1' : '0',
                    reminder_hour: '12'
                },
                collapseKey: version ? `app_update_${version}` : 'app_update_available'
            });
            pushed += Number(result.sent || 0);
            failed += Number(result.failed || 0);
            if (result.skipped) {
                skipped += 1;
                if (result.reason) skipReasons.add(result.reason);
                if (result.reason === 'firebase_not_ready') break;
            }
        }

        if (pushed === 0) {
            const reasons = Array.from(skipReasons);
            let message = 'Failed to send app update notification';
            if (reasons.includes('firebase_not_ready')) {
                message = 'Push service is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH.';
            } else if (reasons.includes('no_tokens')) {
                message = 'No active push tokens found. Ask users to open the app so their device token registers.';
            }
            return res.status(500).json({
                success: false,
                message,
                push_notification: {
                    audience,
                    version: version || null,
                    recipient_count: recipients.length,
                    pushed_count: pushed,
                    failed_count: failed,
                    skipped_count: skipped,
                    skip_reasons: reasons
                }
            });
        }

        return res.json({
            success: true,
            message: 'App update notification sent successfully',
            push_notification: {
                audience,
                version: version || null,
                recipient_count: recipients.length,
                pushed_count: pushed,
                failed_count: failed,
                skipped_count: skipped,
                skip_reasons: Array.from(skipReasons)
            }
        });
    } catch (error) {
        console.error('Error sending app update push notification:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to send app update notification',
            error: error.message
        });
    }
});

router.get('/push-status', authenticateToken, requireAdmin, async (req, res) => {
    try {
        await ensurePushDeviceTokensTable(req.db);
        const [rows] = await req.db.execute(
            `SELECT LOWER(COALESCE(platform, 'unknown')) AS platform,
                    COUNT(*) AS active_tokens,
                    MAX(last_seen_at) AS last_seen
             FROM push_device_tokens
             WHERE is_active = 1
             GROUP BY LOWER(COALESCE(platform, 'unknown'))
             ORDER BY platform`
        );
        return res.json({
            success: true,
            push_service: getPushServiceStatus(),
            tokens: rows || []
        });
    } catch (error) {
        console.error('Error fetching push status:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch push status',
            error: error.message
        });
    }
});

router.put('/global-delivery-status', authenticateToken, requireAdmin, async (req, res) => {
    try {
        await ensureGlobalDeliveryStatusTable(req.db);
        const isEnabled = !!req.body.is_enabled;
        const blockOrdering = !!req.body.block_ordering;
        const title = (req.body.title ?? '').toString().trim();
        const statusMessage = (req.body.status_message ?? '').toString().trim();
        const startAt = normalizeDateTimeInput(req.body.start_at);
        const endAt = normalizeDateTimeInput(req.body.end_at);
        const sendPush = !!req.body.send_push_notification;
        const notificationTarget = (req.body.notification_target || 'all').toString().toLowerCase() === 'custom' ? 'custom' : 'all';
        const customCustomerIds = normalizeCustomerIds(req.body.customer_ids);
        const pushTitle = (req.body.push_title ?? '').toString().trim();
        const pushMessageRaw = (req.body.push_message ?? '').toString().trim();

        if (statusMessage.length > 500) {
            return res.status(400).json({
                success: false,
                message: 'Status message must be 500 characters or less'
            });
        }

        if (title.length > 120) {
            return res.status(400).json({
                success: false,
                message: 'Title must be 120 characters or less'
            });
        }

        if (isEnabled && (!startAt || !endAt)) {
            return res.status(400).json({
                success: false,
                message: 'Start and end time are required when delivery notice is enabled'
            });
        }

        if (startAt && endAt && new Date(startAt) >= new Date(endAt)) {
            return res.status(400).json({
                success: false,
                message: 'End time must be after start time'
            });
        }

        await req.db.execute(
            `INSERT INTO global_delivery_status (is_enabled, block_ordering, title, status_message, start_at, end_at, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [isEnabled ? 1 : 0, blockOrdering ? 1 : 0, title || null, statusMessage || null, startAt, endAt, req.user.id]
        );

        const [rows] = await req.db.execute(
            `SELECT is_enabled, block_ordering, title, status_message, start_at, end_at, updated_at
             FROM global_delivery_status
             ORDER BY id DESC
             LIMIT 1`
        );
        const payload = getGlobalDeliveryStatusPayload(rows[0] || null);
        let pushed = 0;
        if (sendPush) {
            const recipients = await getTargetCustomers(req.db, notificationTarget, customCustomerIds);
            const notifTitle = pushTitle || (title || 'Delivery Update');
            const notifMessage = pushMessageRaw || (statusMessage || 'Please check latest delivery status.');
            for (const recipient of recipients) {
                await sendPushToUser(req.db, {
                    userId: recipient.id,
                    userType: recipient.user_type,
                    title: notifTitle,
                    message: notifMessage,
                    data: {
                        type: 'global_delivery_status',
                        is_enabled: payload.is_enabled,
                        block_ordering: payload.block_ordering,
                        start_at: payload.start_at,
                        end_at: payload.end_at
                    },
                    collapseKey: 'global_delivery_status'
                });
                try {
                    req.io?.to(`user_${recipient.id}`).emit('user_notification', {
                        user_id: recipient.id,
                        type: 'global_delivery_status',
                        title: notifTitle,
                        message: notifMessage,
                        data: {
                            is_enabled: payload.is_enabled,
                            block_ordering: payload.block_ordering,
                            start_at: payload.start_at,
                            end_at: payload.end_at
                        }
                    });
                } catch (_) {}
                pushed++;
            }
        }

        return res.json({
            success: true,
            message: 'Global delivery status updated successfully',
            global_delivery_status: payload,
            push_notification: {
                requested: sendPush,
                target: notificationTarget,
                pushed_count: pushed
            }
        });
    } catch (error) {
        console.error('Error updating global delivery status:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to update global delivery status',
            error: error.message
        });
    }
});

router.get('/live-promotions', async (req, res) => {
    try {
        await ensureOnce('live-promotions-schema', () => ensureLivePromotionsTable(req.db));
        const [rows] = await req.db.execute(
            `SELECT id, is_enabled, title, status_message, start_at, end_at, widget_images_json, updated_at
             FROM live_promotions
             ORDER BY id DESC
             LIMIT 1`
        );
        let row = rows[0] || null;
        if (row?.is_enabled && row?.end_at) {
            const endAt = new Date(row.end_at);
            if (!Number.isNaN(endAt.getTime()) && new Date() > endAt) {
                await req.db.execute(
                    `UPDATE live_promotions
                     SET is_enabled = 0,
                         title = NULL,
                         status_message = NULL,
                         start_at = NULL,
                         end_at = NULL,
                         widget_images_json = NULL,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [row.id]
                );
                row = null;
            }
        }
        return res.json({
            success: true,
            live_promotions: getLivePromotionsPayload(row)
        });
    } catch (error) {
        console.error('Error fetching live promotions:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch live promotions',
            error: error.message
        });
    }
});

router.get('/offer-campaigns', authenticateToken, requireStoreOwner, async (req, res) => {
    try {
        await ensureStoreOfferCampaignTables(req.db);
        const requestedStoreId = req.query.store_id === undefined
            ? null
            : parseInt(String(req.query.store_id), 10);

        let storeId = null;
        if (req.user.user_type === 'admin') {
            if (!Number.isInteger(requestedStoreId) || requestedStoreId <= 0) {
                return res.status(400).json({ success: false, message: 'store_id is required for admin users' });
            }
            storeId = requestedStoreId;
        } else {
            if (Number.isInteger(requestedStoreId) && requestedStoreId > 0) {
                const [owned] = await req.db.execute(
                    'SELECT id FROM stores WHERE id = ? AND owner_id = ? LIMIT 1',
                    [requestedStoreId, req.user.id]
                );
                if (!owned.length) {
                    return res.status(403).json({ success: false, message: 'You do not have permission for this store' });
                }
                storeId = requestedStoreId;
            } else {
                const [ownedStores] = await req.db.execute(
                    'SELECT id FROM stores WHERE owner_id = ? ORDER BY id ASC LIMIT 1',
                    [req.user.id]
                );
                if (!ownedStores.length) {
                    return res.status(404).json({ success: false, message: 'No store found for this owner' });
                }
                storeId = Number(ownedStores[0].id);
            }
        }

        const [rows] = await req.db.execute(
            `
            SELECT c.*
            FROM store_offer_campaigns c
            WHERE c.store_id = ?
            ORDER BY c.id DESC
            `,
            [storeId]
        );
        const campaignIds = (rows || []).map((r) => Number(r.id)).filter((x) => Number.isInteger(x) && x > 0);
        let linked = [];
        if (campaignIds.length) {
            const placeholders = campaignIds.map(() => '?').join(',');
            const [linkedRows] = await req.db.execute(
                `SELECT campaign_id, product_id FROM store_offer_campaign_products WHERE campaign_id IN (${placeholders})`,
                campaignIds
            );
            linked = linkedRows || [];
        }
        const productIdsByCampaign = {};
        for (const row of linked) {
            const cid = Number(row.campaign_id);
            const pid = Number(row.product_id);
            if (!Number.isInteger(cid) || !Number.isInteger(pid)) continue;
            if (!productIdsByCampaign[cid]) productIdsByCampaign[cid] = [];
            productIdsByCampaign[cid].push(pid);
        }

        const campaigns = (rows || []).map((c) => {
            const payload = {
                id: Number(c.id),
                store_id: Number(c.store_id),
                name: c.name || '',
                description: c.description || '',
                campaign_type: c.campaign_type || 'discount',
                discount_type: c.discount_type || null,
                discount_value: c.discount_value === null || c.discount_value === undefined ? null : Number(c.discount_value),
                buy_qty: c.buy_qty === null || c.buy_qty === undefined ? null : Number(c.buy_qty),
                get_qty: c.get_qty === null || c.get_qty === undefined ? null : Number(c.get_qty),
                apply_scope: c.apply_scope || 'all_products',
                is_enabled: Number(c.is_enabled || 0) === 1,
                start_at: c.start_at || null,
                end_at: c.end_at || null,
                created_at: c.created_at || null,
                updated_at: c.updated_at || null,
                product_ids: productIdsByCampaign[Number(c.id)] || []
            };
            payload.is_active_now = isCampaignActiveNow(payload);
            payload.offer_badge = campaignBadge(payload);
            return payload;
        });

        return res.json({
            success: true,
            store_id: storeId,
            campaigns
        });
    } catch (error) {
        console.error('Error fetching store offer campaigns:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch offer campaigns',
            error: error.message
        });
    }
});

router.post('/offer-campaigns', authenticateToken, requireStoreOwner, async (req, res) => {
    try {
        await ensureStoreOfferCampaignTables(req.db);

        const requestedStoreId = parseInt(String(req.body.store_id || ''), 10);
        let storeId = null;
        if (req.user.user_type === 'admin') {
            if (!Number.isInteger(requestedStoreId) || requestedStoreId <= 0) {
                return res.status(400).json({ success: false, message: 'store_id is required for admin users' });
            }
            storeId = requestedStoreId;
        } else {
            if (Number.isInteger(requestedStoreId) && requestedStoreId > 0) {
                const [owned] = await req.db.execute(
                    'SELECT id FROM stores WHERE id = ? AND owner_id = ? LIMIT 1',
                    [requestedStoreId, req.user.id]
                );
                if (!owned.length) return res.status(403).json({ success: false, message: 'You do not have permission for this store' });
                storeId = requestedStoreId;
            } else {
                const [ownedStores] = await req.db.execute(
                    'SELECT id FROM stores WHERE owner_id = ? ORDER BY id ASC LIMIT 1',
                    [req.user.id]
                );
                if (!ownedStores.length) return res.status(404).json({ success: false, message: 'No store found for this owner' });
                storeId = Number(ownedStores[0].id);
            }
        }

        const name = String(req.body.name || '').trim();
        const description = String(req.body.description || '').trim();
        const campaignType = String(req.body.campaign_type || 'discount').toLowerCase() === 'bxgy' ? 'bxgy' : 'discount';
        const discountType = String(req.body.discount_type || 'amount').toLowerCase() === 'percent' ? 'percent' : 'amount';
        const discountValue = req.body.discount_value === null || req.body.discount_value === undefined || String(req.body.discount_value).trim() === ''
            ? null
            : Number(req.body.discount_value);
        const buyQty = req.body.buy_qty === null || req.body.buy_qty === undefined || String(req.body.buy_qty).trim() === ''
            ? null
            : parseInt(String(req.body.buy_qty), 10);
        const getQty = req.body.get_qty === null || req.body.get_qty === undefined || String(req.body.get_qty).trim() === ''
            ? null
            : parseInt(String(req.body.get_qty), 10);
        const applyScope = String(req.body.apply_scope || 'all_products').toLowerCase() === 'selected_products'
            ? 'selected_products'
            : 'all_products';
        const isEnabled = req.body.is_enabled === undefined ? true : !!req.body.is_enabled;
        const startAtRaw = String(req.body.start_at || '').trim();
        const endAtRaw = String(req.body.end_at || '').trim();
        const selectedProductIds = Array.isArray(req.body.product_ids)
            ? req.body.product_ids.map((x) => parseInt(String(x), 10)).filter((x) => Number.isInteger(x) && x > 0)
            : [];

        if (!name || name.length > 160) {
            return res.status(400).json({ success: false, message: 'Campaign name is required (max 160 chars)' });
        }
        if (!startAtRaw || !endAtRaw) {
            return res.status(400).json({ success: false, message: 'Start and end time are required' });
        }
        const startAt = startAtRaw.replace('T', ' ');
        const endAt = endAtRaw.replace('T', ' ');
        if (new Date(startAt) >= new Date(endAt)) {
            return res.status(400).json({ success: false, message: 'End time must be after start time' });
        }
        if (campaignType === 'discount') {
            if (!Number.isFinite(discountValue) || discountValue <= 0) {
                return res.status(400).json({ success: false, message: 'Discount value must be greater than 0' });
            }
        } else {
            if (!Number.isInteger(buyQty) || !Number.isInteger(getQty) || buyQty <= 0 || getQty <= 0) {
                return res.status(400).json({ success: false, message: 'Buy/Get quantity must be positive integers' });
            }
        }
        if (applyScope === 'selected_products' && !selectedProductIds.length) {
            return res.status(400).json({ success: false, message: 'Please select at least one product for selected-products scope' });
        }

        const [insertResult] = await req.db.execute(
            `
            INSERT INTO store_offer_campaigns
            (store_id, name, description, campaign_type, discount_type, discount_value, buy_qty, get_qty, apply_scope, is_enabled, start_at, end_at, created_by, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                storeId,
                name,
                description || null,
                campaignType,
                campaignType === 'discount' ? discountType : null,
                campaignType === 'discount' ? Number(discountValue) : null,
                campaignType === 'bxgy' ? buyQty : null,
                campaignType === 'bxgy' ? getQty : null,
                applyScope,
                isEnabled ? 1 : 0,
                startAt,
                endAt,
                req.user.id,
                req.user.id
            ]
        );
        const campaignId = Number(insertResult.insertId);

        if (applyScope === 'selected_products' && selectedProductIds.length) {
            const placeholders = selectedProductIds.map(() => '(?, ?)').join(',');
            const params = [];
            selectedProductIds.forEach((pid) => {
                params.push(campaignId, pid);
            });
            await req.db.execute(
                `INSERT IGNORE INTO store_offer_campaign_products (campaign_id, product_id) VALUES ${placeholders}`,
                params
            );
        }

        return res.json({
            success: true,
            message: 'Offer campaign created successfully',
            campaign_id: campaignId
        });
    } catch (error) {
        console.error('Error creating store offer campaign:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to create offer campaign',
            error: error.message
        });
    }
});

router.put('/offer-campaigns/:id', authenticateToken, requireStoreOwner, async (req, res) => {
    try {
        await ensureStoreOfferCampaignTables(req.db);
        const campaignId = parseInt(String(req.params.id), 10);
        if (!Number.isInteger(campaignId) || campaignId <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid campaign id' });
        }

        const [rows] = await req.db.execute('SELECT * FROM store_offer_campaigns WHERE id = ? LIMIT 1', [campaignId]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Campaign not found' });
        const current = rows[0];

        if (req.user.user_type !== 'admin') {
            const [owned] = await req.db.execute(
                'SELECT id FROM stores WHERE id = ? AND owner_id = ? LIMIT 1',
                [current.store_id, req.user.id]
            );
            if (!owned.length) return res.status(403).json({ success: false, message: 'You do not have permission for this campaign' });
        }

        const name = String(req.body.name ?? current.name ?? '').trim();
        const description = String(req.body.description ?? current.description ?? '').trim();
        const campaignType = String(req.body.campaign_type || current.campaign_type || 'discount').toLowerCase() === 'bxgy' ? 'bxgy' : 'discount';
        const discountType = String(req.body.discount_type || current.discount_type || 'amount').toLowerCase() === 'percent' ? 'percent' : 'amount';
        const discountValue = req.body.discount_value === undefined
            ? (current.discount_value === null || current.discount_value === undefined ? null : Number(current.discount_value))
            : (String(req.body.discount_value).trim() === '' ? null : Number(req.body.discount_value));
        const buyQty = req.body.buy_qty === undefined
            ? (current.buy_qty === null || current.buy_qty === undefined ? null : Number(current.buy_qty))
            : (String(req.body.buy_qty).trim() === '' ? null : parseInt(String(req.body.buy_qty), 10));
        const getQty = req.body.get_qty === undefined
            ? (current.get_qty === null || current.get_qty === undefined ? null : Number(current.get_qty))
            : (String(req.body.get_qty).trim() === '' ? null : parseInt(String(req.body.get_qty), 10));
        const applyScope = req.body.apply_scope === undefined
            ? (current.apply_scope || 'all_products')
            : (String(req.body.apply_scope).toLowerCase() === 'selected_products' ? 'selected_products' : 'all_products');
        const isEnabled = req.body.is_enabled === undefined ? Number(current.is_enabled || 0) === 1 : !!req.body.is_enabled;
        const startAt = req.body.start_at === undefined
            ? current.start_at
            : String(req.body.start_at || '').trim().replace('T', ' ');
        const endAt = req.body.end_at === undefined
            ? current.end_at
            : String(req.body.end_at || '').trim().replace('T', ' ');
        const selectedProductIds = Array.isArray(req.body.product_ids)
            ? req.body.product_ids.map((x) => parseInt(String(x), 10)).filter((x) => Number.isInteger(x) && x > 0)
            : null;

        if (!name || name.length > 160) {
            return res.status(400).json({ success: false, message: 'Campaign name is required (max 160 chars)' });
        }
        if (!startAt || !endAt || new Date(startAt) >= new Date(endAt)) {
            return res.status(400).json({ success: false, message: 'Valid start/end time is required' });
        }
        if (campaignType === 'discount') {
            if (!Number.isFinite(discountValue) || discountValue <= 0) {
                return res.status(400).json({ success: false, message: 'Discount value must be greater than 0' });
            }
        } else if (!Number.isInteger(buyQty) || !Number.isInteger(getQty) || buyQty <= 0 || getQty <= 0) {
            return res.status(400).json({ success: false, message: 'Buy/Get quantity must be positive integers' });
        }

        await req.db.execute(
            `
            UPDATE store_offer_campaigns
            SET name = ?, description = ?, campaign_type = ?, discount_type = ?, discount_value = ?, buy_qty = ?, get_qty = ?,
                apply_scope = ?, is_enabled = ?, start_at = ?, end_at = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [
                name,
                description || null,
                campaignType,
                campaignType === 'discount' ? discountType : null,
                campaignType === 'discount' ? Number(discountValue) : null,
                campaignType === 'bxgy' ? buyQty : null,
                campaignType === 'bxgy' ? getQty : null,
                applyScope,
                isEnabled ? 1 : 0,
                startAt,
                endAt,
                req.user.id,
                campaignId
            ]
        );

        if (selectedProductIds) {
            await req.db.execute('DELETE FROM store_offer_campaign_products WHERE campaign_id = ?', [campaignId]);
            if (applyScope === 'selected_products' && selectedProductIds.length) {
                const placeholders = selectedProductIds.map(() => '(?, ?)').join(',');
                const params = [];
                selectedProductIds.forEach((pid) => params.push(campaignId, pid));
                await req.db.execute(
                    `INSERT IGNORE INTO store_offer_campaign_products (campaign_id, product_id) VALUES ${placeholders}`,
                    params
                );
            }
        }

        return res.json({ success: true, message: 'Offer campaign updated successfully' });
    } catch (error) {
        console.error('Error updating store offer campaign:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to update offer campaign',
            error: error.message
        });
    }
});

router.delete('/offer-campaigns/:id', authenticateToken, requireStoreOwner, async (req, res) => {
    try {
        await ensureStoreOfferCampaignTables(req.db);
        const campaignId = parseInt(String(req.params.id), 10);
        if (!Number.isInteger(campaignId) || campaignId <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid campaign id' });
        }

        const [rows] = await req.db.execute('SELECT id, store_id FROM store_offer_campaigns WHERE id = ? LIMIT 1', [campaignId]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Campaign not found' });
        const row = rows[0];
        if (req.user.user_type !== 'admin') {
            const [owned] = await req.db.execute(
                'SELECT id FROM stores WHERE id = ? AND owner_id = ? LIMIT 1',
                [row.store_id, req.user.id]
            );
            if (!owned.length) return res.status(403).json({ success: false, message: 'You do not have permission for this campaign' });
        }

        await req.db.execute('DELETE FROM store_offer_campaigns WHERE id = ?', [campaignId]);
        return res.json({ success: true, message: 'Offer campaign deleted successfully' });
    } catch (error) {
        console.error('Error deleting store offer campaign:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to delete offer campaign',
            error: error.message
        });
    }
});

router.put('/live-promotions', authenticateToken, requireAdmin, async (req, res) => {
    try {
        await ensureLivePromotionsTable(req.db);
        const isEnabled = !!req.body.is_enabled;
        const title = (req.body.title ?? '').toString().trim();
        const statusMessage = (req.body.status_message ?? '').toString().trim();
        const startAt = normalizeDateTimeInput(req.body.start_at);
        const endAt = normalizeDateTimeInput(req.body.end_at);
        const widgetImages = normalizeWidgetImages(req.body.widget_images);

        if (title.length > 120) {
            return res.status(400).json({
                success: false,
                message: 'Title must be 120 characters or less'
            });
        }
        if (statusMessage.length > 500) {
            return res.status(400).json({
                success: false,
                message: 'Message must be 500 characters or less'
            });
        }
        if (isEnabled && (!startAt || !endAt)) {
            return res.status(400).json({
                success: false,
                message: 'Start and end time are required when promotions are enabled'
            });
        }
        if (startAt && endAt && new Date(startAt) >= new Date(endAt)) {
            return res.status(400).json({
                success: false,
                message: 'End time must be after start time'
            });
        }
        if (isEnabled && !widgetImages.length) {
            return res.status(400).json({
                success: false,
                message: 'At least one live widget image is required'
            });
        }

        await req.db.execute(
            `INSERT INTO live_promotions (is_enabled, title, status_message, start_at, end_at, widget_images_json, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                isEnabled ? 1 : 0,
                title || null,
                statusMessage || null,
                startAt,
                endAt,
                widgetImages.length ? JSON.stringify(widgetImages) : null,
                req.user.id
            ]
        );

        const [rows] = await req.db.execute(
            `SELECT is_enabled, title, status_message, start_at, end_at, widget_images_json, updated_at
             FROM live_promotions
             ORDER BY id DESC
             LIMIT 1`
        );
        return res.json({
            success: true,
            message: 'Live promotions updated successfully',
            live_promotions: getLivePromotionsPayload(rows[0] || null)
        });
    } catch (error) {
        console.error('Error updating live promotions:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to update live promotions',
            error: error.message
        });
    }
});

router.get('/customer-flash-message', authenticateToken, async (req, res) => {
    try {
        await ensureOnce('customer-flash-message-schema', () => ensureCustomerFlashMessagesTable(req.db));
        const [rows] = await req.db.execute(
            `SELECT id, is_enabled, title, status_message, image_url, start_at, end_at, notification_target, customer_ids_json, updated_at
             FROM customer_flash_messages
             ORDER BY id DESC
             LIMIT 1`
        );
        let row = rows[0] || null;
        if (row?.is_enabled && row?.end_at) {
            const endAt = new Date(row.end_at);
            if (!Number.isNaN(endAt.getTime()) && new Date() > endAt) {
                await req.db.execute(
                    `UPDATE customer_flash_messages
                     SET is_enabled = 0,
                         title = NULL,
                         status_message = NULL,
                         image_url = NULL,
                         start_at = NULL,
                         end_at = NULL,
                         notification_target = 'all',
                         customer_ids_json = NULL,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [row.id]
                );
                row = null;
            }
        }
        return res.json({
            success: true,
            customer_flash_message: getCustomerFlashPayload(row, req.user?.id)
        });
    } catch (error) {
        console.error('Error fetching customer flash message:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch customer flash message',
            error: error.message
        });
    }
});

router.put('/customer-flash-message', authenticateToken, requireAdmin, async (req, res) => {
    try {
        await ensureCustomerFlashMessagesTable(req.db);
        const isEnabled = !!req.body.is_enabled;
        const title = (req.body.title ?? '').toString().trim();
        const statusMessage = (req.body.status_message ?? '').toString().trim();
        const imageUrl = (req.body.image_url ?? '').toString().trim();
        const startAt = normalizeDateTimeInput(req.body.start_at);
        const endAt = normalizeDateTimeInput(req.body.end_at);
        const notificationTarget = (req.body.notification_target || 'all').toString().toLowerCase() === 'custom' ? 'custom' : 'all';
        const customCustomerIds = normalizeCustomerIds(req.body.customer_ids);
        const sendPush = !!req.body.send_push_notification;
        const pushTitle = (req.body.push_title ?? '').toString().trim();
        const pushMessageRaw = (req.body.push_message ?? '').toString().trim();

        if (title.length > 120) {
            return res.status(400).json({
                success: false,
                message: 'Title must be 120 characters or less'
            });
        }
        if (statusMessage.length > 500) {
            return res.status(400).json({
                success: false,
                message: 'Message must be 500 characters or less'
            });
        }
        if (imageUrl.length > 2048) {
            return res.status(400).json({
                success: false,
                message: 'Image URL is too long'
            });
        }
        if (isEnabled && (!startAt || !endAt)) {
            return res.status(400).json({
                success: false,
                message: 'Start and end time are required when flash message is enabled'
            });
        }
        if (startAt && endAt && new Date(startAt) >= new Date(endAt)) {
            return res.status(400).json({
                success: false,
                message: 'End time must be after start time'
            });
        }
        if (notificationTarget === 'custom' && !customCustomerIds.length) {
            return res.status(400).json({
                success: false,
                message: 'Please select at least one customer for custom target'
            });
        }

        await req.db.execute(
            `INSERT INTO customer_flash_messages (is_enabled, title, status_message, image_url, start_at, end_at, notification_target, customer_ids_json, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                isEnabled ? 1 : 0,
                title || null,
                statusMessage || null,
                imageUrl || null,
                startAt,
                endAt,
                notificationTarget,
                customCustomerIds.length ? JSON.stringify(customCustomerIds) : null,
                req.user.id
            ]
        );

        const [rows] = await req.db.execute(
            `SELECT is_enabled, title, status_message, image_url, start_at, end_at, notification_target, customer_ids_json, updated_at
             FROM customer_flash_messages
             ORDER BY id DESC
             LIMIT 1`
        );
        const payload = getCustomerFlashPayload(rows[0] || null, null);

        let pushed = 0;
        if (sendPush) {
            const recipients = await getTargetCustomers(req.db, notificationTarget, customCustomerIds);
            const notifTitle = pushTitle || (title || 'ServeNow Update');
            const notifMessage = pushMessageRaw || (statusMessage || 'Please check latest customer updates.');
            for (const recipient of recipients) {
                await sendPushToUser(req.db, {
                    userId: recipient.id,
                    userType: recipient.user_type,
                    title: notifTitle,
                    message: notifMessage,
                    data: {
                        type: 'customer_flash_message',
                        start_at: payload.start_at,
                        end_at: payload.end_at
                    },
                    collapseKey: 'customer_flash_message'
                });
                try {
                    req.io?.to(`user_${recipient.id}`).emit('user_notification', {
                        user_id: recipient.id,
                        type: 'customer_flash_message',
                        title: notifTitle,
                        message: notifMessage,
                        data: {
                            start_at: payload.start_at,
                            end_at: payload.end_at
                        }
                    });
                } catch (_) {}
                pushed++;
            }
        }

        return res.json({
            success: true,
            message: 'Customer flash message updated successfully',
            customer_flash_message: payload,
            push_notification: {
                requested: sendPush,
                target: notificationTarget,
                pushed_count: pushed
            }
        });
    } catch (error) {
        console.error('Error updating customer flash message:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to update customer flash message',
            error: error.message
        });
    }
});

router.get('/grace-alerts', authenticateToken, requireAdmin, async (req, res) => {
    try {
        await ensureStoreFinancialColumns(req.db);
        const channel = String(req.query.channel || 'web').toLowerCase() === 'mobile' ? 'mobile' : 'web';
        const maxDaysLeft = channel === 'mobile' ? 1 : 2;
        const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');

        const [rows] = await req.db.execute(
            `SELECT
                s.id,
                s.name,
                s.payment_term,
                s.payment_grace_days,
                s.payment_grace_start_date,
                s.grace_alert_muted_until,
                DATE_ADD(s.payment_grace_start_date, INTERVAL s.payment_grace_days DAY) as due_date,
                DATEDIFF(DATE_ADD(s.payment_grace_start_date, INTERVAL s.payment_grace_days DAY), CURDATE()) as days_left
             FROM stores s
             WHERE s.is_active = 1
               AND s.payment_grace_days IS NOT NULL
               AND s.payment_grace_days > 0
               AND s.payment_grace_start_date IS NOT NULL
               AND LOWER(TRIM(COALESCE(s.payment_term, ''))) NOT IN ('cash only', 'credit')
               AND (s.grace_alert_muted_until IS NULL OR s.grace_alert_muted_until <= ?)
               AND DATEDIFF(DATE_ADD(s.payment_grace_start_date, INTERVAL s.payment_grace_days DAY), CURDATE()) <= ?
             ORDER BY days_left ASC, s.id ASC`,
            [nowIso, maxDaysLeft]
        );

        const hasStoreSettlements = await tableExists(req.db, 'store_settlements');
        const alerts = [];
        for (const row of rows || []) {
            const [payableRows] = await req.db.execute(
                `SELECT COALESCE(SUM(
                        GREATEST(
                            0,
                            (oi.price * oi.quantity) -
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
                    ), 0) as payable_amount
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN products p ON p.id = oi.product_id
                 JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
                 WHERE oi.store_id = ?
                   AND o.status = 'delivered'
                   AND DATE(o.created_at) >= ?`,
                [row.id, row.payment_grace_start_date]
            );
            const payableAmount = Number(payableRows?.[0]?.payable_amount || 0);

            let paidAmount = 0;
            if (hasStoreSettlements) {
                const [paidRows] = await req.db.execute(
                    `SELECT COALESCE(SUM(ss.net_amount), 0) as paid_amount
                     FROM store_settlements ss
                     WHERE ss.store_id = ?
                       AND ss.status = 'paid'
                       AND DATE(ss.settlement_date) >= ?`,
                    [row.id, row.payment_grace_start_date]
                );
                paidAmount = Number(paidRows?.[0]?.paid_amount || 0);
            }
            const pendingAmount = Math.max(0, Math.round((payableAmount - paidAmount) * 100) / 100);
            if (pendingAmount <= 0) continue;

            const daysLeft = Number(row.days_left);
            const dueDate = row.due_date ? String(row.due_date).slice(0, 10) : null;
            const severity =
                daysLeft < 0 ? 'overdue' :
                daysLeft === 0 ? 'due_today' :
                daysLeft === 1 ? 'due_1_day' :
                daysLeft === 2 ? 'due_2_days' : 'upcoming';
            alerts.push({
                store_id: Number(row.id),
                store_name: row.name,
                payment_term: row.payment_term || null,
                grace_days: Number(row.payment_grace_days || 0),
                grace_start_date: row.payment_grace_start_date || null,
                due_date: dueDate,
                days_left: Number.isFinite(daysLeft) ? daysLeft : null,
                severity,
                pending_amount: pendingAmount,
                muted_until: row.grace_alert_muted_until || null,
            });
        }

        return res.json({
            success: true,
            channel,
            alerts,
            count: alerts.length,
            generated_at: new Date().toISOString(),
        });
    } catch (error) {
        console.error('Error fetching store grace alerts:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch store grace alerts',
            error: error.message,
        });
    }
});

router.post('/:id/grace-alert-mute', authenticateToken, requireAdmin, async (req, res) => {
    try {
        await ensureStoreFinancialColumns(req.db);
        const storeId = parseInt(String(req.params.id || ''), 10);
        if (!Number.isInteger(storeId) || storeId <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid store id',
            });
        }
        const rawHours = parseInt(String(req.body?.hours || '24'), 10);
        const wantsUnmute = req.body?.unmute === true || (Number.isInteger(rawHours) && rawHours <= 0);
        const muteHours = Number.isInteger(rawHours)
            ? Math.min(24 * 30, Math.max(1, rawHours))
            : 24;
        const mutedUntil = wantsUnmute
            ? null
            : new Date(Date.now() + muteHours * 60 * 60 * 1000)
                .toISOString()
                .slice(0, 19)
                .replace('T', ' ');

        const [result] = await req.db.execute(
            `UPDATE stores
             SET grace_alert_muted_until = ?
             WHERE id = ?`,
            [mutedUntil, storeId]
        );
        if (!result || result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Store not found',
            });
        }
        return res.json({
            success: true,
            message: wantsUnmute
                ? 'Grace alert re-enabled successfully'
                : `Grace alert muted for ${muteHours} hours`,
            muted_until: mutedUntil,
            muted: !wantsUnmute
        });
    } catch (error) {
        console.error('Error muting store grace alert:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to mute store grace alert',
            error: error.message,
        });
    }
});

router.get('/:id', async (req, res) => {
    try {
        await ensureStoreStatusMessagesTable(req.db);
        await ensureStoreFinancialColumns(req.db);
        await ensureStoreCustomerVisibilityColumn(req.db);
        await ensureStoreBankColumn(req.db);
        await ensureStoreBankDetailsColumns(req.db);
        const { id } = req.params;

        const [stores] = await req.db.execute(`
            SELECT s.*, sm.is_closed, sm.status_message, u.first_name as owner_first_name, u.last_name as owner_last_name, u.email as owner_email,
                   b.name AS bank_name, b.account_number AS bank_account_number, b.bank_code AS bank_code,
                   b.branch_name AS bank_branch_name, b.account_title AS bank_account_title
            FROM stores s
            LEFT JOIN store_status_messages sm ON sm.store_id = s.id
            LEFT JOIN users u ON s.owner_id = u.id
            LEFT JOIN banks b ON b.id = s.bank_id
            WHERE s.id = ? AND s.is_active = true AND (? = '1' OR COALESCE(s.is_customer_visible, 1) = 1)
        `, [id, String(req.query?.admin || '0')]);

        if (stores.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Store not found'
            });
        }

        const store = stores[0];

        // Get products for this store
        const [products] = await req.db.execute(`
            SELECT p.*, c.name as category_name, u.name as unit_name, u.abbreviation as unit_abbreviation,
                   sz.label as size_label
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN units u ON p.unit_id = u.id
            LEFT JOIN sizes sz ON p.size_id = sz.id
            WHERE p.store_id = ? AND p.is_available = true
            ORDER BY p.name ASC
        `, [id]);

        const variantsByProductId = await loadProductSizeVariants(req.db, (products || []).map(p => p.id));
        await ensureStoreOfferCampaignTables(req.db);
        const campaignMap = await getActiveStoreCampaignsMap(req.db, [Number(id)]);
        const activeStoreCampaigns = campaignMap[Number(id)] || [];
        const manuallyClosed = !!store.is_closed;
        const scheduleOpen = calculateIsOpen(store.opening_time, store.closing_time);

        res.json({
            success: true,
            store: {
                id: store.id,
                name: store.name,
                location: store.location,
                opening_time: store.opening_time || null,
                closing_time: store.closing_time || null,
                payment_term: store.payment_term || null,
                payment_grace_days: store.payment_grace_days === null || store.payment_grace_days === undefined ? null : Number(store.payment_grace_days),
                payment_grace_start_date: store.payment_grace_start_date || null,
                payment_grace_due_date: calculateGraceDueDate(store.payment_grace_start_date, store.payment_grace_days),
                grace_alert_muted_until: store.grace_alert_muted_until || null,
                store_discount_apply_all_products: Number(store.store_discount_apply_all_products || 0),
                store_discount_percent: store.store_discount_percent === null || store.store_discount_percent === undefined ? null : Number(store.store_discount_percent),
                latitude: store.latitude,
                longitude: store.longitude,
                rating: store.rating,
                delivery_time: store.delivery_time,
                phone: store.phone,
                email: store.email,
                address: store.address,
                description: store.description,
                owner_id: store.owner_id,
                category_id: store.category_id || null,
                bank_id: store.bank_id === null || store.bank_id === undefined ? null : Number(store.bank_id),
                store_bank_account_title: store.store_bank_account_title || null,
                store_bank_account_number: store.store_bank_account_number || null,
                bank_info: store.bank_id ? {
                    id: Number(store.bank_id),
                    name: store.bank_name || null,
                    account_number: store.bank_account_number || null,
                    bank_code: store.bank_code || null,
                    branch_name: store.bank_branch_name || null,
                    account_title: store.bank_account_title || null
                } : null,
                image_url: store.cover_image || null,
                is_closed: manuallyClosed,
                status_message: store.status_message || '',
                is_open: !manuallyClosed && scheduleOpen,
                priority: store.priority || null,
                owner_email: store.owner_email || null,
                owner_name: store.owner_name || null
            },
            active_store_campaigns: activeStoreCampaigns.map((c) => ({
                id: c.id,
                name: c.name,
                description: c.description,
                campaign_type: c.campaign_type,
                discount_type: c.discount_type,
                discount_value: c.discount_value,
                buy_qty: c.buy_qty,
                get_qty: c.get_qty,
                apply_scope: c.apply_scope,
                start_at: c.start_at,
                end_at: c.end_at,
                offer_badge: campaignBadge(c)
            })),
            products: products.map(product => {
                const applicableCampaigns = campaignsForProduct(activeStoreCampaigns, product.id);
                const baseVariants = (variantsByProductId[product.id] && variantsByProductId[product.id].length)
                    ? variantsByProductId[product.id]
                    : (product.size_id || product.unit_id ? [{
                        size_id: product.size_id || null,
                        size_label: product.size_label || null,
                        unit_id: product.unit_id || null,
                        unit_name: product.unit_name || null,
                        unit_abbreviation: product.unit_abbreviation || null,
                        price: Number(product.price),
                        cost_price: product.cost_price === null || product.cost_price === undefined ? null : Number(product.cost_price)
                    }] : []);
                const productOffer = applyBestCampaignToPrice(Number(product.price), applicableCampaigns);
                const enrichedVariants = baseVariants.map((v) => {
                    const offer = applyBestCampaignToPrice(Number(v.price), applicableCampaigns);
                    return {
                        ...v,
                        original_price: offer.original_price,
                        promotional_price: offer.promotional_price,
                        has_active_offer: offer.has_active_offer,
                        offer_badge: offer.offer_badge,
                        offer_meta: offer.offer_meta
                    };
                });
                return {
                    id: product.id,
                    name: product.name,
                    description: product.description,
                    price: product.price,
                    original_price: productOffer.original_price,
                    promotional_price: productOffer.promotional_price,
                    has_active_offer: productOffer.has_active_offer,
                    offer_badge: productOffer.offer_badge,
                    offer_meta: productOffer.offer_meta,
                    image_url: product.image_url,
                    category_name: product.category_name,
                    store_name: store.name,
                    store_id: product.store_id,
                    stock_quantity: product.stock_quantity,
                    is_available: product.is_available,
                    unit_id: product.unit_id,
                    unit_name: product.unit_name,
                    unit_abbreviation: product.unit_abbreviation,
                    size_id: product.size_id,
                    size_label: product.size_label,
                    size_variants: enrichedVariants
                };
            })
        });

    } catch (error) {
        console.error('Error fetching store:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch store',
            error: error.message
        });
    }
});

// Create new store (Admin or Store Owner)
router.post('/', authenticateToken, requireStoreOwner, [
    body('name').trim().isLength({ min: 2 }).withMessage('Store name must be at least 2 characters'),
    body('location').trim().notEmpty().withMessage('Location is required'),
    body('phone').optional().isMobilePhone().withMessage('Please provide a valid phone number'),
    body('email').optional().isEmail().withMessage('Please provide a valid email'),
    body('rating').optional().isFloat({ min: 0, max: 5 }).withMessage('Rating must be between 0 and 5'),
    body('is_customer_visible').optional().isBoolean().withMessage('is_customer_visible must be boolean')
], async (req, res) => {
    try {
        await ensureStoreFinancialColumns(req.db);
        await ensureStoreCustomerVisibilityColumn(req.db);
        await ensureStoreBankColumn(req.db);
        await ensureStoreBankDetailsColumns(req.db);
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const {
            name,
            description,
            owner_name,
            location,
            latitude,
            longitude,
            delivery_time,
            phone,
            email,
            address,
            opening_time, closing_time,
            payment_term,
            payment_grace_days,
            payment_grace_start_date,
            store_discount_apply_all_products,
            store_discount_percent,
            bank_id,
            store_bank_account_title,
            store_bank_account_number,
            image_url,
            rating,
            is_customer_visible
        } = req.body;
        const customerVisible = is_customer_visible === undefined
            ? true
            : (is_customer_visible === true
                || String(is_customer_visible).toLowerCase() === 'true'
                || String(is_customer_visible) === '1');
        const discountApplicable = String(payment_term || '').toLowerCase().includes('discount');
        const applyStoreDiscount = discountApplicable && (
            store_discount_apply_all_products === true
            || String(store_discount_apply_all_products || '').toLowerCase() === 'true'
            || String(store_discount_apply_all_products || '') === '1'
        );
        const parsedStoreDiscountPercentRaw = store_discount_percent === null || store_discount_percent === undefined || String(store_discount_percent).trim() === ''
            ? null
            : Number.parseFloat(String(store_discount_percent));
        const parsedStoreDiscountPercent = applyStoreDiscount && Number.isFinite(parsedStoreDiscountPercentRaw) && parsedStoreDiscountPercentRaw >= 0
            ? parsedStoreDiscountPercentRaw
            : null;
        if (applyStoreDiscount && parsedStoreDiscountPercent === null) {
            return res.status(400).json({
                success: false,
                message: 'Store Discount (%) is required when apply-on-all-products is enabled'
            });
        }
        const parsedGraceDaysRaw = payment_grace_days === null || payment_grace_days === undefined || String(payment_grace_days).trim() === ''
            ? null
            : Math.max(0, parseInt(String(payment_grace_days), 10));
        const graceApplicable = isGraceApplicablePaymentTerm(payment_term);
        const parsedGraceDays = graceApplicable ? parsedGraceDaysRaw : null;
        const parsedGraceStartDate = graceApplicable ? normalizeDateOnlyInput(payment_grace_start_date) : null;
        const parsedStoreBankAccountTitle = String(store_bank_account_title || '').trim() || null;
        const parsedStoreBankAccountNumber = String(store_bank_account_number || '').trim() || null;
        const parsedBankId = bank_id === null || bank_id === undefined || String(bank_id).trim() === ''
            ? null
            : parseInt(String(bank_id), 10);
        if (parsedBankId !== null) {
            if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid bank selection'
                });
            }
            const [bankRows] = await req.db.execute('SELECT id FROM banks WHERE id = ? LIMIT 1', [parsedBankId]);
            if (!bankRows.length) {
                return res.status(400).json({
                    success: false,
                    message: 'Selected bank does not exist'
                });
            }
        }

        if (rating !== undefined && req.user.user_type !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Only admins can set store rating'
            });
        }

        // If user is store owner, they can only create stores for themselves
        // If user is admin, they can create stores for any owner
        const rawOwnerId = req.user.user_type === 'admin' ? (req.body.owner_id ?? req.user.id) : req.user.id;
        const parsedOwnerId = rawOwnerId === null || rawOwnerId === undefined ? null : parseInt(String(rawOwnerId), 10);
        const ownerId = Number.isFinite(parsedOwnerId) && parsedOwnerId > 0 ? parsedOwnerId : null;

        const insertFields = [
            'name',
            'description',
            'owner_name',
            'location',
            'latitude',
            'longitude',
            'delivery_time',
            'opening_time',
            'closing_time',
            'payment_term',
            'payment_grace_days',
            'payment_grace_start_date',
            'store_discount_apply_all_products',
            'store_discount_percent',
            'phone',
            'email',
            'address',
            'bank_id',
            'store_bank_account_title',
            'store_bank_account_number',
            'owner_id',
            'cover_image'
            ,
            'is_customer_visible'
        ];
        const insertValues = [
            name,
            description || null,
            owner_name || null,
            location,
            latitude || null,
            longitude || null,
            delivery_time || null,
            opening_time || null,
            closing_time || null,
            payment_term || null,
            Number.isInteger(parsedGraceDays) ? parsedGraceDays : null,
            parsedGraceStartDate,
            applyStoreDiscount ? 1 : 0,
            parsedStoreDiscountPercent,
            phone || null,
            email || null,
            address || null,
            parsedBankId,
            parsedStoreBankAccountTitle,
            parsedStoreBankAccountNumber,
            ownerId,
            image_url || null,
            customerVisible ? 1 : 0
        ];

        if (rating !== undefined && req.user.user_type === 'admin') {
            const n = parseFloat(rating);
            const safeRating = Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : 0;
            insertFields.push('rating');
            insertValues.push(safeRating);
        }

        const placeholders = insertFields.map(() => '?').join(', ');
        const [result] = await req.db.execute(
            `INSERT INTO stores (${insertFields.join(', ')}) VALUES (${placeholders})`,
            insertValues
        );

        res.status(201).json({
            success: true,
            message: 'Store created successfully',
            store: {
                id: result.insertId,
                name,
                location,
                owner_id: ownerId,
                owner_name: owner_name || null,
                bank_id: parsedBankId,
                store_bank_account_title: parsedStoreBankAccountTitle,
                store_bank_account_number: parsedStoreBankAccountNumber,
                image_url: image_url || null,
                payment_term: payment_term || null,
                payment_grace_days: Number.isInteger(parsedGraceDays) ? parsedGraceDays : null,
                payment_grace_start_date: parsedGraceStartDate,
                payment_grace_due_date: calculateGraceDueDate(parsedGraceStartDate, parsedGraceDays),
                store_discount_apply_all_products: applyStoreDiscount ? 1 : 0,
                store_discount_percent: parsedStoreDiscountPercent,
                is_customer_visible: customerVisible
            }
        });

    } catch (error) {
        console.error('Error creating store:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create store',
            error: error.message
        });
    }
});

// Update store (Admin or Store Owner)
router.put('/:id', authenticateToken, requireStoreOwner, [
    body('name').optional().trim().isLength({ min: 2 }).withMessage('Store name must be at least 2 characters'),
    body('location').optional().trim().notEmpty().withMessage('Location is required'),
    body('phone').optional().trim().matches(/^[\d\s\-\+\(\)]{6,}$/).withMessage('Please provide a valid phone number'),
    body('email').optional().isEmail().withMessage('Please provide a valid email'),
    body('rating').optional().isFloat({ min: 0, max: 5 }).withMessage('Rating must be between 0 and 5'),
    body('priority').custom(val => {
        if (val === null || val === undefined || val === '') return true;
        const num = parseInt(val, 10);
        if (!Number.isInteger(num) || num < 1 || num > 5) {
            throw new Error('Priority must be a number between 1 and 5');
        }
        return true;
    }),
    body('status').optional(),
    body('is_customer_visible').optional().isBoolean().withMessage('is_customer_visible must be boolean')
], async (req, res) => {
    try {
        await ensureStoreFinancialColumns(req.db);
        await ensureStoreCustomerVisibilityColumn(req.db);
        await ensureStoreBankColumn(req.db);
        await ensureStoreBankDetailsColumns(req.db);
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { id } = req.params;

        // Check if store exists and user has permission
        const [stores] = await req.db.execute(
            'SELECT * FROM stores WHERE id = ?',
            [id]
        );

        if (stores.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Store not found'
            });
        }

        const store = stores[0];

        // Check ownership permission
        if (req.user.user_type !== 'admin' && store.owner_id !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to update this store'
            });
        }

        const {
            name,
            description,
            owner_name,
            location,
            latitude,
            longitude,
            delivery_time,
            phone,
            email,
            address,
            is_active,
            opening_time,
            closing_time,
            payment_term,
            payment_grace_days,
            payment_grace_start_date,
            store_discount_apply_all_products,
            store_discount_percent,
            bank_id,
            store_bank_account_title,
            store_bank_account_number,
            image_url,
            rating,
            category_id,
            priority,
            is_customer_visible
        } = req.body;

        // Check priority permission and duplicate prevention
        if (priority !== undefined) {
            if (req.user.user_type !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Only admins can set store priority'
                });
            }
            
            // Allow null to remove priority
            if (priority !== null) {
                const priorityNum = parseInt(priority, 10);
                if (!Number.isInteger(priorityNum) || priorityNum < 1 || priorityNum > 5) {
                    return res.status(400).json({
                        success: false,
                        message: 'Priority must be an integer between 1 and 5'
                    });
                }
                
                // Check if another store already has this priority
                const [existingPriority] = await req.db.execute(
                    'SELECT id FROM stores WHERE priority = ? AND id != ?',
                    [priorityNum, id]
                );
                
                if (existingPriority.length > 0) {
                    return res.status(400).json({
                        success: false,
                        message: `Priority ${priorityNum} is already assigned to another store. Each priority (1-5) can only be used once.`
                    });
                }
            }
        }

        const updateFields = [];
        const updateValues = [];
        if (bank_id !== undefined) {
            const parsedBankId = bank_id === null || String(bank_id).trim() === ''
                ? null
                : parseInt(String(bank_id), 10);
            if (parsedBankId !== null) {
                if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid bank selection'
                    });
                }
                const [bankRows] = await req.db.execute('SELECT id FROM banks WHERE id = ? LIMIT 1', [parsedBankId]);
                if (!bankRows.length) {
                    return res.status(400).json({
                        success: false,
                        message: 'Selected bank does not exist'
                    });
                }
            }
            updateFields.push('bank_id = ?');
            updateValues.push(parsedBankId);
        }
        if (store_bank_account_title !== undefined) {
            updateFields.push('store_bank_account_title = ?');
            updateValues.push(String(store_bank_account_title || '').trim() || null);
        }
        if (store_bank_account_number !== undefined) {
            updateFields.push('store_bank_account_number = ?');
            updateValues.push(String(store_bank_account_number || '').trim() || null);
        }

        if (name !== undefined) { updateFields.push('name = ?'); updateValues.push(name); }
        if (description !== undefined) { updateFields.push('description = ?'); updateValues.push(description); }
        if (owner_name !== undefined) { updateFields.push('owner_name = ?'); updateValues.push(owner_name); }
        if (location !== undefined) { updateFields.push('location = ?'); updateValues.push(location); }
        if (latitude !== undefined) { updateFields.push('latitude = ?'); updateValues.push(latitude); }
        if (longitude !== undefined) { updateFields.push('longitude = ?'); updateValues.push(longitude); }
        if (delivery_time !== undefined) { updateFields.push('delivery_time = ?'); updateValues.push(delivery_time); }
        if (opening_time !== undefined) { updateFields.push('opening_time = ?'); updateValues.push(opening_time); }
        if (closing_time !== undefined) { updateFields.push('closing_time = ?'); updateValues.push(closing_time); }
        const nextPaymentTerm = payment_term !== undefined ? payment_term : store.payment_term;
        const graceApplicable = isGraceApplicablePaymentTerm(nextPaymentTerm);
        const discountApplicable = String(nextPaymentTerm || '').toLowerCase().includes('discount');
        const requestedApplyStoreDiscount = store_discount_apply_all_products !== undefined
            ? (store_discount_apply_all_products === true
                || String(store_discount_apply_all_products || '').toLowerCase() === 'true'
                || String(store_discount_apply_all_products || '') === '1')
            : Number(store.store_discount_apply_all_products || 0) === 1;
        const applyStoreDiscount = discountApplicable ? requestedApplyStoreDiscount : false;
        const parsedStoreDiscountPercentRaw = store_discount_percent === undefined || store_discount_percent === null || String(store_discount_percent).trim() === ''
            ? (store.store_discount_percent === null || store.store_discount_percent === undefined ? null : Number(store.store_discount_percent))
            : Number.parseFloat(String(store_discount_percent));
        const parsedStoreDiscountPercent = applyStoreDiscount && Number.isFinite(parsedStoreDiscountPercentRaw) && parsedStoreDiscountPercentRaw >= 0
            ? parsedStoreDiscountPercentRaw
            : null;
        if (applyStoreDiscount && parsedStoreDiscountPercent === null) {
            return res.status(400).json({
                success: false,
                message: 'Store Discount (%) is required when apply-on-all-products is enabled'
            });
        }
        if (payment_term !== undefined) {
            updateFields.push('payment_term = ?');
            updateValues.push(payment_term);
            updateFields.push('grace_alert_muted_until = ?');
            updateValues.push(null);
        }
        if (store_discount_apply_all_products !== undefined || payment_term !== undefined) {
            updateFields.push('store_discount_apply_all_products = ?');
            updateValues.push(applyStoreDiscount ? 1 : 0);
        }
        if (store_discount_percent !== undefined || payment_term !== undefined || store_discount_apply_all_products !== undefined) {
            updateFields.push('store_discount_percent = ?');
            updateValues.push(parsedStoreDiscountPercent);
        }
        if (payment_grace_days !== undefined) {
            const parsedGraceDaysRaw = payment_grace_days === null || String(payment_grace_days).trim() === ''
                ? null
                : Math.max(0, parseInt(String(payment_grace_days), 10));
            const parsedGraceDays = graceApplicable ? parsedGraceDaysRaw : null;
            updateFields.push('payment_grace_days = ?');
            updateValues.push(Number.isInteger(parsedGraceDays) ? parsedGraceDays : null);
            updateFields.push('grace_alert_muted_until = ?');
            updateValues.push(null);
        } else if (!graceApplicable) {
            updateFields.push('payment_grace_days = ?');
            updateValues.push(null);
            updateFields.push('payment_grace_start_date = ?');
            updateValues.push(null);
            updateFields.push('grace_alert_muted_until = ?');
            updateValues.push(null);
        }
        if (payment_grace_start_date !== undefined) {
            const parsedStart = graceApplicable ? normalizeDateOnlyInput(payment_grace_start_date) : null;
            updateFields.push('payment_grace_start_date = ?');
            updateValues.push(parsedStart);
            updateFields.push('grace_alert_muted_until = ?');
            updateValues.push(null);
        }
        if (phone !== undefined) { updateFields.push('phone = ?'); updateValues.push(phone); }
        if (email !== undefined) { updateFields.push('email = ?'); updateValues.push(email); }
        if (address !== undefined) { updateFields.push('address = ?'); updateValues.push(address); }
        if (image_url !== undefined) { updateFields.push('cover_image = ?'); updateValues.push(image_url); }
        if (category_id !== undefined) { updateFields.push('category_id = ?'); updateValues.push(category_id || null); }
        if (rating !== undefined) {
            if (req.user.user_type !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Only admins can set store rating'
                });
            }
            const n = parseFloat(rating);
            const safeRating = Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : 0;
            updateFields.push('rating = ?');
            updateValues.push(safeRating);
        }
        if (priority !== undefined && req.user.user_type === 'admin') {
            const priorityNum = parseInt(priority, 10);
            updateFields.push('priority = ?');
            updateValues.push(Number.isInteger(priorityNum) && priorityNum >= 1 && priorityNum <= 5 ? priorityNum : null);
        }
        if (is_customer_visible !== undefined && req.user.user_type === 'admin') {
            const visible = is_customer_visible === true
                || String(is_customer_visible).toLowerCase() === 'true'
                || String(is_customer_visible) === '1';
            updateFields.push('is_customer_visible = ?');
            updateValues.push(visible ? 1 : 0);
        }
        if (is_active !== undefined && req.user.user_type === 'admin') { updateFields.push('is_active = ?'); updateValues.push(is_active); }

        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid fields to update'
            });
        }

        updateValues.push(id);

        await req.db.execute(
            `UPDATE stores SET ${updateFields.join(', ')} WHERE id = ?`,
            updateValues
        );

        if (applyStoreDiscount && Number.isFinite(parsedStoreDiscountPercent)) {
            await req.db.execute(
                `UPDATE products
                 SET discount_type = 'percent',
                     discount_value = ?,
                     cost_price = GREATEST(0, ROUND(price - (price * ? / 100), 2))
                 WHERE store_id = ?`,
                [parsedStoreDiscountPercent, parsedStoreDiscountPercent, id]
            );
            try {
                await req.db.execute(
                    `UPDATE product_size_prices psp
                     JOIN products p ON p.id = psp.product_id
                     SET psp.cost_price = GREATEST(0, ROUND(psp.price - (psp.price * ? / 100), 2))
                     WHERE p.store_id = ?`,
                    [parsedStoreDiscountPercent, id]
                );
            } catch (e) {
                console.warn('Failed to auto-apply store discount to product size prices:', e.message);
            }
        }

        res.json({
            success: true,
            message: 'Store updated successfully'
        });

    } catch (error) {
        console.error('Error updating store:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update store',
            error: error.message
        });
    }
});

// Delete store (Admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Hard delete the store record
        const [result] = await req.db.execute(
            'DELETE FROM stores WHERE id = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Store not found'
            });
        }

        res.json({
            success: true,
            message: 'Store deleted successfully'
        });

    } catch (error) {
        // Handle foreign key constraint errors specifically
        if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.errno === 1451) {
            return res.status(409).json({
                success: false,
                message: 'Cannot delete store because it has associated records (products, orders, etc.). Please delete or reassign them first.',
                error: error.message
            });
        }

        console.error('Error deleting store:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete store',
            error: error.message
        });
    }
});

module.exports = router;

// Upload cover image for store: accepts single file and generates resized variants
router.post('/upload-image', authenticateToken, requireStoreOwner, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
        const uploadDir = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

        const originalPath = req.file.path;
        const ext = path.extname(req.file.originalname) || '.jpg';
        const baseName = `store_upload_${Date.now()}_${Math.round(Math.random()*1000)}`;
        const outName = `${baseName}${ext}`;
        const outPath = path.join(uploadDir, outName);

        fs.renameSync(originalPath, outPath);

        const publicPath = '/uploads/' + outName;
        const variants = {};

        if (sharp) {
            const sizes = [320, 640, 1024];
            await Promise.all(sizes.map(async (w) => {
                try {
                    const vname = `${baseName}_${w}${ext}`;
                    const vpath = path.join(uploadDir, vname);
                    await sharp(outPath).resize({ width: w }).toFile(vpath);
                    variants[w] = '/uploads/' + vname;
                } catch (err) {
                    console.warn('sharp resize failed for', outPath, err.message);
                }
            }));
        }

        res.json({ success: true, image_url: publicPath, variants });
    } catch (error) {
        console.error('Upload image failed:', error);
        res.status(500).json({ success: false, message: 'Image upload failed', error: error.message });
    }
});
