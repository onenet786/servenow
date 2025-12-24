const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const { sendSuccess, sendError, sendValidationError, sendServerError } = require('../utils/response');

const router = express.Router();

// ===== WALLET BALANCE & OPERATIONS =====

// Get wallet balance
router.get('/balance', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const [wallets] = await req.db.execute(
            `SELECT id, balance, total_credited, total_spent, auto_recharge_enabled, 
             auto_recharge_amount, auto_recharge_threshold, last_credited_at 
             FROM wallets WHERE user_id = ?`,
            [userId]
        );

        if (!wallets.length) {
            // Create wallet if doesn't exist (shouldn't happen with proper migration)
            await req.db.execute(
                'INSERT INTO wallets (user_id, balance) VALUES (?, ?)',
                [userId, 0]
            );

            const [newWallet] = await req.db.execute(
                'SELECT id, balance, total_credited, total_spent FROM wallets WHERE user_id = ?',
                [userId]
            );

            return sendSuccess(res, { wallet: newWallet[0] }, 'Wallet created');
        }

        return sendSuccess(res, { wallet: wallets[0] }, 'Wallet balance retrieved');

    } catch (error) {
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

        // 1. Get wallet
        const [wallets] = await req.db.execute(
            'SELECT id FROM wallets WHERE user_id = ?',
            [userId]
        );

        if (!wallets.length) {
            return sendError(res, 'Wallet not found', 404);
        }

        const wallet = wallets[0];
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        // 2. Process payment via Stripe
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

        // 3. Create payment intent for top-up
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

        // 4. Credit wallet
        const newBalance = parseFloat(wallets[0]?.balance || 0) + parseFloat(amount);
        await req.db.execute(
            'UPDATE wallets SET balance = ?, total_credited = total_credited + ?, last_credited_at = NOW() WHERE id = ?',
            [newBalance, amount, wallet.id]
        );

        // 5. Record transaction
        const [result] = await req.db.execute(
            `INSERT INTO wallet_transactions (wallet_id, type, amount, description, 
             reference_type, reference_id, balance_after) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [wallet.id, 'credit', amount, `Top-up via ${paymentMethod}`, 
             'topup', paymentIntent.id, newBalance]
        );

        // 6. Save payment method if requested
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
            transaction_id: result.insertId,
            new_balance: newBalance,
            amount_added: amount
        }, 'Wallet topped up successfully', 201);

    } catch (error) {
        console.error('Wallet top-up error:', error);
        return sendServerError(res, error);
    }
});

// ===== WALLET TRANSACTIONS =====

// Get wallet transaction history
router.get('/transactions', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { limit = 20, offset = 0, type } = req.query;

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
        params.push(parseInt(limit), parseInt(offset));

        const [transactions] = await req.db.execute(query, params);

        // Get total count
        let countQuery = 'SELECT COUNT(*) as count FROM wallet_transactions WHERE wallet_id = ?';
        let countParams = [wallet.id];

        if (type) {
            countQuery += ' AND type = ?';
            countParams.push(type);
        }

        const [total] = await req.db.execute(countQuery, countParams);

        return sendSuccess(res, { 
            transactions,
            total: total[0].count,
            limit: parseInt(limit),
            offset: parseInt(offset)
        }, 'Transaction history retrieved');

    } catch (error) {
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

        // Get wallet
        const [wallets] = await req.db.execute(
            'SELECT id FROM wallets WHERE user_id = ?',
            [userId]
        );

        if (!wallets.length) {
            return sendError(res, 'Wallet not found', 404);
        }

        // Update auto-recharge settings
        const updateParams = [wallets[0].id];
        let updateFields = ['auto_recharge_enabled = ?'];
        updateParams.unshift(enabled);

        if (enabled && amount) {
            updateFields.push('auto_recharge_amount = ?');
            updateParams.push(amount);
        }

        if (enabled && threshold !== undefined) {
            updateFields.push('auto_recharge_threshold = ?');
            updateParams.push(threshold);
        }

        await req.db.execute(
            `UPDATE wallets SET ${updateFields.join(', ')} WHERE id = ?`,
            [...updateParams, wallets[0].id]
        );

        return sendSuccess(res, { enabled }, 'Auto-recharge settings updated');

    } catch (error) {
        return sendServerError(res, error);
    }
});

// Get auto-recharge settings
router.get('/auto-recharge', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const [wallets] = await req.db.execute(
            `SELECT auto_recharge_enabled, auto_recharge_amount, 
             auto_recharge_threshold FROM wallets WHERE user_id = ?`,
            [userId]
        );

        if (!wallets.length) {
            return sendError(res, 'Wallet not found', 404);
        }

        return sendSuccess(res, { 
            enabled: wallets[0].auto_recharge_enabled,
            amount: wallets[0].auto_recharge_amount,
            threshold: wallets[0].auto_recharge_threshold
        }, 'Auto-recharge settings retrieved');

    } catch (error) {
        return sendServerError(res, error);
    }
});

// ===== SAVED PAYMENT METHODS =====

// Get saved payment methods
router.get('/payment-methods', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const [methods] = await req.db.execute(
            `SELECT id, type, card_last_four, card_brand, card_expiry_month, 
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

        // Verify ownership
        const [methods] = await req.db.execute(
            'SELECT user_id FROM saved_payment_methods WHERE id = ?',
            [id]
        );

        if (!methods.length || methods[0].user_id !== userId) {
            return sendError(res, 'Payment method not found', 404);
        }

        // Update - clear other primary
        await req.db.execute(
            'UPDATE saved_payment_methods SET is_primary = FALSE WHERE user_id = ?',
            [userId]
        );

        // Set this as primary
        await req.db.execute(
            'UPDATE saved_payment_methods SET is_primary = TRUE WHERE id = ?',
            [id]
        );

        return sendSuccess(res, {}, 'Primary payment method updated');

    } catch (error) {
        return sendServerError(res, error);
    }
});

// Delete payment method
router.delete('/payment-methods/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // Verify ownership
        const [methods] = await req.db.execute(
            'SELECT user_id FROM saved_payment_methods WHERE id = ?',
            [id]
        );

        if (!methods.length || methods[0].user_id !== userId) {
            return sendError(res, 'Payment method not found', 404);
        }

        // Soft delete
        await req.db.execute(
            'UPDATE saved_payment_methods SET is_active = FALSE WHERE id = ?',
            [id]
        );

        return sendSuccess(res, {}, 'Payment method deleted');

    } catch (error) {
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

        // 1. Check if recipient exists
        const [recipients] = await req.db.execute(
            'SELECT id FROM users WHERE id = ?',
            [recipientId]
        );

        if (!recipients.length) {
            return sendError(res, 'Recipient not found', 404);
        }

        // 2. Get sender wallet
        const [senderWallets] = await req.db.execute(
            'SELECT id, balance FROM wallets WHERE user_id = ?',
            [senderId]
        );

        if (!senderWallets.length) {
            return sendError(res, 'Wallet not found', 404);
        }

        const senderWallet = senderWallets[0];

        // 3. Check sender balance
        if (parseFloat(senderWallet.balance) < parseFloat(amount)) {
            return sendError(res, 'Insufficient wallet balance', 400);
        }

        // 4. Get recipient wallet
        const [recipientWallets] = await req.db.execute(
            'SELECT id FROM wallets WHERE user_id = ?',
            [recipientId]
        );

        if (!recipientWallets.length) {
            return sendError(res, 'Recipient wallet not found', 404);
        }

        const recipientWallet = recipientWallets[0];

        // 5. Create transfer request
        const [result] = await req.db.execute(
            `INSERT INTO wallet_transfers 
             (sender_id, recipient_id, amount, description, sender_wallet_id, recipient_wallet_id, status) 
             VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
            [senderId, recipientId, amount, description || '', senderWallet.id, recipientWallet.id]
        );

        // 6. Create transaction entry for sender (pending)
        const newSenderBalance = parseFloat(senderWallet.balance) - parseFloat(amount);
        await req.db.execute(
            `INSERT INTO wallet_transactions 
             (wallet_id, type, amount, description, reference_type, reference_id, balance_after) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [senderWallet.id, 'debit', amount, `Transfer to user #${recipientId}`, 'transfer', result.insertId, newSenderBalance]
        );

        return sendSuccess(res, { 
            transfer_id: result.insertId,
            status: 'pending',
            amount,
            recipient_id: recipientId
        }, 'Transfer request created', 201);

    } catch (error) {
        console.error('Transfer send error:', error);
        return sendServerError(res, error);
    }
});

// Get sent transfers
router.get('/transfers/sent', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { limit = 20, offset = 0, status } = req.query;

        let query = `SELECT t.*, u.email as recipient_email, u.name as recipient_name
                   FROM wallet_transfers t
                   JOIN users u ON t.recipient_id = u.id
                   WHERE t.sender_id = ?`;
        let params = [userId];

        if (status && ['pending', 'completed', 'rejected', 'cancelled'].includes(status)) {
            query += ' AND t.status = ?';
            params.push(status);
        }

        query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const [transfers] = await req.db.execute(query, params);

        const [total] = await req.db.execute(
            'SELECT COUNT(*) as count FROM wallet_transfers WHERE sender_id = ?',
            [userId]
        );

        return sendSuccess(res, {
            transfers,
            total: total[0].count,
            limit: parseInt(limit),
            offset: parseInt(offset)
        }, 'Sent transfers retrieved');

    } catch (error) {
        return sendServerError(res, error);
    }
});

// Get received transfers
router.get('/transfers/received', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { limit = 20, offset = 0, status } = req.query;

        let query = `SELECT t.*, u.email as sender_email, u.name as sender_name
                   FROM wallet_transfers t
                   JOIN users u ON t.sender_id = u.id
                   WHERE t.recipient_id = ?`;
        let params = [userId];

        if (status && ['pending', 'completed', 'rejected', 'cancelled'].includes(status)) {
            query += ' AND t.status = ?';
            params.push(status);
        }

        query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const [transfers] = await req.db.execute(query, params);

        const [total] = await req.db.execute(
            'SELECT COUNT(*) as count FROM wallet_transfers WHERE recipient_id = ?',
            [userId]
        );

        return sendSuccess(res, {
            transfers,
            total: total[0].count,
            limit: parseInt(limit),
            offset: parseInt(offset)
        }, 'Received transfers retrieved');

    } catch (error) {
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
