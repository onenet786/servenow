const test = require('node:test');
const assert = require('node:assert/strict');
const { normaliseAppVersion } = require('../routes/stores');

test('app update version: the formats the app can compare', () => {
  assert.equal(normaliseAppVersion('1.2.17'), '1.2.17');
  assert.equal(normaliseAppVersion(' 1.2.17+57 '), '1.2.17+57');
  assert.equal(normaliseAppVersion('v1.2.17 + 57'), '1.2.17+57');
  // the value that made every phone see "Update Available" (read by the app as version 531)
  assert.equal(normaliseAppVersion('53 (1.2.13)'), '1.2.13+53');
  assert.equal(normaliseAppVersion('1.2.13 (53)'), '1.2.13+53');
  assert.equal(normaliseAppVersion(''), '');
  assert.equal(normaliseAppVersion(null), '');
  assert.equal(normaliseAppVersion('latest'), null);
  assert.equal(normaliseAppVersion('53'), null);
});
