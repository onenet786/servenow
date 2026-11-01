// Copies a branch's stores and products into another branch, as a starting point to edit. The new
// branch does not retype its catalogue; after the copy the two are independent.
//
// Copied: store details, products, prices, size prices, images (the file is shared, and files are
// never deleted). Not copied: orders, money, offers, stock, and anything that belongs to the original
// store's owner or location: owner login and contacts, bank details, the commission, payment terms
// and discounts agreed with that owner, map pin, priority and rating. Those start at the database
// defaults; the new branch agrees its own terms with its own store owner.
//
// Each store is its own transaction and remembers its source, so a copy that stops part way can
// simply be run again: finished stores are skipped, and the database refuses a duplicate.

const STORE_SKIP = new Set([
    'id', 'created_at', 'updated_at', 'branch_id', 'source_store_id',
    'owner_id', 'bank_id', 'store_bank_account_title', 'store_bank_account_number',
    'latitude', 'longitude', 'priority', 'rating',
    // The original owner's agreement and contacts
    'phone', 'email', 'commission_rate', 'payment_term',
    'payment_grace_days', 'payment_grace_start_date', 'payment_grace_due_date', 'grace_alert_muted_until',
    'store_discount_percent', 'store_discount_apply_all_products',
]);
// Stock belongs to the original store's shelf; the copy starts at 0.
const PRODUCT_SKIP = new Set(['id', 'store_id', 'created_at', 'updated_at', 'stock_quantity']);
const SIZE_PRICE_SKIP = new Set(['id', 'product_id', 'created_at']);

// Column names come from the database itself, never from a request.
async function columnsOf(db, table, skip) {
    const [rows] = await db.execute(
        `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [table]
    );
    return rows.map((r) => r.name).filter((c) => !skip.has(c)).map((c) => `\`${c}\``).join(', ');
}

const STORES_TO_COPY = `FROM stores s
   WHERE s.branch_id = ? AND s.is_active = 1
     AND NOT EXISTS (SELECT 1 FROM stores done WHERE done.branch_id = ? AND done.source_store_id = s.id)`;

// What a copy would do, without doing it.
async function copyPreview(db, fromId, toId) {
    const [[stores]] = await db.execute(`SELECT COUNT(*) AS n ${STORES_TO_COPY}`, [fromId, toId]);
    const [[products]] = await db.execute(
        `SELECT COUNT(*) AS n FROM products p WHERE p.store_id IN (SELECT s.id ${STORES_TO_COPY})`,
        [fromId, toId]
    );
    const [[done]] = await db.execute(
        'SELECT COUNT(*) AS n FROM stores WHERE branch_id = ? AND source_store_id IS NOT NULL',
        [toId]
    );
    return { stores: Number(stores.n), products: Number(products.n), already_copied: Number(done.n) };
}

async function copyStore(conn, sourceId, toId, hide, cols) {
    await conn.beginTransaction();
    try {
        const [made] = await conn.execute(
            `INSERT INTO stores (${cols.store}, branch_id, source_store_id)
             SELECT ${cols.store}, ?, id FROM stores WHERE id = ?`,
            [toId, sourceId]
        );
        const storeId = made.insertId;
        if (hide) await conn.execute('UPDATE stores SET is_customer_visible = 0 WHERE id = ?', [storeId]);

        const [products] = await conn.execute('SELECT id FROM products WHERE store_id = ?', [sourceId]);
        for (const { id } of products) {
            const [copy] = await conn.execute(
                `INSERT INTO products (${cols.product}, store_id) SELECT ${cols.product}, ? FROM products WHERE id = ?`,
                [storeId, id]
            );
            await conn.execute(
                `INSERT INTO product_size_prices (${cols.sizePrice}, product_id)
                 SELECT ${cols.sizePrice}, ? FROM product_size_prices WHERE product_id = ?`,
                [copy.insertId, id]
            );
        }
        await conn.commit();
        return products.length;
    } catch (err) {
        await conn.rollback();
        throw err;
    }
}

// `hide`: keep the copies away from customers until edited, for a branch that is already open.
async function copyBranchStores(db, fromId, toId, { hide = false } = {}) {
    const cols = {
        store: await columnsOf(db, 'stores', STORE_SKIP),
        product: await columnsOf(db, 'products', PRODUCT_SKIP),
        sizePrice: await columnsOf(db, 'product_size_prices', SIZE_PRICE_SKIP),
    };
    const [sources] = await db.execute(`SELECT s.id ${STORES_TO_COPY} ORDER BY s.id`, [fromId, toId]);

    const conn = await db.getConnection();
    let stores = 0;
    let products = 0;
    try {
        for (const { id } of sources) {
            products += await copyStore(conn, id, toId, hide, cols);
            stores += 1;
        }
    } catch (err) {
        err.copied = { stores, products };
        throw err;
    } finally {
        conn.release();
    }
    return { stores, products };
}

module.exports = { copyPreview, copyBranchStores, STORE_SKIP };
