const test = require('node:test');
const assert = require('node:assert');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_unit_test';

const express = require('express');
const { fakeDb, request } = require('./helpers');
const payments = require('../routes/payments');
const stripe = require('stripe')('sk_test_dummy');

// Same body-parser arrangement as server.js: JSON parsing skips the webhook
const serverParsers = (app) => {
  const jsonParser = express.json({ limit: '10mb' });
  app.use((req, res, next) => (req.path === '/api/payments/webhook/stripe' ? next() : jsonParser(req, res, next)));
};

const event = JSON.stringify({ id: 'evt_1', object: 'event', type: 'payment_intent.succeeded',
  data: { object: { id: 'pi_123', object: 'payment_intent' } } });

test('Stripe webhook accepts a correctly signed event', async () => {
  const { db, log } = fakeDb(() => [[{ order_id: 5 }]]);
  const signature = stripe.webhooks.generateTestHeaderString({ payload: event, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const r = await request(payments, '/api/payments', db, {
    method: 'POST', path: '/api/payments/webhook/stripe', rawBody: event,
    headers: { 'stripe-signature': signature }, beforeRouter: serverParsers,
  });
  assert.equal(r.status, 200);
  assert.ok(log.some((q) => /UPDATE payments SET status/.test(q)));
});

test('Stripe webhook rejects a forged signature', async () => {
  const { db } = fakeDb(() => undefined);
  const original = console.error;
  console.error = () => {};
  try {
    const r = await request(payments, '/api/payments', db, {
      method: 'POST', path: '/api/payments/webhook/stripe', rawBody: event,
      headers: { 'stripe-signature': 't=1,v1=forged' }, beforeRouter: serverParsers,
    });
    assert.equal(r.status, 400);
  } finally {
    console.error = original;
  }
});

test('paying an already-paid order is refused (no double charge)', async () => {
  const { db, log } = fakeDb((q) => {
    if (/FROM users WHERE id = \?/.test(q) && /is_active/.test(q)) return [[{ is_active: 1, user_type: 'customer' }]];
    if (/SELECT \* FROM orders WHERE id = \? AND user_id = \?/.test(q)) return [[{ id: 5, total_amount: 230, payment_status: 'paid', status: 'confirmed' }]];
    return undefined;
  });
  const r = await request(payments, '/api/payments', db, {
    method: 'POST', path: '/api/payments/process', user: { id: 42, user_type: 'customer' },
    body: { orderId: 5, paymentMethod: 'wallet', amount: 230 },
  });
  assert.equal(r.status, 400);
  assert.ok(!log.some((q) => /UPDATE wallets/.test(q)));
});

test('refunds are admin-only', async () => {
  const { db } = fakeDb((q) => (/FROM users WHERE id = \?/.test(q) && /is_active/.test(q) ? [[{ is_active: 1, user_type: 'customer' }]] : undefined));
  const r = await request(payments, '/api/payments', db, {
    method: 'POST', path: '/api/payments/1/refund', user: { id: 42, user_type: 'customer' }, body: { reason: 'changed my mind' },
  });
  assert.equal(r.status, 403);
});
