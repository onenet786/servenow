const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Usage: node scripts/export_base64_images.js [--dry-run]
(async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-n');

  console.log(`Export base64 images script. dryRun=${dryRun}`);

  try {
    const c = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'servenow',
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306
    });

    const [rows] = await c.execute("SELECT id, image_url FROM products WHERE image_url LIKE 'data:%'");
    console.log(`Found ${rows.length} products with data: image_url.`);

    if (rows.length === 0) {
      await c.end();
      process.exit(0);
    }

    const uploadDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      if (!dryRun) fs.mkdirSync(uploadDir, { recursive: true });
    }

    const results = [];
    for (const row of rows) {
      const id = row.id;
      const dataUri = row.image_url || '';
      const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(dataUri);
      if (!match) {
        results.push({ id, success: false, error: 'Invalid data URI' });
        continue;
      }

      const mime = match[1];
      const base64 = match[2];
      let ext = 'jpg';
      if (mime === 'image/png') ext = 'png';
      else if (mime === 'image/gif') ext = 'gif';
      else if (mime === 'image/webp') ext = 'webp';
      else if (mime === 'image/svg+xml') ext = 'svg';
      else if (/jpeg/i.test(mime)) ext = 'jpg';

      const filename = `product_${id}_${Date.now()}.${ext}`;
      const filePath = path.join(uploadDir, filename);
      const publicPath = '/uploads/' + filename;

      if (dryRun) {
        console.log(`[DRY] Would write file for product ${id} -> ${publicPath}`);
        results.push({ id, success: true, new: publicPath, dry: true });
        continue;
      }

      try {
        fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
        await c.execute('UPDATE products SET image_url = ? WHERE id = ?', [publicPath, id]);
        console.log(`Wrote ${filePath} and updated DB for product ${id}`);
        results.push({ id, success: true, new: publicPath });
      } catch (err) {
        console.error('Error writing file for product', id, err.message);
        results.push({ id, success: false, error: err.message });
      }
    }

    await c.end();

    const converted = results.filter(r => r.success).length;
    console.log(`Completed. Converted ${converted} of ${rows.length} products.`);
    process.exit(0);
  } catch (e) {
    console.error('Script failed:', e.message);
    process.exit(1);
  }
})();
