// One-time: make existing pictures in uploads/ smaller, keeping each file's name and format.
//
//   node scripts/shrink-uploads.js            dry run: lists what would change, changes nothing
//   node scripts/shrink-uploads.js --apply    shrinks them; originals are copied first to
//                                             uploads_originals_<date>/ next to uploads/
//
// Only pictures over 200 KB or wider than 1280 px are touched. GIFs and anything that
// would not get at least 30% smaller are left alone, and a picture shrunk on an earlier run
// is never shrunk again. To undo, copy the originals folder back over uploads/.
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const APPLY = process.argv.includes("--apply");
const ROOT = path.resolve(process.argv.find((a) => a.startsWith("--dir="))?.slice(6) || path.join(__dirname, "..", "uploads"));
const BACKUP = path.join(path.dirname(ROOT), `uploads_originals_${new Date().toISOString().slice(0, 10)}`);
const MAX_WIDTH = 1280;
const MIN_BYTES = 200 * 1024;
const KINDS = { ".jpg": "jpeg", ".jpeg": "jpeg", ".png": "png", ".webp": "webp" };

const encode = (img, kind) =>
  kind === "png" ? img.png({ palette: true, quality: 90, compressionLevel: 9 })
    : kind === "webp" ? img.webp({ quality: 80 })
      : img.jpeg({ quality: 80, mozjpeg: true });

async function main() {
  const files = fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isFile() && KINDS[path.extname(d.name).toLowerCase()])
    .map((d) => d.name);
  // A picture with a saved original was shrunk on an earlier run: never compress it twice.
  const done = new Set();
  for (const d of fs.readdirSync(path.dirname(ROOT), { withFileTypes: true })) {
    if (d.isDirectory() && d.name.startsWith("uploads_originals_")) {
      for (const n of fs.readdirSync(path.join(path.dirname(ROOT), d.name))) done.add(n);
    }
  }
  let checked = 0, changed = 0, before = 0, after = 0, failed = 0;
  if (APPLY) fs.mkdirSync(BACKUP, { recursive: true });
  for (const name of files) {
    const file = path.join(ROOT, name);
    const size = fs.statSync(file).size;
    checked += 1;
    if (done.has(name)) continue;
    try {
      const meta = await sharp(file).metadata();
      if (size < MIN_BYTES && (meta.width || 0) <= MAX_WIDTH) continue;
      const kind = KINDS[path.extname(name).toLowerCase()];
      // Keep the real format even when the extension says otherwise.
      const real = meta.format === "jpeg" || meta.format === "png" || meta.format === "webp" ? meta.format : kind;
      const out = await encode(sharp(file).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true }), real).toBuffer();
      if (out.length > size * 0.7) continue; // not worth it, and stops a second run re-compressing
      changed += 1; before += size; after += out.length;
      console.log(`${APPLY ? "shrunk" : "would shrink"} ${name}  ${Math.round(size / 1024)} KB -> ${Math.round(out.length / 1024)} KB`);
      if (APPLY) {
        const keep = path.join(BACKUP, name);
        if (!fs.existsSync(keep)) fs.copyFileSync(file, keep);
        fs.writeFileSync(`${file}.small`, out);
        fs.renameSync(`${file}.small`, file);
      }
    } catch (error) {
      failed += 1;
      console.log(`skipped ${name}: ${error.message}`);
    }
  }
  const mb = (b) => (b / 1048576).toFixed(1);
  console.log(`\nChecked ${checked} pictures. ${APPLY ? "Shrunk" : "Would shrink"} ${changed}: ${mb(before)} MB -> ${mb(after)} MB. Skipped ${failed}.`);
  if (APPLY && changed) console.log(`Originals are in ${BACKUP}`);
  if (!APPLY) console.log("Dry run: nothing was changed. Run again with --apply to shrink them.");
}

main().catch((error) => { console.error(error); process.exit(1); });
