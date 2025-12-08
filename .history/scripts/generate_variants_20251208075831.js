const fs = require('fs');
const path = require('path');

(async () => {
  try {
    const sharp = require('sharp');
    const uploadDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      console.error('Uploads directory does not exist:', uploadDir);
      process.exit(1);
    }

    const files = fs.readdirSync(uploadDir).filter(f => {
      // skip already-variant files (ending with _<w> before extension)
      return !/_\d+\.[^.]+$/.test(f);
    });

    const sizes = [320, 640, 1024];
    for (const file of files) {
      const full = path.join(uploadDir, file);
      const ext = path.extname(file) || '.jpg';
      const base = path.basename(file, ext);
      for (const w of sizes) {
        const vname = `${base}_${w}${ext}`;
        const vpath = path.join(uploadDir, vname);
        if (fs.existsSync(vpath)) {
          console.log('Variant exists, skipping', vname);
          continue;
        }
        try {
          await sharp(full).resize({ width: w }).toFile(vpath);
          console.log('Wrote variant', vname);
        } catch (err) {
          console.warn('Failed to generate variant for', file, err.message);
        }
      }
    }

    console.log('Variant generation complete.');
  } catch (e) {
    console.error('Script failed:', e.message);
    process.exit(1);
  }
})();
