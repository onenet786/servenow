
const axios = require('axios');

async function testSearch() {
    try {
        const response = await axios.get('http://localhost:3002/api/stores?search=panadol');
        console.log('Search Status:', response.status);
        console.log('Stores Found:', response.data.stores.length);
        if (response.data.stores.length > 0) {
            console.log('First Store:', response.data.stores[0].name);
        } else {
            console.log('No stores found.');
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}

testSearch();
