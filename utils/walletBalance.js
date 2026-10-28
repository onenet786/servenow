// Apply a credit/debit to a wallet with a relative UPDATE so concurrent writers
// can never overwrite each other's change (no read-modify-write of balance).
// Returns the balance after the update (informational; used for balance_after).
async function applyWalletDelta(db, walletId, type, amount) {
  const amt = Number(amount);
  if (type === 'credit') {
    await db.execute(
      'UPDATE wallets SET balance = balance + ?, total_credited = total_credited + ? WHERE id = ?',
      [amt, amt, walletId]
    );
  } else {
    await db.execute(
      'UPDATE wallets SET balance = balance - ?, total_spent = total_spent + ? WHERE id = ?',
      [amt, amt, walletId]
    );
  }
  const [rows] = await db.execute('SELECT balance FROM wallets WHERE id = ?', [walletId]);
  return parseFloat(rows[0]?.balance || 0);
}

module.exports = { applyWalletDelta };
