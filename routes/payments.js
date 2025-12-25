const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { sendSuccess, sendError, sendValidationError, sendServerError, sendNotFound } = require('../utils/response');

const router = express.Router();

// Initialize Stripe (will be configured via environment variables)
let stripe = null;
try {
    if (process.env.STRIPE_SECRET_KEY) {
        stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    }
} catch (e) {
    console.warn('Stripe not initialized - install stripe package and set STRIPE_SECRET_KEY');
}

// ===== PAYMENT PROCESSING =====

// Process payment for an order
router.post('/process', authenticateToken, [
    body('orderId').isInt({ min: 1 }).withMessage('Valid order ID required'),
    body('paymentMethod').isIn(['card', 'wallet', 'cash']).withMessage('Invalid payment method'),
    body('amount').isFloat({ min: 0 }).withMessage('Valid amount required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return sendValidationError(res, errors);
        }

        const { orderId, paymentMethod, amount, cardToken, saveCard } = req.body;
        const userId = req.user.id;

        // 1. Verify order exists and belongs to user
        const [orders] = await req.db.execute(
            'SELECT * FROM orders WHERE id = ? AND user_id = ?',
            [orderId, userId]
        );

        if (!orders.length) {
            return sendNotFound(res, 'Order not found');
        }

        const order = orders[0];

        // 2. Prevent duplicate payment processing
        const [existingPayment] = await req.db.execute(
            'SELECT id FROM payments WHERE order_id = ? AND status IN (?, ?)',
            [orderId, 'success', 'pending']
        );

        if (existingPayment.length) {
            return sendError(res, 'Payment already processed for this order', 400);
        }

        // 3. Verify amount matches order total
        if (parseFloat(amount) !== parseFloat(order.total_amount)) {
            return sendError(res, 'Payment amount does not match order total', 400);
        }

        let payment = null;
        let transactionId = null;

        // 4. Process based on payment method
        switch (paymentMethod) {
            case 'card':
                payment = await processCardPayment(req, orderId, userId, amount, cardToken, saveCard);
                break;
            case 'wallet':
                payment = await processWalletPayment(req, orderId, userId, amount);
                break;
            case 'cash':
                payment = await processCashPayment(req, orderId, userId, amount);
                break;
        }

        if (!payment) {
            return sendError(res, 'Payment processing failed', 400);
        }

        // 5. Update order with payment information
        await req.db.execute(
            'UPDATE orders SET payment_method = ?, payment_status = ?, status = ? WHERE id = ?',
            [paymentMethod, payment.status === 'success' ? 'paid' : 'pending', 
             payment.status === 'success' ? 'confirmed' : 'pending', orderId]
        );

        return sendSuccess(res, payment, 'Payment processed successfully', 201);

    } catch (error) {
        console.error('Payment processing error:', error);
        return sendServerError(res, error);
    }
});

// Process card payment via Stripe
async function processCardPayment(req, orderId, userId, amount, cardToken, saveCard) {
    if (!stripe) {
        throw new Error('Stripe not configured');
    }

    try {
        // 1. Get or create Stripe customer
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

        // 2. Create payment intent
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100),
            currency: 'pkr',
            customer: customerId,
            payment_method: cardToken,
            confirm: true,
            metadata: { orderId, userId }
        });

        // 3. Save payment record
        const status = paymentIntent.status === 'succeeded' ? 'success' : 'failed';
        const [result] = await req.db.execute(
            `INSERT INTO payments (order_id, user_id, amount, payment_method, gateway, 
             transaction_id, status, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [orderId, userId, amount, 'card', 'stripe', paymentIntent.id, status, 
             JSON.stringify(paymentIntent)]
        );

        // 4. Save payment method if requested
        if (saveCard && paymentIntent.payment_method) {
            const pm = await stripe.paymentMethods.retrieve(paymentIntent.payment_method);
            await req.db.execute(
                `INSERT INTO saved_payment_methods (user_id, type, gateway_id, card_last_four, 
                 card_brand, card_expiry_month, card_expiry_year) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [userId, 'card', pm.id, pm.card.last4, pm.card.brand, 
                 pm.card.exp_month, pm.card.exp_year]
            );
        }

        return {
            id: result.insertId,
            order_id: orderId,
            amount,
            payment_method: 'card',
            gateway: 'stripe',
            transaction_id: paymentIntent.id,
            status,
            message: status === 'success' ? 'Payment successful' : 'Payment failed'
        };

    } catch (error) {
        console.error('Stripe error:', error);
        await req.db.execute(
            `INSERT INTO payments (order_id, user_id, amount, payment_method, gateway, 
             status, error_message) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [orderId, userId, amount, 'card', 'stripe', 'failed', error.message]
        );
        throw error;
    }
}

// Process wallet payment
async function processWalletPayment(req, orderId, userId, amount) {
    try {
        // 1. Get wallet balance
        const [wallets] = await req.db.execute(
            'SELECT id, balance FROM wallets WHERE user_id = ?',
            [userId]
        );

        if (!wallets.length) {
            throw new Error('Wallet not found');
        }

        const wallet = wallets[0];

        // 2. Check sufficient balance
        if (wallet.balance < amount) {
            throw new Error('Insufficient wallet balance');
        }

        // 3. Debit wallet
        const newBalance = wallet.balance - amount;
        await req.db.execute(
            'UPDATE wallets SET balance = ? WHERE id = ?',
            [newBalance, wallet.id]
        );

        // 4. Record wallet transaction
        await req.db.execute(
            `INSERT INTO wallet_transactions (wallet_id, type, amount, description, 
             reference_type, reference_id, balance_after) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [wallet.id, 'debit', amount, `Payment for Order #${orderId}`, 
             'order', orderId, newBalance]
        );

        // 5. Record payment
        const [result] = await req.db.execute(
            `INSERT INTO payments (order_id, user_id, amount, payment_method, gateway, 
             status) VALUES (?, ?, ?, ?, ?, ?)`,
            [orderId, userId, amount, 'wallet', 'local', 'success']
        );

        return {
            id: result.insertId,
            order_id: orderId,
            amount,
            payment_method: 'wallet',
            gateway: 'local',
            status: 'success',
            message: 'Payment successful'
        };

    } catch (error) {
        console.error('Wallet payment error:', error);
        await req.db.execute(
            `INSERT INTO payments (order_id, user_id, amount, payment_method, gateway, 
             status, error_message) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [orderId, userId, amount, 'wallet', 'local', 'failed', error.message]
        );
        throw error;
    }
}

// Process cash payment
async function processCashPayment(req, orderId, userId, amount) {
    try {
        const [result] = await req.db.execute(
            `INSERT INTO payments (order_id, user_id, amount, payment_method, gateway, 
             status) VALUES (?, ?, ?, ?, ?, ?)`,
            [orderId, userId, amount, 'cash', 'local', 'pending']
        );

        return {
            id: result.insertId,
            order_id: orderId,
            amount,
            payment_method: 'cash',
            gateway: 'local',
            status: 'pending',
            message: 'Cash payment pending - pay on delivery'
        };

    } catch (error) {
        console.error('Cash payment error:', error);
        throw error;
    }
}

// ===== PAYMENT WEBHOOKS =====

// Stripe webhook handler
router.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        if (!stripe) {
            return res.status(400).json({ error: 'Stripe not configured' });
        }

        const sig = req.headers['stripe-signature'];
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

        let event;
        try {
            event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        } catch (err) {
            console.error('Webhook signature verification failed:', err);
            return res.status(400).json({ error: 'Invalid signature' });
        }

        // Handle payment intent succeeded
        if (event.type === 'payment_intent.succeeded') {
            const paymentIntent = event.data.object;
            
            // Update payment status
            await req.db.execute(
                'UPDATE payments SET status = ? WHERE transaction_id = ?',
                ['success', paymentIntent.id]
            );

            // Update order status
            const [payments] = await req.db.execute(
                'SELECT order_id FROM payments WHERE transaction_id = ?',
                [paymentIntent.id]
            );

            if (payments.length) {
                await req.db.execute(
                    'UPDATE orders SET payment_status = ?, status = ? WHERE id = ?',
                    ['paid', 'confirmed', payments[0].order_id]
                );
            }
        }

        // Handle payment intent failed
        if (event.type === 'payment_intent.payment_failed') {
            const paymentIntent = event.data.object;
            
            await req.db.execute(
                'UPDATE payments SET status = ? WHERE transaction_id = ?',
                ['failed', paymentIntent.id]
            );
        }

        res.json({ received: true });

    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== PAYMENT RETRIEVAL =====

// Get payment details for an order
router.get('/:orderId', authenticateToken, async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user.id;

        // Verify order belongs to user (unless admin)
        if (!req.user.user_type.includes('admin')) {
            const [orders] = await req.db.execute(
                'SELECT id FROM orders WHERE id = ? AND user_id = ?',
                [orderId, userId]
            );
            if (!orders.length) {
                return sendNotFound(res, 'Order not found');
            }
        }

        const [payments] = await req.db.execute(
            `SELECT id, order_id, amount, payment_method, gateway, transaction_id, 
             status, created_at FROM payments WHERE order_id = ?`,
            [orderId]
        );

        if (!payments.length) {
            return sendNotFound(res, 'No payment found for this order');
        }

        return sendSuccess(res, { payments }, 'Payment details retrieved');

    } catch (error) {
        return sendServerError(res, error);
    }
});

// ===== REFUNDS =====

// Request refund
router.post('/:paymentId/refund', authenticateToken, [
    body('reason').trim().isLength({ min: 5 }).withMessage('Reason must be at least 5 characters')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return sendValidationError(res, errors);
        }

        const { paymentId } = req.params;
        const { reason } = req.body;
        const userId = req.user.id;

        // 1. Get payment details
        const [payments] = await req.db.execute(
            `SELECT p.*, o.user_id FROM payments p 
             JOIN orders o ON p.order_id = o.id 
             WHERE p.id = ?`,
            [paymentId]
        );

        if (!payments.length) {
            return sendNotFound(res, 'Payment not found');
        }

        const payment = payments[0];

        // 2. Check if user is owner or admin
        if (payment.user_id !== userId && !req.user.user_type.includes('admin')) {
            return sendError(res, 'Unauthorized', 403);
        }

        // 3. Check if payment can be refunded
        if (payment.status !== 'success') {
            return sendError(res, 'Only successful payments can be refunded', 400);
        }

        // 4. Check for existing refund
        const [existingRefund] = await req.db.execute(
            'SELECT id FROM refunds WHERE payment_id = ? AND status != ?',
            [paymentId, 'failed']
        );

        if (existingRefund.length) {
            return sendError(res, 'Refund already requested for this payment', 400);
        }

        // 5. Create refund record
        const [result] = await req.db.execute(
            `INSERT INTO refunds (payment_id, order_id, user_id, refund_amount, reason, status) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [paymentId, payment.order_id, userId, payment.amount, reason, 'pending']
        );

        // 6. Process refund based on payment gateway
        if (payment.gateway === 'stripe' && stripe) {
            try {
                const refund = await stripe.refunds.create({
                    payment_intent: payment.transaction_id
                });

                await req.db.execute(
                    'UPDATE refunds SET status = ?, refund_transaction_id = ?, processed_at = NOW() WHERE id = ?',
                    ['processed', refund.id, result.insertId]
                );
            } catch (stripeError) {
                await req.db.execute(
                    'UPDATE refunds SET status = ?, notes = ? WHERE id = ?',
                    ['failed', stripeError.message, result.insertId]
                );
                return sendError(res, 'Refund processing failed', 400);
            }
        } else if (payment.payment_method === 'wallet') {
            // Refund to wallet
            const [wallets] = await req.db.execute(
                'SELECT id FROM wallets WHERE user_id = ?',
                [userId]
            );

            if (wallets.length) {
                const wallet = wallets[0];
                await req.db.execute(
                    'UPDATE wallets SET balance = balance + ? WHERE id = ?',
                    [payment.amount, wallet.id]
                );

                await req.db.execute(
                    `INSERT INTO wallet_transactions (wallet_id, type, amount, description, 
                     reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)`,
                    [wallet.id, 'credit', payment.amount, `Refund for Order #${payment.order_id}`, 
                     'refund', result.insertId]
                );

                await req.db.execute(
                    'UPDATE refunds SET status = ?, processed_at = NOW() WHERE id = ?',
                    ['processed', result.insertId]
                );
            }
        }

        return sendSuccess(res, { refund_id: result.insertId }, 'Refund requested successfully', 201);

    } catch (error) {
        return sendServerError(res, error);
    }
});

// ===== PAYMENT HISTORY =====

// Get user's payment history
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { limit, offset } = req.query;
        const limitVal = Math.max(1, parseInt(limit) || 10);
        const offsetVal = Math.max(0, parseInt(offset) || 0);

        const [payments] = await req.db.execute(
            `SELECT p.id, p.order_id, p.amount, p.payment_method, p.gateway, 
             p.status, p.created_at, o.order_number
             FROM payments p
             JOIN orders o ON p.order_id = o.id
             WHERE p.user_id = ?
             ORDER BY p.created_at DESC
             LIMIT ? OFFSET ?`,
            [userId, limitVal, offsetVal]
        );

        const [totalResult] = await req.db.execute(
            'SELECT COUNT(*) as count FROM payments WHERE user_id = ?',
            [userId]
        );

        return sendSuccess(res, { 
            payments, 
            total: Number(totalResult[0].count),
            limit: limitVal,
            offset: offsetVal
        }, 'Payment history retrieved');

    } catch (error) {
        return sendServerError(res, error);
    }
});

module.exports = router;
