// Use shared global variables from app.js where applicable
let walletStripe = null;
let walletElements = null;
let walletCardElement = null;

if (!authToken) {
    window.location.href = 'login.html';
}

let walletCurrentFilters = { type: '' };

// P2P Transfer Functions
function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('onclick').includes(`'${tabName}'`)) {
            btn.classList.add('active');
        }
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}Tab`).classList.add('active');

    // Load data for the tab
    if (tabName === 'received') {
        loadReceivedTransfers();
    } else if (tabName === 'sent') {
        loadSentTransfers();
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Initialize Stripe
        const stripeResponse = await fetch(`${API_BASE}/api/wallet/balance`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const stripeData = await stripeResponse.json();
        
        if (stripeData.success && stripeData.wallet) {
            const stripePK = stripeData.stripePublicKey;
            if (stripePK) {
                walletStripe = Stripe(stripePK);
                walletElements = walletStripe.elements();
                walletCardElement = walletElements.create('card');
            }
        }

        // Load wallet data
        loadWalletBalance();
        loadTransactions();
        loadPaymentMethods();

        // Event listeners
        document.getElementById('paymentMethod').addEventListener('change', handlePaymentMethodChange);
        document.getElementById('topupForm').addEventListener('submit', handleTopupSubmit);
        document.getElementById('transactionFilter').addEventListener('input', handleTransactionFilter);
        document.getElementById('saveAutoRechargeBtn').addEventListener('click', saveAutoRechargeSettings);
        document.getElementById('sendMoneyForm').addEventListener('submit', handleSendMoneySubmit);

        // Quick amount buttons
        document.querySelectorAll('.topup-amount-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('.topup-amount-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('topupAmount').value = btn.dataset.amount;
            });
        });

    } catch (error) {
        console.error('Wallet initialization error:', error);
        showError('Failed to initialize wallet');
    }
});

async function loadWalletBalance() {
    try {
        const response = await fetch(`${API_BASE}/api/wallet/balance`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();

        if (data.success && data.wallet) {
            const wallet = data.wallet;
            document.getElementById('balanceAmount').textContent = (parseFloat(wallet.balance) || 0).toFixed(2);
            document.getElementById('totalCredited').textContent = `PKR ${parseFloat(wallet.total_credited).toFixed(2)}`;
            document.getElementById('totalSpent').textContent = `PKR ${parseFloat(wallet.total_spent).toFixed(2)}`;
            document.getElementById('transactionCount').textContent = wallet.total_transactions || '0';
            document.getElementById('autoRechargeStatus').textContent = wallet.auto_recharge_enabled ? 'Enabled' : 'Disabled';

            if (wallet.auto_recharge_enabled) {
                document.getElementById('enableAutoRecharge').checked = true;
                document.getElementById('autoRechargeThreshold').value = wallet.auto_recharge_threshold || '';
                document.getElementById('autoRechargeAmount').value = wallet.auto_recharge_amount || '';
            }
        }
    } catch (error) {
        console.error('Load balance error:', error);
    }
}

async function loadTransactions() {
    try {
        const response = await fetch(`${API_BASE}/api/wallet/transactions`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();

        const tbody = document.getElementById('transactionsBody');
        tbody.innerHTML = '';

        if (data.success && data.transactions && data.transactions.length) {
            data.transactions.forEach(tx => {
                const row = document.createElement('tr');
                const badgeClass = `badge badge-${tx.type}`;
                const date = new Date(tx.created_at).toLocaleString();
                
                row.innerHTML = `
                    <td>${date}</td>
                    <td><span class="${badgeClass}">${tx.type.toUpperCase()}</span></td>
                    <td>PKR ${parseFloat(tx.amount).toFixed(2)}</td>
                    <td>${tx.description}</td>
                    <td><strong>PKR ${parseFloat(tx.balance_after).toFixed(2)}</strong></td>
                `;
                tbody.appendChild(row);
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #999;">No transactions yet</td></tr>';
        }
    } catch (error) {
        console.error('Load transactions error:', error);
    }
}

function handleTransactionFilter(e) {
    const filterValue = e.target.value.toLowerCase();
    const rows = document.querySelectorAll('#transactionsBody tr');

    rows.forEach(row => {
        const typeCell = row.querySelector('td:nth-child(2)');
        if (typeCell) {
            const typeText = typeCell.textContent.toLowerCase();
            row.style.display = filterValue === '' || typeText.includes(filterValue) ? '' : 'none';
        }
    });
}

function handlePaymentMethodChange(e) {
    const method = e.target.value;
    const cardSection = document.getElementById('cardSection');
    const paypalMessage = document.getElementById('paypalMessage');
    const saveCardGroup = document.getElementById('saveCardGroup');
    const savedCardsContainer = document.getElementById('savedCardsContainer');

    if (method === 'card') {
        paypalMessage.style.display = 'none';
        saveCardGroup.style.display = 'flex';
        savedCardsContainer.style.display = 'block';

        // If user chooses to use a new card by default, mount the card element
        const selected = document.querySelector('input[name="savedCardRadio"]:checked');
        if (!selected || selected.value === 'new') {
            cardSection.style.display = 'block';
            if (walletCardElement && !(walletCardElement._parent || walletCardElement._mounted)) {
                try { walletCardElement.mount('#card-element'); } catch (err) { /* ignore mount errors */ }
            }
        } else {
            // Using saved card, hide card element
            cardSection.style.display = 'none';
        }
    } else if (method === 'paypal') {
        cardSection.style.display = 'none';
        paypalMessage.style.display = 'block';
        saveCardGroup.style.display = 'none';
        document.getElementById('savedCardsContainer').style.display = 'none';
    } else {
        cardSection.style.display = 'none';
        paypalMessage.style.display = 'none';
        saveCardGroup.style.display = 'none';
        document.getElementById('savedCardsContainer').style.display = 'none';
    }
}

// Load saved payment methods and render them so user can pick an existing card
async function loadPaymentMethods() {
    try {
        const container = document.getElementById('savedCards');
        container.innerHTML = '<div style="color: #999; text-align: center; padding: 10px;">Loading saved cards...</div>';

        const res = await fetch(`${API_BASE}/api/wallet/payment-methods`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await res.json();

        if (data.success && data.payment_methods && data.payment_methods.length) {
            const methodsHtml = [];
            // Add option for using a new card
            methodsHtml.push(`<label style="display:block; margin-bottom:8px;"><input type=\"radio\" name=\"savedCardRadio\" value=\"new\" checked> Use a new card</label>`);

            data.payment_methods.forEach(pm => {
                methodsHtml.push(
                    `<label style=\"display:block; padding:8px; border-radius:6px; margin-bottom:6px; cursor:pointer;\">
                        <input type=\"radio\" name=\"savedCardRadio\" value=\"id_${pm.id}\" data-gateway-id=\"${pm.gateway_id || pm.gatewayId || pm.gateway_id || ''}\"> ${pm.card_brand || pm.cardBrand || ''} •••• ${pm.card_last_four || ''} (exp ${pm.card_expiry_month || ''}/${pm.card_expiry_year || ''})
                    </label>`
                );
            });

            container.innerHTML = methodsHtml.join('');

            // When selecting saved card radio, update visibility of card element
            container.querySelectorAll('input[name="savedCardRadio"]').forEach(r => {
                r.addEventListener('change', () => {
                    const cardSection = document.getElementById('cardSection');
                    if (r.value === 'new') {
                        cardSection.style.display = 'block';
                        try { walletCardElement.mount('#card-element'); } catch (err) { }
                        document.getElementById('saveCardGroup').style.display = 'flex';
                    } else {
                        cardSection.style.display = 'none';
                        document.getElementById('saveCardGroup').style.display = 'none';
                    }
                });
            });
        } else {
            container.innerHTML = '<div style="color: #999; text-align: center; padding: 10px;">No saved cards</div>';
        }
    } catch (error) {
        console.error('Load payment methods error:', error);
        const container = document.getElementById('savedCards');
        container.innerHTML = '<div style="color: #e74c3c; text-align: center; padding: 10px;">Failed to load saved cards</div>';
    }
}

async function handleTopupSubmit(e) {
    e.preventDefault();

    const amount = parseFloat(document.getElementById('topupAmount').value);
    const paymentMethod = document.getElementById('paymentMethod').value;

    if (!amount || amount <= 0) {
        showError('Please enter a valid amount');
        return;
    }

    if (!paymentMethod) {
        showError('Please select a payment method');
        return;
    }

    if (paymentMethod === 'card' && !walletCardElement) {
        showError('Card payment is not available. Please contact support.');
        return;
    }

    if (paymentMethod === 'paypal') {
        showError('PayPal support is coming soon');
        return;
    }

    try {
        const btn = document.getElementById('topupBtn');
        btn.disabled = true;
        btn.textContent = 'Processing...';

        // Create payment method with Stripe or use saved card
        if (paymentMethod === 'card') {
            // Check saved card selection
            const selected = document.querySelector('input[name="savedCardRadio"]:checked');
            let cardTokenToUse = null;

            if (selected && selected.value && selected.value !== 'new') {
                // saved card selected - extract gateway id
                cardTokenToUse = selected.dataset.gatewayId || null;
            }

            let pmIdToSend = cardTokenToUse;

            if (!cardTokenToUse) {
                // create a new payment method from card element
                const { paymentMethod: pm, error } = await walletStripe.createPaymentMethod({
                    type: 'card',
                    card: walletCardElement,
                    billing_details: {
                        name: localStorage.getItem('serveNowUserName') || 'User'
                    }
                });

                if (error) {
                    showError(`Card error: ${error.message}`);
                    btn.disabled = false;
                    btn.textContent = 'Add to Wallet';
                    return;
                }

                pmIdToSend = pm.id;
            }

            // Submit topup request
            const topupResponse = await fetch(`${API_BASE}/api/wallet/topup`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    amount: amount,
                    paymentMethod: 'card',
                    cardToken: pmIdToSend,
                    saveCard: document.getElementById('saveCard').checked
                })
            });

            const topupData = await topupResponse.json();

            if (topupData.success) {
                showSuccess(`Successfully added PKR ${amount.toFixed(2)} to your wallet!`);
                document.getElementById('topupForm').reset();
                document.querySelectorAll('.topup-amount-btn').forEach(b => b.classList.remove('active'));
                
                // Clear card element
                if (walletCardElement) {
                    walletCardElement.clear();
                }
                
                loadWalletBalance();
                loadTransactions();
                // refresh saved cards list (if new card was saved)
                loadPaymentMethods();
            } else {
                showError(`Topup failed: ${topupData.message}`);
            }
        }

        btn.disabled = false;
        btn.textContent = 'Add to Wallet';
    } catch (error) {
        console.error('Topup error:', error);
        showError('An error occurred while processing your request');
        document.getElementById('topupBtn').disabled = false;
        document.getElementById('topupBtn').textContent = 'Add to Wallet';
    }
}

async function saveAutoRechargeSettings() {
    try {
        const enabled = document.getElementById('enableAutoRecharge').checked;
        const threshold = parseFloat(document.getElementById('autoRechargeThreshold').value);
        const amount = parseFloat(document.getElementById('autoRechargeAmount').value);

        if (enabled) {
            if (!threshold || threshold <= 0) {
                showError('Please enter a valid threshold amount');
                return;
            }
            if (!amount || amount <= 0) {
                showError('Please enter a valid auto-recharge amount');
                return;
            }
        }

        const response = await fetch(`${API_BASE}/api/wallet/auto-recharge`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                enabled: enabled,
                threshold: threshold,
                amount: amount
            })
        });

        const data = await response.json();

        if (data.success) {
            showSuccess('Auto-recharge settings updated successfully!');
            loadWalletBalance();
        } else {
            showError(`Failed to update settings: ${data.message}`);
        }
    } catch (error) {
        console.error('Save auto-recharge error:', error);
        showError('Failed to save auto-recharge settings');
    }
}

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    const successDiv = document.getElementById('successMessage');
    
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    successDiv.style.display = 'none';

    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 5000);
}

function showSuccess(message) {
    const successDiv = document.getElementById('successMessage');
    const errorDiv = document.getElementById('errorMessage');
    
    successDiv.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
    successDiv.style.display = 'block';
    errorDiv.style.display = 'none';

    setTimeout(() => {
        successDiv.style.display = 'none';
    }, 5000);
}

function toggleMobileMenu() {
    const navMenu = document.querySelector('nav ul');
    navMenu.style.display = navMenu.style.display === 'flex' ? 'none' : 'flex';
}

function logout() {
    localStorage.removeItem('serveNowToken');
    localStorage.removeItem('serveNowUser');
    window.location.href = 'login.html';
}

async function handleSendMoneySubmit(e) {
    e.preventDefault();

    const recipientId = document.getElementById('recipientId').value;
    const amount = parseFloat(document.getElementById('sendAmount').value);
    const description = document.getElementById('sendDescription').value;

    if (!recipientId) {
        showSendError('Please enter a recipient user ID');
        return;
    }

    if (!amount || amount <= 0) {
        showSendError('Please enter a valid amount');
        return;
    }

    try {
        const btn = document.getElementById('sendMoneyBtn');
        btn.disabled = true;
        btn.textContent = 'Sending...';

        const response = await fetch(`${API_BASE}/api/wallet/transfers/send`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                recipientId,
                amount,
                description
            })
        });

        const data = await response.json();

        if (data.success) {
            showSendSuccess(`Transfer request for PKR ${amount.toFixed(2)} sent!`);
            document.getElementById('sendMoneyForm').reset();
            loadWalletBalance();
            loadTransactions();
        } else {
            showSendError(data.message || 'Failed to send money');
        }

        btn.disabled = false;
        btn.textContent = 'Send Money';
    } catch (error) {
        console.error('Send money error:', error);
        showSendError('An error occurred while sending money');
        document.getElementById('sendMoneyBtn').disabled = false;
        document.getElementById('sendMoneyBtn').textContent = 'Send Money';
    }
}

async function loadReceivedTransfers() {
    const listDiv = document.getElementById('receivedTransfersList');
    try {
        const response = await fetch(`${API_BASE}/api/wallet/transfers/received`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();

        if (data.success && data.transfers && data.transfers.length) {
            listDiv.innerHTML = data.transfers.map(t => `
                <div class="transfer-card">
                    <div class="transfer-header">
                        <strong>From: ${t.sender_name} (${t.sender_email})</strong>
                        <span class="transfer-status status-${t.status}">${t.status}</span>
                    </div>
                    <div style="margin-bottom: 10px;">
                        <span style="font-size: 20px; font-weight: bold;">PKR ${parseFloat(t.amount).toFixed(2)}</span>
                        ${t.description ? `<p style="margin: 5px 0; color: #666;">${t.description}</p>` : ''}
                    </div>
                    <div style="font-size: 12px; color: #999; margin-bottom: 10px;">
                        Received: ${new Date(t.created_at).toLocaleString()}
                    </div>
                    ${t.status === 'pending' ? `
                        <div>
                            <button onclick="acceptTransfer(${t.id})" class="btn-small btn-accept">Accept</button>
                            <button onclick="rejectTransfer(${t.id})" class="btn-small btn-reject">Reject</button>
                        </div>
                    ` : ''}
                    ${t.rejection_reason ? `<div style="font-size: 12px; color: #e74c3c;">Reason: ${t.rejection_reason}</div>` : ''}
                </div>
            `).join('');
        } else {
            listDiv.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No received transfers yet.</p>';
        }
    } catch (error) {
        console.error('Load received transfers error:', error);
        listDiv.innerHTML = '<p style="text-align: center; color: #e74c3c;">Failed to load received transfers.</p>';
    }
}

async function loadSentTransfers() {
    const listDiv = document.getElementById('sentTransfersList');
    try {
        const response = await fetch(`${API_BASE}/api/wallet/transfers/sent`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();

        if (data.success && data.transfers && data.transfers.length) {
            listDiv.innerHTML = data.transfers.map(t => `
                <div class="transfer-card">
                    <div class="transfer-header">
                        <strong>To: ${t.recipient_name} (${t.recipient_email})</strong>
                        <span class="transfer-status status-${t.status}">${t.status}</span>
                    </div>
                    <div style="margin-bottom: 10px;">
                        <span style="font-size: 20px; font-weight: bold;">PKR ${parseFloat(t.amount).toFixed(2)}</span>
                        ${t.description ? `<p style="margin: 5px 0; color: #666;">${t.description}</p>` : ''}
                    </div>
                    <div style="font-size: 12px; color: #999; margin-bottom: 10px;">
                        Sent: ${new Date(t.created_at).toLocaleString()}
                    </div>
                    ${t.status === 'pending' ? `
                        <div>
                            <button onclick="cancelTransfer(${t.id})" class="btn-small btn-cancel">Cancel</button>
                        </div>
                    ` : ''}
                    ${t.rejection_reason ? `<div style="font-size: 12px; color: #e74c3c;">Rejection Reason: ${t.rejection_reason}</div>` : ''}
                </div>
            `).join('');
        } else {
            listDiv.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No sent transfers yet.</p>';
        }
    } catch (error) {
        console.error('Load sent transfers error:', error);
        listDiv.innerHTML = '<p style="text-align: center; color: #e74c3c;">Failed to load sent transfers.</p>';
    }
}

async function acceptTransfer(id) {
    if (!confirm('Are you sure you want to accept this transfer? The money will be added to your balance.')) return;
    
    try {
        const response = await fetch(`${API_BASE}/api/wallet/transfers/${id}/accept`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();

        if (data.success) {
            showSendSuccess('Transfer accepted successfully!');
            loadReceivedTransfers();
            loadWalletBalance();
            loadTransactions();
        } else {
            showSendError(data.message || 'Failed to accept transfer');
        }
    } catch (error) {
        console.error('Accept transfer error:', error);
        showSendError('An error occurred while accepting the transfer');
    }
}

async function rejectTransfer(id) {
    const reason = prompt('Please enter a reason for rejection (optional):');
    if (reason === null) return;

    try {
        const response = await fetch(`${API_BASE}/api/wallet/transfers/${id}/reject`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ reason })
        });
        const data = await response.json();

        if (data.success) {
            showSendSuccess('Transfer rejected.');
            loadReceivedTransfers();
        } else {
            showSendError(data.message || 'Failed to reject transfer');
        }
    } catch (error) {
        console.error('Reject transfer error:', error);
        showSendError('An error occurred while rejecting the transfer');
    }
}

async function cancelTransfer(id) {
    if (!confirm('Are you sure you want to cancel this transfer? The money will be returned to your balance.')) return;

    try {
        const response = await fetch(`${API_BASE}/api/wallet/transfers/${id}/cancel`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();

        if (data.success) {
            showSendSuccess('Transfer cancelled.');
            loadSentTransfers();
            loadWalletBalance();
            loadTransactions();
        } else {
            showSendError(data.message || 'Failed to cancel transfer');
        }
    } catch (error) {
        console.error('Cancel transfer error:', error);
        showSendError('An error occurred while cancelling the transfer');
    }
}

function showSendError(message) {
    const errorDiv = document.getElementById('sendErrorMessage');
    const successDiv = document.getElementById('sendSuccessMessage');
    
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    successDiv.style.display = 'none';

    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 5000);
}

function showSendSuccess(message) {
    const successDiv = document.getElementById('sendSuccessMessage');
    const errorDiv = document.getElementById('sendErrorMessage');
    
    successDiv.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
    successDiv.style.display = 'block';
    errorDiv.style.display = 'none';

    setTimeout(() => {
        successDiv.style.display = 'none';
    }, 5000);
}
