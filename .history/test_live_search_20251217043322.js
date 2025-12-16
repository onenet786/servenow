

async function testSearch() {
    try {
        const response = await fetch('http://localhost:3002/api/stores?search=panadol');
        console.log('Search Status:', response.status);
        const data = await response.json();
        console.log('Stores Found:', data.stores.length);
        if (data.stores.length > 0) {
            console.log('First Store:', data.stores[0].name);
        } else {
            console.log('No stores found.');
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}

testSearch();
