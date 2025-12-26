const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const { sendSuccess, sendError, sendValidationError, sendServerError } = require('../utils/response');
const { logError } = require('../utils/debugLogger');

const router = express.Router();

const getOrCreateWallet = async (db, userId) => {
    const [wallets] = await db.execute(
        `SELECT id, balance, total_credited, total_spent, auto_recharge_enabled, 
         auto_recharge_amount, auto_recharge_threshold, last_credited_at 
         FROM wallets WHERE user_id = ?`,
        [userId]
    );

    if (!wallets.length) {
        await db.execute(
            'INSERT INTO wallets (user_id, balance) VALUES (?, ?)',
            [userId, 0]
        );
        const [newWallet] = await db.execute(
            'SELECT id, balance, total_credited, total_spent FROM wallets WHERE user_id = ?',
            [userId]
        );
        return newWallet[0];
    }
    return wallets[0];
};

const validatePaymentMethodOwnership = async (db, paymentMethodId, userId) => {
    const [methods] = await db.execute(
        'SELECT user_id FROM saved_payment_methods WHERE id = ?',
        [paymentMethodId]
    );

    if (!methods.length || methods[0].user_id !== userId) {
        return null;
    }
    return methods[0];
};

const recordWalletTransaction = async (db, walletId, type, amount, description, referenceType, referenceId, balanceAfter) => {
    const [result] = await db.execute(
        `INSERT INTO wallet_transactions (wallet_id, type, amount, description, 
         reference_type, reference_id, balance_after) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [walletId, type, amount, description, referenceType, referenceId, balanceAfter]
    );
    return result.insertId;
};

// ===== WALLET BALANCE & OPERATIONS =====

// Get wallet balance
router.get('/balance', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const wallet = await getOrCreateWallet(req.db, userId);

        return sendSuccess(res, { 
            wallet,
            stripePublicKey: process.env.STRIPE_PUBLIC_KEY 
        }, 'Wallet balance retrieved');

    } catch (error) {
        logError('Get wallet balance', error);
        return sendServerError(res, error);
    }
});

// Top up wallet
router.post('/topup', authenticateToken, [
    body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
    body('paymentMethod').isIn(['card', 'paypal']).withMessage('Invalid payment method')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return sendValidationError(res, errors);
        }

        const userId = req.user.id;
        const { amount, paymentMethod, cardToken, saveCard } = req.body;

        const wallet = await getOrCreateWallet(req.db, userId);
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        const [users] = await req.db.execute(
            'SELECT stripe_customer_id FROM users WHERE id = ?',
            [userId]
        );

        let customerId = users[0]?.stripe_customer_id;

        if (!customerId) {
            const customer = await stripe.customers.create({
                email: req.user.email,
                metadata: { userId }
            });
            customerId = customer.id;
            await req.db.execute(
                'UPDATE users SET stripe_customer_id = ? WHERE id = ?',
                [customerId, userId]
            );
        }

        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100),
            currency: 'pkr',
            customer: customerId,
            payment_method: cardToken,
            confirm: true,
            metadata: { userId, type: 'wallet_topup' }
        });

        if (paymentIntent.status !== 'succeeded') {
            return sendError(res, 'Payment failed', 400);
        }

        const newBalance = parseFloat(wallet.balance || 0) + parseFloat(amount);
        await req.db.execute(
            'UPDATE wallets SET balance = ?, total_credited = total_credited + ?, last_credited_at = NOW() WHERE id = ?',
            [newBalance, amount, wallet.id]
        );

        const transactionId = await recordWalletTransaction(
            req.db, wallet.id, 'credit', amount, 
            `Top-up via ${paymentMethod}`, 'topup', paymentIntent.id, newBalance
        );

        if (saveCard && paymentIntent.payment_method) {
            const pm = await stripe.paymentMethods.retrieve(paymentIntent.payment_method);
            await req.db.execute(
                `INSERT INTO saved_payment_methods (user_id, type, gateway_id, card_last_four, 
                 card_brand, card_expiry_month, card_expiry_year) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [userId, 'card', pm.id, pm.card.last4, pm.card.brand, 
                 pm.card.exp_month, pm.card.exp_year]
            );
        }

        return sendSuccess(res, { 
            transaction_id: transactionId,
            new_balance: newBalance,
            amount_added: amount
        }, 'Wallet topped up successfully', 201);

    } catch (error) {
        logError('Wallet top-up', error);
        return sendServerError(res, error);
    }
});

// ===== WALLET TRANSACTIONS =====

// Get wallet transaction history
router.get('/transactions', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { limit, offset, type } = req.query;
        const limitVal = Math.max(1, parseInt(limit) || 20);
        const offsetVal = Math.max(0, parseInt(offset) || 0);

        // Get wallet ID
        const [wallets] = await req.db.execute(
            'SELECT id FROM wallets WHERE user_id = ?',
            [userId]
        );

        if (!wallets.length) {
            return sendError(res, 'Wallet not found', 404);
        }

        const wallet = wallets[0];

        // Build query
        let query = `SELECT id, type, amount, description, reference_type, 
                    reference_id, balance_after, created_at 
                    FROM wallet_transactions WHERE wallet_id = ?`;
        let params = [wallet.id];

        if (type) {
            query += ' AND type = ?';
            params.push(type);
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limitVal, offsetVal);

        console.log('[wallets] Fetching transactions for user:', userId, 'wallet:', wallet.id, 'query:', query, 'params:', params);
        const [transactions] = await req.db.query(query, params);

        // Get total count
        let countQuery = 'SELECT COUNT(*) as count FROM wallet_transactions WHERE wallet_id = ?';
        let countParams = [wallet.id];

        if (type) {
            countQuery += ' AND type = ?';
            countParams.push(type);
        }

        const [totalResult] = await req.db.query(countQuery, countParams);
        const total = Number(totalResult[0]?.count || 0);

        console.log('[wallets] Found', transactions.length, 'transactions, total:', total);

        return sendSuccess(res, { 
            transactions,
            total,
            limit: limitVal,
            offset: offsetVal
        }, 'Transaction history retrieved');

    } catch (error) {
        logError('Get transactions', error);
        return sendServerError(res, error);
    }
});

// ===== AUTO-RECHARGE =====

// Configure auto-recharge
router.post('/auto-recharge', authenticateToken, [
    body('enabled').isBoolean().withMessage('Enabled must be boolean'),
    body('amount').optional().isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
    body('threshold').optional().isFloat({ min: 0 }).withMessage('Threshold must be valid')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return sendValidationError(res, errors);
        }

        const userId = req.user.id;
        const { enabled, amount, threshold } = req.body;

        const wallet = await getOrCreateWallet(req.db, userId);

        const updateParams = [enabled];
        let updateFields = ['auto_recharge_enabled = ?'];

        if (enabled && amount) {
            updateFields.push('auto_recharge_amount = ?');
            updateParams.push(amount);
        }

        if (enabled && threshold !== undefined) {
            updateFields.push('auto_recharge_threshold = ?');
            updateParams.push(threshold);
        }

        updateParams.push(wallet.id);
        await req.db.execute(
            `UPDATE wallets SET ${updateFields.join(', ')} WHERE id = ?`,
            updateParams
        );

        return sendSuccess(res, { enabled }, 'Auto-recharge settings updated');

    } catch (error) {
        logError('Configure auto-recharge', error);
        return sendServerError(res, error);
    }
});

// Get auto-recharge settings
router.get('/auto-recharge', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const wallet = await getOrCreateWallet(req.db, userId);

        return sendSuccess(res, { 
            enabled: wallet.auto_recharge_enabled,
            amount: wallet.auto_recharge_amount,
            threshold: wallet.auto_recharge_threshold
        }, 'Auto-recharge settings retrieved');

    } catch (error) {
        logError('Get auto-recharge settings', error);
        return sendServerError(res, error);
    }
});

// ===== SAVED PAYMENT METHODS =====

// Get saved payment methods
router.get('/payment-methods', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const [methods] = await req.db.execute(
            `SELECT id, type, gateway_id, card_last_four, card_brand, card_expiry_month, 
             card_expiry_year, is_primary, created_at 
             FROM saved_payment_methods WHERE user_id = ? AND is_active = TRUE`,
            [userId]
        );

        return sendSuccess(res, { payment_methods: methods }, 'Payment methods retrieved');

    } catch (error) {
        return sendServerError(res, error);
    }
});

// Set primary payment method
router.put('/payment-methods/:id/primary', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const method = await validatePaymentMethodOwnership(req.db, id, userId);
        if (!method) {
            return sendError(res, 'Payment method not found', 404);
        }

        await req.db.execute(
            'UPDATE saved_payment_methods SET is_primary = FALSE WHERE user_id = ?',
            [userId]
        );

        await req.db.execute(
            'UPDATE saved_payment_methods SET is_primary = TRUE WHERE id = ?',
            [id]
        );

        return sendSuccess(res, {}, 'Primary payment method updated');

    } catch (error) {
        logError('Set primary payment method', error);
        return sendServerError(res, error);
    }
});

// Delete payment method
router.delete('/payment-methods/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const method = await validatePaymentMethodOwnership(req.db, id, userId);
        if (!method) {
            return sendError(res, 'Payment method not found', 404);
        }

        await req.db.execute(
            'UPDATE saved_payment_methods SET is_active = FALSE WHERE id = ?',
            [id]
        );

        return sendSuccess(res, {}, 'Payment method deleted');

    } catch (error) {
        logError('Delete payment method', error);
        return sendServerError(res, error);
    }
});

// ===== P2P TRANSFERS =====

// Send money to another user
router.post('/transfers/send', authenticateToken, [
    body('recipientId').isInt({ min: 1 }).withMessage('Invalid recipient ID'),
    body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
    body('description').optional().trim().isLength({ max: 255 }).withMessage('Description too long')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return sendValidationError(res, errors);
        }

        const senderId = req.user.id;
        const { recipientId, amount, description } = req.body;

        if (senderId === recipientId) {
            return sendError(res, 'Cannot send money to yourself', 400);
        }

        const [recipients] = await req.db.execute(
            'SELECT id FROM users WHERE id = ?',
            [recipientId]
        );

        if (!recipients.length) {
            return sendError(res, 'Recipient not found', 404);
        }

        const senderWallet = await getOrCreateWallet(req.db, senderId);
        
        if (parseFloat(senderWallet.balance) < parseFloat(amount)) {
            return sendError(res, 'Insufficient wallet balance', 400);
        }

        const recipientWallet = await getOrCreateWallet(req.db, recipientId);

        const [result] = await req.db.execute(
            `INSERT INTO wallet_transfers 
             (sender_id, recipient_id, amount, description, sender_wallet_id, recipient_wallet_id, status) 
             VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
            [senderId, recipientId, amount, description || '', senderWallet.id, recipientWallet.id]
        );

        const newSenderBalance = parseFloat(senderWallet.balance) - parseFloat(amount);
        await recordWalletTransaction(
            req.db, senderWallet.id, 'debit', amount, 
            `Transfer to user #${recipientId}`, 'transfer', result.insertId, newSenderBalance
        );

        return sendSuccess(res, { 
            transfer_id: result.insertId,
            status: 'pending',
            amount,
            recipient_id: recipientId
        }, 'Transfer request created', 201);

    } catch (error) {
        logError('Transfer send', error);
        return sendServerError(res, error);
    }
});

// Get sent transfers
router.get('/transfers/sent', authenticateToken, async (req, res) => {
    try {
        console.log('[wallets] GET /transfers/sent - user:', req.user);
        const userId = req.user.id;
        const { limit, offset, status } = req.query;
        const limitVal = Math.max(1, parseInt(limit) || 20);
        const offsetVal = Math.max(0, parseInt(offset) || 0);

        let query = `SELECT t.*, u.email as recipient_email, CONCAT(u.first_name, ' ', u.last_name) as recipient_name
                   FROM wallet_transfers t
                   JOIN users u ON t.recipient_id = u.id
                   WHERE t.sender_id = ?`;
        let params = [userId];

        if (status && ['pending', 'completed', 'rejected', 'cancelled'].includes(status)) {
            query += ' AND t.status = ?';
            params.push(status);
        }

        query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
        params.push(limitVal, offsetVal);

        console.log('[wallets] Fetching sent transfers for user:', userId, 'query:', query, 'params:', params);
        const [transfers] = await req.db.query(query, params);

        let countQuery = 'SELECT COUNT(*) as count FROM wallet_transfers WHERE sender_id = ?';
        let countParams = [userId];
        if (status && ['pending', 'completed', 'rejected', 'cancelled'].includes(status)) {
            countQuery += ' AND status = ?';
            countParams.push(status);
        }

        const [totalResult] = await req.db.query(countQuery, countParams);
        const total = Number(totalResult[0]?.count || 0);

        const responseData = {
            transfers,
            total,
            limit: limitVal,
            offset: offsetVal
        };
        console.log('[wallets] Sending response for sent transfers:', JSON.stringify(responseData).substring(0, 200));
        return sendSuccess(res, responseData, 'Sent transfers retrieved');

    } catch (error) {
        console.error('Error fetching sent transfers:', error);
        logError('Get sent transfers', error);
        return sendServerError(res, error);
    }
});

// Get received transfers
router.get('/transfers/received', authenticateToken, async (req, res) => {
    try {
        console.log('[wallets] GET /transfers/received - user:', req.user);
        const userId = req.user.id;
        const { limit, offset, status } = req.query;
        const limitVal = Math.max(1, parseInt(limit) || 20);
        const offsetVal = Math.max(0, parseInt(offset) || 0);

        let query = `SELECT t.*, u.email as sender_email, CONCAT(u.first_name, ' ', u.last_name) as sender_name
                   FROM wallet_transfers t
                   JOIN users u ON t.sender_id = u.id
                   WHERE t.recipient_id = ?`;
        let params = [userId];

        if (status && ['pending', 'completed', 'rejected', 'cancelled'].includes(status)) {
            query += ' AND t.status = ?';
            params.push(status);
        }

        query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
        params.push(limitVal, offsetVal);

        console.log('[wallets] Fetching received transfers for user:', userId, 'query:', query, 'params:', params);
        let transfers;
        try {
            const [rows] = await req.db.query(query, params);
            transfers = rows;
            console.log('[wallets] DB query successful, rows:', transfers.length);
        } catch (dbError) {
            console.error('[wallets] DB query failed:', dbError);
            logError('Get received transfers - Main Query', dbError);
            throw dbError;
        }

        console.log('[wallets] Fetching total count...');
        let total;
        try {
            let countQuery = 'SELECT COUNT(*) as count FROM wallet_transfers WHERE recipient_id = ?';
            let countParams = [userId];
            if (status && ['pending', 'completed', 'rejected', 'cancelled'].includes(status)) {
                countQuery += ' AND status = ?';
                countParams.push(status);
            }
            const [totalResult] = await req.db.query(countQuery, countParams);
            total = Number(totalResult[0]?.count || 0);
            console.log('[wallets] Total count successful:', total);
        } catch (countError) {
            console.error('[wallets] Count query failed:', countError);
            logError('Get received transfers - Count Query', countError);
            throw countError;
        }

        const responseData = {
            transfers,
            total,
            limit: limitVal,
            offset: offsetVal
        };
        console.log('[wallets] Sending response for received transfers:', JSON.stringify(responseData).substring(0, 200));
        return sendSuccess(res, responseData, 'Received transfers retrieved');

    } catch (error) {
        console.error('Error fetching received transfers:', error);
        logError('Get received transfers', error);
        return sendServerError(res, error);
    }
});

// Accept transfer
router.post('/transfers/:id/accept', authenticateToken, async (req, res) => {
    try {
        const transferId = req.params.id;
        const userId = req.user.id;

        // 1. Get transfer
        const [transfers] = await req.db.execute(
            'SELECT * FROM wallet_transfers WHERE id = ?',
            [transferId]
        );

        if (!transfers.length) {
            return sendError(res, 'Transfer not found', 404);
        }

        const transfer = transfers[0];

        if (transfer.recipient_id !== userId) {
            return sendError(res, 'Not authorized to accept this transfer', 403);
        }

        if (transfer.status !== 'pending') {
            return sendError(res, `Cannot accept transfer with status: ${transfer.status}`, 400);
        }

        // 2. Get wallets
        const [senderWallets] = await req.db.execute(
            'SELECT id, balance FROM wallets WHERE user_id = ?',
            [transfer.sender_id]
        );

        const [recipientWallets] = await req.db.execute(
            'SELECT id, balance FROM wallets WHERE user_id = ?',
            [transfer.recipient_id]
        );

        if (!senderWallets.length || !recipientWallets.length) {
            return sendError(res, 'Wallet not found', 404);
        }

        const senderWallet = senderWallets[0];
        const recipientWallet = recipientWallets[0];

        // 3. Verify sender still has enough balance
        if (parseFloat(senderWallet.balance) < parseFloat(transfer.amount)) {
            await req.db.execute(
                'UPDATE wallet_transfers SET status = ?, rejection_reason = ? WHERE id = ?',
                ['rejected', 'Sender insufficient balance', transferId]
            );
            return sendError(res, 'Transfer rejected: Sender has insufficient balance', 400);
        }

        // 4. Update balances
        const newSenderBalance = parseFloat(senderWallet.balance) - parseFloat(transfer.amount);
        const newRecipientBalance = parseFloat(recipientWallet.balance) + parseFloat(transfer.amount);

        await req.db.execute(
            'UPDATE wallets SET balance = ? WHERE id = ?',
            [newSenderBalance, senderWallet.id]
        );

        await req.db.execute(
            'UPDATE wallets SET balance = ? WHERE id = ?',
            [newRecipientBalance, recipientWallet.id]
        );

        // 5. Update transfer status
        await req.db.execute(
            'UPDATE wallet_transfers SET status = ?, completed_at = NOW() WHERE id = ?',
            ['completed', transferId]
        );

        // 6. Create wallet transaction for recipient
        await req.db.execute(
            `INSERT INTO wallet_transactions 
             (wallet_id, type, amount, description, reference_type, reference_id, balance_after) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [recipientWallet.id, 'credit', transfer.amount, `Transfer from user #${transfer.sender_id}`, 'transfer', transferId, newRecipientBalance]
        );

        // 7. Update sender's transaction
        await req.db.execute(
            'UPDATE wallet_transactions SET balance_after = ? WHERE reference_type = ? AND reference_id = ? AND type = ?',
            [newSenderBalance, 'transfer', transferId, 'debit']
        );

        return sendSuccess(res, {
            transfer_id: transferId,
            status: 'completed',
            new_balance: newRecipientBalance
        }, 'Transfer accepted', 200);

    } catch (error) {
        console.error('Accept transfer error:', error);
        return sendServerError(res, error);
    }
});

// Reject transfer
router.post('/transfers/:id/reject', authenticateToken, [
    body('reason').optional().trim().isLength({ max: 255 }).withMessage('Reason too long')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return sendValidationError(res, errors);
        }

        const transferId = req.params.id;
        const userId = req.user.id;
        const { reason } = req.body;

        // 1. Get transfer
        const [transfers] = await req.db.execute(
            'SELECT * FROM wallet_transfers WHERE id = ?',
            [transferId]
        );

        if (!transfers.length) {
            return sendError(res, 'Transfer not found', 404);
        }

        const transfer = transfers[0];

        if (transfer.recipient_id !== userId) {
            return sendError(res, 'Not authorized to reject this transfer', 403);
        }

        if (transfer.status !== 'pending') {
            return sendError(res, `Cannot reject transfer with status: ${transfer.status}`, 400);
        }

        // 2. Restore sender's balance
        const [wallets] = await req.db.execute(
            'SELECT id, balance FROM wallets WHERE user_id = ?',
            [transfer.sender_id]
        );

        if (wallets.length) {
            const newBalance = parseFloat(wallets[0].balance) + parseFloat(transfer.amount);
            await req.db.execute(
                'UPDATE wallets SET balance = ? WHERE id = ?',
                [newBalance, wallets[0].id]
            );
        }

        // 3. Update transfer status
        await req.db.execute(
            'UPDATE wallet_transfers SET status = ?, rejection_reason = ? WHERE id = ?',
            ['rejected', reason || 'Not specified', transferId]
        );

        // 4. Delete sender's pending debit transaction
        await req.db.execute(
            'DELETE FROM wallet_transactions WHERE reference_type = ? AND reference_id = ? AND type = ?',
            ['transfer', transferId, 'debit']
        );

        return sendSuccess(res, {
            transfer_id: transferId,
            status: 'rejected'
        }, 'Transfer rejected', 200);

    } catch (error) {
        console.error('Reject transfer error:', error);
        return sendServerError(res, error);
    }
});

// Cancel transfer (sender only, before acceptance)
router.post('/transfers/:id/cancel', authenticateToken, async (req, res) => {
    try {
        const transferId = req.params.id;
        const userId = req.user.id;

        // 1. Get transfer
        const [transfers] = await req.db.execute(
            'SELECT * FROM wallet_transfers WHERE id = ?',
            [transferId]
        );

        if (!transfers.length) {
            return sendError(res, 'Transfer not found', 404);
        }

        const transfer = transfers[0];

        if (transfer.sender_id !== userId) {
            return sendError(res, 'Not authorized to cancel this transfer', 403);
        }

        if (transfer.status !== 'pending') {
            return sendError(res, `Cannot cancel transfer with status: ${transfer.status}`, 400);
        }

        // 2. Restore sender's balance
        const [wallets] = await req.db.execute(
            'SELECT id, balance FROM wallets WHERE user_id = ?',
            [transfer.sender_id]
        );

        if (wallets.length) {
            const newBalance = parseFloat(wallets[0].balance) + parseFloat(transfer.amount);
            await req.db.execute(
                'UPDATE wallets SET balance = ? WHERE id = ?',
                [newBalance, wallets[0].id]
            );
        }

        // 3. Update transfer status
        await req.db.execute(
            'UPDATE wallet_transfers SET status = ? WHERE id = ?',
            ['cancelled', transferId]
        );

        // 4. Delete pending debit transaction
        await req.db.execute(
            'DELETE FROM wallet_transactions WHERE reference_type = ? AND reference_id = ? AND type = ?',
            ['transfer', transferId, 'debit']
        );

        return sendSuccess(res, {
            transfer_id: transferId,
            status: 'cancelled'
        }, 'Transfer cancelled', 200);

    } catch (error) {
        console.error('Cancel transfer error:', error);
        return sendServerError(res, error);
    }
});

module.exports = router;
