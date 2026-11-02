// The report toolbar and the search dropdowns are browser scripts: these checks keep them wired up.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pagesBlock = read('js/report-tools.js').match(/const PAGES = \{([\s\S]*?)\n {4}\};/)[1];

test('every report page in the toolbar exists in the admin panel', () => {
  const admin = read('admin.html');
  const ids = [...pagesBlock.matchAll(/^\s*'?([a-z-]+)'?: \{/gm)].map((m) => m[1]).filter((id) => id !== 'full');
  assert.ok(ids.length >= 25);
  for (const id of ids) assert.ok(admin.includes(`id="${id}"`), id);
});

test('every page loading only its latest rows names a real loader', () => {
  const scripts = read('js/financial.js') + read('js/admin.js');
  const loaders = [...pagesBlock.matchAll(/loader: '([A-Za-z]+)'/g)].map((m) => m[1]);
  assert.ok(loaders.length >= 10);
  for (const name of loaders) assert.ok(scripts.includes(`function ${name}(`), name);
});

test('every live page with a dropdown loads the search script', () => {
  const skip = /^(test|preview_|walkthrough|audit_|socket-test)/;
  for (const file of fs.readdirSync(root).filter((f) => f.endsWith('.html') && !skip.test(f))) {
    const html = read(file);
    if (html.includes('<select')) assert.ok(html.includes('js/sn-select.js'), file);
  }
});
