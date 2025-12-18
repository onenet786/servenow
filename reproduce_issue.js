const axios = require('axios');

async function testRegister() {
    const email = `test${Math.floor(Math.random() * 10000)}@example.com`;
    console.log('Registering:', email);

    try {
        const response = await axios.post('http://localhost:3002/api/auth/register', {
            firstName: 'Test',
            lastName: 'User',
            email: email,
            password: 'password123',
            phone: '1234567890',
            address: '123 Test St',
            userType: 'customer'
        });
        console.log('Success:', response.data);
    } catch (error) {
        if (error.code) {
             console.log('Error Code:', error.code);
        }
        if (error.response) {
            console.log('Error Status:', error.response.status);
            console.log('Error Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.log('Error Message:', error.message);
        }
    }
}

testRegister();
