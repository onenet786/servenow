
// Paste the function to test
function isFractionalUnit(name, id) {
    if (id) {
        const uid = parseInt(id, 10);
        if (uid === 1 || uid === 32) return true;
    }
    const n = String(name || '').toLowerCase().trim().replace(/\./g, '');
    if (!n) return false;
    const singular = n.replace(/s$/, '');
    if (singular === 'kilogram' || singular === 'kiligram' || singular === 'kg') return true;
    if (singular === 'liter' || singular === 'litre' || singular === 'ltr' || singular === 'l') return true;
    if (singular.includes('kilo')) return true;
    if (singular.includes('lit')) return true;
    return false;
}

// Test cases
console.log('Testing isFractionalUnit:');
console.log('1. ID 1 (should be true):', isFractionalUnit('Unknown', 1));
console.log('2. ID 32 (should be true):', isFractionalUnit('Unknown', 32));
console.log('3. ID 99 (should be false):', isFractionalUnit('Unknown', 99));
console.log('4. Name Kilogram (should be true):', isFractionalUnit('Kilogram'));
console.log('5. Name Kiligram (should be true):', isFractionalUnit('Kiligram'));
console.log('6. Name Liter (should be true):', isFractionalUnit('Liter'));
console.log('7. Name Piece (should be false):', isFractionalUnit('Piece'));
console.log('8. ID 1 with name Piece (should be true):', isFractionalUnit('Piece', 1));

// Test qtyStepForUnit
function qtyStepForUnit(name, id) {
    return isFractionalUnit(name, id) ? 0.25 : 1;
}
console.log('\nTesting qtyStepForUnit:');
console.log('1. ID 1:', qtyStepForUnit('Piece', 1));
console.log('2. Name Kilogram:', qtyStepForUnit('Kilogram'));
console.log('3. Name Piece:', qtyStepForUnit('Piece'));
