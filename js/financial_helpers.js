
// Helper functions for dynamic payee/payer selection
async function fetchFinancialEntities(type) {
    try {
        const response = await fetch(`${API_BASE}/api/financial/entities?type=${type}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json();
        return data.success ? data.data : [];
    } catch (error) {
        console.error(`Error fetching ${type}:`, error);
        return [];
    }
}

async function updateVoucherTypeUI(type, nameInput, select, hidden, addBtn) {
    nameInput.value = '';
    if (hidden) hidden.value = '';
    select.innerHTML = '<option value="">Select...</option>';
    
    if (['store', 'rider', 'employee', 'expense', 'customer', 'bank'].includes(type)) {
        nameInput.style.display = 'none';
        nameInput.removeAttribute('required');
        select.style.display = 'block';
        select.setAttribute('required', 'true');
        
        if (addBtn) addBtn.style.display = (type === 'expense' || type === 'bank') ? 'block' : 'none';
        if (addBtn.style.display === 'block') {
            if (type === 'bank') {
                addBtn.textContent = 'Add New Bank';
                addBtn.title = 'Add New Bank';
            } else {
                addBtn.textContent = '+';
                addBtn.title = 'Add New Expense Type';
            }
        }
        
        const entities = await fetchFinancialEntities(type);
        entities.forEach(entity => {
            const option = document.createElement('option');
            option.value = entity.id; // ID for entities, Name for expense types
            option.textContent = entity.name;
            option.dataset.name = entity.name;
            select.appendChild(option);
        });
    } else {
        nameInput.style.display = 'block';
        nameInput.setAttribute('required', 'true');
        select.style.display = 'none';
        select.removeAttribute('required');
        
        if (addBtn) addBtn.style.display = 'none';
    }
}

function handleVoucherTypeChange(typeSelectId, nameInputId, selectId, hiddenId, addBtnId) {
    const typeSelect = document.getElementById(typeSelectId);
    const nameInput = document.getElementById(nameInputId);
    const select = document.getElementById(selectId);
    const hidden = document.getElementById(hiddenId);
    const addBtn = document.getElementById(addBtnId);

    if (!typeSelect || !nameInput || !select) return;

    typeSelect.addEventListener('change', async () => {
        await updateVoucherTypeUI(typeSelect.value, nameInput, select, hidden, addBtn);
    });

    select.addEventListener('change', () => {
        const selectedOption = select.options[select.selectedIndex];
        if (selectedOption.value) {
            if (hidden) hidden.value = selectedOption.value;
            nameInput.value = selectedOption.dataset.name || selectedOption.textContent;
        } else {
            if (hidden) hidden.value = '';
            nameInput.value = '';
        }
    });
    
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            if (typeSelect.value === 'bank') {
                if (typeof openModal === 'function') {
                    // Explicitly set button text to ensure it's correct
                    const bankModal = document.getElementById('addBankModal');
                    if (bankModal) {
                        const btn = bankModal.querySelector('.btn-primary');
                        if (btn) btn.textContent = 'Add New Bank';
                        // Force layout update to ensure text change is rendered
                        btn.style.display = 'none';
                        btn.offsetHeight; // Trigger reflow
                        btn.style.display = '';
                    }
                    openModal('addBankModal');
                } else {
                    console.error('openModal function not found');
                }
                return;
            }

            const newType = prompt("Enter new Expense Type:");
            if (newType && newType.trim()) {
                const option = document.createElement('option');
                option.value = newType.trim();
                option.textContent = newType.trim();
                option.dataset.name = newType.trim();
                option.selected = true;
                select.appendChild(option);
                select.dispatchEvent(new Event('change'));
            }
        });
    }
}

// The Ledger Account box on the voucher forms. It shows the account the voucher will post to as it is
// typed; a person can change it, unless the party has its own balance (then the server fixes it).
let ledgerAccountsRequest = null;
function loadLedgerAccounts() {
    ledgerAccountsRequest = ledgerAccountsRequest || fetch(`${API_BASE}/api/financial/voucher-accounts`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
    }).then((response) => response.json()).then((data) => {
        if (!data.success) throw new Error(data.message || 'No accounts');
        return data.accounts;
    }).catch((error) => {
        console.error('Error loading ledger accounts:', error);
        ledgerAccountsRequest = null;
        return [];
    });
    return ledgerAccountsRequest;
}

const ledgerAccountLabel = (account) => `${account.code} ${account.name}`;

// "+ New account..." right under the first choice (Automatic / Select account), so it is seen
// without scrolling. Without the right it shows greyed out and names the right to ask for.
const NEW_ACCOUNT = '__new_account__';
async function offerNewAccount(select) {
    if (typeof window.canManageLedgerAccounts !== 'function') return;
    const allowed = await window.canManageLedgerAccounts();
    let option = select.querySelector(`option[value="${NEW_ACCOUNT}"]`);
    if (!option) {
        option = new Option('', NEW_ACCOUNT);
        select.insertBefore(option, select.options[1] || null);
    }
    option.textContent = allowed ? '+ New account...' : '+ New account (needs the right: Chart of accounts, add and edit)';
    option.disabled = !allowed;
}

// Opens New Account; on save the lists reload with it and it is chosen. Cancel puts back the previous choice.
async function chooseNewAccount(select, previous, type, valueOf, refill) {
    const account = await window.addLedgerAccountFrom({ type });
    if (!account) { select.value = previous; return null; }
    ledgerAccountsRequest = null;
    await refill();
    const value = valueOf(account);
    if (!select.querySelector(`option[value="${CSS.escape(value)}"]`)) select.add(new Option(ledgerAccountLabel(account), value));
    select.value = value;
    return account;
}

function createLedgerAccountField({ selectId, hintId, kind, read, watch }) {
    const select = document.getElementById(selectId);
    const hint = document.getElementById(hintId);
    if (!select) return null;
    let byHand = false;
    let locked = false;
    let timer = null;
    let turn = 0;
    let previous = '';

    function setOptions(list, chosen) {
        const options = list.filter((a) => a[kind] || (chosen && a.code === chosen));
        select.innerHTML = '<option value="">Automatic</option>';
        options.forEach((a) => select.add(new Option(ledgerAccountLabel(a), a.code)));
        offerNewAccount(select);
    }

    async function refresh() {
        const doc = read();
        const mine = ++turn;
        if (doc === null) {
            locked = false;
            select.disabled = false;
            setOptions(await loadLedgerAccounts());
            if (mine === turn) { select.value = ''; if (hint) hint.textContent = ''; }
            return;
        }
        const [list, answer] = await Promise.all([
            loadLedgerAccounts(),
            fetch(`${API_BASE}/api/financial/voucher-accounts?${new URLSearchParams({ kind, ...doc })}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
            }).then((response) => response.json()).catch(() => null)
        ]);
        if (mine !== turn || !answer?.success) return;
        const current = byHand ? select.value : '';
        const suggested = answer.suggested.code;
        locked = answer.suggested.locked;
        setOptions(list, locked || !byHand ? suggested : (current || suggested));
        if (!select.querySelector(`option[value="${suggested}"]`)) {
            const account = list.find((a) => a.code === suggested);
            if (account) select.add(new Option(ledgerAccountLabel(account), account.code));
        }
        select.disabled = locked;
        select.value = locked ? suggested : (byHand ? current : suggested);
        if (hint) {
            hint.textContent = locked
                ? 'Fixed: this party has its own balance in the ledger.'
                : (byHand ? 'Chosen by you.' : 'Suggested from the details above. You can change it.');
        }
    }

    const later = () => {
        clearTimeout(timer);
        timer = setTimeout(refresh, 350);
    };
    watch.forEach((id) => {
        const field = document.getElementById(id);
        field?.addEventListener('change', later);
        field?.addEventListener('input', later);
    });
    select.addEventListener('focus', () => { previous = select.value; });
    select.addEventListener('change', async () => {
        if (select.value === NEW_ACCOUNT) {
            // A receipt usually needs an income account; payments and expenses an expense account.
            const account = await chooseNewAccount(select, previous, kind === 'receipt' ? 'income' : 'expense',
                (a) => a.code, async () => setOptions(await loadLedgerAccounts(), select.value));
            byHand = Boolean(account) || (previous !== '');
            if (hint) hint.textContent = account ? 'Chosen by you.' : hint.textContent;
            previous = select.value;
            return;
        }
        byHand = select.value !== '';
        previous = select.value;
        if (hint) hint.textContent = byHand ? 'Chosen by you.' : 'Picked automatically from the details above.';
    });

    return {
        refresh,
        reset() {
            byHand = false;
            return refresh();
        },
        async show(code) {
            byHand = false;
            await refresh();
            if (!code || locked) return;
            byHand = true;
            if (!select.querySelector(`option[value="${code}"]`)) {
                const account = (await loadLedgerAccounts()).find((a) => a.code === code);
                if (account) select.add(new Option(ledgerAccountLabel(account), account.code));
            }
            select.value = code;
            if (hint) hint.textContent = 'Chosen by you.';
        },
        value: () => (locked ? '' : select.value)
    };
}

// A journal entry's account: the full chart. An old entry keeps its own wording until it is changed.
async function fillJournalAccount(select, current) {
    const accounts = await loadLedgerAccounts();
    select.innerHTML = '<option value="">Select account...</option>';
    accounts.forEach((account) => select.add(new Option(ledgerAccountLabel(account), ledgerAccountLabel(account))));
    if (current && ![...select.options].some((option) => option.value === current)) select.add(new Option(current, current));
    if (current) select.value = current;
    await offerNewAccount(select);
    if (!select.dataset.newAccountReady) {
        select.dataset.newAccountReady = '1';
        let previous = select.value;
        select.addEventListener('focus', () => { previous = select.value; });
        select.addEventListener('change', async () => {
            if (select.value !== NEW_ACCOUNT) { previous = select.value; return; }
            await chooseNewAccount(select, previous, undefined, (a) => ledgerAccountLabel(a), async () => {
                const keep = select.value;
                await fillJournalAccount(select, keep === NEW_ACCOUNT ? previous : keep);
            });
            previous = select.value;
            select.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }
}
