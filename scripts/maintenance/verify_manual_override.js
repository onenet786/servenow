
function determineFuelCost(providedCost, distance, rate) {
    const fcp = (providedCost !== undefined && providedCost !== null && providedCost !== '') ? parseFloat(providedCost) : null;
    
    if (fcp !== null && Number.isFinite(fcp)) {
        console.log(`Manual Override Used: ${fcp}`);
        return Math.round(fcp * 100) / 100;
    } else if (distance !== null && rate !== null) {
        // Formula: (Distance / 45) * Rate
        const calculated = Math.round(((distance / 45) * rate) * 100) / 100;
        console.log(`Formula Used: ${calculated}`);
        return calculated;
    }
    return null;
}

const tests = [
    { 
        name: "Manual Override Priority",
        input: { cost: "500", dist: 90, rate: 100 }, 
        expected: 500, // Formula would be 200, but manual is 500
        desc: "Should use manual cost 500 instead of formula result 200"
    },
    { 
        name: "Formula Fallback",
        input: { cost: "", dist: 90, rate: 100 }, 
        expected: 200, 
        desc: "Should use formula (90/45)*100 = 200 when cost is empty"
    },
    { 
        name: "Partial Manual Input",
        input: { cost: "123.45", dist: 100, rate: 250 }, 
        expected: 123.45,
        desc: "Should use manual cost 123.45 exactly"
    }
];

console.log('--- Verifying Manual Entry Logic ---');
let passed = 0;
tests.forEach(t => {
    const result = determineFuelCost(t.input.cost, t.input.dist, t.input.rate);
    const pass = result === t.expected;
    if (pass) passed++;
    console.log(`[${t.name}] Result: ${result} | Expected: ${t.expected}`);
    console.log(`Status: ${pass ? 'PASS' : 'FAIL'}\n`);
});

if (passed === tests.length) {
    console.log('All verification tests passed.');
} else {
    console.log('Verification failed.');
}
