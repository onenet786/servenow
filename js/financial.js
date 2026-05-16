let currentTransactions = [];
let currentPaymentVouchers = [];
let currentReceiptVouchers = [];
let currentRiderCash = [];
let currentStoreSettlements = [];
let currentExpenses = [];
let currentReports = [];
let currentUnsettledSettlementItems = [];
let selectedUnsettledSettlementItemIds = new Set();
let currentJournalVouchers = [];
let lastRiderData = [];
let lastStoreData = [];

const financialModalIds = ['paymentVoucherModal', 'receiptVoucherModal', 'transactionModal', 'riderCashModal', 'storeSettlementModal', 'expenseModal', 'journalVoucherModal'];
const formChangedState = {};

function openModal(modalId) {
    document.getElementById(modalId).classList.add('show');
    
    // Initialize listeners when the settlement modal opens
    if (modalId === 'storeSettlementModal') {
        // We delay slightly to ensure DOM is ready/visible if needed, though usually unnecessary
        setTimeout(setupStoreSettlementListeners, 100);
    }
}

function closeModal(modalId) {
    const isFiancialModal = financialModalIds.includes(modalId);
    if (isFiancialModal && formChangedState[modalId]) {
        const confirmed = confirm('You have unsaved changes. Are you sure you want to close without saving?');
        if (!confirmed) return;
    }
    document.getElementById(modalId).classList.remove('show');
    if (isFiancialModal) formChangedState[modalId] = false;
}

function trackFormChanges(formId, modalId) {
    const form = document.getElementById(formId);
    if (!form) return;
    
    form.addEventListener('change', () => {
        formChangedState[modalId] = true;
    });
    
    form.addEventListener('input', () => {
        formChangedState[modalId] = true;
    });
}

async function loadJournalVouchers() {
    try {
        const status = document.getElementById('journalVoucherStatusFilter')?.value || '';
        const params = new URLSearchParams();
        if (status) params.append('status', status);

        const response = await fetch(`${API_BASE}/api/financial/journal-vouchers?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();

        if (data.success) {
            currentJournalVouchers = data.vouchers || [];
            displayJournalVouchers(currentJournalVouchers);
        }
    } catch (error) {
        console.error('Error loading journal vouchers:', error);
        showError('Load Error', 'Failed to load journal vouchers');
    }
}

function displayJournalVouchers(vouchers) {
    const tbody = document.getElementById('journalVouchersTableBody');
    tbody.innerHTML = '';

    vouchers.forEach(v => {
        const row = document.createElement('tr');
        const date = new Date(v.voucher_date).toLocaleDateString();
        row.innerHTML = `
            <td>${v.voucher_number}</td>
            <td>${date}</td>
            <td>${v.description || '-'}</td>
            <td>${v.reference_number || '-'}</td>
            <td>Rs  ${parseFloat(v.total_amount).toFixed(2)}</td>
            <td><span class="status-${v.status}">${v.status}</span></td>
            <td>${v.prepared_by_name || '-'}</td>
            <td>
                <button class="btn-small btn-info" onclick="viewJournalVoucher(${v.id})">View</button>
                ${v.status === 'draft' ? `<button class="btn-small btn-primary" onclick="postJournalVoucher(${v.id})">Post</button>` : ''}
                ${v.status === 'draft' ? `<button class="btn-small btn-danger" onclick="cancelJournalVoucher(${v.id})">Cancel</button>` : ''}
            </td>
        `;
        tbody.appendChild(row);
    });

    if (vouchers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem;">No journal vouchers found</td></tr>';
    }
}

function createJournalVoucher() {
    const form = document.getElementById('journalVoucherForm');
    if (form) form.reset();
    document.getElementById('journalVoucherId').value = '';
    document.getElementById('jnvEntriesBody').innerHTML = '';
    document.getElementById('jnvDebitTotal').textContent = '0.00';
    document.getElementById('jnvCreditTotal').textContent = '0.00';
    document.getElementById('jnvDebitTotal').parentElement.style.color = 'inherit';
    document.getElementById('jnvDate').valueAsDate = new Date();
    
    // Add two initial rows
    addJnvEntryRow();
    addJnvEntryRow();

    formChangedState['journalVoucherModal'] = false;
    openModal('journalVoucherModal');
}

function addJnvEntryRow(data = null) {
    const tbody = document.getElementById('jnvEntriesBody');
    const row = document.createElement('tr');
    row.className = 'jnv-entry-row';
    
    row.innerHTML = `
        <td><input type="text" class="form-control jnv-account" placeholder="e.g. Sales, Cash" value="${data ? data.account_name : ''}" required></td>
        <td>
            <select class="form-control jnv-entity-type">
                <option value="platform" ${data?.entity_type === 'platform' ? 'selected' : ''}>Platform</option>
                <option value="rider" ${data?.entity_type === 'rider' ? 'selected' : ''}>Rider</option>
                <option value="store" ${data?.entity_type === 'store' ? 'selected' : ''}>Store</option>
                <option value="customer" ${data?.entity_type === 'customer' ? 'selected' : ''}>Customer</option>
                <option value="vendor" ${data?.entity_type === 'vendor' ? 'selected' : ''}>Vendor</option>
                <option value="other" ${data?.entity_type === 'other' ? 'selected' : ''}>Other</option>
            </select>
        </td>
        <td><input type="number" class="form-control jnv-entity-id" placeholder="ID" value="${data ? data.entity_id : ''}"></td>
        <td>
            <select class="form-control jnv-entry-type">
                <option value="debit" ${data?.entry_type === 'debit' ? 'selected' : ''}>Debit</option>
                <option value="credit" ${data?.entry_type === 'credit' ? 'selected' : ''}>Credit</option>
            </select>
        </td>
        <td><input type="number" class="form-control jnv-amount" step="0.01" min="0" placeholder="0.00" value="${data ? data.amount : ''}" required></td>
        <td><input type="text" class="form-control jnv-row-desc" placeholder="Detail" value="${data ? data.description || '' : ''}"></td>
        <td><button type="button" class="btn-small btn-danger" onclick="this.closest('tr').remove(); calculateJnvTotals();"><i class="fas fa-trash"></i></button></td>
    `;
    
    tbody.appendChild(row);
    
    // Add listeners for total calculation
    row.querySelector('.jnv-amount').addEventListener('input', calculateJnvTotals);
    row.querySelector('.jnv-entry-type').addEventListener('change', calculateJnvTotals);
}

function calculateJnvTotals() {
    let debitTotal = 0;
    let creditTotal = 0;
    
    document.querySelectorAll('.jnv-entry-row').forEach(row => {
        const amount = parseFloat(row.querySelector('.jnv-amount').value) || 0;
        const type = row.querySelector('.jnv-entry-type').value;
        
        if (type === 'debit') debitTotal += amount;
        else creditTotal += amount;
    });
    
    document.getElementById('jnvDebitTotal').textContent = debitTotal.toFixed(2);
    document.getElementById('jnvCreditTotal').textContent = creditTotal.toFixed(2);
    
    // Highlight if imbalanced
    const totalCell = document.getElementById('jnvDebitTotal').parentElement;
    if (debitTotal !== creditTotal) {
        totalCell.style.color = 'red';
    } else {
        totalCell.style.color = 'inherit';
    }
    
    return { debitTotal, creditTotal };
}

async function submitJournalVoucher() {
    const { debitTotal, creditTotal } = calculateJnvTotals();
    
    if (debitTotal !== creditTotal) {
        showError('Imbalanced Voucher', 'Total Debits must equal Total Credits');
        return;
    }
    
    if (debitTotal <= 0) {
        showError('Invalid Amount', 'Voucher amount must be greater than zero');
        return;
    }

    const entries = [];
    document.querySelectorAll('.jnv-entry-row').forEach(row => {
        entries.push({
            account_name: row.querySelector('.jnv-account').value,
            entity_type: row.querySelector('.jnv-entity-type').value,
            entity_id: row.querySelector('.jnv-entity-id').value || null,
            entry_type: row.querySelector('.jnv-entry-type').value,
            amount: parseFloat(row.querySelector('.jnv-amount').value),
            description: row.querySelector('.jnv-row-desc').value
        });
    });

    const payload = {
        voucher_date: document.getElementById('jnvDate').value,
        reference_number: document.getElementById('jnvReference').value,
        description: document.getElementById('jnvDescription').value,
        total_amount: debitTotal,
        entries
    };

    try {
        const response = await fetch(`${API_BASE}/api/financial/journal-vouchers`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Success', 'Journal Voucher created as draft');
            closeModal('journalVoucherModal');
            loadJournalVouchers();
        } else {
            showError('Error', data.message);
        }
    } catch (error) {
        console.error('Error submitting JNV:', error);
        showError('Error', 'Failed to save journal voucher');
    }
}

async function postJournalVoucher(id) {
    if (!confirm('Are you sure you want to post this voucher to the master ledger? This action cannot be undone.')) return;

    try {
        const response = await fetch(`${API_BASE}/api/financial/journal-vouchers/${id}/post`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();
        if (data.success) {
            showSuccess('Success', 'Voucher posted successfully');
            loadJournalVouchers();
        } else {
            showError('Error', data.message);
        }
    } catch (error) {
        showError('Error', 'Failed to post voucher');
    }
}

async function cancelJournalVoucher(id) {
    if (!confirm('Are you sure you want to cancel this draft voucher?')) return;

    try {
        const response = await fetch(`${API_BASE}/api/financial/journal-vouchers/${id}/cancel`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();
        if (data.success) {
            showSuccess('Success', 'Voucher cancelled');
            loadJournalVouchers();
        } else {
            showError('Error', data.message);
        }
    } catch (error) {
        showError('Error', 'Failed to cancel voucher');
    }
}

async function viewJournalVoucher(id) {
    try {
        const response = await fetch(`${API_BASE}/api/financial/journal-vouchers/${id}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();
        
        if (data.success) {
            const v = data.voucher;
            const entries = data.entries;
            
            let entryRows = entries.map(e => `
                <tr>
                    <td>${e.account_name}</td>
                    <td>${e.entity_type}</td>
                    <td>${e.entity_id || '-'}</td>
                    <td><span class="badge badge-${e.entry_type}">${e.entry_type.toUpperCase()}</span></td>
                    <td>Rs  ${parseFloat(e.amount).toFixed(2)}</td>
                    <td>${e.description || '-'}</td>
                </tr>
            `).join('');
            
            const details = `
                <div style="margin-bottom: 1rem;">
                    <strong>Voucher #:</strong> ${v.voucher_number}<br>
                    <strong>Date:</strong> ${new Date(v.voucher_date).toLocaleDateString()}<br>
                    <strong>Status:</strong> <span class="status-${v.status}">${v.status}</span><br>
                    <strong>Description:</strong> ${v.description || '-'}<br>
                    <strong>Ref #:</strong> ${v.reference_number || '-'}<br>
                    <strong>Prepared By:</strong> ${v.prepared_by_name || '-'}<br>
                </div>
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Account</th>
                                <th>Entity</th>
                                <th>ID</th>
                                <th>Type</th>
                                <th>Amount</th>
                                <th>Desc</th>
                            </tr>
                        </thead>
                        <tbody>${entryRows}</tbody>
                    </table>
                </div>
            `;
            
            showInfo('Journal Voucher Details', details, 20000);
        }
    } catch (error) {
        showError('Error', 'Failed to load voucher details');
    }
}

function initializeFinancialForms() {
    // Initialize dynamic voucher type handlers
    if (window.handleVoucherTypeChange) {
        handleVoucherTypeChange('payeeType', 'payeeName', 'payeeSelect', 'payeeId', 'addExpenseTypeBtn');
        handleVoucherTypeChange('payerType', 'payerName', 'payerSelect', 'payerId', 'addPayerExpenseTypeBtn');
    }

    document.getElementById('paymentVoucherForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (typeof validateForm === 'function' && !validateForm('paymentVoucherForm')) return;
        await submitPaymentVoucher();
    });
    trackFormChanges('paymentVoucherForm', 'paymentVoucherModal');
    
    document.getElementById('receiptVoucherForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (typeof validateForm === 'function' && !validateForm('receiptVoucherForm')) return;
        await submitReceiptVoucher();
    });
    trackFormChanges('receiptVoucherForm', 'receiptVoucherModal');
    
    document.getElementById('transactionForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (typeof validateForm === 'function' && !validateForm('transactionForm')) return;
        await submitTransaction();
    });
    trackFormChanges('transactionForm', 'transactionModal');
    
    document.getElementById('riderCashForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (typeof validateForm === 'function' && !validateForm('riderCashForm')) return;
        await submitRiderCash();
    });
    trackFormChanges('riderCashForm', 'riderCashModal');
    
    document.getElementById('storeSettlementForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!isSettlementMultiStoreMode() && typeof validateForm === 'function' && !validateForm('storeSettlementForm')) return;
        await submitStoreSettlement();
    });
    trackFormChanges('storeSettlementForm', 'storeSettlementModal');
    
    document.getElementById('expenseForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (typeof validateForm === 'function' && !validateForm('expenseForm')) return;
        await submitExpense();
    });
    trackFormChanges('expenseForm', 'expenseModal');
    
    document.getElementById('journalVoucherForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (typeof validateForm === 'function' && !validateForm('journalVoucherForm')) return;
        await submitJournalVoucher();
    });
    trackFormChanges('journalVoucherForm', 'journalVoucherModal');
    
    document.getElementById('addJnvEntryRowBtn')?.addEventListener('click', () => {
        addJnvEntryRow();
    });

    document.getElementById('generateReportForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitGenerateReport();
    });

    // Report Type Change Handler
    const reportTypeSelect = document.getElementById('reportTypeModal');
    if (reportTypeSelect) {
        reportTypeSelect.addEventListener('change', function() {
            const riderGroup = document.getElementById('reportRiderSelectGroup');
            const riderSelect = document.getElementById('reportRiderSelect');
            
            if (
                this.value === 'rider_fuel_report' ||
                this.value === 'rider_cash_report' ||
                this.value === 'rider_orders_report' ||
                this.value === 'rider_payments_report' ||
                this.value === 'rider_receivings_report' ||
                this.value === 'rider_wallet_report' ||
                this.value === 'rider_petrol_report' ||
                this.value === 'rider_daily_mileage_report' ||
                this.value === 'rider_daily_activity_report' ||
                this.value === 'rider_day_closing_report'
            ) {
                if (riderGroup) riderGroup.style.display = 'block';
                // Populate riders if needed
                if (riderSelect && riderSelect.options.length <= 1 && window.AppState && window.AppState.riders) {
                     window.AppState.riders.forEach(r => {
                        const opt = document.createElement('option');
                        opt.value = r.id;
                        opt.textContent = `${r.first_name} ${r.last_name || ''}`.trim();
                        riderSelect.appendChild(opt);
                     });
                }
            } else {
                if (riderGroup) riderGroup.style.display = 'none';
                if (riderSelect) riderSelect.value = '';
            }

            const storeGroup = document.getElementById('reportStoreSelectGroup');
            const storeSelect = document.getElementById('reportStoreSelect');
            if (storeGroup) {
                storeGroup.style.display = (
                    this.value === 'order_wise_sale_summary' ||
                    this.value === 'store_payable_reconciliation' ||
                    this.value === 'unsettled_amounts_report' ||
                    this.value === 'store_order_settlement_report' ||
                    this.value === 'periodic_sales_report'
                ) ? 'block' : 'none';
            }
            if (storeSelect && (!storeGroup || storeGroup.style.display === 'none')) {
                storeSelect.value = '';
            }

            if (this.value === 'periodic_credit_cash_report') {
                setDatesForPeriod('today', 'reportPeriodFrom', 'reportPeriodTo');
            }
        });
    }

    document.getElementById('addBankForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitAddBank();
    });
}

async function submitAddBank() {
    const form = document.getElementById('addBankForm');
    const formData = new FormData(form);
    const raw = Object.fromEntries(formData.entries());
    const payload = {
        name: raw.name,
        account_number: raw.account_number || raw.accountNumber || null,
        bank_code: raw.bank_code || raw.bankCode || null,
        branch_name: raw.branch_name || raw.branchName || null,
        account_title: raw.account_title || raw.accountTitle || null
    };

    try {
        const response = await fetch(`${API_BASE}/api/financial/banks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Success', 'Bank added successfully');
            if (typeof hideModal === 'function') hideModal('addBankModal');
            else closeModal('addBankModal');
            form.reset();
            window.dispatchEvent(new CustomEvent('servenow:bank-added', { detail: { id: data.id || null } }));
            
            // Refresh lists if currently selected type is bank
            const payeeType = document.getElementById('payeeType');
            if (payeeType && payeeType.value === 'bank') {
                 payeeType.dispatchEvent(new Event('change'));
            }
            const payerType = document.getElementById('payerType');
            if (payerType && payerType.value === 'bank') {
                 payerType.dispatchEvent(new Event('change'));
            }
        } else {
            showError('Error', data.message || 'Failed to add bank');
        }
    } catch (error) {
        console.error('Error adding bank:', error);
        showError('Error', 'Failed to add bank');
    }
}

async function loadFinancialDashboard() {
    try {
        const period = document.getElementById('financialPeriodFilter')?.value || 'all';
        const response = await fetch(`${API_BASE}/api/financial/dashboard?period=${period}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();

        if (data.success) {
            const toNum = (v) => {
                const n = parseFloat(v);
                return Number.isFinite(n) ? n : 0;
            };
            const setAmount = (id, value, color) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.textContent = `Rs  ${toNum(value).toFixed(2)}`;
                el.style.setProperty('color', color, 'important');
                el.style.setProperty('-webkit-text-fill-color', color, 'important');
                el.style.setProperty('background', 'none', 'important');
                el.style.setProperty('-webkit-background-clip', 'initial', 'important');
                el.style.fontWeight = '700';
            };
            const setTileStyle = (id, accent, bg) => {
                const el = document.getElementById(id);
                if (!el) return;
                const card = el.closest('.stat-card');
                if (!card) return;
                card.style.setProperty('border-left', `4px solid ${accent}`, 'important');
                card.style.setProperty('background', bg, 'important');
            };
            const setDynamicAmount = (id, value, positiveColor, negativeColor) => {
                const num = toNum(value);
                setAmount(id, num, num < 0 ? negativeColor : positiveColor);
            };

            const stats = data.stats || {};
            const netProfit = toNum(stats.income) - (toNum(stats.expense) + toNum(stats.settlement) + toNum(stats.refund));

            setAmount('cashInHandAmount', stats.cashInHand, '#0f766e');
            setAmount('totalIncomeAmount', stats.income, '#16a34a');
            setAmount('totalExpenseAmount', stats.expense, '#dc2626');
            setDynamicAmount('netProfitAmount', netProfit, '#16a34a', '#b91c1c');
            setAmount('totalSettlementsAmount', stats.settlement, '#d97706');
            setAmount('totalRiderCashAmount', stats.riderCashSubmitted, '#2563eb');
            setAmount('paymentVouchersAmount', stats.paymentVouchers, '#7c3aed');
            setAmount('receiptVouchersAmount', stats.receiptVouchers, '#4f46e5');
            setAmount('deliveryChargesAmount', stats.deliveryCharges || 0, '#0891b2');
            setAmount('storeBalancesAmount', stats.storeBalances || 0, '#b45309');
            setAmount('totalUnsettledAmount', stats.totalUnsettledAmount || 0, '#ea580c');
            setDynamicAmount('netProfitIfSettledAmount', stats.netProfitIfSettled || 0, '#059669', '#b91c1c');

            setTileStyle('cashInHandAmount', '#0f766e', 'linear-gradient(135deg,#f0fdfa,#ecfeff)');
            setTileStyle('totalIncomeAmount', '#16a34a', 'linear-gradient(135deg,#f0fdf4,#ecfdf5)');
            setTileStyle('totalExpenseAmount', '#dc2626', 'linear-gradient(135deg,#fef2f2,#fff1f2)');
            setTileStyle('netProfitAmount', netProfit < 0 ? '#b91c1c' : '#16a34a', netProfit < 0 ? 'linear-gradient(135deg,#fff1f2,#fef2f2)' : 'linear-gradient(135deg,#ecfdf5,#f0fdf4)');
            setTileStyle('totalSettlementsAmount', '#d97706', 'linear-gradient(135deg,#fffbeb,#fefce8)');
            setTileStyle('totalRiderCashAmount', '#2563eb', 'linear-gradient(135deg,#eff6ff,#eef2ff)');
            setTileStyle('paymentVouchersAmount', '#7c3aed', 'linear-gradient(135deg,#f5f3ff,#faf5ff)');
            setTileStyle('receiptVouchersAmount', '#4f46e5', 'linear-gradient(135deg,#eef2ff,#e0e7ff)');
            setTileStyle('deliveryChargesAmount', '#0891b2', 'linear-gradient(135deg,#ecfeff,#cffafe)');
            setTileStyle('storeBalancesAmount', '#b45309', 'linear-gradient(135deg,#fffbeb,#fde68a)');
            setTileStyle('totalUnsettledAmount', '#ea580c', 'linear-gradient(135deg,#fff7ed,#ffedd5)');
            setTileStyle('netProfitIfSettledAmount', toNum(stats.netProfitIfSettled || 0) < 0 ? '#b91c1c' : '#059669', toNum(stats.netProfitIfSettled || 0) < 0 ? 'linear-gradient(135deg,#fff1f2,#fef2f2)' : 'linear-gradient(135deg,#ecfdf5,#f0fdf4)');

            // Refresh dependent store-wise grid for the same selected period.
            await loadFinancialDashboardStoreWise();
        }
    } catch (error) {
        console.error('Error loading financial dashboard:', error);
        showError('Dashboard Error', 'Failed to load financial dashboard');
    }
}

function periodToDateRange(period) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const toYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (period === 'all') return { start: null, end: null };
    if (period === 'today') {
        const d = toYmd(now);
        return { start: d, end: d };
    }
    if (period === 'week') {
        const s = new Date(now);
        s.setHours(0, 0, 0, 0);
        s.setDate(s.getDate() - s.getDay());
        const e = new Date(s);
        e.setDate(s.getDate() + 6);
        return { start: toYmd(s), end: toYmd(e) };
    }
    if (period === 'year') {
        const y = now.getFullYear();
        return { start: `${y}-01-01`, end: `${y}-12-31` };
    }
    // month default
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: toYmd(start), end: toYmd(end) };
}

async function loadFinancialDashboardStoreFilters() {
    const storeSel = document.getElementById('fdStoreFilter');
    if (!storeSel) return;
    if (storeSel.dataset.loaded === '1') return;
    try {
        const response = await fetch(`${API_BASE}/api/stores?admin=1&lite=1`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();
        if (!response.ok || !data.success) return;
        const stores = Array.isArray(data.stores) ? data.stores : [];
        storeSel.innerHTML = '<option value="all">All Stores</option>';
        stores.forEach((s) => {
            const id = parseInt(String(s.id), 10);
            if (!Number.isInteger(id) || id <= 0) return;
            const opt = document.createElement('option');
            opt.value = String(id);
            opt.textContent = `${s.name || 'Store'} (#${id})`;
            storeSel.appendChild(opt);
        });
        storeSel.dataset.loaded = '1';
    } catch (e) {
        console.error('Error loading financial dashboard store filters:', e);
    }
}

function renderFinancialStoreWiseRows(rows) {
    const tbody = document.getElementById('financialStoreWiseBody');
    if (!tbody) return;
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:14px;">No records found</td></tr>';
        return;
    }
    const money = (v) => {
        const n = parseFloat(v);
        return `PKR ${Number.isFinite(n) ? n.toFixed(2) : '0.00'}`;
    };
    tbody.innerHTML = rows.map((r) => `
        <tr>
            <td>${r.name || '-'}</td>
            <td>${r.payment_term || '-'}</td>
            <td>${parseInt(String(r.total_orders || 0), 10) || 0}</td>
            <td>${money(r.total_earnings)}</td>
            <td>${money(r.total_paid)}</td>
            <td style="font-weight:700;color:${parseFloat(r.pending_settlement || 0) > 0 ? '#b45309' : '#059669'};">${money(r.pending_settlement)}</td>
        </tr>
    `).join('');
}

function renderFinancialStoreWiseSummary(rows) {
    const asNum = (v) => {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : 0;
    };
    const money = (v) => `Rs ${asNum(v).toFixed(2)}`;
    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };
    const setTile = (id, color, bg) => {
        const el = document.getElementById(id);
        const card = el?.closest('.stat-card');
        if (!card) return;
        card.style.setProperty('border-left', `4px solid ${color}`, 'important');
        card.style.setProperty('background', bg, 'important');
        el.style.setProperty('color', color, 'important');
    };

    const totalStores = rows.length;
    const totalOrders = rows.reduce((sum, r) => sum + (parseInt(String(r.total_orders || 0), 10) || 0), 0);
    const totalEarnings = rows.reduce((sum, r) => sum + asNum(r.total_earnings), 0);
    const totalPaid = rows.reduce((sum, r) => sum + asNum(r.total_paid), 0);
    const totalPending = rows.reduce((sum, r) => sum + asNum(r.pending_settlement), 0);

    setText('fdStoreCountAmount', String(totalStores));
    setText('fdStoreOrdersAmount', String(totalOrders));
    setText('fdStoreEarningsAmount', money(totalEarnings));
    setText('fdStorePaidAmount', money(totalPaid));
    setText('fdStorePendingAmount', money(totalPending));

    setTile('fdStoreCountAmount', '#1d4ed8', 'linear-gradient(135deg,#eff6ff,#dbeafe)');
    setTile('fdStoreOrdersAmount', '#7c3aed', 'linear-gradient(135deg,#f5f3ff,#ede9fe)');
    setTile('fdStoreEarningsAmount', '#15803d', 'linear-gradient(135deg,#f0fdf4,#dcfce7)');
    setTile('fdStorePaidAmount', '#0f766e', 'linear-gradient(135deg,#f0fdfa,#ccfbf1)');
    setTile(
        'fdStorePendingAmount',
        totalPending > 0 ? '#b45309' : '#059669',
        totalPending > 0 ? 'linear-gradient(135deg,#fff7ed,#ffedd5)' : 'linear-gradient(135deg,#ecfdf5,#d1fae5)'
    );
}

async function loadFinancialDashboardStoreWise() {
    const tbody = document.getElementById('financialStoreWiseBody');
    if (!tbody) return;
    try {
        await loadFinancialDashboardStoreFilters();
        const period = document.getElementById('financialPeriodFilter')?.value || 'all';
        const storeId = document.getElementById('fdStoreFilter')?.value || 'all';
        const paymentTermFilter = (document.getElementById('fdPaymentTermFilter')?.value || 'all').toLowerCase().trim();
        const pendingFilter = document.getElementById('fdPendingFilter')?.value || 'all';

        const dr = periodToDateRange(period);
        const params = new URLSearchParams();
        if (dr.start && dr.end) {
            params.set('start_date', dr.start);
            params.set('end_date', dr.end);
        }
        params.set('store_id', storeId || 'all');
        const response = await fetch(`${API_BASE}/api/financial/reports/stores-detailed?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:14px;">Failed to load store-wise details</td></tr>';
            return;
        }
        let rows = Array.isArray(data.stores) ? data.stores : [];
        if (paymentTermFilter !== 'all') {
            rows = rows.filter((r) => String(r.payment_term || '').toLowerCase().trim() === paymentTermFilter);
        }
        if (pendingFilter === 'pending_only') {
            rows = rows.filter((r) => parseFloat(r.pending_settlement || 0) > 0);
        } else if (pendingFilter === 'cleared_only') {
            rows = rows.filter((r) => parseFloat(r.pending_settlement || 0) <= 0);
        }
        renderFinancialStoreWiseSummary(rows);
        renderFinancialStoreWiseRows(rows);
    } catch (error) {
        console.error('Error loading financial dashboard store-wise details:', error);
        renderFinancialStoreWiseSummary([]);
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:14px;">Failed to load store-wise details</td></tr>';
        }
    }
}

function showCashLedger() {
    loadCashLedger();
    openModal('cashLedgerModal');
}

async function loadCashLedger() {
    try {
        const period = document.getElementById('ledgerPeriod')?.value || 'month';
        const response = await fetch(`${API_BASE}/api/financial/cash-ledger?period=${period}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();

        if (data.success) {
            const tbody = document.getElementById('cashLedgerBody');
            tbody.innerHTML = '';
            let total = 0;

            data.transactions.forEach(t => {
                const row = document.createElement('tr');
                const date = new Date(t.created_at).toLocaleString();
                const amount = parseFloat(t.amount);
                
                // Determine if amount should be displayed as positive or negative based on type
                let displayAmount = amount;
                let amountClass = 'text-success'; // Green for incoming
                
                if (['expense', 'settlement', 'refund'].includes(t.transaction_type)) {
                    displayAmount = -amount;
                    amountClass = 'text-danger'; // Red for outgoing
                }
                
                total += displayAmount;

                row.innerHTML = `
                    <td>${date}</td>
                    <td>${t.description || '-'}</td>
                    <td><span class="badge badge-${t.transaction_type}">${t.transaction_type}</span></td>
                    <td>${t.category || '-'}</td>
                    <td class="${amountClass}" style="font-weight:bold">Rs  ${displayAmount.toFixed(2)}</td>
                    <td>${t.created_by_name || '-'}</td>
                `;
                tbody.appendChild(row);
            });

            if (data.transactions.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem;">No cash transactions found for this period</td></tr>';
            }
            
            document.getElementById('ledgerTotal').textContent = `Rs  ${total.toFixed(2)}`;
        }
    } catch (error) {
        console.error('Error loading cash ledger:', error);
        showError('Load Error', 'Failed to load cash ledger');
    }
}

async function loadTransactions() {
    try {
        const type = document.getElementById('transactionTypeFilter')?.value || '';
        const status = document.getElementById('transactionStatusFilter')?.value || '';
        const params = new URLSearchParams();
        if (type) params.append('type', type);
        if (status) params.append('status', status);

        const response = await fetch(`${API_BASE}/api/financial/transactions?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();

        if (data.success) {
            currentTransactions = data.transactions || [];
            displayTransactions(currentTransactions);
        }
    } catch (error) {
        console.error('Error loading transactions:', error);
        showError('Load Error', 'Failed to load transactions');
    }
}

function displayTransactions(transactions) {
    const tbody = document.getElementById('transactionsTableBody');
    tbody.innerHTML = '';

    transactions.forEach(t => {
        const row = document.createElement('tr');
        const date = new Date(t.created_at).toLocaleDateString();
        row.innerHTML = `
            <td>${t.id}</td>
            <td>${t.transaction_number}</td>
            <td><span class="badge badge-${t.transaction_type}">${t.transaction_type}</span></td>
            <td>${t.description || '-'}</td>
            <td>Rs  ${parseFloat(t.amount).toFixed(2)}</td>
            <td>${t.payment_method}</td>
            <td><span class="status-${t.status}">${t.status}</span></td>
            <td>${date}</td>
            <td>
                <button class="btn-small btn-info" onclick="viewTransaction(${t.id})">View</button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (transactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 2rem;">No transactions found</td></tr>';
    }
}

async function loadPaymentVouchers() {
    try {
        const status = document.getElementById('paymentVoucherStatusFilter')?.value || '';
        const params = new URLSearchParams();
        if (status) params.append('status', status);
        params.append('payment_method', 'cash');

        const response = await fetch(`${API_BASE}/api/financial/payment-vouchers?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();

        if (data.success) {
            currentPaymentVouchers = data.vouchers || [];
            displayPaymentVouchers(currentPaymentVouchers);
        }
    } catch (error) {
        console.error('Error loading payment vouchers:', error);
        showError('Load Error', 'Failed to load payment vouchers');
    }
}

async function loadBankPaymentVouchers() {
    try {
        const status = document.getElementById('bankPaymentVoucherStatusFilter')?.value || '';
        const params = new URLSearchParams();
        if (status) params.append('status', status);
        params.append('payment_method', 'bank');

        const response = await fetch(`${API_BASE}/api/financial/payment-vouchers?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();

        if (data.success) {
            displayBankPaymentVouchers(data.vouchers || []);
        }
    } catch (error) {
        console.error('Error loading bank payment vouchers:', error);
        showError('Load Error', 'Failed to load bank payment vouchers');
    }
}

function displayBankPaymentVouchers(vouchers) {
    const tbody = document.getElementById('bankPaymentVouchersTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    vouchers.forEach(v => {
        const row = document.createElement('tr');
        const date = new Date(v.voucher_date).toLocaleDateString();
        row.innerHTML = `
            <td>${v.voucher_number}</td>
            <td>${date}</td>
            <td>${v.payee_name}</td>
            <td>${v.payee_type}</td>
            <td>Rs  ${parseFloat(v.amount).toFixed(2)}</td>
            <td>${v.purpose || '-'}</td>
            <td><span class="status-${v.status}">${v.status}</span></td>
            <td>
                <button class="btn-small btn-info" onclick="editPaymentVoucher(${v.id})">Edit</button>
                <button class="btn-small btn-primary" onclick="approvePaymentVoucher(${v.id})">Approve</button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (vouchers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem;">No bank payment vouchers found</td></tr>';
    }
}

function displayPaymentVouchers(vouchers) {
    const tbody = document.getElementById('paymentVouchersTableBody');
    tbody.innerHTML = '';

    vouchers.forEach(v => {
        const row = document.createElement('tr');
        const date = new Date(v.voucher_date).toLocaleDateString();
        row.innerHTML = `
            <td>${v.voucher_number}</td>
            <td>${date}</td>
            <td>${v.payee_name}</td>
            <td>${v.payee_type}</td>
            <td>Rs  ${parseFloat(v.amount).toFixed(2)}</td>
            <td>${v.purpose || '-'}</td>
            <td><span class="status-${v.status}">${v.status}</span></td>
            <td>
                <button class="btn-small btn-info" onclick="editPaymentVoucher(${v.id})">Edit</button>
                <button class="btn-small btn-primary" onclick="approvePaymentVoucher(${v.id})">Approve</button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (vouchers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem;">No payment vouchers found</td></tr>';
    }
}

async function loadReceiptVouchers() {
    try {
        const status = document.getElementById('receiptVoucherStatusFilter')?.value || '';
        const params = new URLSearchParams();
        if (status) params.append('status', status);
        params.append('payment_method', 'cash');

        const response = await fetch(`${API_BASE}/api/financial/receipt-vouchers?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();

        if (data.success) {
            currentReceiptVouchers = data.vouchers || [];
            displayReceiptVouchers(currentReceiptVouchers);
        }
    } catch (error) {
        console.error('Error loading receipt vouchers:', error);
        showError('Load Error', 'Failed to load receipt vouchers');
    }
}

async function loadBankReceiptVouchers() {
    try {
        const status = document.getElementById('bankReceiptVoucherStatusFilter')?.value || '';
        const params = new URLSearchParams();
        if (status) params.append('status', status);
        params.append('payment_method', 'bank');

        const response = await fetch(`${API_BASE}/api/financial/receipt-vouchers?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();

        if (data.success) {
            displayBankReceiptVouchers(data.vouchers || []);
        }
    } catch (error) {
        console.error('Error loading bank receipt vouchers:', error);
        showError('Load Error', 'Failed to load bank receipt vouchers');
    }
}

function displayBankReceiptVouchers(vouchers) {
    const tbody = document.getElementById('bankReceiptVouchersTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    vouchers.forEach(v => {
        const row = document.createElement('tr');
        const date = new Date(v.voucher_date).toLocaleDateString();
        row.innerHTML = `
            <td>${v.voucher_number}</td>
            <td>${date}</td>
            <td>${v.payer_name}</td>
            <td>${v.payer_type}</td>
            <td>Rs  ${parseFloat(v.amount).toFixed(2)}</td>
            <td>${v.description || '-'}</td>
            <td><span class="status-${v.status}">${v.status}</span></td>
            <td>
                <button class="btn-small btn-info" onclick="editReceiptVoucher(${v.id})">Edit</button>
                <button class="btn-small btn-primary" onclick="approveReceiptVoucher(${v.id})">Approve</button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (vouchers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem;">No bank receipt vouchers found</td></tr>';
    }
}

function displayReceiptVouchers(vouchers) {
    const tbody = document.getElementById('receiptVouchersTableBody');
    tbody.innerHTML = '';

    vouchers.forEach(v => {
        const row = document.createElement('tr');
        const date = new Date(v.voucher_date).toLocaleDateString();
        row.innerHTML = `
            <td>${v.voucher_number}</td>
            <td>${date}</td>
            <td>${v.payer_name}</td>
            <td>${v.payer_type}</td>
            <td>Rs  ${parseFloat(v.amount).toFixed(2)}</td>
            <td>${v.description || '-'}</td>
            <td><span class="status-${v.status}">${v.status}</span></td>
            <td>
                <button class="btn-small btn-info" onclick="editReceiptVoucher(${v.id})">Edit</button>
                <button class="btn-small btn-primary" onclick="approveReceiptVoucher(${v.id})">Approve</button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (vouchers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem;">No receipt vouchers found</td></tr>';
    }
}

async function loadRiderCash() {
    try {
        const type = document.getElementById('riderCashMovementTypeFilter')?.value || '';
        const status = document.getElementById('riderCashStatusFilter')?.value || '';
        const params = new URLSearchParams();
        if (type) params.append('type', type);
        if (status) params.append('status', status);
        params.append('limit', '500');

        const response = await fetch(`${API_BASE}/api/financial/rider-cash?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();

        if (data.success) {
            currentRiderCash = data.movements || [];
            displayRiderCash(currentRiderCash);
        }
    } catch (error) {
        console.error('Error loading rider cash movements:', error);
        showError('Load Error', 'Failed to load rider cash movements');
    }
}

function displayRiderCash(movements) {
    const tbody = document.getElementById('riderCashTableBody');
    tbody.innerHTML = '';

    movements.forEach(m => {
        const row = document.createElement('tr');
        const date = new Date(m.movement_date).toLocaleDateString();
        const riderName = `${m.first_name || ''} ${m.last_name || ''}`.trim();
        const movementType = String(m.movement_type || '').toLowerCase().trim();
        const status = String(m.status || '').toLowerCase().trim();
        const canEdit = Number.isInteger(Number(m.id)) && Number(m.id) > 0 && status === 'pending';
        const canApprove = canEdit && status === 'pending' && movementType !== 'cash_collection';
        const actionButtons = [
            canEdit ? `<button class="btn-small btn-info" onclick="editRiderCash(${m.id})">Edit</button>` : '',
            canApprove ? `<button class="btn-small btn-primary" onclick="approveRiderCash(${m.id})">Approve</button>` : ''
        ].filter(Boolean).join(' ');

        row.innerHTML = `
            <td>${m.movement_number}</td>
            <td>${m.order_number || '-'}</td>
            <td>${date}</td>
            <td>${riderName}</td>
            <td>${m.movement_type.replace(/_/g, ' ')}</td>
            <td>Rs ${parseFloat(m.amount).toFixed(2)}</td>
            <td>${m.description || '-'}</td>
            <td><span class="status-${m.status}">${m.status}</span></td>
            <td>
                ${actionButtons || '<span style="color:#6b7280;">-</span>'}
            </td>
        `;
        tbody.appendChild(row);
    });

    if (movements.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 2rem;">No rider cash movements found</td></tr>';
    }
}

async function loadStoreSettlements() {
    try {
        const status = document.getElementById('storeSettlementStatusFilter')?.value || '';
        const params = new URLSearchParams();
        if (status) params.append('status', status);
        // API default limit is 20; fetch broader set so older pending rows are visible.
        params.append('limit', '500');
        params.append('page', '1');

        const response = await fetch(`${API_BASE}/api/financial/store-settlements?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();

        if (data.success) {
            currentStoreSettlements = data.settlements || [];
            displayStoreSettlements(currentStoreSettlements);
        }
    } catch (error) {
        console.error('Error loading store settlements:', error);
        showError('Load Error', 'Failed to load store settlements');
    }
}

function displayStoreSettlements(settlements) {
    const tbody = document.getElementById('storeSettlementsTableBody');
    tbody.innerHTML = '';

    settlements.forEach(s => {
        const row = document.createElement('tr');
        const date = new Date(s.settlement_date).toLocaleDateString();
        const from = s.period_from ? new Date(s.period_from).toLocaleDateString() : '-';
        const to = s.period_to ? new Date(s.period_to).toLocaleDateString() : '-';
        const totalOrders = parseFloat(s.total_orders_amount || 0);
        const commissions = parseFloat(s.commissions || 0);
        const netAmount = parseFloat(s.net_amount || 0);
        row.innerHTML = `
            <td>${s.settlement_number}</td>
            <td>${date}</td>
            <td>${s.store_name || '-'}</td>
            <td>${from} to ${to}</td>
            <td>Rs  ${totalOrders.toFixed(2)}</td>
            <td>Rs  ${commissions.toFixed(2)}</td>
            <td>Rs  ${netAmount.toFixed(2)}</td>
            <td><span class="status-${s.status}">${s.status}</span></td>
            <td>${
                s.status === 'pending'
                    ? `<button class="btn-small btn-info" onclick="editStoreSettlement(${s.id})">Edit</button>
                       <button class="btn-small btn-primary" onclick="approveStoreSettlement(${s.id})">Approve</button>`
                    : (s.status === 'approved'
                        ? `<button class="btn-small btn-success" onclick="payStoreSettlement(${s.id})" style="background-color: #28a745; color: white;">Pay</button>`
                        : '<span style="color:#6b7280;">-</span>')
            }</td>
        `;
        tbody.appendChild(row);
    });

    if (settlements.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 2rem;">No store settlements found</td></tr>';
    }
}

async function loadExpenses() {
    try {
        const category = document.getElementById('expenseCategoryFilter')?.value || '';
        const status = document.getElementById('expenseStatusFilter')?.value || '';
        const params = new URLSearchParams();
        if (category) params.append('category', category);
        if (status) params.append('status', status);

        const response = await fetch(`${API_BASE}/api/financial/expenses?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();

        if (data.success) {
            currentExpenses = data.expenses || [];
            displayExpenses(currentExpenses);
        }
    } catch (error) {
        console.error('Error loading expenses:', error);
        showError('Load Error', 'Failed to load expenses');
    }
}

function displayExpenses(expenses) {
    const tbody = document.getElementById('expensesTableBody');
    tbody.innerHTML = '';

    expenses.forEach(e => {
        const row = document.createElement('tr');
        const date = new Date(e.expense_date).toLocaleDateString();
        let actionButtons = `<button class="btn-small btn-info" onclick="editExpense(${e.id})">Edit</button>`;
        
        if (e.status === 'pending') {
            actionButtons += ` <button class="btn-small btn-primary" onclick="approveExpense(${e.id})">Approve</button>`;
        } else if (e.status === 'approved') {
            actionButtons += ` <button class="btn-small btn-success" onclick="payExpense(${e.id})">Pay</button>`;
        }

        row.innerHTML = `
            <td>${e.expense_number}</td>
            <td>${date}</td>
            <td>${e.category}</td>
            <td>${e.description || '-'}</td>
            <td>Rs  ${parseFloat(e.amount).toFixed(2)}</td>
            <td>${e.vendor_name || '-'}</td>
            <td><span class="status-${e.status}">${e.status}</span></td>
            <td>${actionButtons}</td>
        `;
        tbody.appendChild(row);
    });

    if (expenses.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem;">No expenses found</td></tr>';
    }
}

// === Store Settlement Logic ===

function setupStoreSettlementListeners() {
    const storeSelect = document.getElementById('settlementStoreSelect');
    const autoCalcCheckbox = document.getElementById('autoCalculateSettlement');
    const wholeDataMode = document.getElementById('settlementWholeDataMode');
    const datePeriodMode = document.getElementById('settlementDatePeriodMode');
    const periodFrom = document.getElementById('periodFrom');
    const periodTo = document.getElementById('periodTo');
    const multiStoreMode = document.getElementById('settlementMultiStoreMode');
    const selectAllDueStores = document.getElementById('settlementSelectAllDueStores');
    
    if (storeSelect && storeSelect.dataset.boundStoreSettlementListeners === '1') {
        return;
    }

    if (storeSelect) {
        storeSelect.addEventListener('change', () => {
            syncSettlementDueStoreChecks(storeSelect.value);
            if (autoCalcCheckbox && autoCalcCheckbox.checked) {
                loadUnsettledItems(storeSelect.value);
            }
        });
        storeSelect.dataset.boundStoreSettlementListeners = '1';
    }

    if (autoCalcCheckbox) {
        autoCalcCheckbox.addEventListener('change', () => {
            const itemsContainer = document.getElementById('unsettledItemsContainer');
            const amountInput = document.getElementById('settlementAmount');
            
            if (autoCalcCheckbox.checked) {
                itemsContainer.style.display = 'block';
                amountInput.readOnly = true;
                if (storeSelect.value) {
                    loadUnsettledItems(storeSelect.value);
                }
            } else {
                itemsContainer.style.display = 'none';
                amountInput.readOnly = false;
                amountInput.value = '';
            }
        });
    }

    multiStoreMode?.addEventListener('change', () => {
        updateSettlementMultiMode();
        syncSettlementDueStoreChecks(storeSelect?.value || '');
    });

    selectAllDueStores?.addEventListener('change', () => {
        const checked = !!selectAllDueStores.checked;
        if (checked && multiStoreMode) {
            multiStoreMode.checked = true;
            updateSettlementMultiMode();
        }
        document.querySelectorAll('.settlement-due-store-checkbox').forEach((checkbox) => {
            checkbox.checked = checked && !checkbox.disabled;
        });
    });

    const reloadForPeriodChange = () => {
        updateSettlementPeriodInputs();
        if (storeSelect?.value && autoCalcCheckbox?.checked) {
            loadUnsettledItems(storeSelect.value);
        }
        loadSettlementDueStores();
    };

    wholeDataMode?.addEventListener('change', reloadForPeriodChange);
    datePeriodMode?.addEventListener('change', reloadForPeriodChange);
    periodFrom?.addEventListener('change', reloadForPeriodChange);
    periodTo?.addEventListener('change', reloadForPeriodChange);
}

function isSettlementMultiStoreMode() {
    return !!document.getElementById('settlementMultiStoreMode')?.checked;
}

function updateSettlementMultiMode() {
    const multi = isSettlementMultiStoreMode();
    const storeSelect = document.getElementById('settlementStoreSelect');
    const amountInput = document.getElementById('settlementAmount');
    const autoCalcCheckbox = document.getElementById('autoCalculateSettlement');
    const selectAllDueStores = document.getElementById('settlementSelectAllDueStores');

    if (storeSelect) storeSelect.required = !multi;
    if (amountInput && multi) {
        amountInput.value = '';
        amountInput.readOnly = true;
    }
    if (autoCalcCheckbox && multi) {
        autoCalcCheckbox.checked = true;
    }
    if (!multi && selectAllDueStores) {
        selectAllDueStores.checked = false;
    }
}

function getSelectedUnsettledSettlementItems() {
    return currentUnsettledSettlementItems.filter((item) =>
        selectedUnsettledSettlementItemIds.has(Number(item.id))
    );
}

function updateSelectedUnsettledTotals() {
    const selectedItems = getSelectedUnsettledSettlementItems();
    const totalSales = selectedItems.reduce(
        (sum, item) => sum + Number(item.line_gross || (item.price * item.quantity) || 0),
        0
    );
    const netPayable = selectedItems.reduce(
        (sum, item) => sum + Number(item.line_payable || 0),
        0
    );
    const adjustment = Math.max(0, totalSales - netPayable);

    const totalSalesEl = document.getElementById('unsettledTotalSales');
    const adjustmentEl = document.getElementById('unsettledCommission');
    const netPayableEl = document.getElementById('unsettledNetPayable');
    const amountInput = document.getElementById('settlementAmount');
    const selectAll = document.getElementById('selectAllUnsettledItems');
    const itemCheckboxes = document.querySelectorAll('.unsettled-item-checkbox');
    const checkedRows = Array.from(itemCheckboxes).filter((checkbox) => checkbox.checked).length;

    if (totalSalesEl) totalSalesEl.textContent = `Rs  ${totalSales.toFixed(2)}`;
    if (adjustmentEl) adjustmentEl.textContent = `Rs  ${adjustment.toFixed(2)}`;
    if (netPayableEl) netPayableEl.textContent = `Rs  ${netPayable.toFixed(2)}`;
    if (amountInput) amountInput.value = netPayable.toFixed(2);
    if (selectAll) {
        selectAll.checked =
            itemCheckboxes.length > 0 &&
            checkedRows === itemCheckboxes.length;
        selectAll.indeterminate =
            checkedRows > 0 &&
            checkedRows < itemCheckboxes.length;
    }
}

async function loadUnsettledItems(storeId) {
    if (!storeId) return;
    
    try {
        const params = new URLSearchParams({ store_id: storeId });
        const range = getSettlementDateRangeForRequest();
        if (range.period_from && range.period_to) {
            params.append('period_from', range.period_from);
            params.append('period_to', range.period_to);
        }

        const response = await fetch(`${API_BASE}/api/financial/store-settlements/unsettled-items?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();
        
        if (data.success) {
            displayUnsettledItems(data.items, data.summary);
        } else {
            showError('Error', data.message);
        }
    } catch (error) {
        console.error('Error loading unsettled items:', error);
        showError('Error', 'Failed to load unpaid items');
    }
}

function displayUnsettledItems(items, summary) {
    const tbody = document.getElementById('unsettledItemsBody');
    tbody.innerHTML = '';
    currentUnsettledSettlementItems = Array.isArray(items) ? items : [];
    selectedUnsettledSettlementItemIds = new Set(
        currentUnsettledSettlementItems
            .map((item) => Number(item.id))
            .filter((id) => Number.isInteger(id) && id > 0)
    );

    // Backward-compatible UI fix:
    // if older hosted HTML still shows "Commission (10%)",
    // force the settlement summary row label to the new meaning.
    const adjustmentValueCell = document.getElementById('unsettledCommission');
    if (adjustmentValueCell) {
        const row = adjustmentValueCell.closest('tr');
        const labelCell = row?.querySelector('td');
        if (labelCell) {
            labelCell.textContent = 'Profit/Discount Adjustment:';
        }
    }
    
    const orderRowsByKey = new Map();
    currentUnsettledSettlementItems.forEach((item) => {
        const key = String(item.order_id || item.order_number || item.id || '');
        if (!orderRowsByKey.has(key)) {
            orderRowsByKey.set(key, {
                order_id: item.order_id,
                order_number: item.order_number || '-',
                order_date: item.order_date,
                item_ids: [],
                item_names: [],
                line_count: 0,
                gross: 0,
            });
        }
        const row = orderRowsByKey.get(key);
        const itemId = Number(item.id || 0);
        if (Number.isInteger(itemId) && itemId > 0) row.item_ids.push(itemId);
        row.item_names.push(`${item.product_name || 'Item'}${item.variant_label ? ` (${item.variant_label})` : ''}`);
        row.line_count += 1;
        row.gross += Number(item.line_gross || (item.price * item.quantity) || 0);
    });

    Array.from(orderRowsByKey.values()).forEach((orderRow) => {
        const row = document.createElement('tr');
        const itemIds = orderRow.item_ids.join(',');
        row.innerHTML = `
            <td>
                <input type="checkbox" class="unsettled-item-checkbox" data-item-ids="${itemIds}" checked>
            </td>
            <td>${new Date(orderRow.order_date).toLocaleDateString()}</td>
            <td>${orderRow.order_number}</td>
            <td>${escapeHtml(orderRow.item_names.join(', '))}</td>
            <td>${orderRow.line_count}</td>
            <td>Rs  ${orderRow.gross.toFixed(2)}</td>
        `;
        tbody.appendChild(row);
    });
    
    if (currentUnsettledSettlementItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No unpaid items found</td></tr>';
    }

    document.querySelectorAll('.unsettled-item-checkbox').forEach((checkbox) => {
        checkbox.addEventListener('change', () => {
            const itemIds = String(checkbox.dataset.itemIds || '')
                .split(',')
                .map((itemId) => Number(itemId))
                .filter((itemId) => Number.isInteger(itemId) && itemId > 0);
            itemIds.forEach((itemId) => {
                if (checkbox.checked) {
                    selectedUnsettledSettlementItemIds.add(itemId);
                } else {
                    selectedUnsettledSettlementItemIds.delete(itemId);
                }
            });
            updateSelectedUnsettledTotals();
        });
    });
    const selectAll = document.getElementById('selectAllUnsettledItems');
    if (selectAll) {
        selectAll.checked = true;
        selectAll.indeterminate = false;
        selectAll.onchange = () => {
            selectedUnsettledSettlementItemIds = new Set(
                selectAll.checked
                    ? currentUnsettledSettlementItems.map((item) => Number(item.id))
                        .filter((id) => Number.isInteger(id) && id > 0)
                    : []
            );
            document.querySelectorAll('.unsettled-item-checkbox').forEach((checkbox) => {
                checkbox.checked = selectAll.checked;
            });
            updateSelectedUnsettledTotals();
        };
    }

    updateSelectedUnsettledTotals();
    const legacyPaidOffset = Number(summary.legacy_paid_offset || 0);
    const legacyPaidNote = document.getElementById('unsettledLegacyPaidNote');
    if (legacyPaidNote) {
        if (legacyPaidOffset > 0) {
            legacyPaidNote.textContent = `Already-paid legacy settlements deducted: Rs ${legacyPaidOffset.toFixed(2)}`;
            legacyPaidNote.style.display = 'block';
        } else {
            legacyPaidNote.textContent = '';
            legacyPaidNote.style.display = 'none';
        }
    }
}

function getSettlementDateRangeForRequest() {
    const mode = document.querySelector('input[name="settlementPeriodMode"]:checked')?.value || 'all';
    if (mode !== 'period') {
        return { period_from: null, period_to: null };
    }
    return {
        period_from: document.getElementById('periodFrom')?.value || null,
        period_to: document.getElementById('periodTo')?.value || null
    };
}

function updateSettlementPeriodInputs() {
    const mode = document.querySelector('input[name="settlementPeriodMode"]:checked')?.value || 'all';
    const disabled = mode !== 'period';
    const fromInput = document.getElementById('periodFrom');
    const toInput = document.getElementById('periodTo');
    if (fromInput) fromInput.disabled = disabled;
    if (toInput) toInput.disabled = disabled;
}

function syncSettlementDueStoreChecks(storeId) {
    if (isSettlementMultiStoreMode()) return;
    document.querySelectorAll('.settlement-due-store-checkbox').forEach((checkbox) => {
        checkbox.checked =
            !checkbox.disabled && String(checkbox.value) === String(storeId || '');
    });
}

function getSelectedSettlementStoreIds() {
    return Array.from(document.querySelectorAll('.settlement-due-store-checkbox:checked'))
        .filter((checkbox) => !checkbox.disabled)
        .map((checkbox) => Number(checkbox.value))
        .filter((id) => Number.isInteger(id) && id > 0);
}

async function loadSettlementDueStores() {
    const container = document.getElementById('settlementDueStoresList');
    if (!container) return;
    container.innerHTML = 'Loading due stores...';

    try {
        const params = new URLSearchParams();
        const range = getSettlementDateRangeForRequest();
        if (range.period_from && range.period_to) {
            params.append('period_from', range.period_from);
            params.append('period_to', range.period_to);
        }
        const response = await fetch(`${API_BASE}/api/financial/store-settlements/due-stores?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();
        if (!data.success) {
            container.innerHTML = '<span style="color:#b91c1c;">Failed to load due stores</span>';
            return;
        }

        const dueStores = (data.stores || [])
            .filter((store) => Number(store.pending_settlement || 0) > 0)
            .sort((a, b) => Number(b.pending_settlement || 0) - Number(a.pending_settlement || 0));

        if (!dueStores.length) {
            container.innerHTML = '<span style="color:#64748b;">No stores with pending settlement</span>';
            return;
        }

        container.innerHTML = dueStores.map((store) => {
            const creatableBalance = Number(store.current_settlement_balance || 0);
            const openSettlementAmount = Number(store.open_settlement_amount || 0);
            const canCreateSettlement = creatableBalance > 0.005;
            const helperText = canCreateSettlement
                ? `Ready to create: Rs ${creatableBalance.toFixed(2)}`
                : openSettlementAmount > 0
                    ? `Existing pending/approved settlement: Rs ${openSettlementAmount.toFixed(2)}`
                    : 'No new unlinked items available';
            return `
            <label class="settlement-due-store-option" title="${escapeHtml(`${store.name || ''} - ${helperText}`)}">
                <input type="checkbox" class="settlement-due-store-checkbox" value="${store.id}" ${canCreateSettlement ? '' : 'disabled'}>
                <span class="settlement-due-store-name">${escapeHtml(store.name || '-')}</span>
                <span class="settlement-due-store-amount">
                    Rs ${Number(store.pending_settlement || 0).toFixed(2)}
                    <small style="display:block;color:#64748b;font-weight:400;">${escapeHtml(helperText)}</small>
                </span>
            </label>
        `}).join('');

        container.querySelectorAll('.settlement-due-store-checkbox').forEach((checkbox) => {
            checkbox.addEventListener('change', () => {
                if (isSettlementMultiStoreMode()) {
                    const selected = getSelectedSettlementStoreIds();
                    const selectAll = document.getElementById('settlementSelectAllDueStores');
                    const allBoxes = document.querySelectorAll('.settlement-due-store-checkbox:not(:disabled)');
                    if (selectAll) selectAll.checked = allBoxes.length > 0 && selected.length === allBoxes.length;
                    return;
                }
                if (!checkbox.checked) return;
                const storeSelect = document.getElementById('settlementStoreSelect');
                if (storeSelect) storeSelect.value = checkbox.value;
                syncSettlementDueStoreChecks(checkbox.value);
                if (document.getElementById('autoCalculateSettlement')?.checked) {
                    loadUnsettledItems(checkbox.value);
                }
            });
        });
        syncSettlementDueStoreChecks(document.getElementById('settlementStoreSelect')?.value || '');
    } catch (error) {
        console.error('Error loading settlement due stores:', error);
        container.innerHTML = '<span style="color:#b91c1c;">Failed to load due stores</span>';
    }
}

async function loadFinancialReports() {
    try {
        const type = document.getElementById('reportTypeFilter')?.value || '';
        const params = new URLSearchParams();
        if (type) params.append('type', type);

        const response = await fetch(`${API_BASE}/api/financial/reports?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();

        if (data.success) {
            currentReports = data.reports || [];
            displayReports(currentReports);
        }
    } catch (error) {
        console.error('Error loading reports:', error);
        showError('Load Error', 'Failed to load reports');
    }
}

function displayReports(reports) {
    const tbody = document.getElementById('reportsTableBody');
    tbody.innerHTML = '';

    reports.forEach(r => {
        const row = document.createElement('tr');
        const fromDate = r.period_from ? new Date(r.period_from).toLocaleDateString() : '-';
        const toDate = r.period_to ? new Date(r.period_to).toLocaleDateString() : '-';
        const created = new Date(r.created_at).toLocaleDateString();
        row.innerHTML = `
            <td>${r.report_number}</td>
            <td>${r.report_type.replace(/_/g, ' ')}</td>
            <td>${fromDate}</td>
            <td>${toDate}</td>
            <td>Rs  ${parseFloat(r.total_income).toFixed(2)}</td>
            <td>Rs  ${parseFloat(r.total_expense).toFixed(2)}</td>
            <td>Rs  ${parseFloat(r.net_profit).toFixed(2)}</td>
            <td>${created}</td>
            <td>
                <button class="btn-small btn-info" onclick="viewReport(${r.id})">View</button>
                <button class="btn-small btn-secondary" onclick="generatePDF(${r.id})">Download</button>
                <button class="btn-small btn-danger" onclick="deleteReport(${r.id})" style="background-color: #dc3545; color: white; margin-left: 4px;">Delete</button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (reports.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 2rem;">No reports found</td></tr>';
    }
}

async function deleteReport(id) {
    if (!confirm('Are you sure you want to delete this report? This action cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/financial/reports/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            }
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Success', 'Report deleted successfully');
            loadFinancialReports();
        } else {
            showError('Error', data.message);
        }
    } catch (error) {
        console.error('Error deleting report:', error);
        showError('Error', 'Failed to delete report');
    }
}

async function payStoreSettlement(id) {
    if (!confirm('Are you sure you want to mark this settlement as PAID? This will record a financial transaction.')) return;

    try {
        const response = await fetch(`${API_BASE}/api/financial/store-settlements/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify({ status: 'paid' })
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Success', 'Settlement marked as paid');
            loadStoreSettlements();
        } else {
            showError('Error', data.message);
        }
    } catch (error) {
        console.error('Error paying settlement:', error);
        showError('Error', 'Failed to pay settlement');
    }
}

function createPaymentVoucher() {
    const form = document.getElementById('paymentVoucherForm');
    if (form) form.reset();
    const idInput = document.getElementById('paymentVoucherId');
    if (idInput) idInput.value = '';
    
    // Set default payment method to cash for CPV
    const methodSelect = document.getElementById('paymentMethodPV');
    if (methodSelect) methodSelect.value = 'cash';

    document.querySelector('#paymentVoucherModal h2').textContent = 'Create Cash Payment Voucher (CPV)';
    document.querySelector('#paymentVoucherModal .btn-primary').textContent = 'Create Voucher';
    
    formChangedState['paymentVoucherModal'] = false;
    openModal('paymentVoucherModal');
}

function createBankPaymentVoucher() {
    const form = document.getElementById('paymentVoucherForm');
    if (form) form.reset();
    const idInput = document.getElementById('paymentVoucherId');
    if (idInput) idInput.value = '';
    
    // Set default payment method to bank_transfer for BPV
    const methodSelect = document.getElementById('paymentMethodPV');
    if (methodSelect) methodSelect.value = 'bank_transfer';

    document.querySelector('#paymentVoucherModal h2').textContent = 'Create Bank Payment Voucher (BPV)';
    document.querySelector('#paymentVoucherModal .btn-primary').textContent = 'Create Voucher';
    
    formChangedState['paymentVoucherModal'] = false;
    openModal('paymentVoucherModal');
}

async function submitPaymentVoucher() {
    const id = document.getElementById('paymentVoucherId').value;
    const payeeName = document.getElementById('payeeName').value;
    const payeeType = document.getElementById('payeeType').value;
    const payeeId = document.getElementById('payeeId').value;
    const amount = parseFloat(document.getElementById('paymentAmount').value);
    const purpose = document.getElementById('paymentPurpose').value;
    const paymentMethod = document.getElementById('paymentMethodPV').value;
    const chequeNumber = document.getElementById('paymentChequeNoPV').value;

    const payload = {
        payee_name: payeeName,
        payee_type: payeeType,
        payee_id: (payeeType === 'expense') ? null : (payeeId || null),
        amount,
        purpose,
        description: '',
        payment_method: paymentMethod,
        check_number: (paymentMethod === 'cheque') ? chequeNumber : null,
        bank_details: null
    };

    try {
        const url = id ? `${API_BASE}/api/financial/payment-vouchers/${id}` : `${API_BASE}/api/financial/payment-vouchers`;
        const method = id ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Success', id ? 'Payment voucher updated' : 'Payment voucher created successfully');
            closeModal('paymentVoucherModal');
            loadPaymentVouchers();
        } else {
            showError('Error', data.message);
        }
    } catch (error) {
        console.error('Error submitting payment voucher:', error);
        showError('Error', 'Failed to save payment voucher');
    }
}

async function editPaymentVoucher(id) {
    const voucher = currentPaymentVouchers.find(v => v.id === id);
    if (!voucher) return;

    document.getElementById('paymentVoucherId').value = voucher.id;
    document.getElementById('paymentAmount').value = voucher.amount;
    document.getElementById('paymentPurpose').value = voucher.purpose || '';
    document.getElementById('paymentMethodPV').value = voucher.payment_method;
    
    // Populate cheque number if applicable
    const chequeInput = document.getElementById('paymentChequeNoPV');
    if (chequeInput) {
        // Fallback to check_number if cheque_number is missing (database inconsistency)
        chequeInput.value = voucher.cheque_number || voucher.check_number || '';
    }
    // Trigger visibility toggle
    if (typeof toggleChequeInput === 'function') {
        toggleChequeInput('paymentMethodPV', 'paymentChequeContainerPV');
    }
    
    const payeeType = document.getElementById('payeeType');
    payeeType.value = voucher.payee_type;
    
    // UI elements
    const nameInput = document.getElementById('payeeName');
    const select = document.getElementById('payeeSelect');
    const hidden = document.getElementById('payeeId');
    const addBtn = document.getElementById('addExpenseTypeBtn');
    
    await updateVoucherTypeUI(voucher.payee_type, nameInput, select, hidden, addBtn);
    
    if (['store', 'rider', 'employee', 'expense'].includes(voucher.payee_type)) {
        if (voucher.payee_type === 'expense') {
             select.value = voucher.payee_name;
             hidden.value = ''; 
        } else {
             select.value = voucher.payee_id;
             hidden.value = voucher.payee_id;
        }
        nameInput.value = voucher.payee_name;
    } else {
        nameInput.value = voucher.payee_name;
    }

    document.querySelector('#paymentVoucherModal h2').textContent = 'Edit Payment Voucher';
    document.querySelector('#paymentVoucherModal .btn-primary').textContent = 'Update Voucher';

    formChangedState['paymentVoucherModal'] = false;
    openModal('paymentVoucherModal');
}

function createReceiptVoucher() {
    const form = document.getElementById('receiptVoucherForm');
    if (form) form.reset();
    const idInput = document.getElementById('receiptVoucherId');
    if (idInput) idInput.value = '';
    
    // Set default payment method to cash for CRV
    const methodSelect = document.getElementById('paymentMethodRV');
    if (methodSelect) methodSelect.value = 'cash';

    document.querySelector('#receiptVoucherModal h2').textContent = 'Create Cash Receipt Voucher (CRV)';
    document.querySelector('#receiptVoucherModal .btn-primary').textContent = 'Create Voucher';
    
    formChangedState['receiptVoucherModal'] = false;
    openModal('receiptVoucherModal');
}

function createBankReceiptVoucher() {
    const form = document.getElementById('receiptVoucherForm');
    if (form) form.reset();
    const idInput = document.getElementById('receiptVoucherId');
    if (idInput) idInput.value = '';
    
    // Set default payment method to bank_transfer for BRV
    const methodSelect = document.getElementById('paymentMethodRV');
    if (methodSelect) methodSelect.value = 'bank_transfer';

    document.querySelector('#receiptVoucherModal h2').textContent = 'Create Bank Receive Voucher (BRV)';
    document.querySelector('#receiptVoucherModal .btn-primary').textContent = 'Create Voucher';
    
    formChangedState['receiptVoucherModal'] = false;
    openModal('receiptVoucherModal');
}

async function submitReceiptVoucher() {
    const id = document.getElementById('receiptVoucherId').value;
    const payerName = document.getElementById('payerName').value;
    const payerType = document.getElementById('payerType').value;
    const payerId = document.getElementById('payerId').value;
    const amount = parseFloat(document.getElementById('receiptAmount').value);
    const description = document.getElementById('receiptDescription').value;
    const paymentMethod = document.getElementById('paymentMethodRV').value;

    const payload = {
        payer_name: payerName,
        payer_type: payerType,
        payer_id: (payerType === 'expense') ? null : (payerId || null),
        amount,
        description,
        details: '',
        payment_method: paymentMethod,
    cheque_number: null,
    bank_details: null
    };

    try {
        const url = id ? `${API_BASE}/api/financial/receipt-vouchers/${id}` : `${API_BASE}/api/financial/receipt-vouchers`;
        const method = id ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Success', id ? 'Receipt voucher updated' : 'Receipt voucher created successfully');
            closeModal('receiptVoucherModal');
            loadReceiptVouchers();
        } else {
            showError('Error', data.message);
        }
    } catch (error) {
        console.error('Error submitting receipt voucher:', error);
        showError('Error', 'Failed to save receipt voucher');
    }
}

async function editReceiptVoucher(id) {
    const voucher = currentReceiptVouchers.find(v => v.id === id);
    if (!voucher) return;

    document.getElementById('receiptVoucherId').value = voucher.id;
    document.getElementById('receiptAmount').value = voucher.amount;
    document.getElementById('receiptDescription').value = voucher.description || '';
    document.getElementById('paymentMethodRV').value = voucher.payment_method;
    
    const payerType = document.getElementById('payerType');
    payerType.value = voucher.payer_type;
    
    // UI elements
    const nameInput = document.getElementById('payerName');
    const select = document.getElementById('payerSelect');
    const hidden = document.getElementById('payerId');
    const addBtn = document.getElementById('addPayerExpenseTypeBtn');
    
    await updateVoucherTypeUI(voucher.payer_type, nameInput, select, hidden, addBtn);
    
    if (['store', 'rider', 'employee', 'expense'].includes(voucher.payer_type)) {
        if (voucher.payer_type === 'expense') {
             select.value = voucher.payer_name;
             hidden.value = ''; 
        } else {
             select.value = voucher.payer_id;
             hidden.value = voucher.payer_id;
        }
        nameInput.value = voucher.payer_name;
    } else {
        nameInput.value = voucher.payer_name;
    }

    document.querySelector('#receiptVoucherModal h2').textContent = 'Edit Receipt Voucher';
    document.querySelector('#receiptVoucherModal .btn-primary').textContent = 'Update Voucher';

    formChangedState['receiptVoucherModal'] = false;
    openModal('receiptVoucherModal');
}

function createTransaction() {
    const form = document.getElementById('transactionForm');
    if (form) form.reset();
    const idInput = document.getElementById('transactionId');
    if (idInput) idInput.value = '';

    document.querySelector('#transactionModal h2').textContent = 'Record Transaction';
    document.querySelector('#transactionModal .btn-primary').textContent = 'Record Transaction';

    formChangedState['transactionModal'] = false;
    openModal('transactionModal');
}

async function submitTransaction() {
    const id = document.getElementById('transactionId').value;
    const amount = parseFloat(document.getElementById('transactionAmount').value);
    const type = document.getElementById('transactionType').value;
    const description = document.getElementById('transactionDescription').value;
    const paymentMethod = document.getElementById('transactionPaymentMethod').value;

    const payload = {
        transaction_type: type,
        amount,
        description,
        payment_method: paymentMethod,
        category: null
    };

    try {
        const url = id ? `${API_BASE}/api/financial/transactions/${id}` : `${API_BASE}/api/financial/transactions`;
        const method = id ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Success', id ? 'Transaction updated' : 'Transaction recorded successfully');
            closeModal('transactionModal');
            loadTransactions();
        } else {
            showError('Error', data.message);
        }
    } catch (error) {
        console.error('Error submitting transaction:', error);
        showError('Error', 'Failed to save transaction');
    }
}

async function createRiderCash() {
    document.getElementById('riderCashForm').reset();
    document.getElementById('riderCashId').value = '';
    formChangedState['riderCashModal'] = false;
    document.querySelector('#riderCashModal h2').textContent = 'Record Rider Cash Movement';
    document.querySelector('#riderCashModal .btn-primary').textContent = 'Record Movement';
    await populateRidersDropdown();
    const typeSelect = document.getElementById('movementType');
    if (typeSelect) {
        typeSelect.value = 'cash_submission';
    }

    // Setup listeners for pending orders
    const riderSelect = document.getElementById('riderId');
    const container = document.getElementById('pendingOrdersContainer');
    const submittedContainer = document.getElementById('submittedOrdersContainer');
    const pendingFuelContainer = document.getElementById('pendingFuelContainer');
    const submittedFuelContainer = document.getElementById('submittedFuelContainer');
    
    // Reset container visibility
    if (container) container.style.display = 'none';
    if (submittedContainer) submittedContainer.style.display = 'none';
    if (pendingFuelContainer) pendingFuelContainer.style.display = 'none';
    if (submittedFuelContainer) submittedFuelContainer.style.display = 'none';

    // Global variables to track pending orders (ensure they are reset)
    window.pendingCashOrders = [];
    window.selectedPendingOrders = new Set();
    window.submittedCashOrders = [];
    window.pendingFuelEntries = [];
    window.selectedPendingFuelEntries = new Set();
    window.submittedFuelEntries = [];

    const checkPendingOrders = async () => {
        const riderId = riderSelect.value;
        const type = typeSelect.value;
        
        if (container && type === 'cash_submission' && riderId) {
            try {
                const [pendingRes, submittedRes] = await Promise.all([
                    fetch(`${API_BASE}/api/financial/riders/${riderId}/pending-cash-orders`, {
                        headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
                    }),
                    fetch(`${API_BASE}/api/financial/riders/${riderId}/submitted-cash-orders`, {
                        headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
                    })
                ]);
                const pendingData = await pendingRes.json();
                const submittedData = await submittedRes.json();

                if (pendingData.success && pendingData.orders && pendingData.orders.length > 0) {
                    window.pendingCashOrders = pendingData.orders;
                    window.selectedPendingOrders = new Set(pendingData.orders.map(o => o.id)); // Default select all
                    renderPendingOrdersTable();
                    container.style.display = 'block';
                } else {
                    window.pendingCashOrders = [];
                    window.selectedPendingOrders = new Set();
                    container.style.display = 'none';
                }

                if (submittedData.success && submittedData.orders && submittedData.orders.length > 0) {
                    window.submittedCashOrders = submittedData.orders;
                    renderSubmittedOrdersTable();
                    if (submittedContainer) submittedContainer.style.display = 'block';
                } else {
                    window.submittedCashOrders = [];
                    if (submittedContainer) submittedContainer.style.display = 'none';
                }
                if (pendingFuelContainer) pendingFuelContainer.style.display = 'none';
                if (submittedFuelContainer) submittedFuelContainer.style.display = 'none';
            } catch (e) {
                console.error('Error fetching pending orders:', e);
                container.style.display = 'none';
                if (submittedContainer) submittedContainer.style.display = 'none';
                if (pendingFuelContainer) pendingFuelContainer.style.display = 'none';
                if (submittedFuelContainer) submittedFuelContainer.style.display = 'none';
            }
        } else if (pendingFuelContainer && type === 'fuel_payment' && riderId) {
            try {
                const [fuelRes, submittedFuelRes] = await Promise.all([
                    fetch(`${API_BASE}/api/financial/riders/${riderId}/pending-fuel-entries`, {
                        headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
                    }),
                    fetch(`${API_BASE}/api/financial/riders/${riderId}/submitted-fuel-entries`, {
                        headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
                    })
                ]);
                const fuelData = await fuelRes.json();
                const submittedFuelData = await submittedFuelRes.json();
                if (fuelData.success && fuelData.entries && fuelData.entries.length > 0) {
                    window.pendingFuelEntries = fuelData.entries;
                    window.selectedPendingFuelEntries = new Set(fuelData.entries.map(e => e.id));
                    renderPendingFuelTable();
                    pendingFuelContainer.style.display = 'block';
                } else {
                    window.pendingFuelEntries = [];
                    window.selectedPendingFuelEntries = new Set();
                    pendingFuelContainer.style.display = 'none';
                    const amountInput = document.getElementById('riderCashAmountInput');
                    if (amountInput) amountInput.value = '';
                }

                if (submittedFuelData.success && submittedFuelData.entries && submittedFuelData.entries.length > 0) {
                    window.submittedFuelEntries = submittedFuelData.entries;
                    renderSubmittedFuelTable();
                    if (submittedFuelContainer) submittedFuelContainer.style.display = 'block';
                } else {
                    window.submittedFuelEntries = [];
                    if (submittedFuelContainer) submittedFuelContainer.style.display = 'none';
                }
            } catch (e) {
                console.error('Error fetching pending fuel entries:', e);
                window.pendingFuelEntries = [];
                window.selectedPendingFuelEntries = new Set();
                pendingFuelContainer.style.display = 'none';
                window.submittedFuelEntries = [];
                if (submittedFuelContainer) submittedFuelContainer.style.display = 'none';
            }
            if (container) container.style.display = 'none';
            if (submittedContainer) submittedContainer.style.display = 'none';
        } else if (container) {
            container.style.display = 'none';
            if (submittedContainer) submittedContainer.style.display = 'none';
            if (pendingFuelContainer) pendingFuelContainer.style.display = 'none';
            if (submittedFuelContainer) submittedFuelContainer.style.display = 'none';
        }
    };
    
    // Remove existing listeners to avoid duplicates (though setting onchange property overwrites)
    riderSelect.onchange = checkPendingOrders;
    typeSelect.onchange = checkPendingOrders;
    
    openModal('riderCashModal');
}

function renderPendingFuelTable() {
    const tbody = document.getElementById('pendingFuelListBody');
    const totalEl = document.getElementById('pendingFuelTotal');
    const selectAllCb = document.getElementById('selectAllPendingFuel');
    if (!tbody) return;

    tbody.innerHTML = '';
    let totalSelected = 0;
    (window.pendingFuelEntries || []).forEach((entry) => {
        const isSelected = window.selectedPendingFuelEntries.has(entry.id);
        const fuelCost = parseFloat(entry.fuel_cost || 0);
        const distance = parseFloat(entry.distance || 0);
        if (isSelected) totalSelected += fuelCost;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="text-align:center;"><input type="checkbox" value="${entry.id}" ${isSelected ? 'checked' : ''} onchange="togglePendingFuel(${entry.id}, this.checked)" style="cursor:pointer;"></td>
            <td>${entry.entry_date ? new Date(entry.entry_date).toLocaleDateString() : '-'}</td>
            <td style="text-align:right">Rs  ${fuelCost.toFixed(2)}</td>
            <td style="text-align:right">${distance.toFixed(2)}</td>
            <td>${entry.notes || '-'}</td>
        `;
        tbody.appendChild(row);
    });

    if (!window.pendingFuelEntries || window.pendingFuelEntries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No pending fuel entries</td></tr>';
    }

    if (totalEl) totalEl.textContent = `Rs  ${totalSelected.toFixed(2)}`;
    if (selectAllCb) {
        selectAllCb.checked = window.pendingFuelEntries.length > 0 &&
            window.selectedPendingFuelEntries.size === window.pendingFuelEntries.length;
    }

    const amountInput = document.getElementById('riderCashAmountInput');
    if (amountInput && document.getElementById('movementType').value === 'fuel_payment') {
        amountInput.value = totalSelected.toFixed(2);
    }
}

function togglePendingFuel(id, checked) {
    if (checked) window.selectedPendingFuelEntries.add(id);
    else window.selectedPendingFuelEntries.delete(id);
    renderPendingFuelTable();
}

function toggleAllPendingFuel(cb) {
    if (cb.checked) {
        window.selectedPendingFuelEntries = new Set((window.pendingFuelEntries || []).map(e => e.id));
    } else {
        window.selectedPendingFuelEntries.clear();
    }
    renderPendingFuelTable();
}

function renderSubmittedFuelTable() {
    const tbody = document.getElementById('submittedFuelListBody');
    const totalEl = document.getElementById('submittedFuelTotal');
    if (!tbody) return;

    tbody.innerHTML = '';
    let total = 0;

    (window.submittedFuelEntries || []).forEach((entry) => {
        const cost = parseFloat(entry.fuel_cost || 0);
        total += cost;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${entry.fuel_history_id || entry.id || '-'}</td>
            <td>${entry.entry_date ? new Date(entry.entry_date).toLocaleDateString() : '-'}</td>
            <td style="text-align:right">Rs  ${cost.toFixed(2)}</td>
            <td>${entry.movement_number || '-'}</td>
            <td>${entry.status || '-'}</td>
        `;
        tbody.appendChild(tr);
    });

    if (!window.submittedFuelEntries || window.submittedFuelEntries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No submitted fuel entries</td></tr>';
    }
    if (totalEl) totalEl.textContent = `Rs  ${total.toFixed(2)}`;
}

function renderSubmittedOrdersTable() {
    const tbody = document.getElementById('submittedOrdersListBody');
    const totalEl = document.getElementById('submittedOrdersTotal');
    if (!tbody) return;

    tbody.innerHTML = '';
    let total = 0;
    (window.submittedCashOrders || []).forEach((o) => {
        total += parseFloat(o.total_amount || 0);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${o.order_number || '-'}</td>
            <td>${new Date(o.created_at || o.submitted_at).toLocaleDateString()}</td>
            <td style="text-align:right">Rs  ${parseFloat(o.total_amount || 0).toFixed(2)}</td>
            <td>${o.movement_number || '-'}</td>
        `;
        tbody.appendChild(tr);
    });

    if (!window.submittedCashOrders || window.submittedCashOrders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No submitted cash orders</td></tr>';
    }
    if (totalEl) totalEl.textContent = `Rs  ${total.toFixed(2)}`;
}

function renderPendingOrdersTable() {
    const tbody = document.getElementById('pendingOrdersListBody');
    const totalEl = document.getElementById('pendingOrdersTotal');
    const selectAllCb = document.getElementById('selectAllPendingOrders');
    
    if (!tbody) return;

    tbody.innerHTML = '';
    let totalSelected = 0;

    window.pendingCashOrders.forEach(o => {
        const isSelected = window.selectedPendingOrders.has(o.id);
        if (isSelected) totalSelected += parseFloat(o.total_amount);

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align: center;"><input type="checkbox" class="pending-order-cb" value="${o.id}" ${isSelected ? 'checked' : ''} onchange="togglePendingOrder(${o.id}, this.checked)" style="cursor: pointer;"></td>
            <td>${o.order_number}</td>
            <td>${new Date(o.created_at).toLocaleDateString()}</td>
            <td style="text-align:right">Rs  ${parseFloat(o.total_amount).toFixed(2)}</td>
        `;
        tbody.appendChild(tr);
    });

    if (totalEl) totalEl.textContent = `Rs  ${totalSelected.toFixed(2)}`;
    
    const amountInput = document.getElementById('riderCashAmountInput');
    // Only auto-fill amount if it's 0 or matches previous total (to allow manual override)
    // But for simplicity in this flow, we update it if it's a cash submission
    if (amountInput && document.getElementById('movementType').value === 'cash_submission') {
         amountInput.value = totalSelected.toFixed(2);
    }
    
    if (selectAllCb) {
        selectAllCb.checked = window.pendingCashOrders.length > 0 && window.selectedPendingOrders.size === window.pendingCashOrders.length;
    }
}

function togglePendingOrder(id, checked) {
    if (checked) {
        window.selectedPendingOrders.add(id);
    } else {
        window.selectedPendingOrders.delete(id);
    }
    renderPendingOrdersTable();
}

function toggleAllPendingOrders(cb) {
    if (cb.checked) {
        window.selectedPendingOrders = new Set(window.pendingCashOrders.map(o => o.id));
    } else {
        window.selectedPendingOrders.clear();
    }
    renderPendingOrdersTable();
}

async function populateRidersDropdown() {
    try {
        const response = await fetch(`${API_BASE}/api/riders`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();
        
        const select = document.getElementById('riderId');
        if (select && data.riders) {
            const currentValue = select.value;
            select.innerHTML = '<option value="">-- Select Rider --</option>';
            data.riders.forEach(rider => {
                const option = document.createElement('option');
                option.value = rider.id;
                option.textContent = `${rider.first_name} ${rider.last_name} (${rider.phone})`;
                select.appendChild(option);
            });
            if (currentValue) select.value = currentValue;
        }
    } catch (error) {
        console.error('Error populating riders dropdown:', error);
    }
}

async function populateStoresDropdown() {
    try {
        const response = await fetch(`${API_BASE}/api/stores?admin=1`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();
        
        const select = document.getElementById('settlementStoreSelect');
        if (select && data.stores) {
            const currentValue = select.value;
            select.innerHTML = '<option value="">-- Select Store --</option>';
            data.stores.forEach(store => {
                const option = document.createElement('option');
                option.value = store.id;
                option.textContent = store.name;
                select.appendChild(option);
            });
            if (currentValue) select.value = currentValue;
        }
    } catch (error) {
        console.error('Error populating stores dropdown:', error);
    }
}

async function submitRiderCash() {
    const id = document.getElementById('riderCashId').value;
    const riderId = parseInt(document.getElementById('riderId').value);
    const movementType = document.getElementById('movementType').value;
    const amount = parseFloat(document.getElementById('riderCashAmountInput').value);
    const description = document.getElementById('riderCashDescription').value;

    if (!id && movementType === 'cash_collection') {
        showError('Invalid Movement', 'Cash collection is auto-created from orders. Use Cash Submission when rider hands cash to office.');
        return;
    }

    const payload = {
        rider_id: riderId,
        movement_type: movementType,
        amount,
        description,
        linked_orders: Array.from(window.selectedPendingOrders || []),
        linked_fuel_entries: Array.from(window.selectedPendingFuelEntries || [])
    };

    try {
        const url = id ? `${API_BASE}/api/financial/rider-cash/${id}` : `${API_BASE}/api/financial/rider-cash`;
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Success', id ? 'Rider cash movement updated' : 'Cash movement recorded successfully');
            closeModal('riderCashModal');
            loadRiderCash();
        } else {
            showError('Error', data.message);
        }
    } catch (error) {
        console.error('Error recording rider cash:', error);
        showError('Error', 'Failed to record cash movement');
    }
}

async function createStoreSettlement() {
    const form = document.getElementById('storeSettlementForm');
    if (form) {
        form.reset();
        // Set default dates for the settlement period
        setDatesForPeriod('month', 'periodFrom', 'periodTo');
    }
    const idInput = document.getElementById('storeSettlementId');
    if (idInput) idInput.value = '';

    document.querySelector('#storeSettlementModal h2').textContent = 'Create Store Settlement';
    document.querySelector('#storeSettlementModal .btn-primary').textContent = 'Create Settlement';

    formChangedState['storeSettlementModal'] = false;
    await populateStoresDropdown();
    const storeSelect = document.getElementById('settlementStoreSelect');
    const autoCalcCheckbox = document.getElementById('autoCalculateSettlement');
    const amountInput = document.getElementById('settlementAmount');
    const itemsContainer = document.getElementById('unsettledItemsContainer');
    const itemsBody = document.getElementById('unsettledItemsBody');
    const wholeDataMode = document.getElementById('settlementWholeDataMode');
    const multiStoreMode = document.getElementById('settlementMultiStoreMode');
    const selectAllDueStores = document.getElementById('settlementSelectAllDueStores');
    if (storeSelect) storeSelect.value = '';
    if (wholeDataMode) wholeDataMode.checked = true;
    if (multiStoreMode) multiStoreMode.checked = false;
    if (selectAllDueStores) selectAllDueStores.checked = false;
    if (autoCalcCheckbox) autoCalcCheckbox.checked = true;
    if (amountInput) {
        amountInput.value = '';
        amountInput.readOnly = true;
    }
    updateSettlementPeriodInputs();
    updateSettlementMultiMode();
    loadSettlementDueStores();
    if (itemsContainer) itemsContainer.style.display = 'none';
    if (itemsBody) {
        itemsBody.innerHTML = '<tr><td colspan="6" style="text-align: center;">Select store to load unpaid items</td></tr>';
    }
    currentUnsettledSettlementItems = [];
    selectedUnsettledSettlementItemIds = new Set();
    openModal('storeSettlementModal');
}

async function submitStoreSettlement() {
    const id = document.getElementById('storeSettlementId').value;
    const storeId = parseInt(document.getElementById('settlementStoreSelect').value);
    const netAmount = parseFloat(document.getElementById('settlementAmount').value);
    const paymentMethod = document.getElementById('settlementPaymentMethod').value;
    const range = getSettlementDateRangeForRequest();
    const periodFrom = range.period_from;
    const periodTo = range.period_to;
    const autoCalculate = !!document.getElementById('autoCalculateSettlement')?.checked;

    if (!id && isSettlementMultiStoreMode()) {
        const selectedStoreIds = getSelectedSettlementStoreIds();
        if (!selectedStoreIds.length) {
            showError('No Stores Selected', 'Select one or more due stores to create settlements.');
            return;
        }

        let successCount = 0;
        const failures = [];
        for (const selectedStoreId of selectedStoreIds) {
            const payload = {
                store_id: selectedStoreId,
                net_amount: 0,
                payment_method: paymentMethod,
                period_from: periodFrom,
                period_to: periodTo,
                auto_calculate: true
            };

            try {
                const response = await fetch(`${API_BASE}/api/financial/store-settlements`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
                    },
                    body: JSON.stringify(payload)
                });
                const data = await response.json();
                if (data.success) {
                    successCount += 1;
                } else {
                    failures.push(data.message || `Store #${selectedStoreId}`);
                }
            } catch (error) {
                failures.push(`Store #${selectedStoreId}: ${error.message}`);
            }
        }

        if (successCount > 0) {
            showSuccess('Success', `${successCount} settlement${successCount === 1 ? '' : 's'} created successfully`);
            closeModal('storeSettlementModal');
            loadStoreSettlements();
        }
        if (failures.length > 0) {
            showError('Some Settlements Failed', failures.slice(0, 3).join('\n'));
        }
        return;
    }

    const payload = {
        store_id: storeId,
        net_amount: netAmount,
        payment_method: paymentMethod,
        period_from: periodFrom,
        period_to: periodTo,
        auto_calculate: autoCalculate
    };
    if (!id && autoCalculate) {
        const selectedItemIds = Array.from(selectedUnsettledSettlementItemIds)
            .filter((itemId) => Number.isInteger(Number(itemId)) && Number(itemId) > 0)
            .map((itemId) => Number(itemId));
        if (!selectedItemIds.length) {
            showError('No Items Selected', 'Select one or more unpaid sale items to create a settlement.');
            return;
        }
        payload.selected_item_ids = selectedItemIds;
    }

    try {
        const url = id ? `${API_BASE}/api/financial/store-settlements/${id}` : `${API_BASE}/api/financial/store-settlements`;
        const method = id ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Success', id ? 'Settlement updated' : 'Settlement created successfully');
            closeModal('storeSettlementModal');
            loadStoreSettlements();
        } else {
            showError('Error', data.message);
        }
    } catch (error) {
        console.error('Error submitting settlement:', error);
        showError('Error', 'Failed to save settlement');
    }
}

async function editStoreSettlement(id) {
    const settlement = currentStoreSettlements.find(s => s.id === id);
    if (!settlement) return;

    document.getElementById('storeSettlementId').value = settlement.id;
    
    document.getElementById('settlementAmount').value = settlement.net_amount;
    document.getElementById('settlementPaymentMethod').value = settlement.payment_method;
    
    if (settlement.period_from) {
        document.getElementById('periodFrom').value = settlement.period_from.split('T')[0];
    }
    if (settlement.period_to) {
        document.getElementById('periodTo').value = settlement.period_to.split('T')[0];
    }

    document.querySelector('#storeSettlementModal h2').textContent = 'Edit Store Settlement';
    document.querySelector('#storeSettlementModal .btn-primary').textContent = 'Update Settlement';

    formChangedState['storeSettlementModal'] = false;
    await populateStoresDropdown();
    document.getElementById('settlementStoreSelect').value = settlement.store_id;
    openModal('storeSettlementModal');
}

function createExpense() {
    const form = document.getElementById('expenseForm');
    if (form) form.reset();
    const idInput = document.getElementById('expenseId');
    if (idInput) idInput.value = '';

    document.querySelector('#expenseModal h2').textContent = 'Record Expense';
    document.querySelector('#expenseModal .btn-primary').textContent = 'Record Expense';

    formChangedState['expenseModal'] = false;
    openModal('expenseModal');
}

async function submitExpense() {
    const id = document.getElementById('expenseId').value;
    const category = document.getElementById('expenseCategory').value;
    const description = document.getElementById('expenseDescription').value;
    const amount = parseFloat(document.getElementById('expenseAmount').value);
    const vendorName = document.getElementById('vendorName').value;
    const paymentMethod = document.getElementById('expensePaymentMethod').value;

    const payload = {
        category,
        description,
        amount,
        vendor_name: vendorName,
        payment_method: paymentMethod
    };

    try {
        const url = id ? `${API_BASE}/api/financial/expenses/${id}` : `${API_BASE}/api/financial/expenses`;
        const method = id ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Success', id ? 'Expense updated' : 'Expense recorded successfully');
            closeModal('expenseModal');
            loadExpenses();
        } else {
            showError('Error', data.message);
        }
    } catch (error) {
        console.error('Error submitting expense:', error);
        showError('Error', 'Failed to save expense');
    }
}

function editExpense(id) {
    const expense = currentExpenses.find(e => e.id === id);
    if (!expense) return;

    document.getElementById('expenseId').value = expense.id;
    document.getElementById('expenseCategory').value = expense.category;
    document.getElementById('expenseDescription').value = expense.description || '';
    document.getElementById('expenseAmount').value = expense.amount;
    document.getElementById('vendorName').value = expense.vendor_name || '';
    document.getElementById('expensePaymentMethod').value = expense.payment_method;

    document.querySelector('#expenseModal h2').textContent = 'Edit Expense';
    document.querySelector('#expenseModal .btn-primary').textContent = 'Update Expense';

    formChangedState['expenseModal'] = false;
    openModal('expenseModal');
}

async function approvePaymentVoucher(id) {
    try {
        const response = await fetch(`${API_BASE}/api/financial/payment-vouchers/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify({ status: 'approved' })
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Success', 'Payment voucher approved');
            loadPaymentVouchers();
        } else {
            showError('Error', data.message);
        }
    } catch (error) {
        console.error('Error approving payment voucher:', error);
        showError('Error', 'Failed to approve payment voucher');
    }
}

async function approveReceiptVoucher(id) {
    try {
        const response = await fetch(`${API_BASE}/api/financial/receipt-vouchers/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify({ status: 'approved' })
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Success', 'Receipt voucher approved');
            loadReceiptVouchers();
        } else {
            showError('Error', data.message);
        }
    } catch (error) {
        console.error('Error approving receipt voucher:', error);
        showError('Error', 'Failed to approve receipt voucher');
    }
}

async function approveRiderCash(id) {
    try {
        const response = await fetch(`${API_BASE}/api/financial/rider-cash/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify({ status: 'approved' })
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Success', 'Rider cash movement approved');
            loadRiderCash();
        } else {
            showError('Error', data.message);
        }
    } catch (error) {
        console.error('Error approving rider cash:', error);
        showError('Error', 'Failed to approve rider cash');
    }
}

async function approveStoreSettlement(id) {
    try {
        const response = await fetch(`${API_BASE}/api/financial/store-settlements/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify({ status: 'approved' })
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Success', 'Store settlement approved');
            loadStoreSettlements();
        } else {
            showError('Error', data.message);
        }
    } catch (error) {
        console.error('Error approving store settlement:', error);
        showError('Error', 'Failed to approve store settlement');
    }
}

async function approveExpense(id) {
    try {
        const response = await fetch(`${API_BASE}/api/financial/expenses/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify({ status: 'approved' })
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Success', 'Expense approved');
            loadExpenses();
        } else {
            showError('Error', data.message);
        }
    } catch (error) {
        console.error('Error approving expense:', error);
        showError('Error', 'Failed to approve expense');
    }
}

async function payExpense(id) {
    if (!confirm('Are you sure you want to mark this expense as PAID? This will record a financial transaction.')) return;
    
    try {
        const response = await fetch(`${API_BASE}/api/financial/expenses/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify({ status: 'paid' })
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Success', 'Expense marked as PAID');
            loadExpenses();
        } else {
            showError('Error', data.message);
        }
    } catch (error) {
        console.error('Error paying expense:', error);
        showError('Error', 'Failed to mark expense as paid');
    }
}

function generateFinancialReport() {
    document.getElementById('generateReportForm').reset();
    const reportType = document.getElementById('reportTypeFilter')?.value || 'monthly_summary';
    
    // Set default dates for the report period
    setDatesForPeriod(
        reportType === 'periodic_credit_cash_report' ? 'today' : 'month',
        'reportPeriodFrom',
        'reportPeriodTo'
    );

    document.getElementById('reportTypeModal').value = reportType;
    populateReportRidersDropdown(); // Populate riders when modal opens
    populateReportStoresDropdown(); // Populate stores when modal opens
    
    // Trigger change event to set initial visibility
    const reportTypeModal = document.getElementById('reportTypeModal');
    if (reportTypeModal) {
        reportTypeModal.dispatchEvent(new Event('change'));
    }
    
    openModal('generateReportModal');
}

async function populateReportStoresDropdown() {
    try {
        // Use admin scope so manually-created hidden stores are available in reports.
        const response = await fetch(`${API_BASE}/api/stores?admin=1&lite=1`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();
        
        const select = document.getElementById('reportStoreSelect');
        if (select && data.stores) {
            select.innerHTML = '<option value="">All Stores</option>';
            data.stores.forEach(store => {
                const option = document.createElement('option');
                option.value = store.id;
                option.textContent = store.name;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error populating report stores dropdown:', error);
    }
}

async function populateReportRidersDropdown() {
    try {
        const response = await fetch(`${API_BASE}/api/riders`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();
        
        const select = document.getElementById('reportRiderSelect');
        if (select && data.riders) {
            select.innerHTML = '<option value="">All Riders</option>';
            data.riders.forEach(rider => {
                const option = document.createElement('option');
                option.value = rider.id;
                option.textContent = `${rider.first_name} ${rider.last_name} (${rider.phone})`;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error populating report riders dropdown:', error);
    }
}

async function submitGenerateReport() {
    const reportType = document.getElementById('reportTypeModal').value;
    const periodFromInput = document.getElementById('reportPeriodFrom').value;
    const periodToInput = document.getElementById('reportPeriodTo').value;
    const riderId = document.getElementById('reportRiderSelect')?.value;
    const storeId = document.getElementById('reportStoreSelect')?.value;

    const payload = {
        report_type: reportType
    };

    if (periodFromInput) {
        payload.period_from = periodFromInput;
    }
    if (periodToInput) {
        payload.period_to = periodToInput;
    }
    if (riderId && (
        reportType === 'rider_fuel_report' ||
        reportType === 'rider_cash_report' ||
        reportType === 'rider_orders_report' ||
        reportType === 'rider_payments_report' ||
        reportType === 'rider_receivings_report' ||
        reportType === 'rider_wallet_report' ||
        reportType === 'rider_petrol_report' ||
        reportType === 'rider_daily_mileage_report' ||
        reportType === 'rider_daily_activity_report' ||
        reportType === 'rider_day_closing_report' ||
        reportType === 'order_wise_sale_summary'
    )) {
        payload.rider_id = riderId;
    }
    if (storeId && (reportType === 'order_wise_sale_summary' || reportType === 'periodic_sales_report')) {
        payload.store_id = storeId;
    }
    if (storeId && (reportType === 'periodic_comprehensive_summary_report' || reportType === 'periodic_store_payments_balance_report')) {
        payload.store_id = storeId;
    }
    if (storeId && (reportType === 'store_payable_reconciliation' || reportType === 'unsettled_amounts_report')) {
        payload.store_id = storeId;
    }

    // Always default to preview first
    payload.preview = true;

    try {
        const response = await fetch(`${API_BASE}/api/financial/reports/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (data.success) {
            closeModal('generateReportModal');
            
            // Show preview in the View Modal, but with extra controls
            // Add the report to currentReports temporarily so viewReport works
            const tempReport = data.report;
            // Ensure ID is unique/dummy if needed, though viewReport uses ID lookup. 
            // We'll modify viewReport or just push it.
            // Actually, viewReport expects an ID. Let's make it flexible.
            
            // Add to list but mark as preview
            tempReport.id = 'preview_temp';
            const existingIndex = currentReports.findIndex(r => r.id === 'preview_temp');
            if (existingIndex >= 0) {
                currentReports[existingIndex] = tempReport;
            } else {
                currentReports.push(tempReport);
            }
            
            // Call view report
            viewReport('preview_temp');
            
            // Update the modal footer to show "Save" button
            setTimeout(() => {
                const footer = document.querySelector('#viewReportModal .modal-footer') || document.querySelector('#reportViewModal .modal-footer');
                if (footer) {
                    // Remove existing Save button if any
                    const existingSave = document.getElementById('btnSaveReport');
                    if (existingSave) existingSave.remove();
                    
                    const saveBtn = document.createElement('button');
                    saveBtn.id = 'btnSaveReport';
                    saveBtn.type = 'button';
                    saveBtn.className = 'btn btn-success report-action-btn report-modal-action-btn';
                    saveBtn.innerHTML = 'Save Report';
                    saveBtn.onclick = () => saveGeneratedReport(payload); // Pass original payload without preview flag
                    
                    // Insert before Close button
                    footer.insertBefore(saveBtn, footer.firstChild);
                }
            }, 500);

        } else {
            showError('Error', data.message);
        }
    } catch (error) {
        console.error('Error generating report:', error);
        showError('Error', 'Failed to generate report');
    }
}

async function saveGeneratedReport(payload) {
    // Remove preview flag to actually save
    const savePayload = { ...payload };
    delete savePayload.preview;
    
    try {
        const response = await fetch(`${API_BASE}/api/financial/reports/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify(savePayload)
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Success', 'Report saved successfully');
            // Close the view modal
            const modalId = document.getElementById('viewReportModal') ? 'viewReportModal' : 'reportViewModal';
            closeModal(modalId);
            // Refresh list
            loadFinancialReports();
        } else {
            showError('Error', data.message);
        }
    } catch (error) {
        console.error('Error saving report:', error);
        showError('Error', 'Failed to save report');
    }
}

function formatFinancialReportCurrency(value) {
    return `Rs ${parseFloat(value || 0).toFixed(2)}`;
}

function formatFinancialReportDate(value) {
    if (!value) return '-';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString();
}

function getFinancialReportSortTime(value) {
    if (!value) return 0;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
    const asNumber = Date.parse(String(value));
    return Number.isNaN(asNumber) ? 0 : asNumber;
}

function renderFinancialReportTable(title, headers, rows, footerRow = null) {
    let html = `<h4 style="margin:16px 0 8px 0;">${title}</h4>`;
    html += '<div class="report-detail-table-wrapper"><table class="report-detail-table" style="font-size:0.84em"><thead><tr>';
    headers.forEach((header) => {
        html += `<th>${header}</th>`;
    });
    html += '</tr></thead><tbody>';

    if (rows.length === 0) {
        html += `<tr><td colspan="${headers.length}" style="text-align:center; color:#64748b;">No records found</td></tr>`;
    } else {
        rows.forEach((cells) => {
            html += '<tr>';
            cells.forEach((cell) => {
                html += `<td>${cell}</td>`;
            });
            html += '</tr>';
        });
    }

    if (footerRow) {
        html += '<tr style="font-weight:bold; background:#f8fafc;">';
        footerRow.forEach((cell) => {
            if (cell && typeof cell === 'object' && Object.prototype.hasOwnProperty.call(cell, 'colspan')) {
                html += `<td colspan="${cell.colspan}">${cell.value || ''}</td>`;
            } else {
                html += `<td>${cell || ''}</td>`;
            }
        });
        html += '</tr>';
    }

    html += '</tbody></table></div>';
    return html;
}

function groupRiderFuelEntries(entries) {
    const groups = new Map();
    (entries || []).forEach((entry) => {
        const riderName = `${entry.first_name || ''} ${entry.last_name || ''}`.trim() || 'Unknown Rider';
        if (!groups.has(riderName)) {
            groups.set(riderName, {
                rider_name: riderName,
                entries: [],
                total_distance: 0,
                total_cost: 0
            });
        }
        const group = groups.get(riderName);
        group.entries.push(entry);
        group.total_distance += parseFloat(entry.distance || 0);
        group.total_cost += parseFloat(entry.fuel_cost || 0);
    });

    return Array.from(groups.values()).map((group) => ({
        ...group,
        total_distance: Number(group.total_distance.toFixed(2)),
        total_cost: Number(group.total_cost.toFixed(2))
    }));
}

function renderPeriodicSalesReportHtml(data) {
    const summary = data.summary || {};
    const closing = data.closing_summary || {};
    let html = '<h3>Periodic Sales Report</h3>';

    html += renderFinancialReportTable(
        'Sales By Store / Product',
        ['Type', 'Store', 'Product', 'Cost Price', 'Sale Price', 'Qty Sold', 'Gross Sales', 'Net Sales', 'Profit'],
        (data.rows || []).map((r) => [
            String(r.sale_type || 'store').toUpperCase(),
            r.store_name || '-',
            r.product_name || '-',
            formatFinancialReportCurrency(r.cost_price || 0),
            formatFinancialReportCurrency(r.sale_price || 0),
            parseInt(r.qty_sold || 0),
            formatFinancialReportCurrency(r.gross_sales || 0),
            formatFinancialReportCurrency(r.net_sales || 0),
            formatFinancialReportCurrency(r.profit || 0)
        ]),
        [
            'TOTAL',
            { colspan: 2, value: '' },
            formatFinancialReportCurrency(summary.average_cost_price || 0),
            formatFinancialReportCurrency(summary.average_sale_price || 0),
            parseInt(summary.total_qty_sold || 0),
            formatFinancialReportCurrency(summary.gross_sales || 0),
            formatFinancialReportCurrency(summary.net_sales || 0),
            formatFinancialReportCurrency(summary.profit || 0)
        ]
    );

    html += renderFinancialReportTable(
        'Delivery Charges',
        ['Order #', 'Date', 'Rider', 'Stores', 'Fee'],
        (data.delivery_rows || []).map((row) => [
            row.order_number || '-',
            formatFinancialReportDate(row.order_date),
            row.rider_name || '-',
            row.store_names || '-',
            formatFinancialReportCurrency(row.delivery_fee || 0)
        ]),
        [
            'TOTAL',
            { colspan: 3, value: '' },
            formatFinancialReportCurrency(data.delivery_summary?.total_delivery_charges || 0)
        ]
    );

    html += renderFinancialReportTable(
        'Store Settlement Payments',
        ['Settlement #', 'Date', 'Store', 'Orders Amount', 'Commissions', 'Deductions', 'Net Paid'],
        (data.settlement_rows || []).map((row) => [
            row.settlement_number || '-',
            formatFinancialReportDate(row.settlement_date),
            row.store_name || '-',
            formatFinancialReportCurrency(row.total_orders_amount || 0),
            formatFinancialReportCurrency(row.commissions || 0),
            formatFinancialReportCurrency(row.deductions || 0),
            formatFinancialReportCurrency(row.net_amount || 0)
        ]),
        [
            'TOTAL',
            { colspan: 2, value: '' },
            formatFinancialReportCurrency(data.settlement_summary?.total_orders_amount || 0),
            formatFinancialReportCurrency(data.settlement_summary?.total_commissions || 0),
            formatFinancialReportCurrency(data.settlement_summary?.total_deductions || 0),
            formatFinancialReportCurrency(data.settlement_summary?.total_paid_settlements || 0)
        ]
    );

    html += renderFinancialReportTable(
        'Fuel Payments',
        ['Movement #', 'Date', 'Rider', 'Amount', 'Description'],
        (data.fuel_rows || []).map((row) => [
            row.movement_number || '-',
            formatFinancialReportDate(row.movement_date),
            row.rider_name || '-',
            formatFinancialReportCurrency(row.amount || 0),
            row.description || '-'
        ]),
        [
            'TOTAL',
            { colspan: 2, value: '' },
            formatFinancialReportCurrency(data.fuel_summary?.total_fuel_payments || 0),
            ''
        ]
    );

    html += renderFinancialReportTable(
        'Expenses',
        ['Expense #', 'Date', 'Category', 'Vendor', 'Amount', 'Description'],
        (data.expense_rows || []).map((row) => [
            row.expense_number || '-',
            formatFinancialReportDate(row.expense_date),
            row.category || '-',
            row.vendor_name || '-',
            formatFinancialReportCurrency(row.amount || 0),
            row.description || '-'
        ]),
        [
            'TOTAL',
            { colspan: 3, value: '' },
            formatFinancialReportCurrency(data.expense_summary?.total_paid_expenses || 0),
            ''
        ]
    );

    html += renderFinancialReportTable(
        'Closing Summary',
        ['Cost Price', 'Sale Price', 'Qty Sold', 'Gross Sales', 'Net Sales', 'Profit', 'Delivery Charges', 'Store Settlements', 'Fuel Payments', 'Expenses', 'Net Closing'],
        [[
            formatFinancialReportCurrency(closing.cost_price || 0),
            formatFinancialReportCurrency(closing.sale_price || 0),
            parseInt(closing.qty_sold || 0),
            formatFinancialReportCurrency(closing.gross_sales || 0),
            formatFinancialReportCurrency(closing.net_sales || 0),
            formatFinancialReportCurrency(closing.profit || 0),
            formatFinancialReportCurrency(closing.delivery_charges || 0),
            formatFinancialReportCurrency(closing.store_settlement_payments || 0),
            formatFinancialReportCurrency(closing.fuel_payments || 0),
            formatFinancialReportCurrency(closing.expenses || 0),
            formatFinancialReportCurrency(closing.net_closing || 0)
        ]]
    );

    return html;
}

function renderPeriodicCreditCashReportHtml(data) {
    const summary = data.summary || {};
    const sortedRows = [...(data.rows || [])].sort((a, b) => getFinancialReportSortTime(b.report_date) - getFinancialReportSortTime(a.report_date));
    let html = '<h3>Periodic Credit Cash Report</h3>';

    html += renderFinancialReportTable(
        'Date Wise Credit / Cash Summary',
        ['Date', 'Credit Sale', 'Cash Sale', 'Profit', 'Delivery Charges', 'Total'],
        sortedRows.map((row) => [
            formatFinancialReportDate(row.report_date),
            formatFinancialReportCurrency(row.credit_sale || 0),
            formatFinancialReportCurrency(row.cash_sale || 0),
            formatFinancialReportCurrency(row.profit || 0),
            formatFinancialReportCurrency(row.delivery_charges || 0),
            formatFinancialReportCurrency(row.total || 0)
        ]),
        [
            'TOTAL',
            formatFinancialReportCurrency(summary.total_credit_sale || 0),
            formatFinancialReportCurrency(summary.total_cash_sale || 0),
            formatFinancialReportCurrency(summary.total_profit || 0),
            formatFinancialReportCurrency(summary.total_delivery_charges || 0),
            formatFinancialReportCurrency(summary.grand_total || 0)
        ]
    );

    html += `<div style="margin-top: 15px; font-size: 1.0em; padding: 10px; background: #f8f9fa; border: 1px solid #ddd; border-radius: 5px;">
        <strong>Total Credit:</strong> ${formatFinancialReportCurrency(summary.total_credit_sale || 0)} |
        <strong>Total Cash Sale:</strong> ${formatFinancialReportCurrency(summary.total_cash_sale || 0)} |
        <strong>Total Profit:</strong> ${formatFinancialReportCurrency(summary.total_profit || 0)} |
        <strong>Total Delivery Charges:</strong> ${formatFinancialReportCurrency(summary.total_delivery_charges || 0)} |
        <strong>Grand Total:</strong> ${formatFinancialReportCurrency(summary.grand_total || 0)}
    </div>`;

    return html;
}

function renderPeriodicComprehensiveSummaryReportHtml(data) {
    const summary = data.summary || {};
    const sortedRows = [...(data.rows || [])].sort((a, b) => getFinancialReportSortTime(b.report_date) - getFinancialReportSortTime(a.report_date));
    const netPosition = Number((
        Number(summary.total_sale || 0) +
        Number(summary.total_delivery_charges || 0) -
        Number(summary.total_expense || 0) -
        Number(summary.total_fuel || 0)
    ).toFixed(2));
    let html = '<h3>Periodic Comprehensive Summary Report</h3>';

    html += renderFinancialReportTable(
        'Date Wise Comprehensive Summary',
        ['Date', 'Total Sale', 'Credit Sale', 'Cash Sale', 'Delivery Charges', 'Expense', 'Fuel'],
        sortedRows.map((row) => [
            formatFinancialReportDate(row.report_date),
            formatFinancialReportCurrency(row.total_sale || 0),
            formatFinancialReportCurrency(row.credit_sale || 0),
            formatFinancialReportCurrency(row.cash_sale || 0),
            formatFinancialReportCurrency(row.delivery_charges || 0),
            formatFinancialReportCurrency(row.expense || 0),
            formatFinancialReportCurrency(row.fuel || 0)
        ]),
        [
            'TOTAL',
            formatFinancialReportCurrency(summary.total_sale || 0),
            formatFinancialReportCurrency(summary.total_credit_sale || 0),
            formatFinancialReportCurrency(summary.total_cash_sale || 0),
            formatFinancialReportCurrency(summary.total_delivery_charges || 0),
            formatFinancialReportCurrency(summary.total_expense || 0),
            formatFinancialReportCurrency(summary.total_fuel || 0)
        ]
    );

    html += `<div style="margin-top: 15px; font-size: 1.0em; padding: 10px; background: #f8f9fa; border: 1px solid #ddd; border-radius: 5px;">
        <strong>Total Sale:</strong> ${formatFinancialReportCurrency(summary.total_sale || 0)} |
        <strong>Total Credit Sale:</strong> ${formatFinancialReportCurrency(summary.total_credit_sale || 0)} |
        <strong>Total Cash Sale:</strong> ${formatFinancialReportCurrency(summary.total_cash_sale || 0)} |
        <strong>Total Delivery Charges:</strong> ${formatFinancialReportCurrency(summary.total_delivery_charges || 0)} |
        <strong>Total Expense:</strong> ${formatFinancialReportCurrency(summary.total_expense || 0)} |
        <strong>Total Fuel:</strong> ${formatFinancialReportCurrency(summary.total_fuel || 0)} |
        <strong>Net Position:</strong> ${formatFinancialReportCurrency(netPosition)}
    </div>`;

    return html;
}

function renderPeriodicStorePaymentsBalanceReportHtml(data) {
    const summary = data.summary || {};
    const sortedRows = [...(data.rows || [])].sort((a, b) => {
        const termCompare = String(a.payment_term || '').localeCompare(String(b.payment_term || ''));
        if (termCompare !== 0) return termCompare;
        return String(a.store_name || '').localeCompare(String(b.store_name || ''));
    });
    let html = '<h3>Periodic Store Payments & Balance Report</h3>';

    html += renderFinancialReportTable(
        'Store Payments & Balance',
        ['Store', 'Payment Term', 'Generated Payable', 'Paid Settlements', 'Balance'],
        sortedRows.map((row) => [
            row.store_name || '-',
            row.payment_term || '-',
            formatFinancialReportCurrency(row.generated_payable || 0),
            formatFinancialReportCurrency(row.paid_amount || 0),
            formatFinancialReportCurrency(row.balance_amount || 0)
        ]),
        [
            'TOTAL',
            '',
            formatFinancialReportCurrency(summary.total_generated_payable || 0),
            formatFinancialReportCurrency(summary.total_paid_amount || 0),
            formatFinancialReportCurrency(summary.total_balance_amount || 0)
        ]
    );

    html += `<div style="margin-top: 15px; font-size: 1.0em; padding: 10px; background: #f8f9fa; border: 1px solid #ddd; border-radius: 5px;">
        <strong>Total Generated Payable:</strong> ${formatFinancialReportCurrency(summary.total_generated_payable || 0)} |
        <strong>Total Paid Settlements:</strong> ${formatFinancialReportCurrency(summary.total_paid_amount || 0)} |
        <strong>Total Balance:</strong> ${formatFinancialReportCurrency(summary.total_balance_amount || 0)}
    </div>`;

    return html;
}

function generatePDF(reportId) {
    const report = currentReports.find(r => r.id === reportId);
    if (!report) return;

    // Check if jsPDF is loaded
    if (!window.jspdf) {
        alert('PDF generator library not loaded. Please refresh the page.');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Title
    doc.setFontSize(20);
    doc.text('ServeNow Financial Report', 14, 22);
    
    // Metadata
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Report #: ${report.report_number}`, 14, 32);
    doc.text(`Type: ${report.report_type.replace(/_/g, ' ').toUpperCase()}`, 14, 37);
    doc.text(`Generated: ${new Date(report.created_at).toLocaleString()}`, 14, 42);
    if (report.period_from) {
        doc.text(`Period: ${new Date(report.period_from).toLocaleDateString()} - ${report.period_to ? new Date(report.period_to).toLocaleDateString() : 'Now'}`, 14, 47);
    }

    let data;
    try {
        data = typeof report.data === 'string' ? JSON.parse(report.data) : report.data;
    } catch (e) { data = null; }

    const hideFinancialSummary = data && (data.type === 'rider_fuel' || data.type === 'rider_petrol');

    if (!hideFinancialSummary) {
        doc.setFontSize(12);
        doc.setTextColor(0);
        doc.text('Financial Summary', 14, 58);
        
        doc.autoTable({
            startY: 62,
            head: [['Category', 'Amount']],
            body: [
                ['Total Income', `Rs ${parseFloat(report.total_income).toFixed(2)}`],
                ['Total Expense', `Rs ${parseFloat(report.total_expense).toFixed(2)}`],
                ['Total Settlements', `Rs ${parseFloat(report.total_commissions).toFixed(2)}`],
                ['Net Profit', `Rs ${parseFloat(report.net_profit).toFixed(2)}`]
            ],
            theme: 'striped',
            headStyles: { fillColor: [41, 128, 185] },
            styles: { fontSize: 10, cellPadding: 3 }
        });
    }

    if (data) {
        let startY = hideFinancialSummary ? 58 : doc.lastAutoTable.finalY + 15;
        doc.setFontSize(12);
        
        if (data.type === 'rider_cash') {
            doc.text('Rider Cash Movements', 14, startY);
            const kpis = data.kpis || {};
            doc.setFontSize(10);
            doc.text(
                `Total Income: Rs ${parseFloat(kpis.total_income || 0).toFixed(2)} | Total Orders: ${parseInt(kpis.total_orders || 0)} | Total Delivery Charges: Rs ${parseFloat(kpis.total_delivery_charges || 0).toFixed(2)}`,
                14,
                startY + 5
            );
            doc.autoTable({
                startY: startY + 10,
                head: [['Order #', 'Rider', 'Date', 'Type', 'Amount', 'Description']],
                body: data.movements.map(m => [
                    m.order_number || '-',
                    `${m.first_name} ${m.last_name}`,
                    new Date(m.movement_date).toLocaleDateString(),
                    m.movement_type,
                    `Rs ${parseFloat(m.amount).toFixed(2)}`,
                    m.description || ''
                ]),
                theme: 'grid',
                styles: { fontSize: 8 }
            });
        } else if (data.type === 'rider_orders') {
            doc.text('Rider Orders Report', 14, startY);
            if (data.summary) {
                doc.setFontSize(10);
                doc.text(
                    `Total: ${data.summary.total_orders} | Delivered: ${data.summary.delivered_orders} | Active: ${data.summary.active_orders} | Cancelled: ${data.summary.cancelled_orders}`,
                    14,
                    startY + 5
                );
                startY += 10;
            }
            doc.autoTable({
                startY: startY + 5,
                head: [['Order #', 'Date', 'Rider', 'Customer', 'Status', 'Payment', 'Amount', 'Delivery']],
                body: (data.orders || []).map(o => [
                    o.order_number,
                    new Date(o.created_at).toLocaleDateString(),
                    o.rider_name || '-',
                    o.customer_name || '-',
                    o.status || '-',
                    `${o.payment_method || '-'} / ${o.payment_status || '-'}`,
                    `Rs ${parseFloat(o.total_amount || 0).toFixed(2)}`,
                    `Rs ${parseFloat(o.delivery_fee || 0).toFixed(2)}`
                ]),
                theme: 'grid',
                styles: { fontSize: 7 }
            });
        } else if (data.type === 'rider_payments') {
            doc.text('Rider Payments Report', 14, startY);
            doc.autoTable({
                startY: startY + 5,
                head: [['Rider', 'Date', 'Type', 'Amount', 'Status', 'Description']],
                body: (data.entries || []).map(e => [
                    `${e.first_name || ''} ${e.last_name || ''}`.trim(),
                    new Date(e.movement_date).toLocaleDateString(),
                    e.movement_type || '-',
                    `Rs ${parseFloat(e.amount || 0).toFixed(2)}`,
                    e.status || '-',
                    e.description || ''
                ]),
                theme: 'grid',
                styles: { fontSize: 8 }
            });
        } else if (data.type === 'rider_receivings') {
            doc.text('Rider Receivings Report', 14, startY);
            doc.autoTable({
                startY: startY + 5,
                head: [['Rider', 'Date', 'Type', 'Amount', 'Status', 'Description']],
                body: (data.entries || []).map(e => [
                    `${e.first_name || ''} ${e.last_name || ''}`.trim(),
                    new Date(e.movement_date).toLocaleDateString(),
                    e.movement_type || '-',
                    `Rs ${parseFloat(e.amount || 0).toFixed(2)}`,
                    e.status || '-',
                    e.description || ''
                ]),
                theme: 'grid',
                styles: { fontSize: 8 }
            });
        } else if (data.type === 'rider_wallet') {
            doc.text('Rider Wallet Report', 14, startY);
            if (data.summary) {
                doc.setFontSize(10);
                doc.text(
                    `Wallets: ${parseInt(data.summary.total_wallets || 0)} | Balance: ${formatFinancialReportCurrency(data.summary.total_current_balance || 0)} | Credit Total: ${formatFinancialReportCurrency(data.summary.total_credits || 0)} | Debit Total: ${formatFinancialReportCurrency(data.summary.total_debits || 0)} | Net: ${formatFinancialReportCurrency(data.summary.total_net_credit_debit || 0)}`,
                    14,
                    startY + 5
                );
                startY += 10;
            }
            doc.autoTable({
                startY: startY + 5,
                head: [['Rider', 'Balance', 'Credit Total', 'Debit Total', 'Net Credit-Debit', 'Refunds', 'Transfers', 'Entries']],
                body: (data.wallet_summary || []).map(r => [
                    r.rider_name || '-',
                    formatFinancialReportCurrency(r.current_balance || 0),
                    formatFinancialReportCurrency(r.credits || 0),
                    formatFinancialReportCurrency(r.debits || 0),
                    formatFinancialReportCurrency(r.net_credit_debit || 0),
                    formatFinancialReportCurrency(r.refunds || 0),
                    formatFinancialReportCurrency(r.transfers || 0),
                    parseInt(r.entries || 0)
                ]),
                theme: 'grid',
                styles: { fontSize: 8 }
            });
            const y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : startY + 30;
            const creditEntries = (data.entries || []).filter(e => e.type === 'credit');
            const debitEntries = (data.entries || []).filter(e => e.type === 'debit');
            doc.text('Credit Transactions', 14, y);
            doc.autoTable({
                startY: y + 4,
                head: [['Date', 'Rider', 'Credit', 'Balance After', 'Reference']],
                body: creditEntries.map(e => [
                    e.created_at ? new Date(e.created_at).toLocaleDateString() : '-',
                    e.rider_name || `${e.first_name || ''} ${e.last_name || ''}`.trim(),
                    formatFinancialReportCurrency(e.amount || 0),
                    formatFinancialReportCurrency(e.balance_after || 0),
                    `${e.reference_type || '-'} ${e.reference_id || ''}`.trim()
                ]),
                theme: 'grid',
                styles: { fontSize: 7 }
            });
            const debitY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 30;
            doc.text('Debit Transactions', 14, debitY);
            doc.autoTable({
                startY: debitY + 4,
                head: [['Date', 'Rider', 'Debit', 'Balance After', 'Reference']],
                body: debitEntries.map(e => [
                    e.created_at ? new Date(e.created_at).toLocaleDateString() : '-',
                    e.rider_name || `${e.first_name || ''} ${e.last_name || ''}`.trim(),
                    formatFinancialReportCurrency(e.amount || 0),
                    formatFinancialReportCurrency(e.balance_after || 0),
                    `${e.reference_type || '-'} ${e.reference_id || ''}`.trim()
                ]),
                theme: 'grid',
                styles: { fontSize: 7 }
            });
        } else if (data.type === 'store_financials') {
            doc.text('Store Financials (Cost Analysis)', 14, startY);
            doc.autoTable({
                startY: startY + 5,
                head: [['Store Name', 'Total Sales', 'Total Cost', 'Est. Profit']],
                body: data.stores.map(s => [
                    s.store_name,
                    `Rs ${parseFloat(s.total_sales).toFixed(2)}`,
                    `Rs ${parseFloat(s.total_cost).toFixed(2)}`,
                    `Rs ${parseFloat(s.estimated_profit).toFixed(2)}`
                ]),
                theme: 'grid',
                styles: { fontSize: 8 }
            });
        } else if (data.type === 'store_settlement') {
            doc.text('Store Settlements', 14, startY);
            doc.autoTable({
                startY: startY + 5,
                head: [['Settlement #', 'Date', 'Store', 'Amount', 'Comm.', 'Status']],
                body: data.settlements.map(s => [
                    s.settlement_number,
                    new Date(s.settlement_date).toLocaleDateString(),
                    s.store_name,
                    `Rs ${parseFloat(s.net_amount).toFixed(2)}`,
                    `Rs ${parseFloat(s.commissions).toFixed(2)}`,
                    s.status
                ]),
                theme: 'grid',
                styles: { fontSize: 8 }
            });
        } else if (data.type === 'delivery_charges_breakdown') {
            doc.text('Delivery Charges Breakdown', 14, startY);
            
            if (data.summary) {
                doc.setFontSize(10);
                doc.text(`Total Orders: ${data.summary.total_orders} | Total Fees: Rs ${parseFloat(data.summary.total_delivery_fees).toFixed(2)}`, 14, startY + 5);
                startY += 10;
            }

            doc.autoTable({
                startY: startY + 5,
                head: [['Order #', 'Date', 'Rider', 'Store', 'Fee']],
                body: data.orders.map(o => [
                    o.order_number,
                    new Date(o.order_date).toLocaleDateString(),
                    o.rider_name,
                    o.store_names,
                    `Rs ${parseFloat(o.delivery_fee).toFixed(2)}`
                ]),
                theme: 'grid',
                styles: { fontSize: 8 }
            });
        } else if (data.type === 'periodic_sales_report') {
            doc.text('Periodic Sales Report', 14, startY);
            if (data.summary) {
                doc.setFontSize(10);
                doc.text(
                    `Rows: ${parseInt(data.summary.total_rows || 0)} | Qty: ${parseInt(data.summary.total_qty_sold || 0)} | Cost: ${formatFinancialReportCurrency(data.summary.total_cost || 0)} | Gross: ${formatFinancialReportCurrency(data.summary.gross_sales || 0)} | Net: ${formatFinancialReportCurrency(data.summary.net_sales || 0)} | Profit: ${formatFinancialReportCurrency(data.summary.profit || 0)}`,
                    14,
                    startY + 5
                );
                startY += 10;
            }
            const periodicSalesBody = (data.rows || []).map((r) => [
                String(r.sale_type || 'store').toUpperCase(),
                r.store_name || '-',
                r.product_name || '-',
                formatFinancialReportCurrency(r.cost_price || 0),
                formatFinancialReportCurrency(r.sale_price || 0),
                parseInt(r.qty_sold || 0),
                formatFinancialReportCurrency(r.gross_sales || 0),
                formatFinancialReportCurrency(r.net_sales || 0),
                formatFinancialReportCurrency(r.profit || 0)
            ]);
            if (data.summary) {
                periodicSalesBody.push([
                    'TOTAL',
                    '',
                    '',
                    formatFinancialReportCurrency(data.summary.average_cost_price || 0),
                    formatFinancialReportCurrency(data.summary.average_sale_price || 0),
                    parseInt(data.summary.total_qty_sold || 0),
                    formatFinancialReportCurrency(data.summary.gross_sales || 0),
                    formatFinancialReportCurrency(data.summary.net_sales || 0),
                    formatFinancialReportCurrency(data.summary.profit || 0)
                ]);
            }
            doc.autoTable({
                startY: startY + 5,
                head: [['Type', 'Store', 'Product', 'Cost Price', 'Sale Price', 'Qty Sold', 'Gross Sales', 'Net Sales', 'Profit']],
                body: periodicSalesBody,
                theme: 'grid',
                styles: { fontSize: 7 }
            });

            let periodicY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : startY + 30;
            doc.text('Delivery Charges', 14, periodicY);
            doc.autoTable({
                startY: periodicY + 4,
                head: [['Order #', 'Date', 'Rider', 'Stores', 'Fee']],
                body: (data.delivery_rows && data.delivery_rows.length ? data.delivery_rows : [{ order_number: 'No records found' }]).map((row) => [
                    row.order_number || 'No records found',
                    row.order_number ? formatFinancialReportDate(row.order_date) : '',
                    row.order_number ? (row.rider_name || '-') : '',
                    row.order_number ? (row.store_names || '-') : '',
                    row.order_number ? formatFinancialReportCurrency(row.delivery_fee || 0) : ''
                ]).concat([[
                    'TOTAL',
                    '',
                    '',
                    '',
                    formatFinancialReportCurrency(data.delivery_summary?.total_delivery_charges || 0)
                ]]),
                theme: 'grid',
                styles: { fontSize: 7 }
            });

            periodicY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : periodicY + 30;
            doc.text('Store Settlement Payments', 14, periodicY);
            doc.autoTable({
                startY: periodicY + 4,
                head: [['Settlement #', 'Date', 'Store', 'Orders Amount', 'Commissions', 'Deductions', 'Net Paid']],
                body: (data.settlement_rows && data.settlement_rows.length ? data.settlement_rows : [{ settlement_number: 'No records found' }]).map((row) => [
                    row.settlement_number || 'No records found',
                    row.settlement_number ? formatFinancialReportDate(row.settlement_date) : '',
                    row.settlement_number ? (row.store_name || '-') : '',
                    row.settlement_number ? formatFinancialReportCurrency(row.total_orders_amount || 0) : '',
                    row.settlement_number ? formatFinancialReportCurrency(row.commissions || 0) : '',
                    row.settlement_number ? formatFinancialReportCurrency(row.deductions || 0) : '',
                    row.settlement_number ? formatFinancialReportCurrency(row.net_amount || 0) : ''
                ]).concat([[
                    'TOTAL',
                    '',
                    '',
                    formatFinancialReportCurrency(data.settlement_summary?.total_orders_amount || 0),
                    formatFinancialReportCurrency(data.settlement_summary?.total_commissions || 0),
                    formatFinancialReportCurrency(data.settlement_summary?.total_deductions || 0),
                    formatFinancialReportCurrency(data.settlement_summary?.total_paid_settlements || 0)
                ]]),
                theme: 'grid',
                styles: { fontSize: 6.7 }
            });

            periodicY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : periodicY + 30;
            doc.text('Fuel Payments', 14, periodicY);
            doc.autoTable({
                startY: periodicY + 4,
                head: [['Movement #', 'Date', 'Rider', 'Amount', 'Description']],
                body: (data.fuel_rows && data.fuel_rows.length ? data.fuel_rows : [{ movement_number: 'No records found' }]).map((row) => [
                    row.movement_number || 'No records found',
                    row.movement_number ? formatFinancialReportDate(row.movement_date) : '',
                    row.movement_number ? (row.rider_name || '-') : '',
                    row.movement_number ? formatFinancialReportCurrency(row.amount || 0) : '',
                    row.movement_number ? (row.description || '-') : ''
                ]).concat([[
                    'TOTAL',
                    '',
                    '',
                    formatFinancialReportCurrency(data.fuel_summary?.total_fuel_payments || 0),
                    ''
                ]]),
                theme: 'grid',
                styles: { fontSize: 7 }
            });

            periodicY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : periodicY + 30;
            doc.text('Expenses', 14, periodicY);
            doc.autoTable({
                startY: periodicY + 4,
                head: [['Expense #', 'Date', 'Category', 'Vendor', 'Amount', 'Description']],
                body: (data.expense_rows && data.expense_rows.length ? data.expense_rows : [{ expense_number: 'No records found' }]).map((row) => [
                    row.expense_number || 'No records found',
                    row.expense_number ? formatFinancialReportDate(row.expense_date) : '',
                    row.expense_number ? (row.category || '-') : '',
                    row.expense_number ? (row.vendor_name || '-') : '',
                    row.expense_number ? formatFinancialReportCurrency(row.amount || 0) : '',
                    row.expense_number ? (row.description || '-') : ''
                ]).concat([[
                    'TOTAL',
                    '',
                    '',
                    '',
                    formatFinancialReportCurrency(data.expense_summary?.total_paid_expenses || 0),
                    ''
                ]]),
                theme: 'grid',
                styles: { fontSize: 7 }
            });

            periodicY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : periodicY + 30;
            doc.text('Closing Summary', 14, periodicY);
            doc.autoTable({
                startY: periodicY + 4,
                head: [['Cost Price', 'Sale Price', 'Qty Sold', 'Gross Sales', 'Net Sales', 'Profit', 'Delivery', 'Settlements', 'Fuel', 'Expenses', 'Net Closing']],
                body: [[
                    formatFinancialReportCurrency(data.closing_summary?.cost_price || 0),
                    formatFinancialReportCurrency(data.closing_summary?.sale_price || 0),
                    parseInt(data.closing_summary?.qty_sold || 0),
                    formatFinancialReportCurrency(data.closing_summary?.gross_sales || 0),
                    formatFinancialReportCurrency(data.closing_summary?.net_sales || 0),
                    formatFinancialReportCurrency(data.closing_summary?.profit || 0),
                    formatFinancialReportCurrency(data.closing_summary?.delivery_charges || 0),
                    formatFinancialReportCurrency(data.closing_summary?.store_settlement_payments || 0),
                    formatFinancialReportCurrency(data.closing_summary?.fuel_payments || 0),
                    formatFinancialReportCurrency(data.closing_summary?.expenses || 0),
                    formatFinancialReportCurrency(data.closing_summary?.net_closing || 0)
                ]],
                theme: 'grid',
                styles: { fontSize: 6 }
            });
        } else if (data.type === 'periodic_credit_cash_report') {
            const sortedRows = [...(data.rows || [])].sort((a, b) => getFinancialReportSortTime(b.report_date) - getFinancialReportSortTime(a.report_date));
            doc.text('Periodic Credit Cash Report', 14, startY);
            if (data.summary) {
                doc.setFontSize(10);
                doc.text(
                    `Credit: ${formatFinancialReportCurrency(data.summary.total_credit_sale || 0)} | Cash Sale: ${formatFinancialReportCurrency(data.summary.total_cash_sale || 0)} | Profit: ${formatFinancialReportCurrency(data.summary.total_profit || 0)} | Delivery: ${formatFinancialReportCurrency(data.summary.total_delivery_charges || 0)} | Grand Total: ${formatFinancialReportCurrency(data.summary.grand_total || 0)}`,
                    14,
                    startY + 5
                );
                startY += 10;
            }
            doc.autoTable({
                startY: startY + 5,
                head: [['Date', 'Credit Sale', 'Cash Sale', 'Profit', 'Delivery Charges', 'Total']],
                body: sortedRows.map((row) => [
                    formatFinancialReportDate(row.report_date),
                    formatFinancialReportCurrency(row.credit_sale || 0),
                    formatFinancialReportCurrency(row.cash_sale || 0),
                    formatFinancialReportCurrency(row.profit || 0),
                    formatFinancialReportCurrency(row.delivery_charges || 0),
                    formatFinancialReportCurrency(row.total || 0)
                ]).concat([[
                    'TOTAL',
                    formatFinancialReportCurrency(data.summary?.total_credit_sale || 0),
                    formatFinancialReportCurrency(data.summary?.total_cash_sale || 0),
                    formatFinancialReportCurrency(data.summary?.total_profit || 0),
                    formatFinancialReportCurrency(data.summary?.total_delivery_charges || 0),
                    formatFinancialReportCurrency(data.summary?.grand_total || 0)
                ]]),
                theme: 'grid',
                styles: { fontSize: 8 }
            });
        } else if (data.type === 'periodic_comprehensive_summary_report') {
            const sortedRows = [...(data.rows || [])].sort((a, b) => getFinancialReportSortTime(b.report_date) - getFinancialReportSortTime(a.report_date));
            doc.text('Periodic Comprehensive Summary Report', 14, startY);
            if (data.summary) {
                const netPosition = Number((
                    Number(data.summary.total_sale || 0) +
                    Number(data.summary.total_delivery_charges || 0) -
                    Number(data.summary.total_expense || 0) -
                    Number(data.summary.total_fuel || 0)
                ).toFixed(2));
                doc.setFontSize(10);
                doc.text(
                    `Sale: ${formatFinancialReportCurrency(data.summary.total_sale || 0)} | Credit: ${formatFinancialReportCurrency(data.summary.total_credit_sale || 0)} | Cash: ${formatFinancialReportCurrency(data.summary.total_cash_sale || 0)} | Delivery: ${formatFinancialReportCurrency(data.summary.total_delivery_charges || 0)} | Expense: ${formatFinancialReportCurrency(data.summary.total_expense || 0)} | Fuel: ${formatFinancialReportCurrency(data.summary.total_fuel || 0)} | Net: ${formatFinancialReportCurrency(netPosition)}`,
                    14,
                    startY + 5
                );
                startY += 10;
            }
            doc.autoTable({
                startY: startY + 5,
                head: [['Date', 'Total Sale', 'Credit Sale', 'Cash Sale', 'Delivery Charges', 'Expense', 'Fuel']],
                body: sortedRows.map((row) => [
                    formatFinancialReportDate(row.report_date),
                    formatFinancialReportCurrency(row.total_sale || 0),
                    formatFinancialReportCurrency(row.credit_sale || 0),
                    formatFinancialReportCurrency(row.cash_sale || 0),
                    formatFinancialReportCurrency(row.delivery_charges || 0),
                    formatFinancialReportCurrency(row.expense || 0),
                    formatFinancialReportCurrency(row.fuel || 0)
                ]).concat([[
                    'TOTAL',
                    formatFinancialReportCurrency(data.summary?.total_sale || 0),
                    formatFinancialReportCurrency(data.summary?.total_credit_sale || 0),
                    formatFinancialReportCurrency(data.summary?.total_cash_sale || 0),
                    formatFinancialReportCurrency(data.summary?.total_delivery_charges || 0),
                    formatFinancialReportCurrency(data.summary?.total_expense || 0),
                    formatFinancialReportCurrency(data.summary?.total_fuel || 0)
                ]]),
                theme: 'grid',
                styles: { fontSize: 8 }
            });
        } else if (data.type === 'periodic_store_payments_balance_report') {
            const sortedRows = [...(data.rows || [])].sort((a, b) => {
                const termCompare = String(a.payment_term || '').localeCompare(String(b.payment_term || ''));
                if (termCompare !== 0) return termCompare;
                return String(a.store_name || '').localeCompare(String(b.store_name || ''));
            });
            doc.text('Periodic Store Payments & Balance Report', 14, startY);
            if (data.summary) {
                doc.setFontSize(10);
                doc.text(
                    `Generated Payable: ${formatFinancialReportCurrency(data.summary.total_generated_payable || 0)} | Paid Settlements: ${formatFinancialReportCurrency(data.summary.total_paid_amount || 0)} | Balance: ${formatFinancialReportCurrency(data.summary.total_balance_amount || 0)}`,
                    14,
                    startY + 5
                );
                startY += 10;
            }
            doc.autoTable({
                startY: startY + 5,
                head: [['Store', 'Payment Term', 'Generated Payable', 'Paid Settlements', 'Balance']],
                body: sortedRows.map((row) => [
                    row.store_name || '-',
                    row.payment_term || '-',
                    formatFinancialReportCurrency(row.generated_payable || 0),
                    formatFinancialReportCurrency(row.paid_amount || 0),
                    formatFinancialReportCurrency(row.balance_amount || 0)
                ]).concat([[
                    'TOTAL',
                    '',
                    formatFinancialReportCurrency(data.summary?.total_generated_payable || 0),
                    formatFinancialReportCurrency(data.summary?.total_paid_amount || 0),
                    formatFinancialReportCurrency(data.summary?.total_balance_amount || 0)
                ]]),
                theme: 'grid',
                styles: { fontSize: 8 }
            });
        } else if (data.type === 'store_payable_reconciliation' || data.type === 'unsettled_amounts_report') {
            doc.text('Store Payable Reconciliation', 14, startY);
            if (data.summary) {
                doc.setFontSize(10);
                doc.text(
                    `Generated: Rs ${parseFloat(data.summary.period_generated_payable || 0).toFixed(2)} | Settled: Rs ${parseFloat(data.summary.period_paid_settlements || 0).toFixed(2)} | Flow: Rs ${parseFloat(data.summary.period_flow || 0).toFixed(2)} | Outstanding: Rs ${parseFloat(data.summary.current_outstanding || 0).toFixed(2)}`,
                    14,
                    startY + 5
                );
                startY += 10;
            }
            doc.autoTable({
                startY: startY + 5,
                head: [['Store', 'Generated (Period)', 'Settled (Period)', 'Period Flow', 'Current Outstanding']],
                body: (data.rows || []).map(r => [
                    r.store_name || '-',
                    `Rs ${parseFloat(r.period_generated_payable || 0).toFixed(2)}`,
                    `Rs ${parseFloat(r.period_paid_settlements || 0).toFixed(2)}`,
                    `Rs ${parseFloat(r.period_flow || 0).toFixed(2)}`,
                    `Rs ${parseFloat(r.current_outstanding || 0).toFixed(2)}`
                ]),
                theme: 'grid',
                styles: { fontSize: 8 }
            });
            if (data.type === 'unsettled_amounts_report' && Array.isArray(data.order_rows) && data.order_rows.length > 0) {
                const afterY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : startY + 30;
                doc.text('Order-wise Unsettled (Descending)', 14, afterY);
                doc.autoTable({
                    startY: afterY + 4,
                    head: [['Order #', 'Date', 'Store', 'Unsettled Amount']],
                    body: data.order_rows.map(o => [
                        o.order_number || '-',
                        o.order_date ? new Date(o.order_date).toLocaleDateString() : '-',
                        o.store_name || '-',
                        `Rs ${parseFloat(o.unsettled_amount || 0).toFixed(2)}`
                    ]),
                    theme: 'grid',
                    styles: { fontSize: 7 }
                });
            }
        } else if (data.type === 'cash_discrepancy_report') {
            doc.text('Cash Discrepancy Report', 14, startY);
            if (data.summary) {
                doc.setFontSize(10);
                doc.text(
                    `Orders: ${parseInt(data.summary.total_orders || 0)} | Store Gross: Rs ${parseFloat(data.summary.store_gross || 0).toFixed(2)} | Store Payable: Rs ${parseFloat(data.summary.store_payable || 0).toFixed(2)} | Share: Rs ${parseFloat(data.summary.servenow_share || 0).toFixed(2)} | Collected: Rs ${parseFloat(data.summary.rider_collected_cash || 0).toFixed(2)} | Submitted: Rs ${parseFloat(data.summary.rider_submitted_cash || 0).toFixed(2)} | Gap: Rs ${parseFloat(data.summary.cash_gap || 0).toFixed(2)}`,
                    14,
                    startY + 5
                );
                startY += 10;
            }
            doc.autoTable({
                startY: startY + 5,
                head: [['Order #', 'Date', 'Store', 'Store Gross', 'Store Payable', 'ServeNow Share', 'Collected', 'Submitted', 'Gap']],
                body: (data.details || []).map(d => [
                    d.order_number || '-',
                    d.order_date ? new Date(d.order_date).toLocaleDateString() : '-',
                    d.store_name || '-',
                    `Rs ${parseFloat(d.store_gross || 0).toFixed(2)}`,
                    `Rs ${parseFloat(d.store_payable || 0).toFixed(2)}`,
                    `Rs ${parseFloat(d.servenow_share || 0).toFixed(2)}`,
                    `Rs ${parseFloat(d.rider_collected_cash || 0).toFixed(2)}`,
                    `Rs ${parseFloat(d.rider_submitted_cash || 0).toFixed(2)}`,
                    `Rs ${parseFloat(d.cash_gap || 0).toFixed(2)}`
                ]),
                theme: 'grid',
                styles: { fontSize: 7 }
            });

            const riderCashMap = {};
            (data.details || []).forEach((d) => {
                const riderKey = (d.rider_name || '-').trim() || '-';
                if (!riderCashMap[riderKey]) {
                    riderCashMap[riderKey] = {
                        rider_name: riderKey,
                        orders: 0,
                        collected: 0,
                        submitted: 0
                    };
                }
                riderCashMap[riderKey].orders += 1;
                riderCashMap[riderKey].collected += parseFloat(d.rider_collected_cash || 0);
                riderCashMap[riderKey].submitted += parseFloat(d.rider_submitted_cash || 0);
            });
            const riderRows = Object.values(riderCashMap).map((r) => ({
                ...r,
                gap: Number((r.collected - r.submitted).toFixed(2)),
                collected: Number(r.collected.toFixed(2)),
                submitted: Number(r.submitted.toFixed(2))
            }));
            if (riderRows.length) {
                const riderY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : startY + 30;
                doc.text('Rider Cash Summary', 14, riderY);
                doc.autoTable({
                    startY: riderY + 4,
                    head: [['Rider', 'Orders', 'Collected', 'Submitted', 'Gap']],
                    body: riderRows.map((r) => [
                        r.rider_name,
                        r.orders,
                        `Rs ${parseFloat(r.collected || 0).toFixed(2)}`,
                        `Rs ${parseFloat(r.submitted || 0).toFixed(2)}`,
                        `Rs ${parseFloat(r.gap || 0).toFixed(2)}`
                    ]),
                    theme: 'grid',
                    styles: { fontSize: 7 }
                });
            }

            if (Array.isArray(data.daily_totals) && data.daily_totals.length) {
                const afterY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : startY + 30;
                doc.text('Daily Totals', 14, afterY);
                doc.autoTable({
                    startY: afterY + 4,
                    head: [['Date', 'Orders', 'Store Gross', 'Store Payable', 'Share', 'Collected', 'Submitted', 'Fuel Paid', 'Software Cash']],
                    body: data.daily_totals.map(d => [
                        d.period || '-',
                        parseInt(d.total_orders || 0),
                        `Rs ${parseFloat(d.store_gross || 0).toFixed(2)}`,
                        `Rs ${parseFloat(d.store_payable || 0).toFixed(2)}`,
                        `Rs ${parseFloat(d.servenow_share || 0).toFixed(2)}`,
                        `Rs ${parseFloat(d.rider_collected_cash || 0).toFixed(2)}`,
                        `Rs ${parseFloat(d.rider_submitted_cash || 0).toFixed(2)}`,
                        `Rs ${parseFloat(d.fuel_paid || 0).toFixed(2)}`,
                        `Rs ${parseFloat(d.software_cash_estimate || 0).toFixed(2)}`
                    ]),
                    theme: 'grid',
                    styles: { fontSize: 7 }
                });
            }
        } else if (data.type === 'store_order_settlement_report') {
            doc.text('Store Order Settlement Report', 14, startY);
            if (data.summary) {
                doc.setFontSize(10);
                doc.text(
                    `Stores: ${parseInt(data.summary.total_stores || 0)} | Orders: ${parseInt(data.summary.total_orders || 0)} | Expected: Rs ${parseFloat(data.summary.expected_payable || 0).toFixed(2)} | Paid: Rs ${parseFloat(data.summary.paid_settlement_amount || 0).toFixed(2)} | Unsettled: Rs ${parseFloat(data.summary.unsettled_amount || 0).toFixed(2)} | Discrepancy: Rs ${parseFloat(data.summary.discrepancy || 0).toFixed(2)}`,
                    14,
                    startY + 5
                );
                startY += 10;
            }

            if (Array.isArray(data.store_rows) && data.store_rows.length) {
                doc.autoTable({
                    startY: startY + 5,
                    head: [['Store', 'Orders', 'Gross Sales', 'Expected Payable', 'Paid', 'Unsettled', 'Discrepancy']],
                    body: data.store_rows.map((r) => [
                        r.store_name || '-',
                        parseInt(r.total_orders || 0),
                        `Rs ${parseFloat(r.gross_sales || 0).toFixed(2)}`,
                        `Rs ${parseFloat(r.expected_payable || 0).toFixed(2)}`,
                        `Rs ${parseFloat(r.paid_settlement_amount || 0).toFixed(2)}`,
                        `Rs ${parseFloat(r.unsettled_amount || 0).toFixed(2)}`,
                        `Rs ${parseFloat(r.discrepancy || 0).toFixed(2)}`
                    ]),
                    theme: 'grid',
                    styles: { fontSize: 7 }
                });
            }

            if (Array.isArray(data.order_rows) && data.order_rows.length) {
                const afterY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : startY + 30;
                doc.text('Order-wise Settlement Details', 14, afterY);
                doc.autoTable({
                    startY: afterY + 4,
                    head: [['Order #', 'Date', 'Store', 'Gross', 'Expected', 'Paid', 'Unsettled', 'Discrepancy', 'Settlement #', 'Status']],
                    body: data.order_rows.map((r) => [
                        r.order_number || '-',
                        r.order_date ? new Date(r.order_date).toLocaleDateString() : '-',
                        r.store_name || '-',
                        `Rs ${parseFloat(r.gross_sales || 0).toFixed(2)}`,
                        `Rs ${parseFloat(r.expected_payable || 0).toFixed(2)}`,
                        `Rs ${parseFloat(r.paid_settlement_amount || 0).toFixed(2)}`,
                        `Rs ${parseFloat(r.unsettled_amount || 0).toFixed(2)}`,
                        `Rs ${parseFloat(r.discrepancy || 0).toFixed(2)}`,
                        r.settlement_numbers || '-',
                        r.settlement_statuses || '-'
                    ]),
                    theme: 'grid',
                    styles: { fontSize: 6.5 }
                });
            }
        } else if (data.type === 'general_voucher') {
            doc.text('Journal Vouchers', 14, startY);
            doc.autoTable({
                startY: startY + 5,
                head: [['Voucher #', 'Date', 'Description', 'Amount', 'Ref']],
                body: data.vouchers.map(v => [
                    v.voucher_number,
                    new Date(v.voucher_date).toLocaleDateString(),
                    v.description || '',
                    `Rs ${parseFloat(v.total_amount).toFixed(2)}`,
                    v.reference_number || ''
                ]),
                theme: 'grid',
                styles: { fontSize: 8 }
            });
        } else if (data.type === 'rider_fuel' || data.type === 'rider_petrol') {
            doc.text('Rider Fuel History', 14, startY);
            
            // Summary for Fuel
            if (data.summary) {
                doc.setFontSize(10);
                doc.text(`Total Distance: ${data.summary.total_distance} km | Total Cost: Rs ${parseFloat(data.summary.total_cost).toFixed(2)}`, 14, startY + 5);
                startY += 10;
            }

            const riderFuelGroups = groupRiderFuelEntries(data.entries || []);
            if (riderFuelGroups.length) {
                let fuelY = startY + 5;
                riderFuelGroups.forEach((group, index) => {
                    if (index > 0) {
                        fuelY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 10 : fuelY + 30;
                    }
                    doc.setFontSize(10);
                    doc.text(
                        `${group.rider_name} | Distance: ${group.total_distance.toFixed(2)} km | Cost: ${formatFinancialReportCurrency(group.total_cost)}`,
                        14,
                        fuelY
                    );
                    doc.autoTable({
                        startY: fuelY + 4,
                        head: [['Date', 'Start', 'End', 'Dist', 'Rate', 'Cost', 'Notes']],
                        body: group.entries.map(e => [
                            formatFinancialReportDate(e.entry_date),
                            e.start_meter || '-',
                            e.end_meter || '-',
                            e.distance || '0',
                            e.petrol_rate || '-',
                            formatFinancialReportCurrency(e.fuel_cost || 0),
                            e.notes || ''
                        ]),
                        theme: 'grid',
                        styles: { fontSize: 8 }
                    });
                });
            }
        } else if (data.type === 'rider_daily_mileage') {
            doc.text('Rider Daily Mileage Report', 14, startY);
            if (data.summary) {
                doc.setFontSize(10);
                doc.text(
                    `Days: ${data.summary.total_days_logged} | Distance: ${parseFloat(data.summary.total_distance || 0).toFixed(2)} km | Fuel: Rs ${parseFloat(data.summary.total_fuel_cost || 0).toFixed(2)}`,
                    14,
                    startY + 5
                );
                startY += 10;
            }
            doc.autoTable({
                startY: startY + 5,
                head: [['Date', 'Rider', 'Trips', 'Distance (km)', 'Fuel Cost']],
                body: (data.rows || []).map(r => [
                    new Date(r.mileage_date).toLocaleDateString(),
                    r.rider_name || '-',
                    r.trips_logged || 0,
                    parseFloat(r.total_distance || 0).toFixed(2),
                    `Rs ${parseFloat(r.total_fuel_cost || 0).toFixed(2)}`
                ]),
                theme: 'grid',
                styles: { fontSize: 8 }
            });
        } else if (data.type === 'rider_daily_activity') {
            doc.text('Rider Daily Activity Report', 14, startY);
            if (data.summary) {
                doc.setFontSize(10);
                doc.text(
                    `Orders: ${data.summary.total_orders} | Stores: ${data.summary.total_stores_served} | Cash Collected: Rs ${parseFloat(data.summary.total_cash_collected || 0).toFixed(2)} | Paid to Cash-only Stores: Rs ${parseFloat(data.summary.total_paid_to_cash_only_stores || 0).toFixed(2)} | Cash-only Profit: Rs ${parseFloat(data.summary.total_cash_only_profit || 0).toFixed(2)}`,
                    14,
                    startY + 5
                );
                startY += 12;
            }
            doc.autoTable({
                startY: startY + 5,
                head: [['Order #', 'Date', 'Status', 'Stores', 'Cash Collected', 'Paid to Cash-only Stores', 'Cash-only Profit']],
                body: (data.orders || []).map(o => [
                    o.order_number || '-',
                    new Date(o.created_at).toLocaleDateString(),
                    o.status || '-',
                    o.stores_count || 0,
                    `Rs ${parseFloat(o.cash_collected || 0).toFixed(2)}`,
                    `Rs ${parseFloat(o.paid_to_cash_only_stores || 0).toFixed(2)}`,
                    `Rs ${parseFloat(o.cash_only_profit || 0).toFixed(2)}`
                ]),
                theme: 'grid',
                styles: { fontSize: 7 }
            });
        } else if (data.type === 'rider_day_closing') {
            doc.text('Rider Day Closing Report', 14, startY);
            if (data.summary) {
                doc.setFontSize(10);
                doc.text(
                    `Days: ${data.summary.days} | Taken: Rs ${parseFloat(data.summary.taken_total || 0).toFixed(2)} | Given: Rs ${parseFloat(data.summary.given_total || 0).toFixed(2)} | Net In Hand: Rs ${parseFloat(data.summary.net_in_hand || 0).toFixed(2)}`,
                    14,
                    startY + 5
                );
                startY += 12;
            }
            doc.autoTable({
                startY: startY + 5,
                head: [['Date', 'Rider', 'Cash Collected', 'Advance', 'Settlement', 'Store Pay', 'Fuel', 'Submit', 'Taken', 'Given', 'Net']],
                body: (data.rows || []).map(r => [
                    new Date(r.closing_date).toLocaleDateString(),
                    r.rider_name || '-',
                    `Rs ${parseFloat(r.cash_collection || 0).toFixed(2)}`,
                    `Rs ${parseFloat(r.office_advance || 0).toFixed(2)}`,
                    `Rs ${parseFloat(r.office_settlement || 0).toFixed(2)}`,
                    `Rs ${parseFloat(r.store_payment || 0).toFixed(2)}`,
                    `Rs ${parseFloat(r.fuel_payment || 0).toFixed(2)}`,
                    `Rs ${parseFloat(r.cash_submission || 0).toFixed(2)}`,
                    `Rs ${parseFloat(r.taken_total || 0).toFixed(2)}`,
                    `Rs ${parseFloat(r.given_total || 0).toFixed(2)}`,
                    `Rs ${parseFloat(r.net_in_hand || 0).toFixed(2)}`
                ]),
                theme: 'grid',
                styles: { fontSize: 7 }
            });
        } else if (data.type === 'order_profit') {
            doc.text('Order Profit Report', 14, startY);
            if (data.summary) {
                doc.setFontSize(10);
                doc.text(
                    `Orders: ${data.summary.total_orders} | Bill: Rs ${parseFloat(data.summary.bill_total || 0).toFixed(2)} | Delivery: Rs ${parseFloat(data.summary.delivery_fee || 0).toFixed(2)} | Item Profit: Rs ${parseFloat(data.summary.item_profit || 0).toFixed(2)} | Overall Profit: Rs ${parseFloat(data.summary.overall_profit || 0).toFixed(2)} | Paid to Store: Rs ${parseFloat(data.summary.paid_to_store || 0).toFixed(2)}`,
                    14,
                    startY + 5
                );
                startY += 12;
            }
            doc.autoTable({
                startY: startY + 5,
                head: [['Order #', 'Date', 'Bill Total', 'Delivery Fee', 'Item Profit', 'Overall Profit', 'Paid to Store', 'Expected Store Pay']],
                body: (data.orders || []).map(o => [
                    o.order_number || '-',
                    new Date(o.created_at).toLocaleDateString(),
                    `Rs ${parseFloat(o.bill_total || 0).toFixed(2)}`,
                    `Rs ${parseFloat(o.delivery_fee || 0).toFixed(2)}`,
                    `Rs ${parseFloat(o.item_profit || 0).toFixed(2)}`,
                    `Rs ${parseFloat(o.overall_profit || 0).toFixed(2)}`,
                    `Rs ${parseFloat(o.paid_to_store || 0).toFixed(2)}`,
                    `Rs ${parseFloat(o.paid_to_store_expected || 0).toFixed(2)}`
                ]),
                theme: 'grid',
                styles: { fontSize: 7 }
            });
        } else if (data.type === 'expense_report') {
            doc.text('Expense Report', 14, startY);
            if (data.summary) {
                doc.setFontSize(10);
                doc.text(
                    `Entries: ${data.summary.total_count || 0} | Recorded: Rs ${parseFloat(data.summary.total_recorded || 0).toFixed(2)} | Paid: Rs ${parseFloat(data.summary.total_paid || 0).toFixed(2)}`,
                    14,
                    startY + 5
                );
                startY += 12;
            }
            doc.autoTable({
                startY: startY + 5,
                head: [['Ref #', 'Date', 'Category', 'Description', 'Method', 'Vendor', 'Status', 'Amount']],
                body: (data.expenses || []).map(e => [
                    e.expense_number || e.transaction_number || '-',
                    e.expense_date ? new Date(e.expense_date).toLocaleDateString() : '-',
                    e.category || '-',
                    e.description || '-',
                    e.payment_method || '-',
                    e.vendor_name || e.entity_name || '-',
                    e.status || '-',
                    `Rs ${parseFloat(e.amount || 0).toFixed(2)}`
                ]),
                theme: 'grid',
                styles: { fontSize: 7 }
            });
        } else if (data.type === 'comprehensive_report') {
            doc.text('Comprehensive Transaction Report', 14, startY);
            
            // Add Summary Table at Top for Clarity
            if (data.summary) {
                const deliveryFees = parseFloat(data.summary.total_delivery_fees || 0);
                const itemSales = parseFloat(data.summary.total_item_sales_net || 0);
                const storeComm = parseFloat(data.summary.total_store_commission || 0);
                const settledPaid = parseFloat(data.summary.total_store_settlement_paid || 0);
                const totalIn = deliveryFees + itemSales;
                const netProfit = deliveryFees + storeComm;
                const grossPayable = parseFloat(data.summary.gross_store_payable || (itemSales - storeComm));
                const periodFlow = parseFloat(data.summary.period_store_payable_flow || (grossPayable - settledPaid));
                const outstandingPayable = Math.max(0, parseFloat(data.summary.current_outstanding_store_payable || 0));

                doc.autoTable({
                    startY: startY + 5,
                    head: [['Metric', 'Amount', 'Metric', 'Amount']],
                    body: [
                        ['Delivery Fees', `Rs ${deliveryFees.toFixed(2)}`, 'Item Sales (Net)', `Rs ${itemSales.toFixed(2)}`],
                        ['Store Commission', `Rs ${storeComm.toFixed(2)}`, 'Net Profit', `Rs ${netProfit.toFixed(2)}`],
                        ['Store Settled (Paid)', `Rs ${settledPaid.toFixed(2)}`, 'Period Store Flow', `Rs ${periodFlow.toFixed(2)}`],
                        ['Total Cash In', `Rs ${totalIn.toFixed(2)}`, 'Current Outstanding', `Rs ${outstandingPayable.toFixed(2)}`],
                        ['Gross Payable', `Rs ${grossPayable.toFixed(2)}`, '', '']
                    ],
                    theme: 'grid',
                    styles: { fontSize: 9 },
                    headStyles: { fillColor: [41, 128, 185] }
                });
                startY = doc.lastAutoTable.finalY + 10;
            }

            doc.autoTable({
                startY: startY + 5,
                head: [['Date', 'Ref #', 'Type', 'Entity', 'Cat', 'In', 'Out', 'Desc']],
                body: data.transactions.map(t => [
                    new Date(t.created_at).toLocaleDateString(),
                    t.transaction_number,
                    t.transaction_type.toUpperCase(),
                    t.entity_name || t.related_entity_type || '-',
                    t.category || '-',
                    (t.transaction_type === 'income' || t.transaction_type === 'refund') ? `Rs ${parseFloat(t.amount).toFixed(2)}` : '-',
                    (t.transaction_type === 'expense' || t.transaction_type === 'settlement') ? `Rs ${parseFloat(t.amount).toFixed(2)}` : '-',
                    t.description || ''
                ]),
                theme: 'grid',
                styles: { fontSize: 7, cellPadding: 2 }
            });
        } else if (data.type === 'transaction_summary') {
            doc.text('Transaction Summary Report', 14, startY);
            
            // Summary Table
            if (data.summary) {
                doc.autoTable({
                    startY: startY + 5,
                    head: [['Metric', 'Amount', 'Metric', 'Amount']],
                    body: [
                        ['Total Income', `Rs ${parseFloat(data.summary.total_income).toFixed(2)}`, 'Total Expense', `Rs ${parseFloat(data.summary.total_expense).toFixed(2)}`],
                        ['Total Settlements', `Rs ${parseFloat(data.summary.total_settlements).toFixed(2)}`, 'Total Refunds', `Rs ${parseFloat(data.summary.total_refunds).toFixed(2)}`],
                        ['Net Cash Flow', `Rs ${parseFloat(data.summary.net_cash_flow).toFixed(2)}`, 'Total Adjustments', `Rs ${parseFloat(data.summary.total_adjustments).toFixed(2)}`]
                    ],
                    theme: 'grid',
                    styles: { fontSize: 9 },
                    headStyles: { fillColor: [41, 128, 185] }
                });
                startY = doc.lastAutoTable.finalY + 10;
            }

            doc.autoTable({
                startY: startY + 5,
                head: [['Date', 'Ref #', 'Type', 'Entity', 'In', 'Out', 'Desc']],
                body: data.transactions.map(t => {
                    const income = (t.transaction_type === 'income' || t.transaction_type === 'refund') ? parseFloat(t.amount || 0) : 0;
                    const expense = (t.transaction_type === 'expense' || t.transaction_type === 'settlement') ? parseFloat(t.amount || 0) : 0;
                    return [
                        new Date(t.created_at).toLocaleDateString(),
                        t.transaction_number,
                        t.transaction_type.toUpperCase(),
                        t.entity_name || t.related_entity_type || '-',
                        income > 0 ? `Rs ${income.toFixed(2)}` : '-',
                        expense > 0 ? `Rs ${expense.toFixed(2)}` : '-',
                        t.description || ''
                    ];
                }),
                theme: 'grid',
                styles: { fontSize: 7, cellPadding: 2 }
            });
        }
    }

    doc.save(`Report_${report.report_number}.pdf`);
}

function viewReport(reportId) {
    const report = currentReports.find(r => r.id === reportId);
    if (!report) return;

    let data;
    try {
        data = typeof report.data === 'string' ? JSON.parse(report.data) : report.data;
    } catch (e) {
        data = null;
    }

    let extraDetails = '';
    if (data && data.type === 'rider_cash') {
        extraDetails = '<h3>Rider Cash Movements</h3><div class="report-detail-table-wrapper"><table class="report-detail-table"><thead><tr><th>Order #</th><th>Rider</th><th>Date</th><th>Type</th><th>Amount</th></tr></thead><tbody>';
        data.movements.forEach(m => {
            extraDetails += `<tr><td>${m.order_number || '-'}</td><td>${m.first_name} ${m.last_name}</td><td>${new Date(m.movement_date).toLocaleDateString()}</td><td>${m.movement_type}</td><td>Rs  ${parseFloat(m.amount).toFixed(2)}</td></tr>`;
        });
        extraDetails += '</tbody></table></div>';
        if (data.kpis) {
            extraDetails += `<div style="margin-top: 10px;"><strong>Total Income:</strong> Rs ${parseFloat(data.kpis.total_income || 0).toFixed(2)} | <strong>Total Orders:</strong> ${parseInt(data.kpis.total_orders || 0)} | <strong>Total Delivery Charges:</strong> Rs ${parseFloat(data.kpis.total_delivery_charges || 0).toFixed(2)}</div>`;
        }
    } else if (data && data.type === 'rider_orders') {
        extraDetails = '<h3>Rider Orders Report</h3><div class="report-detail-table-wrapper"><table class="report-detail-table"><thead><tr><th>Order #</th><th>Date</th><th>Rider</th><th>Customer</th><th>Status</th><th>Payment</th><th>Amount</th><th>Delivery</th></tr></thead><tbody>';
        (data.orders || []).forEach(o => {
            extraDetails += `<tr>
                <td>${o.order_number}</td>
                <td>${new Date(o.created_at).toLocaleDateString()}</td>
                <td>${o.rider_name || '-'}</td>
                <td>${o.customer_name || '-'}</td>
                <td>${o.status || '-'}</td>
                <td>${o.payment_method || '-'} / ${o.payment_status || '-'}</td>
                <td>Rs ${parseFloat(o.total_amount || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(o.delivery_fee || 0).toFixed(2)}</td>
            </tr>`;
        });
        extraDetails += '</tbody></table></div>';
        if (data.summary) {
            extraDetails += `<div style="margin-top: 10px;"><strong>Total:</strong> ${data.summary.total_orders} | <strong>Delivered:</strong> ${data.summary.delivered_orders} | <strong>Active:</strong> ${data.summary.active_orders} | <strong>Cancelled:</strong> ${data.summary.cancelled_orders}</div>`;
        }
    } else if (data && data.type === 'rider_payments') {
        extraDetails = '<h3>Rider Payments Report</h3><div class="report-detail-table-wrapper"><table class="report-detail-table"><thead><tr><th>Order #</th><th>Rider</th><th>Date</th><th>Type</th><th>Amount</th><th>Status</th><th>Description</th></tr></thead><tbody>';
        (data.entries || []).forEach(e => {
            extraDetails += `<tr>
                <td>${e.first_name || ''} ${e.last_name || ''}</td>
                <td>${new Date(e.movement_date).toLocaleDateString()}</td>
                <td>${e.movement_type || '-'}</td>
                <td>Rs ${parseFloat(e.amount || 0).toFixed(2)}</td>
                <td>${e.status || '-'}</td>
                <td>${e.description || ''}</td>
            </tr>`;
        });
        extraDetails += '</tbody></table></div>';
    } else if (data && data.type === 'rider_receivings') {
        extraDetails = '<h3>Rider Receivings Report</h3><div class="report-detail-table-wrapper"><table class="report-detail-table"><thead><tr><th>Order #</th><th>Rider</th><th>Date</th><th>Type</th><th>Amount</th><th>Status</th><th>Description</th></tr></thead><tbody>';
        (data.entries || []).forEach(e => {
            extraDetails += `<tr>
                <td>${e.first_name || ''} ${e.last_name || ''}</td>
                <td>${new Date(e.movement_date).toLocaleDateString()}</td>
                <td>${e.movement_type || '-'}</td>
                <td>Rs ${parseFloat(e.amount || 0).toFixed(2)}</td>
                <td>${e.status || '-'}</td>
                <td>${e.description || ''}</td>
            </tr>`;
        });
        extraDetails += '</tbody></table></div>';
    } else if (data && data.type === 'rider_wallet') {
        extraDetails = '<h3>Rider Wallet Summary</h3><div class="report-detail-table-wrapper"><table class="report-detail-table"><thead><tr><th>Rider</th><th>Current Balance</th><th>Credit Total</th><th>Debit Total</th><th>Net Credit-Debit</th><th>Refunds</th><th>Transfers</th><th>Entries</th></tr></thead><tbody>';
        (data.wallet_summary || []).forEach(r => {
            extraDetails += `<tr>
                <td>${r.rider_name || '-'}</td>
                <td>Rs ${parseFloat(r.current_balance || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(r.credits || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(r.debits || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(r.net_credit_debit || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(r.refunds || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(r.transfers || 0).toFixed(2)}</td>
                <td>${parseInt(r.entries || 0)}</td>
            </tr>`;
        });
        extraDetails += '</tbody></table></div>';
        if (data.summary) {
            extraDetails += `<div style="margin-top: 10px;">
                <strong>Wallets:</strong> ${parseInt(data.summary.total_wallets || 0)} |
                <strong>Current Balance:</strong> Rs ${parseFloat(data.summary.total_current_balance || 0).toFixed(2)} |
                <strong>Credit Total:</strong> Rs ${parseFloat(data.summary.total_credits || 0).toFixed(2)} |
                <strong>Debit Total:</strong> Rs ${parseFloat(data.summary.total_debits || 0).toFixed(2)} |
                <strong>Net Credit-Debit:</strong> Rs ${parseFloat(data.summary.total_net_credit_debit || 0).toFixed(2)} |
                <strong>Entries:</strong> ${parseInt(data.summary.total_entries || 0)}
            </div>`;
        }
        const creditEntries = (data.entries || []).filter(e => e.type === 'credit');
        const debitEntries = (data.entries || []).filter(e => e.type === 'debit');
        const renderWalletRows = (entries, amountLabel) => {
            if (!entries.length) {
                return `<tr><td colspan="6" style="text-align:center;">No ${amountLabel.toLowerCase()} transactions found</td></tr>`;
            }
            return entries.map(e => `
            <tr>
                <td>${e.created_at ? new Date(e.created_at).toLocaleString() : '-'}</td>
                <td>${e.rider_name || `${e.first_name || ''} ${e.last_name || ''}`}</td>
                <td>Rs ${parseFloat(e.amount || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(e.balance_after || 0).toFixed(2)}</td>
                <td>${e.reference_type || '-'} ${e.reference_id || ''}</td>
                <td>${e.description || '-'}</td>
            </tr>`).join('');
        };

        extraDetails += '<h3 style="margin-top:14px;">Credit Transactions</h3><div class="report-detail-table-wrapper"><table class="report-detail-table"><thead><tr><th>Date</th><th>Rider</th><th>Credit</th><th>Balance After</th><th>Reference</th><th>Description</th></tr></thead><tbody>';
        extraDetails += renderWalletRows(creditEntries, 'Credit');
        extraDetails += '</tbody></table></div>';

        extraDetails += '<h3 style="margin-top:14px;">Debit Transactions</h3><div class="report-detail-table-wrapper"><table class="report-detail-table"><thead><tr><th>Date</th><th>Rider</th><th>Debit</th><th>Balance After</th><th>Reference</th><th>Description</th></tr></thead><tbody>';
        extraDetails += renderWalletRows(debitEntries, 'Debit');
        extraDetails += '</tbody></table></div>';
    } else if (data && data.type === 'store_financials') {
        extraDetails = '<h3>Store Financials</h3><div class="report-detail-table-wrapper"><table class="report-detail-table"><thead><tr><th>Store</th><th>Sales</th><th>Cost</th><th>Profit</th></tr></thead><tbody>';
        data.stores.forEach(s => {
            extraDetails += `<tr><td>${s.store_name}</td><td>Rs  ${parseFloat(s.total_sales).toFixed(2)}</td><td>Rs  ${parseFloat(s.total_cost).toFixed(2)}</td><td>Rs  ${parseFloat(s.estimated_profit).toFixed(2)}</td></tr>`;
        });
        extraDetails += '</tbody></table></div>';
    } else if (data && data.type === 'general_voucher') {
        extraDetails = '<h3>Journal Vouchers</h3><div class="report-detail-table-wrapper"><table class="report-detail-table"><thead><tr><th>Voucher #</th><th>Date</th><th>Description</th><th>Amount</th></tr></thead><tbody>';
        data.vouchers.forEach(v => {
            extraDetails += `<tr><td>${v.voucher_number}</td><td>${new Date(v.voucher_date).toLocaleDateString()}</td><td>${v.description || '-'}</td><td>Rs  ${parseFloat(v.total_amount).toFixed(2)}</td></tr>`;
        });
        extraDetails += '</tbody></table></div>';
    } else if (data && (data.type === 'rider_fuel' || data.type === 'rider_petrol')) {
        extraDetails = '<h3>Rider Fuel History</h3>';
        const riderFuelGroups = groupRiderFuelEntries(data.entries || []);
        riderFuelGroups.forEach((group) => {
            extraDetails += renderFinancialReportTable(
                `${group.rider_name} | Distance: ${group.total_distance.toFixed(2)} km | Cost: ${formatFinancialReportCurrency(group.total_cost)}`,
                ['Date', 'Start', 'End', 'Distance', 'Rate', 'Cost', 'Notes'],
                group.entries.map((e) => [
                    formatFinancialReportDate(e.entry_date),
                    e.start_meter || '-',
                    e.end_meter || '-',
                    `${parseFloat(e.distance || 0).toFixed(2)} km`,
                    e.petrol_rate || '-',
                    formatFinancialReportCurrency(e.fuel_cost || 0),
                    e.notes || '-'
                ])
            );
        });
        if (data.summary) {
            extraDetails += `<div style="margin-top: 10px;"><strong>Total Distance:</strong> ${data.summary.total_distance} km | <strong>Total Cost:</strong> Rs  ${parseFloat(data.summary.total_cost).toFixed(2)}</div>`;
        }
    } else if (data && data.type === 'rider_daily_mileage') {
        extraDetails = '<h3>Rider Daily Mileage Report</h3><div class="report-detail-table-wrapper"><table class="report-detail-table"><thead><tr><th>Date</th><th>Rider</th><th>Trips</th><th>Distance (km)</th><th>Fuel Cost</th></tr></thead><tbody>';
        (data.rows || []).forEach(r => {
            extraDetails += `<tr>
                <td>${new Date(r.mileage_date).toLocaleDateString()}</td>
                <td>${r.rider_name || '-'}</td>
                <td>${r.trips_logged || 0}</td>
                <td>${parseFloat(r.total_distance || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(r.total_fuel_cost || 0).toFixed(2)}</td>
            </tr>`;
        });
        extraDetails += '</tbody></table></div>';
        if (data.summary) {
            extraDetails += `<div style="margin-top: 10px;"><strong>Days Logged:</strong> ${data.summary.total_days_logged} | <strong>Total Distance:</strong> ${parseFloat(data.summary.total_distance || 0).toFixed(2)} km | <strong>Total Fuel:</strong> Rs ${parseFloat(data.summary.total_fuel_cost || 0).toFixed(2)}</div>`;
        }
    } else if (data && data.type === 'rider_daily_activity') {
        extraDetails = '<h3>Rider Daily Activity Report</h3><div class="report-detail-table-wrapper"><table class="report-detail-table"><thead><tr><th>Order #</th><th>Date</th><th>Status</th><th>Stores</th><th>Cash Collected</th><th>Paid to Cash-only Stores</th><th>Cash-only Profit</th></tr></thead><tbody>';
        (data.orders || []).forEach(o => {
            extraDetails += `<tr>
                <td>${o.order_number || '-'}</td>
                <td>${new Date(o.created_at).toLocaleDateString()}</td>
                <td>${o.status || '-'}</td>
                <td>${o.stores_count || 0}</td>
                <td>Rs ${parseFloat(o.cash_collected || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(o.paid_to_cash_only_stores || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(o.cash_only_profit || 0).toFixed(2)}</td>
            </tr>`;
        });
        extraDetails += '</tbody></table></div>';
        if (data.summary) {
            extraDetails += `<div style="margin-top: 10px;"><strong>Total Orders:</strong> ${data.summary.total_orders} | <strong>Total Stores Served:</strong> ${data.summary.total_stores_served} | <strong>Cash Collected:</strong> Rs ${parseFloat(data.summary.total_cash_collected || 0).toFixed(2)} | <strong>Paid to Cash-only Stores:</strong> Rs ${parseFloat(data.summary.total_paid_to_cash_only_stores || 0).toFixed(2)} | <strong>Cash-only Profit:</strong> Rs ${parseFloat(data.summary.total_cash_only_profit || 0).toFixed(2)}</div>`;
        }
    } else if (data && data.type === 'rider_day_closing') {
        extraDetails = '<h3>Rider Day Closing Report</h3><div class="report-detail-table-wrapper"><table class="report-detail-table"><thead><tr><th>Date</th><th>Rider</th><th>Cash Collected</th><th>Advance</th><th>Settlement</th><th>Store Pay</th><th>Fuel</th><th>Submission</th><th>Taken</th><th>Given</th><th>Net In Hand</th></tr></thead><tbody>';
        (data.rows || []).forEach(r => {
            extraDetails += `<tr>
                <td>${new Date(r.closing_date).toLocaleDateString()}</td>
                <td>${r.rider_name || '-'}</td>
                <td>Rs ${parseFloat(r.cash_collection || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(r.office_advance || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(r.office_settlement || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(r.store_payment || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(r.fuel_payment || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(r.cash_submission || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(r.taken_total || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(r.given_total || 0).toFixed(2)}</td>
                <td><strong>Rs ${parseFloat(r.net_in_hand || 0).toFixed(2)}</strong></td>
            </tr>`;
        });
        extraDetails += '</tbody></table></div>';
        if (data.summary) {
            extraDetails += `<div style="margin-top: 10px;"><strong>Days:</strong> ${data.summary.days} | <strong>Taken:</strong> Rs ${parseFloat(data.summary.taken_total || 0).toFixed(2)} | <strong>Given:</strong> Rs ${parseFloat(data.summary.given_total || 0).toFixed(2)} | <strong>Net In Hand:</strong> Rs ${parseFloat(data.summary.net_in_hand || 0).toFixed(2)}</div>`;
        }
    } else if (data && data.type === 'order_profit') {
        extraDetails = '<h3>Order Profit Report</h3><div class="report-detail-table-wrapper"><table class="report-detail-table"><thead><tr><th>Order #</th><th>Date</th><th>Bill Total</th><th>Delivery Fee</th><th>Item Profit</th><th>Overall Profit</th><th>Paid to Store</th><th>Expected Store Pay</th></tr></thead><tbody>';
        (data.orders || []).forEach(o => {
            extraDetails += `<tr>
                <td>${o.order_number || '-'}</td>
                <td>${new Date(o.created_at).toLocaleDateString()}</td>
                <td>Rs ${parseFloat(o.bill_total || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(o.delivery_fee || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(o.item_profit || 0).toFixed(2)}</td>
                <td><strong>Rs ${parseFloat(o.overall_profit || 0).toFixed(2)}</strong></td>
                <td>Rs ${parseFloat(o.paid_to_store || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(o.paid_to_store_expected || 0).toFixed(2)}</td>
            </tr>`;
        });
        extraDetails += '</tbody></table></div>';
        if (data.summary) {
            extraDetails += `<div style="margin-top: 10px;"><strong>Total Orders:</strong> ${data.summary.total_orders} | <strong>Bill Total:</strong> Rs ${parseFloat(data.summary.bill_total || 0).toFixed(2)} | <strong>Delivery Fee:</strong> Rs ${parseFloat(data.summary.delivery_fee || 0).toFixed(2)} | <strong>Item Profit:</strong> Rs ${parseFloat(data.summary.item_profit || 0).toFixed(2)} | <strong>Overall Profit:</strong> Rs ${parseFloat(data.summary.overall_profit || 0).toFixed(2)} | <strong>Paid to Store:</strong> Rs ${parseFloat(data.summary.paid_to_store || 0).toFixed(2)}</div>`;
        }
    } else if (data && data.type === 'expense_report') {
        extraDetails = '<h3>Expense Report</h3><div class="report-detail-table-wrapper"><table class="report-detail-table"><thead><tr><th>Ref #</th><th>Date</th><th>Category</th><th>Description</th><th>Method</th><th>Vendor</th><th>Status</th><th>Amount</th></tr></thead><tbody>';
        (data.expenses || []).forEach(e => {
            extraDetails += `<tr>
                <td>${e.expense_number || e.transaction_number || '-'}</td>
                <td>${e.expense_date ? new Date(e.expense_date).toLocaleDateString() : '-'}</td>
                <td>${e.category || '-'}</td>
                <td>${e.description || '-'}</td>
                <td>${e.payment_method || '-'}</td>
                <td>${e.vendor_name || e.entity_name || '-'}</td>
                <td>${e.status || '-'}</td>
                <td>Rs ${parseFloat(e.amount || 0).toFixed(2)}</td>
            </tr>`;
        });
        extraDetails += '</tbody></table></div>';
        if (data.summary) {
            extraDetails += `<div style="margin-top: 10px;"><strong>Entries:</strong> ${data.summary.total_count || 0} | <strong>Recorded:</strong> Rs ${parseFloat(data.summary.total_recorded || 0).toFixed(2)} | <strong>Paid:</strong> Rs ${parseFloat(data.summary.total_paid || 0).toFixed(2)}</div>`;
        }
    } else if (data && data.type === 'store_settlement') {
        extraDetails = '<h3>Store Settlements</h3><div class="report-detail-table-wrapper"><table class="report-detail-table"><thead><tr><th>Settlement #</th><th>Date</th><th>Store</th><th>Amount</th><th>Comm.</th><th>Status</th></tr></thead><tbody>';
        if (data.settlements) {
            data.settlements.forEach(s => {
                extraDetails += `<tr>
                    <td>${s.settlement_number}</td>
                    <td>${new Date(s.settlement_date).toLocaleDateString()}</td>
                    <td>${s.store_name}</td>
                    <td>Rs  ${parseFloat(s.net_amount).toFixed(2)}</td>
                    <td>Rs  ${parseFloat(s.commissions).toFixed(2)}</td>
                    <td><span class="status-${s.status}">${s.status}</span></td>
                </tr>`;
            });
        }
        extraDetails += '</tbody></table></div>';
    } else if (data && data.type === 'delivery_charges_breakdown') {
        extraDetails = '<h3>Delivery Charges Breakdown</h3><div class="report-detail-table-wrapper"><table class="report-detail-table"><thead><tr><th>Order #</th><th>Date</th><th>Rider</th><th>Store(s)</th><th>Fee</th></tr></thead><tbody>';
        if (data.orders) {
            data.orders.forEach(o => {
                extraDetails += `<tr>
                    <td>${o.order_number}</td>
                    <td>${new Date(o.order_date).toLocaleDateString()}</td>
                    <td>${o.rider_name}</td>
                    <td>${o.store_names}</td>
                    <td>Rs  ${parseFloat(o.delivery_fee).toFixed(2)}</td>
                </tr>`;
            });
        }
        extraDetails += '</tbody></table></div>';
        if (data.summary) {
            extraDetails += `<div style="margin-top: 10px;"><strong>Total Orders:</strong> ${data.summary.total_orders} | <strong>Total Delivery Fees:</strong> Rs  ${parseFloat(data.summary.total_delivery_fees).toFixed(2)}</div>`;
        }
    } else if (data && (data.type === 'store_payable_reconciliation' || data.type === 'unsettled_amounts_report')) {
        extraDetails = '<h3>Store Payable Reconciliation</h3><div class="report-detail-table-wrapper"><table class="report-detail-table" style="font-size:0.85em"><thead><tr><th>Store</th><th>Generated (Period)</th><th>Settled (Paid, Period)</th><th>Period Flow</th><th>Current Outstanding</th></tr></thead><tbody>';
        if (data.rows) {
            data.rows.forEach(r => {
                extraDetails += `<tr>
                    <td>${r.store_name || '-'}</td>
                    <td>Rs ${parseFloat(r.period_generated_payable || 0).toFixed(2)}</td>
                    <td>Rs ${parseFloat(r.period_paid_settlements || 0).toFixed(2)}</td>
                    <td>${parseFloat(r.period_flow || 0) < 0 ? '<span style="color:#b91c1c;">' : '<span>'}Rs ${parseFloat(r.period_flow || 0).toFixed(2)}</span></td>
                    <td><strong>Rs ${parseFloat(r.current_outstanding || 0).toFixed(2)}</strong></td>
                </tr>`;
            });
        }
        extraDetails += '</tbody></table></div>';
        if (data.summary) {
            extraDetails += `<div style="margin-top: 10px;">
                <strong>Totals:</strong>
                Generated: Rs ${parseFloat(data.summary.period_generated_payable || 0).toFixed(2)} |
                Settled: Rs ${parseFloat(data.summary.period_paid_settlements || 0).toFixed(2)} |
                Period Flow: Rs ${parseFloat(data.summary.period_flow || 0).toFixed(2)} |
                <strong>Current Outstanding: Rs ${parseFloat(data.summary.current_outstanding || 0).toFixed(2)}</strong>
            </div>`;
        }
        if (data.type === 'unsettled_amounts_report' && Array.isArray(data.order_rows) && data.order_rows.length > 0) {
            extraDetails += '<h3 style="margin-top:14px;">Order-wise Unsettled (Descending)</h3><div class="report-detail-table-wrapper"><table class="report-detail-table" style="font-size:0.85em"><thead><tr><th>Order #</th><th>Date</th><th>Store</th><th>Unsettled Amount</th></tr></thead><tbody>';
            data.order_rows.forEach(o => {
                extraDetails += `<tr>
                    <td>${o.order_number || '-'}</td>
                    <td>${o.order_date ? new Date(o.order_date).toLocaleDateString() : '-'}</td>
                    <td>${o.store_name || '-'}</td>
                    <td>Rs ${parseFloat(o.unsettled_amount || 0).toFixed(2)}</td>
                </tr>`;
            });
            extraDetails += '</tbody></table></div>';
        }
    } else if (data && data.type === 'cash_discrepancy_report') {
        extraDetails = '<h3>Cash Discrepancy Report</h3><div class="report-detail-table-wrapper"><table class="report-detail-table" style="font-size:0.82em"><thead><tr><th>Order #</th><th>Date</th><th>Store</th><th>Payment Term</th><th>Rider</th><th>Store Gross</th><th>Store Payable</th><th>ServeNow Share</th><th>Collected</th><th>Submitted</th><th>Gap</th><th>Software Cash</th></tr></thead><tbody>';
        (data.details || []).forEach(d => {
            extraDetails += `<tr>
                <td>${d.order_number || '-'}</td>
                <td>${d.order_date ? new Date(d.order_date).toLocaleDateString() : '-'}</td>
                <td>${d.store_name || '-'}</td>
                <td>${d.payment_term || '-'}</td>
                <td>${d.rider_name || '-'}</td>
                <td>Rs ${parseFloat(d.store_gross || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(d.store_payable || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(d.servenow_share || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(d.rider_collected_cash || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(d.rider_submitted_cash || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(d.cash_gap || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(d.software_cash_estimate || 0).toFixed(2)}</td>
            </tr>`;
        });
        extraDetails += '</tbody></table></div>';
        if (data.summary) {
            extraDetails += `<div style="margin-top: 10px;">
                <strong>Summary:</strong>
                Orders: ${parseInt(data.summary.total_orders || 0)} |
                Store Gross: Rs ${parseFloat(data.summary.store_gross || 0).toFixed(2)} |
                Store Payable: Rs ${parseFloat(data.summary.store_payable || 0).toFixed(2)} |
                ServeNow Share: Rs ${parseFloat(data.summary.servenow_share || 0).toFixed(2)} |
                Collected: Rs ${parseFloat(data.summary.rider_collected_cash || 0).toFixed(2)} |
                Submitted: Rs ${parseFloat(data.summary.rider_submitted_cash || 0).toFixed(2)} |
                Fuel Paid: Rs ${parseFloat(data.summary.fuel_paid || 0).toFixed(2)} |
                Cash Gap: Rs ${parseFloat(data.summary.cash_gap || 0).toFixed(2)} |
                <strong>Software Cash: Rs ${parseFloat(data.summary.software_cash_estimate || 0).toFixed(2)}</strong>
            </div>`;
        }
        const riderCashMap = {};
        (data.details || []).forEach((d) => {
            const riderKey = (d.rider_name || '-').trim() || '-';
            if (!riderCashMap[riderKey]) {
                riderCashMap[riderKey] = { rider_name: riderKey, orders: 0, collected: 0, submitted: 0 };
            }
            riderCashMap[riderKey].orders += 1;
            riderCashMap[riderKey].collected += parseFloat(d.rider_collected_cash || 0);
            riderCashMap[riderKey].submitted += parseFloat(d.rider_submitted_cash || 0);
        });
        const riderRows = Object.values(riderCashMap);
        if (riderRows.length) {
            extraDetails += '<h3 style="margin-top:14px;">Rider Cash Summary</h3><div class="report-detail-table-wrapper"><table class="report-detail-table" style="font-size:0.82em"><thead><tr><th>Rider</th><th>Orders</th><th>Collected</th><th>Submitted</th><th>Gap</th></tr></thead><tbody>';
            riderRows.forEach((r) => {
                const gap = (parseFloat(r.collected || 0) - parseFloat(r.submitted || 0));
                extraDetails += `<tr>
                    <td>${r.rider_name}</td>
                    <td>${parseInt(r.orders || 0)}</td>
                    <td>Rs ${parseFloat(r.collected || 0).toFixed(2)}</td>
                    <td>Rs ${parseFloat(r.submitted || 0).toFixed(2)}</td>
                    <td>Rs ${parseFloat(gap || 0).toFixed(2)}</td>
                </tr>`;
            });
            extraDetails += '</tbody></table></div>';
        }
        if (Array.isArray(data.daily_totals) && data.daily_totals.length) {
            extraDetails += '<h3 style="margin-top:14px;">Daily Totals</h3><div class="report-detail-table-wrapper"><table class="report-detail-table" style="font-size:0.82em"><thead><tr><th>Date</th><th>Orders</th><th>Store Gross</th><th>Store Payable</th><th>Share</th><th>Collected</th><th>Submitted</th><th>Fuel Paid</th><th>Gap</th><th>Software Cash</th></tr></thead><tbody>';
            data.daily_totals.forEach(d => {
                extraDetails += `<tr>
                    <td>${d.period || '-'}</td>
                    <td>${parseInt(d.total_orders || 0)}</td>
                    <td>Rs ${parseFloat(d.store_gross || 0).toFixed(2)}</td>
                    <td>Rs ${parseFloat(d.store_payable || 0).toFixed(2)}</td>
                    <td>Rs ${parseFloat(d.servenow_share || 0).toFixed(2)}</td>
                    <td>Rs ${parseFloat(d.rider_collected_cash || 0).toFixed(2)}</td>
                    <td>Rs ${parseFloat(d.rider_submitted_cash || 0).toFixed(2)}</td>
                    <td>Rs ${parseFloat(d.fuel_paid || 0).toFixed(2)}</td>
                    <td>Rs ${parseFloat(d.cash_gap || 0).toFixed(2)}</td>
                    <td>Rs ${parseFloat(d.software_cash_estimate || 0).toFixed(2)}</td>
                </tr>`;
            });
            extraDetails += '</tbody></table></div>';
        }
        if (Array.isArray(data.monthly_totals) && data.monthly_totals.length) {
            extraDetails += '<h3 style="margin-top:14px;">Monthly Totals</h3><div class="report-detail-table-wrapper"><table class="report-detail-table" style="font-size:0.82em"><thead><tr><th>Month</th><th>Orders</th><th>Store Gross</th><th>Store Payable</th><th>Share</th><th>Collected</th><th>Submitted</th><th>Fuel Paid</th><th>Software Cash</th></tr></thead><tbody>';
            data.monthly_totals.forEach(m => {
                extraDetails += `<tr>
                    <td>${m.period || '-'}</td>
                    <td>${parseInt(m.total_orders || 0)}</td>
                    <td>Rs ${parseFloat(m.store_gross || 0).toFixed(2)}</td>
                    <td>Rs ${parseFloat(m.store_payable || 0).toFixed(2)}</td>
                    <td>Rs ${parseFloat(m.servenow_share || 0).toFixed(2)}</td>
                    <td>Rs ${parseFloat(m.rider_collected_cash || 0).toFixed(2)}</td>
                    <td>Rs ${parseFloat(m.rider_submitted_cash || 0).toFixed(2)}</td>
                    <td>Rs ${parseFloat(m.fuel_paid || 0).toFixed(2)}</td>
                    <td>Rs ${parseFloat(m.software_cash_estimate || 0).toFixed(2)}</td>
                </tr>`;
            });
            extraDetails += '</tbody></table></div>';
        }
        if (Array.isArray(data.yearly_totals) && data.yearly_totals.length) {
            extraDetails += '<h3 style="margin-top:14px;">Yearly Totals</h3><div class="report-detail-table-wrapper"><table class="report-detail-table" style="font-size:0.82em"><thead><tr><th>Year</th><th>Orders</th><th>Store Gross</th><th>Store Payable</th><th>Share</th><th>Collected</th><th>Submitted</th><th>Fuel Paid</th><th>Software Cash</th></tr></thead><tbody>';
            data.yearly_totals.forEach(y => {
                extraDetails += `<tr>
                    <td>${y.period || '-'}</td>
                    <td>${parseInt(y.total_orders || 0)}</td>
                    <td>Rs ${parseFloat(y.store_gross || 0).toFixed(2)}</td>
                    <td>Rs ${parseFloat(y.store_payable || 0).toFixed(2)}</td>
                    <td>Rs ${parseFloat(y.servenow_share || 0).toFixed(2)}</td>
                    <td>Rs ${parseFloat(y.rider_collected_cash || 0).toFixed(2)}</td>
                    <td>Rs ${parseFloat(y.rider_submitted_cash || 0).toFixed(2)}</td>
                    <td>Rs ${parseFloat(y.fuel_paid || 0).toFixed(2)}</td>
                    <td>Rs ${parseFloat(y.software_cash_estimate || 0).toFixed(2)}</td>
                </tr>`;
            });
            extraDetails += '</tbody></table></div>';
        }
    } else if (data && data.type === 'store_order_settlement_report') {
        extraDetails = '<h3>Store Order Settlement Report</h3>';
        if (data.summary) {
            extraDetails += `<div style="margin-top: 8px; margin-bottom: 8px;">
                <strong>Stores:</strong> ${parseInt(data.summary.total_stores || 0)} |
                <strong>Orders:</strong> ${parseInt(data.summary.total_orders || 0)} |
                <strong>Expected Payable:</strong> Rs ${parseFloat(data.summary.expected_payable || 0).toFixed(2)} |
                <strong>Paid:</strong> Rs ${parseFloat(data.summary.paid_settlement_amount || 0).toFixed(2)} |
                <strong>Unsettled:</strong> Rs ${parseFloat(data.summary.unsettled_amount || 0).toFixed(2)} |
                <strong>Discrepancy:</strong> Rs ${parseFloat(data.summary.discrepancy || 0).toFixed(2)}
            </div>`;
        }

        extraDetails += '<h3 style="margin-top:10px;">Store-wise Summary</h3><div class="report-detail-table-wrapper"><table class="report-detail-table" style="font-size:0.84em"><thead><tr><th>Store</th><th>Total Orders</th><th>Gross Sales</th><th>Expected Payable</th><th>Paid</th><th>Unsettled</th><th>Discrepancy</th></tr></thead><tbody>';
        (data.store_rows || []).forEach((r) => {
            extraDetails += `<tr>
                <td>${r.store_name || '-'}</td>
                <td>${parseInt(r.total_orders || 0)}</td>
                <td>Rs ${parseFloat(r.gross_sales || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(r.expected_payable || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(r.paid_settlement_amount || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(r.unsettled_amount || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(r.discrepancy || 0).toFixed(2)}</td>
            </tr>`;
        });
        extraDetails += '</tbody></table></div>';

        extraDetails += '<h3 style="margin-top:14px;">Order-wise Settlement Details</h3><div class="report-detail-table-wrapper"><table class="report-detail-table" style="font-size:0.80em"><thead><tr><th>Order #</th><th>Date</th><th>Store</th><th>Gross</th><th>Expected</th><th>Paid</th><th>Unsettled</th><th>Discrepancy</th><th>Settlement #</th><th>Status</th></tr></thead><tbody>';
        (data.order_rows || []).forEach((r) => {
            extraDetails += `<tr>
                <td>${r.order_number || '-'}</td>
                <td>${r.order_date ? new Date(r.order_date).toLocaleDateString() : '-'}</td>
                <td>${r.store_name || '-'}</td>
                <td>Rs ${parseFloat(r.gross_sales || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(r.expected_payable || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(r.paid_settlement_amount || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(r.unsettled_amount || 0).toFixed(2)}</td>
                <td>Rs ${parseFloat(r.discrepancy || 0).toFixed(2)}</td>
                <td>${r.settlement_numbers || '-'}</td>
                <td>${r.settlement_statuses || '-'}</td>
            </tr>`;
        });
        extraDetails += '</tbody></table></div>';
    } else if (data && data.type === 'comprehensive_report') {
        extraDetails = '<h3>Comprehensive Transactions</h3><div class="report-detail-table-wrapper"><table class="report-detail-table" style="font-size:0.8em"><thead><tr><th>Date</th><th>Ref #</th><th>Type</th><th>Entity</th><th>In</th><th>Out</th><th>Desc</th></tr></thead><tbody>';
        if (data.transactions) {
            data.transactions.forEach(t => {
                const income = (t.transaction_type === 'income' || t.transaction_type === 'refund') ? `Rs  ${parseFloat(t.amount).toFixed(2)}` : '-';
                const expense = (t.transaction_type === 'expense' || t.transaction_type === 'settlement') ? `Rs  ${parseFloat(t.amount).toFixed(2)}` : '-';
                const entity = t.entity_name || t.related_entity_type || '-';
                const ref = t.reference_number_display || t.transaction_number || '-';
                
                extraDetails += `<tr>
                    <td>${new Date(t.created_at).toLocaleDateString()}</td>
                    <td>${ref}</td>
                    <td>${t.transaction_type.toUpperCase()}</td>
                    <td>${entity}</td>
                    <td style="color:green">${income}</td>
                    <td style="color:red">${expense}</td>
                    <td>${t.description || ''}</td>
                </tr>`;
            });
        }
        extraDetails += '</tbody></table></div>';
        
        // Add prominent Net Flow summary
        const flowColor = data.summary.net_flow >= 0 ? 'green' : 'red';
        extraDetails += `
            <div style="margin-top: 15px; padding: 15px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;">
                <h4 style="margin: 0 0 10px 0;">Net Result Calculation</h4>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; text-align: center;">
                    <div>
                        <div style="font-size: 0.8em; color: #666;">Total In (Income)</div>
                        <div style="font-size: 1.2em; font-weight: bold; color: green;">+ Rs  ${parseFloat(data.summary.total_income).toFixed(2)}</div>
                    </div>
                    <div>
                        <div style="font-size: 0.8em; color: #666;">Total Out (Expense/Settlements/Refunds)</div>
                        <div style="font-size: 1.2em; font-weight: bold; color: red;">- Rs  ${parseFloat(data.summary.total_expense + data.summary.total_settlements + data.summary.total_refunds).toFixed(2)}</div>
                    </div>
                    <div style="border-left: 2px solid #ddd;">
                        <div style="font-size: 0.8em; color: #666;">Net Result (Balance)</div>
                        <div style="font-size: 1.4em; font-weight: bold; color: ${flowColor};">Rs  ${parseFloat(data.summary.net_flow).toFixed(2)}</div>
                    </div>
                </div>
                ${(data.summary.total_delivery_fees !== undefined && data.summary.total_store_commission !== undefined) ? `
                <div style="margin-top: 15px; border-top: 1px solid #ddd; padding-top: 10px; font-size: 0.9em;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                        
                        <!-- Cash In Column -->
                        <div style="background: #f9fafb; padding: 10px; border-radius: 6px;">
                            <div style="font-weight: bold; margin-bottom: 5px; color: #374151;">Cash Collected (In)</div>
                            <div style="display: flex; justify-content: space-between;"><span>Delivery Fees:</span> <span>Rs  ${parseFloat(data.summary.total_delivery_fees).toFixed(2)}</span></div>
                            <div style="display: flex; justify-content: space-between;"><span>Item Sales:</span> <span>Rs  ${parseFloat(data.summary.total_item_sales_net).toFixed(2)}</span></div>
                            <div style="border-top: 1px dashed #ccc; margin-top: 5px; padding-top: 5px; font-weight: bold; display: flex; justify-content: space-between;">
                                <span>Total:</span> <span>Rs  ${parseFloat(data.summary.total_delivery_fees + data.summary.total_item_sales_net).toFixed(2)}</span>
                            </div>
                        </div>

                        <!-- Profit Column -->
                        <div style="background: #ecfdf5; padding: 10px; border-radius: 6px;">
                            <div style="font-weight: bold; margin-bottom: 5px; color: #065f46;">Platform Profit</div>
                            <div style="display: flex; justify-content: space-between;"><span>Delivery Profit:</span> <span>Rs  ${parseFloat(data.summary.total_delivery_fees).toFixed(2)}</span></div>
                            <div style="display: flex; justify-content: space-between;"><span>Store Comm.:</span> <span>Rs  ${parseFloat(data.summary.total_store_commission).toFixed(2)}</span></div>
                            <div style="border-top: 1px dashed #ccc; margin-top: 5px; padding-top: 5px; font-weight: bold; color: #059669; display: flex; justify-content: space-between;">
                                <span>Net Profit:</span> <span>Rs  ${parseFloat(data.summary.estimated_gross_profit).toFixed(2)}</span>
                            </div>
                        </div>

                        <!-- Payable Column -->
                        <div style="background: #fffbeb; padding: 10px; border-radius: 6px;">
                            <div style="font-weight: bold; margin-bottom: 5px; color: #92400e;">Payable to Stores</div>
                            <div style="display: flex; justify-content: space-between;"><span>Item Sales:</span> <span>Rs  ${parseFloat(data.summary.total_item_sales_net).toFixed(2)}</span></div>
                            <div style="display: flex; justify-content: space-between;"><span>Less Comm.:</span> <span>-Rs  ${parseFloat(data.summary.total_store_commission).toFixed(2)}</span></div>
                            <div style="display: flex; justify-content: space-between;"><span>Settled Paid:</span> <span>-Rs  ${parseFloat(data.summary.total_store_settlement_paid || 0).toFixed(2)}</span></div>
                            <div style="display: flex; justify-content: space-between;"><span>Period Store Flow:</span> <span>Rs ${parseFloat(data.summary.period_store_payable_flow || 0).toFixed(2)}</span></div>
                            <div style="border-top: 1px dashed #ccc; margin-top: 5px; padding-top: 5px; font-weight: bold; color: #b45309; display: flex; justify-content: space-between;">
                                <span>Current Outstanding:</span> <span>Rs ${Math.max(0, parseFloat(data.summary.current_outstanding_store_payable || 0)).toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                </div>` : ''}
            </div>
        `;
    } else if (data && data.type === 'transaction_summary') {
        extraDetails = '<h3>Transaction Summary</h3><div class="report-detail-table-wrapper"><table class="report-detail-table" style="font-size:0.8em"><thead><tr><th>Date</th><th>Ref #</th><th>Type</th><th>Entity</th><th>In</th><th>Out</th><th>Desc</th></tr></thead><tbody>';
        if (data.transactions) {
            data.transactions.forEach(t => {
                const income = (t.transaction_type === 'income' || t.transaction_type === 'refund') ? parseFloat(t.amount || 0) : 0;
                const expense = (t.transaction_type === 'expense' || t.transaction_type === 'settlement') ? parseFloat(t.amount || 0) : 0;
                // Adjustments usually positive, treat as income or handle by sign if we had signed amounts.
                const entity = t.entity_name || t.related_entity_type || '-';
                const ref = t.transaction_number || '-';
                
                extraDetails += `<tr>
                    <td>${new Date(t.created_at).toLocaleDateString()}</td>
                    <td>${ref}</td>
                    <td><span class="badge badge-${t.transaction_type}">${t.transaction_type}</span></td>
                    <td>${entity}</td>
                    <td style="color:green">${income > 0 ? 'Rs  ' + income.toFixed(2) : '-'}</td>
                    <td style="color:red">${expense > 0 ? 'Rs  ' + expense.toFixed(2) : '-'}</td>
                    <td>${t.description || '-'}</td>
                </tr>`;
            });
        }
        extraDetails += '</tbody></table></div>';
        if (data.summary) {
             const flowColor = data.summary.net_cash_flow >= 0 ? 'green' : 'red';
             extraDetails += `<div style="margin-top: 15px; padding: 15px; background: #f8f9fa; border: 1px solid #ddd; border-radius: 8px;">
                <h4 style="margin: 0 0 10px 0;">Financial Summary</h4>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
                    <div><strong>Total Income:</strong> <span style="color:green">Rs  ${parseFloat(data.summary.total_income).toFixed(2)}</span></div>
                    <div><strong>Total Expense:</strong> <span style="color:red">Rs  ${parseFloat(data.summary.total_expense).toFixed(2)}</span></div>
                    <div><strong>Net Cash Flow:</strong> <span style="color:${flowColor}; font-weight:bold">Rs  ${parseFloat(data.summary.net_cash_flow).toFixed(2)}</span></div>
                    <div><strong>Settlements:</strong> Rs  ${parseFloat(data.summary.total_settlements).toFixed(2)}</div>
                    <div><strong>Refunds:</strong> Rs  ${parseFloat(data.summary.total_refunds).toFixed(2)}</div>
                    <div><strong>Adjustments:</strong> Rs  ${parseFloat(data.summary.total_adjustments).toFixed(2)}</div>
                </div>
             </div>`;
        }
    } else if (data && data.type === 'periodic_sales_report') {
        extraDetails = renderPeriodicSalesReportHtml(data);
    } else if (data && data.type === 'periodic_credit_cash_report') {
        extraDetails = renderPeriodicCreditCashReportHtml(data);
    } else if (data && data.type === 'periodic_comprehensive_summary_report') {
        extraDetails = renderPeriodicComprehensiveSummaryReportHtml(data);
    } else if (data && data.type === 'periodic_store_payments_balance_report') {
        extraDetails = renderPeriodicStorePaymentsBalanceReportHtml(data);
    } else if (data && data.type === 'order_wise_sale_summary') {
        extraDetails = '<h3>Order Wise Sale Summary</h3><div class="report-detail-table-wrapper"><table class="report-detail-table" style="font-size:0.85em"><thead><tr><th>Order #</th><th>Items</th><th>Item Sales</th><th>Total Cost</th><th>Comm.</th><th>Del. Charges</th><th>Total Amount</th></tr></thead><tbody>';
        
        if (data.orders) {
            data.orders.forEach(o => {
                let itemsList = '';
                if (o.items && Array.isArray(o.items)) {
                    itemsList = o.items.map(i => `${i.name} x${i.qty}`).join('<br>');
                }
                
                extraDetails += `<tr>
                    <td>${o.order_number}<br><small>${new Date(o.created_at).toLocaleDateString()}</small></td>
                    <td>${itemsList}</td>
                    <td>Rs  ${parseFloat(o.item_sales_gross).toFixed(2)}</td>
                    <td>Rs  ${parseFloat(o.total_cost_price).toFixed(2)}</td>
                    <td>Rs  ${parseFloat(o.estimated_commission).toFixed(2)}</td>
                    <td>Rs  ${parseFloat(o.delivery_fee).toFixed(2)}</td>
                    <td><strong>Rs  ${parseFloat(o.total_amount).toFixed(2)}</strong></td>
                </tr>`;
            });
        }
        extraDetails += '</tbody></table></div>';
        
        if (data.summary) {
             extraDetails += `<div style="margin-top: 15px; font-size: 1.0em; padding: 10px; background: #f8f9fa; border: 1px solid #ddd; border-radius: 5px;">
                <strong>Totals:</strong><br>
                Item Sales: Rs  ${parseFloat(data.summary.total_item_sales).toFixed(2)} | 
                Cost: Rs  ${parseFloat(data.summary.total_cost).toFixed(2)} | 
                Commission: Rs  ${parseFloat(data.summary.total_commission).toFixed(2)} | 
                Delivery: Rs  ${parseFloat(data.summary.total_delivery).toFixed(2)} | 
                <strong>Grand Total: Rs  ${parseFloat(data.summary.grand_total).toFixed(2)}</strong>
            </div>`;
        }
    }

    const hideFinancialSummary = data && (data.type === 'rider_fuel' || data.type === 'rider_petrol');
    const details = `
        <div class="report-summary">
            <strong>Number:</strong> ${report.report_number}<br>
            <strong>Type:</strong> ${report.report_type.replace(/_/g, ' ')}<br>
            <strong>Period:</strong> ${report.period_from ? new Date(report.period_from).toLocaleDateString() : '-'} to ${report.period_to ? new Date(report.period_to).toLocaleDateString() : '-'}<br>
            <hr>
            <strong>Generated:</strong> ${new Date(report.created_at).toLocaleString()}
            ${hideFinancialSummary ? '' : `<br>
            <strong>Total Income:</strong> Rs  ${parseFloat(report.total_income).toFixed(2)}<br>
            <strong>Total Expense:</strong> Rs  ${parseFloat(report.total_expense).toFixed(2)}<br>
            <strong>Total Settlements:</strong> Rs  ${parseFloat(report.total_commissions).toFixed(2)}<br>
            <strong>Net Profit:</strong> Rs  ${parseFloat(report.net_profit).toFixed(2)}`}
        </div>
        ${extraDetails}
    `;

    // Use the new modal for preview
    const contentDiv = document.getElementById('viewReportContent');
    if (contentDiv) {
        contentDiv.innerHTML = details;
        
        // Setup download button
        const downloadBtn = document.getElementById('viewReportDownloadBtn');
        if (downloadBtn) {
            downloadBtn.onclick = () => generatePDF(reportId);
        }
        
        openModal('viewReportModal');
    } else {
        // Fallback to dynamic modal if static one is missing
        const modalId = 'reportViewModal';
        let modal = document.getElementById(modalId);
        if (!modal) {
            modal = document.createElement('div');
            modal.id = modalId;
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 800px;">
                    <div class="modal-header">
                        <h3>Report Details</h3>
                        <span class="close" onclick="document.getElementById('${modalId}').classList.remove('show')">&times;</span>
                    </div>
                    <div class="modal-body" id="${modalId}Body"></div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="document.getElementById('${modalId}').classList.remove('show')">Close</button>
                        <button class="btn btn-primary" id="${modalId}Download">Download PDF</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        
        document.getElementById(`${modalId}Body`).innerHTML = details;
        document.getElementById(`${modalId}Download`).onclick = () => generatePDF(reportId);
        modal.classList.add('show');
    }
}

async function editRiderCash(id) {
    const movement = currentRiderCash.find(m => m.id === id);
    if (!movement) return;

    document.getElementById('riderCashId').value = movement.id;
    document.getElementById('movementType').value = movement.movement_type;
    document.getElementById('riderCashAmountInput').value = movement.amount;
    document.getElementById('riderCashDescription').value = movement.description || '';

    document.querySelector('#riderCashModal h2').textContent = 'Edit Rider Cash Movement';
    document.querySelector('#riderCashModal .btn-primary').textContent = 'Update Movement';

    formChangedState['riderCashModal'] = false;
    await populateRidersDropdown();
    document.getElementById('riderId').value = movement.rider_id;
    openModal('riderCashModal');
}

function editTransaction(id) {
    const transaction = currentTransactions.find(t => t.id === id);
    if (!transaction) return;

    document.getElementById('transactionId').value = transaction.id;
    document.getElementById('transactionAmount').value = transaction.amount;
    document.getElementById('transactionType').value = transaction.transaction_type;
    document.getElementById('transactionDescription').value = transaction.description || '';
    document.getElementById('transactionPaymentMethod').value = transaction.payment_method;

    document.querySelector('#transactionModal h2').textContent = 'Edit Transaction';
    document.querySelector('#transactionModal .btn-primary').textContent = 'Update Transaction';

    formChangedState['transactionModal'] = false;
    openModal('transactionModal');
}

function viewTransaction(id) {
    const transaction = currentTransactions.find(t => t.id === id);
    if (transaction) {
        const details = `
            <strong>Number:</strong> ${transaction.transaction_number}<br>
            <strong>Type:</strong> ${transaction.transaction_type}<br>
            <strong>Amount:</strong> Rs  ${parseFloat(transaction.amount).toFixed(2)}<br>
            <strong>Method:</strong> ${transaction.payment_method}<br>
            <strong>Status:</strong> <span class="status-${transaction.status}">${transaction.status}</span><br>
            <strong>Description:</strong> ${transaction.description || '-'}<br>
            <strong>Date:</strong> ${new Date(transaction.created_at).toLocaleString()}
        `;
        showInfo('Transaction Details', details, 10000);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    // Hard fallback: if old cached admin.html still contains deprecated dashboard buttons,
    // remove them on load.
    ['openTransactionModalBtn', 'openCompReportModalBtn', 'openOrderDetailReportModalBtn'].forEach((id) => {
        const btn = document.getElementById(id);
        if (btn && btn.parentElement) {
            btn.parentElement.removeChild(btn);
        }
    });

    const financialPeriodFilter = document.getElementById('financialPeriodFilter');
    const refreshFinancialDashboardBtn = document.getElementById('refreshFinancialDashboardBtn');
    const fdStoreFilter = document.getElementById('fdStoreFilter');
    const fdPaymentTermFilter = document.getElementById('fdPaymentTermFilter');
    const fdPendingFilter = document.getElementById('fdPendingFilter');
    const refreshStoreWiseFinancialBtn = document.getElementById('refreshStoreWiseFinancialBtn');
    const transactionTypeFilter = document.getElementById('transactionTypeFilter');
    const transactionStatusFilter = document.getElementById('transactionStatusFilter');
    const clearTransactionFiltersBtn = document.getElementById('clearTransactionFiltersBtn');
    const addTransactionBtn = document.getElementById('addTransactionBtn');
    const paymentVoucherStatusFilter = document.getElementById('paymentVoucherStatusFilter');
    const clearPaymentVoucherFiltersBtn = document.getElementById('clearPaymentVoucherFiltersBtn');
    const addPaymentVoucherBtn = document.getElementById('addPaymentVoucherBtn');
    const bankPaymentVoucherStatusFilter = document.getElementById('bankPaymentVoucherStatusFilter');
    const clearBankPaymentVoucherFiltersBtn = document.getElementById('clearBankPaymentVoucherFiltersBtn');
    const addBankPaymentVoucherBtn = document.getElementById('addBankPaymentVoucherBtn');
    const receiptVoucherStatusFilter = document.getElementById('receiptVoucherStatusFilter');
    const bankReceiptVoucherStatusFilter = document.getElementById('bankReceiptVoucherStatusFilter');
    const clearBankReceiptVoucherFiltersBtn = document.getElementById('clearBankReceiptVoucherFiltersBtn');
    const addBankReceiptVoucherBtn = document.getElementById('addBankReceiptVoucherBtn');
    const clearReceiptVoucherFiltersBtn = document.getElementById('clearReceiptVoucherFiltersBtn');
    const addReceiptVoucherBtn = document.getElementById('addReceiptVoucherBtn');
    const riderCashMovementTypeFilter = document.getElementById('riderCashMovementTypeFilter');
    const riderCashStatusFilter = document.getElementById('riderCashStatusFilter');
    const clearRiderCashFiltersBtn = document.getElementById('clearRiderCashFiltersBtn');
    const addRiderCashMovementBtn = document.getElementById('addRiderCashMovementBtn');
    const storeSettlementStatusFilter = document.getElementById('storeSettlementStatusFilter');
    const clearStoreSettlementFiltersBtn = document.getElementById('clearStoreSettlementFiltersBtn');
    const addStoreSettlementBtn = document.getElementById('addStoreSettlementBtn');
    const expenseCategoryFilter = document.getElementById('expenseCategoryFilter');
    const expenseStatusFilter = document.getElementById('expenseStatusFilter');
    const clearExpenseFiltersBtn = document.getElementById('clearExpenseFiltersBtn');
    const addExpenseBtn = document.getElementById('addExpenseBtn');
    const journalVoucherStatusFilter = document.getElementById('journalVoucherStatusFilter');
    const clearJournalVoucherFiltersBtn = document.getElementById('clearJournalVoucherFiltersBtn');
    const addJournalVoucherBtn = document.getElementById('addJournalVoucherBtn');
    const reportTypeFilter = document.getElementById('reportTypeFilter');
    const generateReportBtn = document.getElementById('generateReportBtn');
    const exportReportBtn = document.getElementById('exportReportBtn');

    if (financialPeriodFilter) financialPeriodFilter.addEventListener('change', loadFinancialDashboard);
    if (refreshFinancialDashboardBtn) refreshFinancialDashboardBtn.addEventListener('click', loadFinancialDashboard);
    if (fdStoreFilter) fdStoreFilter.addEventListener('change', loadFinancialDashboardStoreWise);
    if (fdPaymentTermFilter) fdPaymentTermFilter.addEventListener('change', loadFinancialDashboardStoreWise);
    if (fdPendingFilter) fdPendingFilter.addEventListener('change', loadFinancialDashboardStoreWise);
    if (refreshStoreWiseFinancialBtn) refreshStoreWiseFinancialBtn.addEventListener('click', loadFinancialDashboardStoreWise);
    if (transactionTypeFilter) transactionTypeFilter.addEventListener('change', loadTransactions);
    if (transactionStatusFilter) transactionStatusFilter.addEventListener('change', loadTransactions);
    if (clearTransactionFiltersBtn) clearTransactionFiltersBtn.addEventListener('click', () => {
        if (transactionTypeFilter) transactionTypeFilter.value = '';
        if (transactionStatusFilter) transactionStatusFilter.value = '';
        loadTransactions();
    });
    if (addTransactionBtn) addTransactionBtn.addEventListener('click', createTransaction);

    if (paymentVoucherStatusFilter) paymentVoucherStatusFilter.addEventListener('change', loadPaymentVouchers);
    if (clearPaymentVoucherFiltersBtn) clearPaymentVoucherFiltersBtn.addEventListener('click', () => {
        if (paymentVoucherStatusFilter) paymentVoucherStatusFilter.value = '';
        loadPaymentVouchers();
    });
    if (addPaymentVoucherBtn) addPaymentVoucherBtn.addEventListener('click', createPaymentVoucher);

    if (bankPaymentVoucherStatusFilter) bankPaymentVoucherStatusFilter.addEventListener('change', loadBankPaymentVouchers);
    if (clearBankPaymentVoucherFiltersBtn) clearBankPaymentVoucherFiltersBtn.addEventListener('click', () => {
        if (bankPaymentVoucherStatusFilter) bankPaymentVoucherStatusFilter.value = '';
        loadBankPaymentVouchers();
    });
    if (addBankPaymentVoucherBtn) addBankPaymentVoucherBtn.addEventListener('click', createBankPaymentVoucher);

    if (receiptVoucherStatusFilter) receiptVoucherStatusFilter.addEventListener('change', loadReceiptVouchers);
    if (clearReceiptVoucherFiltersBtn) clearReceiptVoucherFiltersBtn.addEventListener('click', () => {
        if (receiptVoucherStatusFilter) receiptVoucherStatusFilter.value = '';
        loadReceiptVouchers();
    });
    if (addReceiptVoucherBtn) addReceiptVoucherBtn.addEventListener('click', createReceiptVoucher);

    if (bankReceiptVoucherStatusFilter) bankReceiptVoucherStatusFilter.addEventListener('change', loadBankReceiptVouchers);
    if (clearBankReceiptVoucherFiltersBtn) clearBankReceiptVoucherFiltersBtn.addEventListener('click', () => {
        if (bankReceiptVoucherStatusFilter) bankReceiptVoucherStatusFilter.value = '';
        loadBankReceiptVouchers();
    });
    if (addBankReceiptVoucherBtn) addBankReceiptVoucherBtn.addEventListener('click', createBankReceiptVoucher);

    if (riderCashMovementTypeFilter) riderCashMovementTypeFilter.addEventListener('change', loadRiderCash);
    if (riderCashStatusFilter) riderCashStatusFilter.addEventListener('change', loadRiderCash);
    if (clearRiderCashFiltersBtn) clearRiderCashFiltersBtn.addEventListener('click', () => {
        if (riderCashMovementTypeFilter) riderCashMovementTypeFilter.value = '';
        if (riderCashStatusFilter) riderCashStatusFilter.value = '';
        loadRiderCash();
    });
    if (addRiderCashMovementBtn) addRiderCashMovementBtn.addEventListener('click', createRiderCash);

    if (storeSettlementStatusFilter) storeSettlementStatusFilter.addEventListener('change', loadStoreSettlements);
    if (clearStoreSettlementFiltersBtn) clearStoreSettlementFiltersBtn.addEventListener('click', () => {
        if (storeSettlementStatusFilter) storeSettlementStatusFilter.value = '';
        loadStoreSettlements();
    });
    if (addStoreSettlementBtn) addStoreSettlementBtn.addEventListener('click', createStoreSettlement);

    if (expenseCategoryFilter) expenseCategoryFilter.addEventListener('change', loadExpenses);
    if (expenseStatusFilter) expenseStatusFilter.addEventListener('change', loadExpenses);
    if (clearExpenseFiltersBtn) clearExpenseFiltersBtn.addEventListener('click', () => {
        if (expenseCategoryFilter) expenseCategoryFilter.value = '';
        if (expenseStatusFilter) expenseStatusFilter.value = '';
        loadExpenses();
    });
    if (addExpenseBtn) addExpenseBtn.addEventListener('click', createExpense);

    if (journalVoucherStatusFilter) journalVoucherStatusFilter.addEventListener('change', loadJournalVouchers);
    if (clearJournalVoucherFiltersBtn) clearJournalVoucherFiltersBtn.addEventListener('click', () => {
        if (journalVoucherStatusFilter) journalVoucherStatusFilter.value = '';
        loadJournalVouchers();
    });
    if (addJournalVoucherBtn) addJournalVoucherBtn.addEventListener('click', createJournalVoucher);
    
    if (reportTypeFilter) reportTypeFilter.addEventListener('change', loadFinancialReports);
    const generateFinancialReportBtn = document.getElementById('generateFinancialReportBtn');
    if (generateFinancialReportBtn) generateFinancialReportBtn.addEventListener('click', generateFinancialReport);
    
    const reportTypeModal = document.getElementById('reportTypeModal');
    if (reportTypeModal) {
        reportTypeModal.addEventListener('change', function() {
            const riderGroup = document.getElementById('reportRiderSelectGroup');
            if (riderGroup) {
                riderGroup.style.display = (
                    this.value === 'rider_fuel_report' ||
                    this.value === 'rider_cash_report' ||
                    this.value === 'rider_orders_report' ||
                    this.value === 'rider_payments_report' ||
                    this.value === 'rider_receivings_report' ||
                    this.value === 'rider_wallet_report' ||
                    this.value === 'rider_petrol_report' ||
                    this.value === 'rider_daily_mileage_report' ||
                    this.value === 'rider_daily_activity_report' ||
                    this.value === 'rider_day_closing_report' ||
                    this.value === 'delivery_charges_breakdown' ||
                    this.value === 'order_wise_sale_summary'
                ) ? 'block' : 'none';
            }
            const storeGroup = document.getElementById('reportStoreSelectGroup');
            if (storeGroup) {
                storeGroup.style.display = (
                    this.value === 'order_wise_sale_summary' ||
                    this.value === 'periodic_sales_report' ||
                    this.value === 'periodic_comprehensive_summary_report' ||
                    this.value === 'periodic_store_payments_balance_report' ||
                    this.value === 'store_payable_reconciliation' ||
                    this.value === 'unsettled_amounts_report' ||
                    this.value === 'store_order_settlement_report'
                ) ? 'block' : 'none';
            }
            if (this.value === 'periodic_credit_cash_report') {
                setDatesForPeriod('today', 'reportPeriodFrom', 'reportPeriodTo');
            }
        });
    }

    const generateRiderReportBtn = document.getElementById('generateRiderReportBtn');
    if (generateRiderReportBtn) generateRiderReportBtn.addEventListener('click', loadRiderReports);

    // Setup period filters and initialize defaults
    setupPeriodFilters();

    const generateStoreReportBtn = document.getElementById('generateStoreReportBtn');
    if (generateStoreReportBtn) generateStoreReportBtn.addEventListener('click', loadStoreReports);

    const refreshStorePaymentTermReportBtn = document.getElementById('refreshStorePaymentTermReportBtn');
    if (refreshStorePaymentTermReportBtn) refreshStorePaymentTermReportBtn.addEventListener('click', loadStorePaymentTermReport);

    const exportRiderReportBtn = document.getElementById('exportRiderReportBtn');
    if (exportRiderReportBtn) exportRiderReportBtn.addEventListener('click', exportRiderReport);

    const exportStoreReportBtn = document.getElementById('exportStoreReportBtn');
    if (exportStoreReportBtn) exportStoreReportBtn.addEventListener('click', exportStoreReport);

    if (exportReportBtn) exportReportBtn.addEventListener('click', () => {
        if (currentReports.length > 0) {
            downloadReport(currentReports[0].id);
        } else {
            showWarning('No Reports', 'No reports available to export');
        }
    });

    initializePersistentModalHandlers();
    initializeFinancialManagement();
});

function initializePersistentModalHandlers() {
    financialModalIds.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal && modal.classList.contains('show')) {
                    e.stopPropagation();
                    if (formChangedState[modalId]) {
                        showWarning('Cannot Close', 'Please use the Cancel button to close this form');
                    }
                }
            });
        }
    });
}

function initializeFinancialManagement() {
    loadPaymentVouchers();
    loadBankPaymentVouchers();
    loadReceiptVouchers();
    loadBankReceiptVouchers();
    loadJournalVouchers();
}

async function populateReportFilters() {
    // Ensure riders are loaded (non-blocking for store filters)
    try {
        if ((!Array.isArray(window.currentRiders) || window.currentRiders.length === 0) && typeof loadRiders === 'function') {
            await loadRiders();
        }
    } catch (err) {
        console.warn('populateReportFilters: rider preload failed, continuing with store filters', err);
    }

    const ridersData = Array.isArray(window.currentRiders)
        ? window.currentRiders
        : (Array.isArray(window.AppState?.riders) ? window.AppState.riders : []);

    const riderSelect = document.getElementById('riderReportSelect');
    if (riderSelect) {
        const previous = riderSelect.value || 'all';
        riderSelect.innerHTML = '<option value="all">All Riders</option>';
        ridersData.forEach(r => {
            const option = document.createElement('option');
            option.value = r.id;
            option.textContent = `${r.first_name} ${r.last_name}`;
            riderSelect.appendChild(option);
        });
        if (Array.from(riderSelect.options).some(o => String(o.value) === String(previous))) {
            riderSelect.value = previous;
        }
    }

    // Ensure stores are loaded
    let storesData = Array.isArray(window.currentStores)
        ? window.currentStores
        : (Array.isArray(window.AppState?.stores) ? window.AppState.stores : []);
    if (!storesData.length && typeof loadStores === 'function') {
        try {
            const loaded = await loadStores();
            if (Array.isArray(loaded) && loaded.length) storesData = loaded;
        } catch (err) {
            console.warn('populateReportFilters: loadStores failed, trying direct stores fetch', err);
        }
    }
    // Hard fallback: fetch directly for report dropdown
    if (!storesData.length) {
        try {
            const response = await fetch(`${API_BASE}/api/stores?admin=1&lite=1`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken') || authToken || ''}` }
            });
            const data = await response.json();
            if (response.ok && data.success && Array.isArray(data.stores)) {
                storesData = data.stores;
                if (window.AppState && Array.isArray(window.AppState.stores)) {
                    window.AppState.stores = data.stores;
                }
                window.currentStores = data.stores;
            }
        } catch (err) {
            console.warn('populateReportFilters: direct store fetch failed', err);
        }
    }

    const storeSelect = document.getElementById('storeReportSelect');
    if (storeSelect) {
        const previous = storeSelect.value || 'all';
        storeSelect.innerHTML = '<option value="all">All Stores</option>';
        storesData.forEach(s => {
            const option = document.createElement('option');
            option.value = s.id;
            option.textContent = s.name;
            storeSelect.appendChild(option);
        });
        if (!storesData.length) {
            storeSelect.innerHTML = '<option value="all">All Stores</option><option value="" disabled>No stores found</option>';
        }
        if (Array.from(storeSelect.options).some(o => String(o.value) === String(previous))) {
            storeSelect.value = previous;
        }
    }
}

// Helper to set date inputs based on period
function setDatesForPeriod(period, startEl, endEl) {
    const today = new Date();
    let startDate = new Date();
    let endDate = new Date();

    switch (period) {
        case 'daily':
        case 'today':
            startDate = today;
            endDate = today;
            break;
        case 'weekly':
        case 'week':
            // Start of week (Sunday)
            startDate.setDate(today.getDate() - today.getDay());
            // End date is Today (per user request)
            endDate = today;
            break;
        case 'monthly':
        case 'month':
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
            // End date is Today
            endDate = today;
            break;
        case 'year':
            startDate = new Date(today.getFullYear(), 0, 1);
            endDate = today;
            break;
        default:
            return;
    }

    const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };
    
    const sEl = document.getElementById(startEl);
    const eEl = document.getElementById(endEl);
    if (sEl) {
        sEl.value = formatDate(startDate);
        sEl.defaultValue = sEl.value;
    }
    if (eEl) {
        eEl.value = formatDate(endDate);
        eEl.defaultValue = eEl.value;
    }
}

function initializeDateDefaults() {
    // 1. Initialize Period Selectors
    const periods = [
        { periodId: 'riderReportPeriod', startId: 'riderReportStartDate', endId: 'riderReportEndDate' },
        { periodId: 'storeReportPeriod', startId: 'storeReportStartDate', endId: 'storeReportEndDate' }
    ];
    
    periods.forEach(p => {
        const el = document.getElementById(p.periodId);
        if (el && el.value && el.value !== 'custom' && el.value !== 'all') {
            setDatesForPeriod(el.value, p.startId, p.endId);
        }
    });

    // 2. Initialize Standalone Date Filters (Default to Month/Today if empty)
    const defaults = [
        { startId: 'filterStartDate', endId: 'filterEndDate', type: 'month' },
        { startId: 'paymentStartDate', endId: 'paymentEndDate', type: 'month' },
        { startId: 'jnvDate', type: 'today' },
        { startId: 'reportStartDate', endId: 'reportEndDate', type: 'month' },
        { startId: 'reportPeriodFrom', endId: 'reportPeriodTo', type: 'month' },
        { startId: 'periodFrom', endId: 'periodTo', type: 'month' },
        // Fallbacks if period selector didn't set them (or doesn't exist)
        { startId: 'riderReportStartDate', endId: 'riderReportEndDate', type: 'month' }
    ];

    defaults.forEach(d => {
        if (d.type === 'today') {
            const el = document.getElementById(d.startId);
            if (el && !el.value) {
                el.value = new Date().toISOString().split('T')[0];
            }
        } else {
            const s = document.getElementById(d.startId);
            const e = document.getElementById(d.endId);
            // Only set if both exist and start is empty
            if (s && e && !s.value) {
                setDatesForPeriod(d.type === 'month' ? 'monthly' : 'daily', d.startId, d.endId);
            }
        }
    });
}

function setupPeriodFilters() {
    document.getElementById('riderReportPeriod')?.addEventListener('change', function() {
        if (this.value !== 'custom') {
            setDatesForPeriod(this.value, 'riderReportStartDate', 'riderReportEndDate');
        }
    });

    document.getElementById('storeReportPeriod')?.addEventListener('change', function() {
        if (this.value === 'all') {
            const start = document.getElementById('storeReportStartDate');
            const end = document.getElementById('storeReportEndDate');
            if (start) start.value = '';
            if (end) end.value = '';
        } else if (this.value !== 'custom') {
            setDatesForPeriod(this.value, 'storeReportStartDate', 'storeReportEndDate');
        }
    });

    const storeSelect = document.getElementById('storeReportSelect');
    if (storeSelect && !storeSelect.dataset.boundStoreReportFilter) {
        storeSelect.addEventListener('change', () => {
            if (typeof loadStoreReports === 'function') loadStoreReports();
        });
        storeSelect.dataset.boundStoreReportFilter = '1';
    }

    const pendingOnlyCheckbox = document.getElementById('storeReportPendingOnly');
    if (pendingOnlyCheckbox && !pendingOnlyCheckbox.dataset.boundStoreReportFilter) {
        pendingOnlyCheckbox.addEventListener('change', () => {
            if (Array.isArray(lastStoreData)) {
                const filtered = applyStoreReportFilters(lastStoreData);
                displayStoreReports(filtered);
                updateStoreReportDueTotals(filtered);
            }
        });
        pendingOnlyCheckbox.dataset.boundStoreReportFilter = '1';
    }
    
    // Initialize defaults on load
    initializeDateDefaults();
}

async function loadRiderReports() {
    try {
        const start_date = document.getElementById('riderReportStartDate')?.value;
        const end_date = document.getElementById('riderReportEndDate')?.value;
        const rider_id = document.getElementById('riderReportSelect')?.value || 'all';
        
        const params = new URLSearchParams();
        if (start_date) params.append('start_date', start_date);
        if (end_date) params.append('end_date', end_date);
        if (rider_id) params.append('rider_id', rider_id);

        const response = await fetch(`${API_BASE}/api/financial/reports/riders-detailed?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();

        if (data.success) {
            lastRiderData = data.riders;
            displayRiderReports(data.riders);
        }
    } catch (error) {
        console.error('Error loading rider reports:', error);
    }
}

function displayRiderReports(riders) {
    const tbody = document.getElementById('riderReportsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    riders.forEach(r => {
        const feesEarned = parseFloat(r.total_fees || 0);
        const cashCollection = parseFloat(r.cash_collection || 0);
        const cashSubmission = parseFloat(r.cash_submission || 0);
        const pendingCash = cashCollection - cashSubmission;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${r.first_name} ${r.last_name}</td>
            <td>${r.email}<br>${r.phone || '-'}</td>
            <td>${r.total_assigned}</td>
            <td>${r.total_delivered}</td>
            <td>${r.total_cancelled}</td>
            <td>Rs  ${feesEarned.toFixed(2)}</td>
            <td>Rs  ${cashCollection.toFixed(2)}</td>
            <td>Rs  ${cashSubmission.toFixed(2)}</td>
            <td style="font-weight: bold; color: ${pendingCash > 0 ? 'red' : (pendingCash < 0 ? 'blue' : 'green')}">Rs  ${pendingCash.toFixed(2)}</td>
        `;
        tbody.appendChild(row);
    });
}

function shouldShowStoreReportPendingOnly() {
    const checkbox = document.getElementById('storeReportPendingOnly');
    return checkbox ? checkbox.checked : false;
}

function applyStoreReportFilters(stores) {
    const pendingOnly = shouldShowStoreReportPendingOnly();
    if (!pendingOnly) return stores || [];
    return (stores || []).filter(s => {
        const pending = parseFloat(s.pending_settlement || 0);
        return pending > 0;
    });
}

function normalizeStoreReportRow(store) {
    const row = { ...(store || {}) };
    const paymentTerm = String(row.payment_term || '').toLowerCase().trim();
    const payable = Number(row.total_payable || 0);
    const paid = Number(row.total_paid || 0);
    const settlementBalance = row.current_settlement_balance;
    const accountingBalance = row.accounting_pending_balance;
    row.pending_settlement = paymentTerm === 'cash only' || paymentTerm === 'cash with discount'
        ? 0
        : Number.isFinite(Number(accountingBalance))
            ? Math.max(0, Number(accountingBalance || 0))
            : Math.max(0, payable - paid);
    if (Number.isFinite(Number(settlementBalance))) {
        row.current_settlement_balance = Math.max(0, Number(settlementBalance || 0));
    }
    row.accounting_pending_balance = Math.max(0, payable - paid);
    return row;
}

function isCreditStoreTerm(term) {
    const t = String(term || '').toLowerCase().trim();
    return t === 'credit' || t === 'credit with discount';
}

function formatDateOnly(value) {
    if (!value) return '';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    return text;
}

function formatGraceDueCell(store) {
    if (!isCreditStoreTerm(store?.payment_term)) return '-';
    const dueDateRaw = store?.grace_due_date || store?.payment_grace_due_date || null;
    const dueDate = formatDateOnly(dueDateRaw);
    if (!dueDate) return '-';
    const rawDays = store?.grace_days_left;
    const daysLeft = Number.isFinite(Number(rawDays)) ? Number(rawDays) : null;
    if (daysLeft === null) return String(dueDate);
    if (daysLeft === 0) return `${dueDate} (Due today)`;
    if (daysLeft > 0) return `${dueDate} (${daysLeft} day${daysLeft === 1 ? '' : 's'})`;
    const overdue = Math.abs(daysLeft);
    return `${dueDate} (Overdue by ${overdue} day${overdue === 1 ? '' : 's'})`;
}

function updateStoreReportDueTotals(stores) {
    const countEl = document.getElementById('storeReportDueStoreCount');
    const amountEl = document.getElementById('storeReportDuePayable');
    if (!countEl && !amountEl) return;

    const rows = stores || [];
    const totalStores = rows.length;
    const totalPayable = rows.reduce((sum, s) => sum + (parseFloat(s.pending_settlement || 0) || 0), 0);

    if (countEl) countEl.textContent = String(totalStores);
    if (amountEl) amountEl.textContent = `Rs ${totalPayable.toFixed(2)}`;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function showStoreDueOrders(store) {
    const storeId = Number(store?.id || store?.store_id || 0);
    if (!storeId) {
        showError('Store Due Orders', 'Store ID not found.');
        return;
    }

    const modal = document.getElementById('storeDueOrdersModal');
    const content = document.getElementById('storeDueOrdersContent');
    if (!modal || !content) return;

    const storeName = store?.name || `Store #${storeId}`;
    content.innerHTML = 'Loading due orders...';
    if (typeof showModal === 'function') showModal('storeDueOrdersModal');

    try {
        const response = await fetch(`${API_BASE}/api/financial/store-settlements/unsettled-items?store_id=${storeId}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();
        if (!data.success) {
            content.innerHTML = `<div style="color:#b91c1c;">${escapeHtml(data.message || 'Failed to load due orders.')}</div>`;
            return;
        }

        const items = Array.isArray(data.items) ? data.items : [];
        if (!items.length) {
            content.innerHTML = `<div>No due orders found for <strong>${escapeHtml(storeName)}</strong>.</div>`;
            return;
        }

        const summary = data.summary || {};
        const grouped = new Map();
        items.forEach(item => {
            const key = String(item.order_id || item.order_number || '');
            if (!key) return;
            if (!grouped.has(key)) {
                grouped.set(key, {
                    order_number: item.order_number || '-',
                    order_date: item.order_date || item.order_date,
                    items_count: 0,
                    gross: 0,
                    discount: 0,
                    net: 0,
                    payable: 0
                });
            }
            const group = grouped.get(key);
            group.items_count += 1;
            group.gross += Number(item.line_gross || 0);
            group.discount += Number(item.line_discount || 0);
            group.net += Number(item.line_net || 0);
            group.payable += Number(item.line_payable || 0);
        });

        const rows = Array.from(grouped.values()).sort((a, b) => {
            const aTime = a.order_date ? new Date(a.order_date).getTime() : 0;
            const bTime = b.order_date ? new Date(b.order_date).getTime() : 0;
            return aTime - bTime;
        });

        const rowsHtml = rows.map(row => `
            <tr>
                <td>${escapeHtml(row.order_number)}</td>
                <td>${row.order_date ? new Date(row.order_date).toLocaleString() : '-'}</td>
                <td>${row.items_count}</td>
                <td>${formatFinancialReportCurrency(row.gross)}</td>
                <td>${formatFinancialReportCurrency(row.discount)}</td>
                <td>${formatFinancialReportCurrency(row.payable)}</td>
            </tr>
        `).join('');

        content.innerHTML = `
            <div style="margin-bottom:0.75rem;">
                <strong>Store:</strong> ${escapeHtml(storeName)}<br>
                <strong>Orders:</strong> ${rows.length} |
                <strong>Items:</strong> ${items.length} |
                <strong>Net Payable:</strong> ${formatFinancialReportCurrency(summary.net_amount || 0)}
            </div>
            <div class="table-container" style="margin-top:0.5rem;">
                <table>
                    <thead>
                        <tr>
                            <th>Order #</th>
                            <th>Date</th>
                            <th>Items</th>
                            <th>Gross</th>
                            <th>Discount</th>
                            <th>Payable</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
        `;
    } catch (error) {
        console.error('Error loading store due orders:', error);
        content.innerHTML = '<div style="color:#b91c1c;">Failed to load due orders.</div>';
    }
}

async function loadStoreReports() {
    try {
        const start_date = document.getElementById('storeReportStartDate')?.value;
        const end_date = document.getElementById('storeReportEndDate')?.value;
        const store_id = document.getElementById('storeReportSelect')?.value || 'all';
        
        const params = new URLSearchParams();
        if (start_date) params.append('start_date', start_date);
        if (end_date) params.append('end_date', end_date);
        if (store_id) params.append('store_id', store_id);

        const response = await fetch(`${API_BASE}/api/financial/reports/stores-detailed?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();

        if (data.success) {
            lastStoreData = (data.stores || []).map(normalizeStoreReportRow);
            const filtered = applyStoreReportFilters(lastStoreData);
            displayStoreReports(filtered);
            updateStoreReportDueTotals(filtered);
            const details = data.store_details
                ? { ...data.store_details, store: normalizeStoreReportRow(data.store_details.store) }
                : null;
            displayStoreReportDetails(details, store_id);
        }
    } catch (error) {
        console.error('Error loading store reports:', error);
    }
}

function displayStoreReportDetails(details, storeId) {
    const modal = document.getElementById('storeReportDetailsModal');
    const title = document.getElementById('storeReportDetailsTitle');
    const content = document.getElementById('storeReportDetailsContent');
    if (!modal || !content) return;

    if (!storeId || storeId === 'all' || !details) {
        content.innerHTML = '';
        if (typeof hideModal === 'function') hideModal('storeReportDetailsModal');
        return;
    }

    const storeName = details.store?.name || 'Selected Store';
    if (title) title.textContent = `${storeName} Details`;
    const orders = Array.isArray(details.delivered_orders) ? details.delivered_orders : [];
    const payments = Array.isArray(details.payments) ? details.payments : [];
    const pendingSettlement = Number(details.store?.pending_settlement || 0);
    const orderTotals = orders.reduce((acc, order) => {
        acc.earnings += Number(order.total_earnings || 0);
        acc.payable += Number(order.total_payable || 0);
        return acc;
    }, { earnings: 0, payable: 0 });
    const paymentTotal = payments.reduce((sum, payment) => sum + Number(payment.net_amount || 0), 0);

    const orderRows = orders.length ? orders.map(order => `
        <tr>
            <td>${escapeHtml(order.order_number || '-')}</td>
            <td>${order.order_date ? new Date(order.order_date).toLocaleString() : '-'}</td>
            <td>${escapeHtml(order.payment_method || '-')}</td>
            <td>${escapeHtml(order.payment_status || '-')}</td>
            <td>${order.payment_date ? new Date(order.payment_date).toLocaleString() : '-'}</td>
            <td>${formatFinancialReportCurrency(order.total_earnings || 0)}</td>
            <td>${formatFinancialReportCurrency(order.total_payable || 0)}</td>
        </tr>
    `).join('') : '<tr><td colspan="7" style="text-align:center; padding:1rem;">No delivered orders found</td></tr>';

    const paymentRows = payments.length ? payments.map(payment => `
        <tr>
            <td>${escapeHtml(payment.settlement_number || '-')}</td>
            <td>${payment.settlement_date ? formatDateOnly(payment.settlement_date) : '-'}</td>
            <td>${payment.paid_at ? new Date(payment.paid_at).toLocaleString() : '-'}</td>
            <td>${escapeHtml(payment.payment_method || '-')}</td>
            <td>${escapeHtml(payment.status || '-')}</td>
            <td>${formatFinancialReportCurrency(payment.net_amount || 0)}</td>
        </tr>
    `).join('') : '<tr><td colspan="6" style="text-align:center; padding:1rem;">No paid settlements found</td></tr>';

    content.innerHTML = `
        <div class="orders-table-card store-report-detail-card">
            <div class="orders-section-head">
                <h3>Delivered Orders</h3>
                <span class="orders-section-pill">
                    ${orders.length} Orders | Earnings ${formatFinancialReportCurrency(orderTotals.earnings)} | Payable ${formatFinancialReportCurrency(orderTotals.payable)} | Pending ${formatFinancialReportCurrency(pendingSettlement)}
                </span>
            </div>
            <div class="table-container orders-table-wrap">
            <table class="orders-style-table store-report-detail-table">
                <colgroup>
                    <col class="store-detail-col-order">
                    <col class="store-detail-col-date">
                    <col class="store-detail-col-method">
                    <col class="store-detail-col-status">
                    <col class="store-detail-col-date">
                    <col class="store-detail-col-money">
                    <col class="store-detail-col-money">
                </colgroup>
                <thead>
                    <tr>
                        <th><span class="orders-th-stack"><span>Order</span><span>#</span></span></th>
                        <th><span class="orders-th-stack"><span>Order</span><span>Date</span></span></th>
                        <th><span class="orders-th-stack"><span>Payment</span><span>Method</span></span></th>
                        <th><span class="orders-th-stack"><span>Payment</span><span>Status</span></span></th>
                        <th><span class="orders-th-stack"><span>Payment</span><span>Date</span></span></th>
                        <th>Earnings</th>
                        <th>Payable</th>
                    </tr>
                </thead>
                <tbody>${orderRows}</tbody>
            </table>
            </div>
        </div>
        <div class="orders-table-card store-report-detail-card">
            <div class="orders-section-head">
                <h3>Payments</h3>
                <span class="orders-section-pill orders-section-pill-muted">
                    ${payments.length} Paid Settlements | Total ${formatFinancialReportCurrency(paymentTotal)}
                </span>
            </div>
            <div class="table-container orders-table-wrap">
            <table class="orders-style-table store-report-detail-table store-report-payments-table">
                <colgroup>
                    <col class="store-detail-col-settlement">
                    <col class="store-detail-col-date">
                    <col class="store-detail-col-date">
                    <col class="store-detail-col-method">
                    <col class="store-detail-col-status">
                    <col class="store-detail-col-money">
                </colgroup>
                <thead>
                    <tr>
                        <th><span class="orders-th-stack"><span>Settlement</span><span>#</span></span></th>
                        <th><span class="orders-th-stack"><span>Settlement</span><span>Date</span></span></th>
                        <th><span class="orders-th-stack"><span>Paid</span><span>Date</span></span></th>
                        <th>Method</th>
                        <th>Status</th>
                        <th>Amount</th>
                    </tr>
                </thead>
                <tbody>${paymentRows}</tbody>
            </table>
            </div>
        </div>
    `;
    if (typeof showModal === 'function') {
        showModal('storeReportDetailsModal');
    } else {
        modal.style.display = 'block';
    }
}

function displayStoreReports(stores) {
    const tbody = document.getElementById('storeReportsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!stores || stores.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:1rem;">No stores found</td></tr>';
        updateStoreReportDueTotals([]);
        return;
    }

    (stores || []).forEach(s => {
        const earnings = parseFloat(s.total_earnings || 0);
        const payable = parseFloat(s.total_payable || 0);
        const paid = parseFloat(s.total_paid || 0);
        const pending = parseFloat(s.pending_settlement || 0);
        const creatableBalance = parseFloat(s.current_settlement_balance || 0);
        const graceStart = isCreditStoreTerm(s.payment_term)
            ? (formatDateOnly(s.payment_grace_start_date) || '-')
            : '-';
        const graceDueText = formatGraceDueCell(s);

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${s.payment_term || 'No Payment Term'}</td>
            <td>${s.name}</td>
            <td>${s.email}<br>${s.phone || '-'}</td>
            <td>${s.total_orders}</td>
            <td>${graceStart}</td>
            <td>${graceDueText}</td>
            <td>Rs  ${earnings.toFixed(2)}</td>
            <td>Rs  ${payable.toFixed(2)}</td>
            <td>Rs  ${paid.toFixed(2)}</td>
            <td style="color: ${pending > 0 ? 'orange' : 'inherit'}">Rs  ${pending.toFixed(2)}</td>
        `;
        row.title = 'Click to view store details';
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => {
            const storeSelect = document.getElementById('storeReportSelect');
            if (storeSelect) storeSelect.value = String(s.id);
            loadStoreReports();
        });
        if (creatableBalance > 0) {
            row.title = 'Click to view store details. Double-click to view due orders.';
            row.addEventListener('dblclick', (event) => {
                event.stopPropagation();
                showStoreDueOrders(s);
            });
        } else if (pending > 0) {
            row.title = 'Click to view store details. Pending balance may already be in created settlements.';
        }
        tbody.appendChild(row);
    });
}

function getStorePaymentTermGroup(term) {
    const normalized = String(term || '').toLowerCase().trim();
    if (normalized === 'cash only') {
        return 'Cash Only';
    }
    if (normalized === 'cash with discount') {
        return 'Cash With Discount';
    }
    if (normalized === 'credit') {
        return 'Credit';
    }
    if (normalized === 'credit with discount') {
        return 'Credit With Discount';
    }
    return 'Other / Unassigned';
}

async function loadStorePaymentTermReport() {
    try {
        const response = await fetch(`${API_BASE}/api/financial/reports/stores-detailed?store_id=all`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();
        if (data.success) {
            displayStorePaymentTermGroups((data.stores || []).map(normalizeStoreReportRow));
        }
    } catch (error) {
        console.error('Error loading store payment term report:', error);
    }
}

function displayStorePaymentTermGroups(stores) {
    const tbody = document.getElementById('storePaymentTermGroupsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const groupedStores = new Map();
    (stores || []).forEach((store) => {
        const groupName = getStorePaymentTermGroup(store.payment_term);
        if (!groupedStores.has(groupName)) {
            groupedStores.set(groupName, []);
        }
        groupedStores.get(groupName).push(store);
    });

    const orderedGroups = [
        'Cash Only',
        'Cash With Discount',
        'Credit',
        'Credit With Discount',
        'Other / Unassigned'
    ];

    orderedGroups.forEach((groupName) => {
        const storesInGroup = (groupedStores.get(groupName) || [])
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

        if (!storesInGroup.length) return;

        const totalPayable = storesInGroup.reduce(
            (sum, store) => sum + Number(store.pending_settlement || 0),
            0
        );

        const groupRow = document.createElement('tr');
        groupRow.innerHTML = `
            <td colspan="5" style="background:#f8fafc; font-weight:700;">
                ${groupName} (${storesInGroup.length} store${storesInGroup.length === 1 ? '' : 's'}) |
                Total Payable: Rs ${totalPayable.toFixed(2)}
            </td>
        `;
        tbody.appendChild(groupRow);

        storesInGroup.forEach((store) => {
            const payable = Number(store.pending_settlement || 0);
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${groupName}</td>
                <td>${store.payment_term || 'No Payment Term'}</td>
                <td>${store.name}</td>
                <td>${store.email}<br>${store.phone || '-'}</td>
                <td style="color: ${payable > 0 ? 'orange' : 'inherit'}">Rs ${payable.toFixed(2)}</td>
            `;
            tbody.appendChild(row);
        });
    });
}

function exportRiderReport() {
    if (!lastRiderData || lastRiderData.length === 0) {
        showWarning('No Data', 'No rider report data to export. Generate a report first.');
        return;
    }

    const headers = ['Rider Name', 'Email', 'Phone', 'Assigned', 'Delivered', 'Cancelled', 'delivery charges', 'Cash Collected', 'Cash Submitted', 'Pending Cash'];
    const rows = lastRiderData.map(r => {
        const cashCollection = parseFloat(r.cash_collection || 0);
        const cashSubmission = parseFloat(r.cash_submission || 0);
        return [
            `${r.first_name} ${r.last_name}`,
            r.email,
            r.phone || '',
            r.total_assigned,
            r.total_delivered,
            r.total_cancelled,
            parseFloat(r.total_fees || 0).toFixed(2),
            cashCollection.toFixed(2),
            cashSubmission.toFixed(2),
            (cashCollection - cashSubmission).toFixed(2)
        ];
    });

    downloadCSV('rider_financial_report.csv', headers, rows);
}

function exportStoreReport() {
    const exportRows = applyStoreReportFilters(lastStoreData || []);
    if (!exportRows || exportRows.length === 0) {
        showWarning('No Data', 'No store report data to export. Generate a report first.');
        return;
    }

    const headers = [
        'Payment Term',
        'Store Name',
        'Email',
        'Phone',
        'Total Orders',
        'Grace Start Date',
        'Next Due Date (Days Left)',
        'Total Earnings',
        'Total Payable',
        'Total Paid',
        'Pending Settlement'
    ];
    const rows = exportRows.map(s => [
        s.payment_term || 'No Payment Term',
        s.name,
        s.email,
        s.phone || '',
        s.total_orders,
        isCreditStoreTerm(s.payment_term) ? formatDateOnly(s.payment_grace_start_date) : '',
        formatGraceDueCell(s),
        parseFloat(s.total_earnings || 0).toFixed(2),
        parseFloat(s.total_payable || 0).toFixed(2),
        parseFloat(s.total_paid || 0).toFixed(2),
        parseFloat(s.pending_settlement || 0).toFixed(2)
    ]);

    downloadCSV('store_financial_report.csv', headers, rows);
}

function downloadCSV(filename, headers, rows) {
    let csvContent = "data:text/csv;charset=utf-8," 
        + headers.join(",") + "\n"
        + rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(",")).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Order Wise Detail Summary Functions

let lastOrderDetailData = null;

async function populateOrderDetailFilters() {
    try {
        const [storesRes, ridersRes] = await Promise.all([
            fetch('/api/stores').then(res => res.json()),
            fetch('/api/riders').then(res => res.json())
        ]);

        const stores = storesRes.stores || [];
        const riders = ridersRes.riders || [];

        const storeSelect = document.getElementById('orderDetailStore');
        const riderSelect = document.getElementById('orderDetailRider');

        if (storeSelect) {
            storeSelect.innerHTML = '<option value="">All Stores</option>';
            stores.forEach(s => {
                storeSelect.innerHTML += `<option value="${s.id}">${s.name}</option>`;
            });
        }

        if (riderSelect) {
            riderSelect.innerHTML = '<option value="">All Riders</option>';
            riders.forEach(r => {
                const name = r.full_name || `${r.first_name} ${r.last_name}`;
                riderSelect.innerHTML += `<option value="${r.id}">${name}</option>`;
            });
        }
    } catch (error) {
        console.error('Error populating filters:', error);
        showError('Failed to load filter data');
    }
}

async function generateOrderWiseDetailReport() {
    const fromDate = document.getElementById('orderDetailFrom').value;
    const toDate = document.getElementById('orderDetailTo').value;
    const storeId = document.getElementById('orderDetailStore').value;
    const riderId = document.getElementById('orderDetailRider').value;

    if (!fromDate || !toDate) {
        showWarning('Validation Error', 'Please select date range');
        return;
    }

    try {
        const queryParams = new URLSearchParams({
            from: fromDate,
            to: toDate,
            store_id: storeId,
            rider_id: riderId
        });

        const response = await fetch(`/api/financial/order-wise-detail-report?${queryParams}`);
        if (!response.ok) throw new Error('Failed to fetch report');
        
        const data = await response.json();
        lastOrderDetailData = data;
        
        displayOrderDetailReport(data);
        document.getElementById('orderDetailResult').style.display = 'block';
    } catch (error) {
        console.error('Error generating report:', error);
        showError('Failed to generate report');
    }
}

function displayOrderDetailReport(data) {
    const container = document.getElementById('orderDetailPreviewContent');
    if (!data || data.length === 0) {
        container.innerHTML = '<p class="text-center">No orders found for the selected criteria.</p>';
        return;
    }

    // Calculate totals
    const totals = data.reduce((acc, order) => {
        acc.item_sales_gross += parseFloat(order.item_sales_gross || 0);
        acc.delivery_fee += parseFloat(order.delivery_fee || 0);
        acc.total_in += parseFloat(order.total_in || 0);
        acc.store_commission += parseFloat(order.store_commission || 0);
        acc.platform_profit += parseFloat(order.platform_profit || 0);
        acc.payable_to_store += parseFloat(order.payable_to_store || 0);
        return acc;
    }, {
        item_sales_gross: 0,
        delivery_fee: 0,
        total_in: 0,
        store_commission: 0,
        platform_profit: 0,
        payable_to_store: 0
    });

    let html = `
        <table class="table table-bordered table-striped" style="font-size: 0.85em;">
            <thead class="thead-dark">
                <tr>
                    <th>Date</th>
                    <th>Order #</th>
                    <th>Store</th>
                    <th>Rider</th>
                    <th class="text-right">Item Sales</th>
                    <th class="text-right">Del. Fee</th>
                    <th class="text-right">Total In</th>
                    <th class="text-right">Store Comm.</th>
                    <th class="text-right">Net Profit</th>
                    <th class="text-right">Payable to Store</th>
                </tr>
            </thead>
            <tbody>
    `;

    data.forEach(order => {
        html += `
            <tr>
                <td>${new Date(order.created_at).toLocaleDateString()}</td>
                <td>${order.order_number}</td>
                <td>${order.store_names}</td>
                <td>${order.rider_name || '-'}</td>
                <td class="text-right">Rs ${parseFloat(order.item_sales_gross).toFixed(2)}</td>
                <td class="text-right">Rs ${parseFloat(order.delivery_fee).toFixed(2)}</td>
                <td class="text-right"><strong>Rs ${parseFloat(order.total_in).toFixed(2)}</strong></td>
                <td class="text-right">Rs ${parseFloat(order.store_commission).toFixed(2)}</td>
                <td class="text-right" style="color: green;">Rs ${parseFloat(order.platform_profit).toFixed(2)}</td>
                <td class="text-right" style="color: #d35400;">Rs ${parseFloat(order.payable_to_store).toFixed(2)}</td>
            </tr>
        `;
    });

    // Totals row
    html += `
            <tr style="font-weight: bold; background-color: #f2f2f2; border-top: 2px solid #333;">
                <td colspan="4" class="text-right">TOTALS:</td>
                <td class="text-right">Rs ${totals.item_sales_gross.toFixed(2)}</td>
                <td class="text-right">Rs ${totals.delivery_fee.toFixed(2)}</td>
                <td class="text-right">Rs ${totals.total_in.toFixed(2)}</td>
                <td class="text-right">Rs ${totals.store_commission.toFixed(2)}</td>
                <td class="text-right">Rs ${totals.platform_profit.toFixed(2)}</td>
                <td class="text-right">Rs ${totals.payable_to_store.toFixed(2)}</td>
            </tr>
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

function downloadOrderWiseDetailPdf() {
    if (!lastOrderDetailData || lastOrderDetailData.length === 0) {
        showWarning('No Data', 'Please generate a report first');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4'); // Landscape

    doc.setFontSize(16);
    doc.text('Order Wise Detail Summary Report', 14, 15);
    
    doc.setFontSize(10);
    const fromDate = document.getElementById('orderDetailFrom').value;
    const toDate = document.getElementById('orderDetailTo').value;
    doc.text(`Period: ${fromDate} to ${toDate}`, 14, 22);

    const headers = [['Date', 'Order #', 'Store', 'Rider', 'Item Sales', 'Del. Fee', 'Total In', 'Store Comm.', 'Net Profit', 'Payable']];
    
    const body = lastOrderDetailData.map(order => [
        new Date(order.created_at).toLocaleDateString(),
        order.order_number,
        order.store_names,
        order.rider_name || '-',
        `Rs ${parseFloat(order.item_sales_gross).toFixed(2)}`,
        `Rs ${parseFloat(order.delivery_fee).toFixed(2)}`,
        `Rs ${parseFloat(order.total_in).toFixed(2)}`,
        `Rs ${parseFloat(order.store_commission).toFixed(2)}`,
        `Rs ${parseFloat(order.platform_profit).toFixed(2)}`,
        `Rs ${parseFloat(order.payable_to_store).toFixed(2)}`
    ]);

    // Calculate totals
    const totals = lastOrderDetailData.reduce((acc, order) => {
        acc.item_sales_gross += parseFloat(order.item_sales_gross || 0);
        acc.delivery_fee += parseFloat(order.delivery_fee || 0);
        acc.total_in += parseFloat(order.total_in || 0);
        acc.store_commission += parseFloat(order.store_commission || 0);
        acc.platform_profit += parseFloat(order.platform_profit || 0);
        acc.payable_to_store += parseFloat(order.payable_to_store || 0);
        return acc;
    }, {
        item_sales_gross: 0, delivery_fee: 0, total_in: 0, store_commission: 0, platform_profit: 0, payable_to_store: 0
    });

    body.push([
        'TOTALS', '', '', '',
        `Rs ${totals.item_sales_gross.toFixed(2)}`,
        `Rs ${totals.delivery_fee.toFixed(2)}`,
        `Rs ${totals.total_in.toFixed(2)}`,
        `Rs ${totals.store_commission.toFixed(2)}`,
        `Rs ${totals.platform_profit.toFixed(2)}`,
        `Rs ${totals.payable_to_store.toFixed(2)}`
    ]);

    doc.autoTable({
        head: headers,
        body: body,
        startY: 25,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [41, 128, 185] },
        footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' }
    });

doc.save(`Order_Wise_Detail_Summary_${fromDate}_to_${toDate}.pdf`);
}

// Ensure inline handlers in admin.html can always resolve these actions.
if (typeof window !== 'undefined') {
    window.generateFinancialReport = generateFinancialReport;
    window.loadFinancialReports = loadFinancialReports;
}








