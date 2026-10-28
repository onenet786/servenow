
function calculateFuelCost(distance, rate) {
    if (typeof distance !== 'number' || typeof rate !== 'number') return null;
    // Formula: (Total Distance of day divided by 45 kilometer per liter) * Rate of per liter
    return ((distance / 45) * rate).toFixed(2);
}

const tests = [
    { dist: 90, rate: 100, expected: '200.00' },
    { dist: 45, rate: 100, expected: '100.00' },
    { dist: 100, rate: 250, expected: ((100/45)*250).toFixed(2) }, // 555.56
    { dist: 0, rate: 100, expected: '0.00' }
];

console.log('Running Fuel Calculation Tests...');
let passed = 0;
tests.forEach(t => {
    const result = calculateFuelCost(t.dist, t.rate);
    const pass = result === t.expected;
    if (pass) passed++;
    console.log(`Dist: ${t.dist}, Rate: ${t.rate} => Result: ${result} | Expected: ${t.expected} | ${pass ? 'PASS' : 'FAIL'}`);
});

if (passed === tests.length) {
    console.log('All tests passed!');
} else {
    console.log('Some tests failed.');
}
