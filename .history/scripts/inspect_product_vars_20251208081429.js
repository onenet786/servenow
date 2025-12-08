// scripts/inspect_product_vars.js
// Fetch a product from the local API and compute average RGB + overlay alpha using sharp if available.
// Usage: `node scripts/inspect_product_vars.js [apiBase] [category]`

(async function(){
    try {
        const path = require('path');
        const fs = require('fs');
        const apiBase = process.argv[2] || 'http://localhost:3002';
        const category = process.argv[3] || 'groceries';

        console.log('Using API base:', apiBase);
        const res = await fetch(`${apiBase}/api/products?category=${encodeURIComponent(category)}`);
        const j = await res.json();
        if (!j || !j.products || !j.products.length) {
            console.error('No products returned from API. Response:', JSON.stringify(j));
            process.exit(2);
        }
        // pick first product with an image
        const prod = j.products.find(p => p.image_url) || j.products[0];
        console.log('Product chosen:', prod.id, prod.name);
        console.log('image_url:', prod.image_url);

        let imageUrl = String(prod.image_url || '').trim();
        if (!imageUrl) { console.error('No image_url to inspect'); process.exit(0); }

        let buffer = null;
        let localPath = null;
        if (/^https?:\/\//i.test(imageUrl)) {
            console.log('Image is remote. Attempting to fetch...');
            const r = await fetch(imageUrl);
            if (!r.ok) { console.error('Failed to fetch remote image:', r.status); }
            else buffer = Buffer.from(await r.arrayBuffer());
        } else if (imageUrl.startsWith('/')) {
            // try local filesystem in repo
            localPath = path.join(process.cwd(), imageUrl.replace(/^\//, ''));
            console.log('Image appears local. Trying path:', localPath);
            if (fs.existsSync(localPath)) buffer = fs.readFileSync(localPath);
            else {
                // maybe it's served under uploads but with absolute path; try join uploads
                const alt = path.join(process.cwd(), imageUrl);
                if (fs.existsSync(alt)) { localPath = alt; buffer = fs.readFileSync(alt); }
            }
        } else {
            // relative
            localPath = path.join(process.cwd(), imageUrl);
            console.log('Trying relative path:', localPath);
            if (fs.existsSync(localPath)) buffer = fs.readFileSync(localPath);
        }

        if (!buffer) {
            console.warn('Could not load image bytes from local filesystem or remote fetch. Cannot compute color without sharp or image data.');
            process.exit(0);
        }

        // Try to use sharp to compute a small downscaled version and average pixels
        let sharp;
        try { sharp = require('sharp'); } catch(e) { sharp = null; }
        if (!sharp) {
            console.warn('`sharp` is not installed in this environment. Install it (npm install sharp) to compute image colors.');
            process.exit(0);
        }

        const img = sharp(buffer);
        const small = await img.resize(40, 40, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const { data, info } = small;
        const pixels = info.width * info.height;
        let r=0,g=0,b=0,count=0;
        for (let i=0;i<data.length;i+=4){
            const alpha = data[i+3];
            if (alpha===0) continue;
            r += data[i]; g += data[i+1]; b += data[i+2]; count++;
        }
        if (!count) { console.error('No opaque pixels?'); process.exit(0); }
        r = Math.round(r/count); g = Math.round(g/count); b = Math.round(b/count);
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        let alpha = 0.20;
        if (lum > 0.75) alpha = 0.55; else if (lum > 0.6) alpha = 0.45; else if (lum > 0.45) alpha = 0.32; else alpha = 0.20;
        const contrast = (lum > 0.5) ? '#111' : '#fff';

        console.log('Computed CSS vars:');
        console.log(`--product-bg-r: ${r}`);
        console.log(`--product-bg-g: ${g}`);
        console.log(`--product-bg-b: ${b}`);
        console.log(`--product-overlay-alpha: ${alpha}`);
        console.log(`--product-contrast: ${contrast}`);

    } catch (e) {
        console.error('Error running inspect script:', e);
        process.exit(1);
    }
})();
