const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { shrinkUploadedImage } = require('../middleware/upload');

const noisy = (w, h) => {
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < buf.length; i += 1) buf[i] = (i * 2654435761) % 251;
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } });
};

test('a large phone photo is resized to 1280 px and gets smaller', async () => {
  const file = path.join(os.tmpdir(), `shrink-${Date.now()}.jpg`);
  await noisy(3000, 2000).jpeg({ quality: 95 }).toFile(file);
  const before = fs.statSync(file).size;
  await shrinkUploadedImage(file, '.jpg');
  const meta = await sharp(file).metadata();
  assert.equal(meta.width, 1280);
  assert.equal(meta.format, 'jpeg');
  assert.ok(fs.statSync(file).size < before);
  fs.unlinkSync(file);
});

test('a small picture is left exactly as it was', async () => {
  const file = path.join(os.tmpdir(), `keep-${Date.now()}.png`);
  await sharp({ create: { width: 200, height: 200, channels: 3, background: '#2a7' } }).png().toFile(file);
  const before = fs.readFileSync(file);
  await shrinkUploadedImage(file, '.png');
  assert.ok(before.equals(fs.readFileSync(file)));
  fs.unlinkSync(file);
});
