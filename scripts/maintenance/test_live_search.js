

async function testSearch() {
    try {
        const response = await fetch('http://localhost:3002/api/stores?search=Al%20Sheikh');
        console.log('Search Status:', response.status);
        const data = await response.json();
        console.log('Stores Found:', data.stores.length);
    } catch (error) {
        console.error('Error:', error.message);
    }
}

testSearch();
