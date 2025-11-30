// Display orders
async function displayOrders(status = 'pending') {
    const ordersContainer = document.getElementById('ordersContainer');
    if (!ordersContainer) return;

    try {
