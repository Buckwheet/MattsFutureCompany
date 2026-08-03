import { describe, it, expect, vi } from 'vitest';
import Stripe from 'stripe';
import worker from '../index.js';

const webhookSecret = 'whsec_test_webhook_secret';
const stripe = new Stripe('sk_test_placeholder');

function signedRequest(event) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });

  return new Request('https://example.com/api/webhooks/stripe', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature,
    },
    body: payload,
  });
}

function envWithDb(db) {
  return {
    STRIPE_SECRET_KEY: 'sk_test_placeholder',
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    DB: db,
  };
}

describe('Stripe webhook', () => {
  it('acknowledges a valid unrelated event without querying D1', async () => {
    const db = { prepare: vi.fn() };
    const response = await worker.fetch(signedRequest({
      id: 'evt_unrelated',
      type: 'payout.paid',
      data: { object: { id: 'po_test' } },
    }), envWithDb(db));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('rejects an invalid Stripe signature', async () => {
    const request = new Request('https://example.com/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=invalid' },
      body: '{}',
    });

    const response = await worker.fetch(request, envWithDb({ prepare: vi.fn() }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid webhook signature' });
  });

  it('returns 500 when D1 processing fails for an inventory event', async () => {
    const db = {
      prepare: vi.fn(() => {
        throw new Error('no such table: processed_stripe_events');
      }),
    };
    const response = await worker.fetch(signedRequest({
      id: 'evt_checkout',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test', invoice: null } },
    }), envWithDb(db));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Webhook processing failed' });
  });
});
