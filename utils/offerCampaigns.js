function round2(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
}

function campaignBadge(campaign) {
    const type = String(campaign?.campaign_type || '').toLowerCase();
    if (type === 'discount') {
        const discountType = String(campaign?.discount_type || 'amount').toLowerCase();
        const discountValue = Number(campaign?.discount_value || 0);
        if (discountType === 'percent') return `${round2(discountValue)}% OFF`;
        return `PKR ${round2(discountValue)} OFF`;
    }
    if (type === 'bxgy') {
        const buy = Math.max(1, parseInt(String(campaign?.buy_qty || 0), 10) || 1);
        const get = Math.max(1, parseInt(String(campaign?.get_qty || 0), 10) || 1);
        return `Buy ${buy} Get ${get} Free`;
    }
    return 'Offer';
}

function campaignMeta(campaign) {
    if (!campaign) return null;
    return {
        id: campaign.id,
        name: campaign.name || null,
        campaign_type: campaign.campaign_type || null,
        discount_type: campaign.discount_type || null,
        discount_value: campaign.discount_value === null || campaign.discount_value === undefined ? null : round2(campaign.discount_value),
        buy_qty: campaign.buy_qty === null || campaign.buy_qty === undefined ? null : Number(campaign.buy_qty),
        get_qty: campaign.get_qty === null || campaign.get_qty === undefined ? null : Number(campaign.get_qty),
        start_at: campaign.start_at || null,
        end_at: campaign.end_at || null
    };
}

function isBxgyCampaign(campaign) {
    return String(campaign?.campaign_type || '').toLowerCase() === 'bxgy';
}

function computePromotionalPrice(basePrice, campaign) {
    const price = Number(basePrice);
    if (!Number.isFinite(price) || price < 0) return null;

    const type = String(campaign?.campaign_type || '').toLowerCase();
    if (type === 'discount') {
        const discountType = String(campaign?.discount_type || 'amount').toLowerCase();
        const discountValue = Number(campaign?.discount_value || 0);
        if (!Number.isFinite(discountValue) || discountValue <= 0) return null;
        const discount = discountType === 'percent'
            ? (price * discountValue / 100)
            : discountValue;
        return round2(Math.max(0, price - discount));
    }

    return null;
}

function applyBestCampaignToPrice(basePrice, campaigns) {
    const original = round2(basePrice);
    const list = Array.isArray(campaigns) ? campaigns : [];
    let best = null;
    let bestPrice = original;
    let bxgy = null;
    for (const c of list) {
        if (isBxgyCampaign(c)) {
            if (!bxgy) bxgy = c;
            continue;
        }
        const promo = computePromotionalPrice(original, c);
        if (!Number.isFinite(promo)) continue;
        if (promo < bestPrice) {
            bestPrice = promo;
            best = c;
        }
    }

    if (!best || !(bestPrice < original)) {
        if (bxgy) {
            return {
                original_price: original,
                promotional_price: null,
                has_active_offer: true,
                offer_badge: campaignBadge(bxgy),
                offer_meta: campaignMeta(bxgy)
            };
        }
        return {
            original_price: original,
            promotional_price: null,
            has_active_offer: false,
            offer_badge: null,
            offer_meta: null
        };
    }

    return {
        original_price: original,
        promotional_price: round2(bestPrice),
        has_active_offer: true,
        offer_badge: campaignBadge(best),
        offer_meta: campaignMeta(best)
    };
}

function getBxgyQuantities(quantity, campaign) {
    const qty = parseInt(String(quantity || 0), 10);
    const buyQty = parseInt(String(campaign?.buy_qty || 0), 10);
    const getQty = parseInt(String(campaign?.get_qty || 0), 10);
    if (!Number.isInteger(qty) || qty <= 0 || buyQty <= 0 || getQty <= 0) {
        return { paid_quantity: Math.max(0, qty || 0), free_quantity: 0 };
    }
    const bundleQty = buyQty + getQty;
    const freeQuantity = Math.floor(qty / bundleQty) * getQty;
    return {
        paid_quantity: qty - freeQuantity,
        free_quantity: freeQuantity
    };
}

function applyCampaignToCartLine(basePrice, quantity, campaigns) {
    const original = round2(basePrice);
    const qty = parseInt(String(quantity || 0), 10);
    const list = Array.isArray(campaigns) ? campaigns : [];
    const originalTotal = round2(original * Math.max(0, qty));
    let best = {
        campaign: null,
        original_unit_price: original,
        unit_price: original,
        line_total: originalTotal,
        paid_quantity: qty,
        free_quantity: 0,
        offer_badge: null,
        offer_meta: null
    };

    for (const c of list) {
        if (isBxgyCampaign(c)) {
            const quantities = getBxgyQuantities(qty, c);
            if (quantities.free_quantity <= 0) continue;
            const lineTotal = round2(original * quantities.paid_quantity);
            if (lineTotal < best.line_total) {
                best = {
                    campaign: c,
                    original_unit_price: original,
                    unit_price: original,
                    line_total: lineTotal,
                    paid_quantity: quantities.paid_quantity,
                    free_quantity: quantities.free_quantity,
                    offer_badge: campaignBadge(c),
                    offer_meta: campaignMeta(c)
                };
            }
            continue;
        }

        const promo = computePromotionalPrice(original, c);
        if (!Number.isFinite(promo) || !(promo < original)) continue;
        const lineTotal = round2(promo * qty);
        if (lineTotal < best.line_total) {
            best = {
                campaign: c,
                original_unit_price: original,
                unit_price: promo,
                line_total: lineTotal,
                paid_quantity: qty,
                free_quantity: 0,
                offer_badge: campaignBadge(c),
                offer_meta: campaignMeta(c)
            };
        }
    }

    return best;
}

async function ensureStoreOfferCampaignTables(db) {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS store_offer_campaigns (
            id INT PRIMARY KEY AUTO_INCREMENT,
            store_id INT NOT NULL,
            name VARCHAR(160) NOT NULL,
            description TEXT NULL,
            campaign_type ENUM('discount', 'bxgy') NOT NULL DEFAULT 'discount',
            discount_type ENUM('amount', 'percent') NULL,
            discount_value DECIMAL(10,2) NULL,
            buy_qty INT NULL,
            get_qty INT NULL,
            apply_scope ENUM('all_products', 'selected_products') NOT NULL DEFAULT 'all_products',
            is_enabled TINYINT(1) NOT NULL DEFAULT 1,
            start_at DATETIME NOT NULL,
            end_at DATETIME NOT NULL,
            created_by INT NULL,
            updated_by INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_soc_store (store_id),
            INDEX idx_soc_active (is_enabled, start_at, end_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS store_offer_campaign_products (
            campaign_id INT NOT NULL,
            product_id INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (campaign_id, product_id),
            INDEX idx_socp_product (product_id),
            CONSTRAINT fk_socp_campaign FOREIGN KEY (campaign_id) REFERENCES store_offer_campaigns(id) ON DELETE CASCADE,
            CONSTRAINT fk_socp_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}

function isCampaignActiveNow(campaign, now = new Date()) {
    if (!campaign || !campaign.is_enabled) return false;
    const start = campaign.start_at ? new Date(campaign.start_at) : null;
    const end = campaign.end_at ? new Date(campaign.end_at) : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
    return now >= start && now <= end;
}

async function getActiveStoreCampaignsMap(db, storeIds) {
    const ids = (Array.isArray(storeIds) ? storeIds : [])
        .map((x) => parseInt(String(x), 10))
        .filter((x) => Number.isInteger(x) && x > 0);
    if (!ids.length) return {};

    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await db.execute(
        `
        SELECT c.*
        FROM store_offer_campaigns c
        WHERE c.store_id IN (${placeholders})
          AND c.is_enabled = 1
          AND c.start_at <= NOW()
          AND c.end_at >= NOW()
        ORDER BY c.id DESC
        `,
        ids
    );

    if (!rows || !rows.length) return {};

    const campaignIds = rows.map((r) => Number(r.id)).filter((x) => Number.isInteger(x) && x > 0);
    const mapProductsByCampaign = {};
    if (campaignIds.length) {
        const pPlaceholders = campaignIds.map(() => '?').join(',');
        const [linkedRows] = await db.execute(
            `
            SELECT campaign_id, product_id
            FROM store_offer_campaign_products
            WHERE campaign_id IN (${pPlaceholders})
            `,
            campaignIds
        );
        for (const lr of linkedRows || []) {
            const cid = Number(lr.campaign_id);
            const pid = Number(lr.product_id);
            if (!Number.isInteger(cid) || !Number.isInteger(pid)) continue;
            if (!mapProductsByCampaign[cid]) mapProductsByCampaign[cid] = new Set();
            mapProductsByCampaign[cid].add(pid);
        }
    }

    const out = {};
    for (const row of rows) {
        const c = {
            id: Number(row.id),
            store_id: Number(row.store_id),
            name: row.name || '',
            description: row.description || '',
            campaign_type: row.campaign_type || 'discount',
            discount_type: row.discount_type || null,
            discount_value: row.discount_value === null || row.discount_value === undefined ? null : Number(row.discount_value),
            buy_qty: row.buy_qty === null || row.buy_qty === undefined ? null : Number(row.buy_qty),
            get_qty: row.get_qty === null || row.get_qty === undefined ? null : Number(row.get_qty),
            apply_scope: row.apply_scope || 'all_products',
            is_enabled: Number(row.is_enabled || 0) === 1,
            start_at: row.start_at || null,
            end_at: row.end_at || null,
            product_ids: Array.from(mapProductsByCampaign[Number(row.id)] || [])
        };

        if (!out[c.store_id]) out[c.store_id] = [];
        out[c.store_id].push(c);
    }
    return out;
}

function campaignsForProduct(campaigns, productId) {
    const pid = Number(productId);
    const list = Array.isArray(campaigns) ? campaigns : [];
    return list.filter((c) => {
        if (String(c.apply_scope || 'all_products') === 'all_products') return true;
        const ids = Array.isArray(c.product_ids) ? c.product_ids : [];
        return ids.includes(pid);
    });
}

module.exports = {
    round2,
    campaignBadge,
    campaignMeta,
    isBxgyCampaign,
    computePromotionalPrice,
    applyBestCampaignToPrice,
    getBxgyQuantities,
    applyCampaignToCartLine,
    ensureStoreOfferCampaignTables,
    isCampaignActiveNow,
    getActiveStoreCampaignsMap,
    campaignsForProduct
};

