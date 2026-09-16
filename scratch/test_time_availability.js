const assert = require('assert');
const {
    formatTime12h,
    normalizeTimeHHMM,
    checkProductTimeAvailability
} = require('../utils/timeAvailability');

console.log('Testing timeAvailability.js...');

// 1. formatTime12h
assert.strictEqual(formatTime12h('07:00'), '7:00 AM');
assert.strictEqual(formatTime12h('12:00'), '12:00 PM');
assert.strictEqual(formatTime12h('14:30'), '2:30 PM');
assert.strictEqual(formatTime12h('18:00'), '6:00 PM');
assert.strictEqual(formatTime12h('00:00'), '12:00 AM');
assert.strictEqual(formatTime12h('23:59'), '11:59 PM');
console.log('✓ formatTime12h tests passed');

// 2. normalizeTimeHHMM
assert.strictEqual(normalizeTimeHHMM('7:00'), '07:00');
assert.strictEqual(normalizeTimeHHMM('07:00:00'), '07:00');
assert.strictEqual(normalizeTimeHHMM('16:45'), '16:45');
assert.strictEqual(normalizeTimeHHMM(''), null);
assert.strictEqual(normalizeTimeHHMM(null), null);
console.log('✓ normalizeTimeHHMM tests passed');

// 3. checkProductTimeAvailability unconstrained
const unconstrained = checkProductTimeAvailability(null, null);
assert.strictEqual(unconstrained.isTimeAvailable, true);
assert.strictEqual(unconstrained.isRestricted, false);
assert.strictEqual(unconstrained.label, null);

const unconstrainedEmpty = checkProductTimeAvailability('', '');
assert.strictEqual(unconstrainedEmpty.isTimeAvailable, true);
assert.strictEqual(unconstrainedEmpty.isRestricted, false);
console.log('✓ Unconstrained (24/7) tests passed');

// 4. Standard daytime window (07:00 to 12:00)
const breakfastBefore = checkProductTimeAvailability('07:00', '12:00', '06:59');
assert.strictEqual(breakfastBefore.isTimeAvailable, false);
assert.strictEqual(breakfastBefore.label, '7:00 AM - 12:00 PM');

const breakfastStart = checkProductTimeAvailability('07:00', '12:00', '07:00');
assert.strictEqual(breakfastStart.isTimeAvailable, true);

const breakfastMid = checkProductTimeAvailability('07:00', '12:00', '09:30');
assert.strictEqual(breakfastMid.isTimeAvailable, true);

const breakfastEnd = checkProductTimeAvailability('07:00', '12:00', '12:00');
assert.strictEqual(breakfastEnd.isTimeAvailable, true);

const breakfastAfter = checkProductTimeAvailability('07:00', '12:00', '12:01');
assert.strictEqual(breakfastAfter.isTimeAvailable, false);
console.log('✓ Standard daytime window (Breakfast 7am - 12pm) tests passed');

// 5. Afternoon / Evening window (14:00 to 18:00)
assert.strictEqual(checkProductTimeAvailability('14:00', '18:00', '13:59').isTimeAvailable, false);
assert.strictEqual(checkProductTimeAvailability('14:00', '18:00', '14:00').isTimeAvailable, true);
assert.strictEqual(checkProductTimeAvailability('14:00', '18:00', '16:00').isTimeAvailable, true);
assert.strictEqual(checkProductTimeAvailability('14:00', '18:00', '18:00').isTimeAvailable, true);
assert.strictEqual(checkProductTimeAvailability('14:00', '18:00', '18:01').isTimeAvailable, false);
console.log('✓ Afternoon window (Evening 2pm - 6pm) tests passed');

// 6. Midnight wrap-around (22:00 to 03:00)
assert.strictEqual(checkProductTimeAvailability('22:00', '03:00', '21:59').isTimeAvailable, false);
assert.strictEqual(checkProductTimeAvailability('22:00', '03:00', '22:00').isTimeAvailable, true);
assert.strictEqual(checkProductTimeAvailability('22:00', '03:00', '23:59').isTimeAvailable, true);
assert.strictEqual(checkProductTimeAvailability('22:00', '03:00', '00:00').isTimeAvailable, true);
assert.strictEqual(checkProductTimeAvailability('22:00', '03:00', '01:30').isTimeAvailable, true);
assert.strictEqual(checkProductTimeAvailability('22:00', '03:00', '03:00').isTimeAvailable, true);
assert.strictEqual(checkProductTimeAvailability('22:00', '03:00', '03:01').isTimeAvailable, false);
console.log('✓ Midnight wrap-around window (Late night 10pm - 3am) tests passed');

console.log('\nAll time availability tests PASSED successfully!');
