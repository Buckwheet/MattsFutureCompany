import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateLeadInput, sniffImageType } from '../index.js';

// Shared mutable event/line-item state for the mocked Stripe module.
const { mockEvent, mockLineItems } = vi.hoisted(() => ({
  mockEvent: { id: 'evt_x', type: 'x', data: { object: {} } },
  mockLineItems: { data: [] },
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    constructor() {}
    webhooks = {
      constructEventAsync: async () => mockEvent,
    };
    checkout = {
      sessions: { listLineItems: async () => mockLineItems },
    };
    customers = {
      list: async () => ({ data: [] }),
      create: async () => ({ id: 'cus_mock' }),
      update: async () => ({}),
    };
    products = {
      create: async () => ({ id: 'prod_mock' }),
      update: async () => ({}),
    };
    prices = { create: async () => ({ id: 'price_mock' }) };
  },
}));

import worker from '../index.js';

function webhookRequest(event) {
  return new Request('https://example.com/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=fake' },
    body: JSON.stringify(event),
  });
}

function leadRequest(payload, ip = '1.2.3.4') {
  return new Request('https://example.com/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify(payload),
  });
}

function validLead() {
  return {
    name: 'Test User', email: 'test@example.com', phone: '555-1234',
    equipment: 'Lawn Mower', issue: 'Wont start', cf_token: 'token',
  };
}

// Fake D1 that implements INSERT OR IGNORE claim semantics.
function claimDb() {
  const calls = { claims: new Set(), updates: 0 };
  const statement = {
    _sql: '',
    bind: function (id) { this._id = id; return this; },
    run: async function () {
      if (this._sql.includes('INSERT OR IGNORE')) {
        if (calls.claims.has(this._id)) return { meta: { changes: 0 } };
        calls.claims.add(this._id);
        return { meta: { changes: 1 } };
      }
      if (this._sql.includes('UPDATE parts')) { calls.updates += 1; return { meta: { changes: 1 } }; }
      return { meta: { changes: 1 } }; // CREATE TABLE and friends
    },
    first: async () => null,
  };
  return {
    db: { prepare: (sql) => { statement._sql = sql; return statement; } },
    calls,
  };
}

describe('validateLeadInput', () => {
  it('accepts a valid lead', () => {
    expect(validateLeadInput(validLead()).ok).toBe(true);
  });

  it('rejects missing fields', () => {
    const r = validateLeadInput({ ...validLead(), email: '' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('All fields are required');
  });

  it('rejects malformed emails', () => {
    for (const email of ['notanemail', 'a@b', 'x@y.', 'a b@c.com']) {
      expect(validateLeadInput({ ...validLead(), email }).ok).toBe(false);
    }
  });

  it('rejects over-length fields', () => {
    expect(validateLeadInput({ ...validLead(), issue: 'x'.repeat(2001) }).ok).toBe(false);
    expect(validateLeadInput({ ...validLead(), name: 'x'.repeat(101) }).ok).toBe(false);
    expect(validateLeadInput({ ...validLead(), delivery_address: 'x'.repeat(501) }).ok).toBe(false);
  });
});

describe('sniffImageType', () => {
  const bytes = (arr, len = 16) => Uint8Array.from({ length: len }, (_, i) => arr[i] ?? 0);

  it('detects JPEG/PNG/WebP magic bytes', () => {
    expect(sniffImageType(bytes([0xFF, 0xD8, 0xFF, 0xE0]))).toBe('image/jpeg');
    expect(sniffImageType(bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))).toBe('image/png');
    expect(sniffImageType(bytes([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp');
  });

  it('rejects SVG/HTML/garbage', () => {
    expect(sniffImageType(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode('<html>'))).toBeNull();
    expect(sniffImageType(bytes([0xDE, 0xAD, 0xBE, 0xEF]))).toBeNull();
  });

  it('rejects buffers too short to sniff', () => {
    expect(sniffImageType(new Uint8Array(4))).toBeNull();
  });
});

describe('POST / (lead capture)', () => {
  const baseEnv = { STRIPE_SECRET_KEY: 'sk_test_x' };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('rejects a malformed email before touching Stripe', async () => {
    const res = await worker.fetch(leadRequest({ ...validLead(), email: 'nope' }), baseEnv);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid email address' });
  });

  it('enforces Turnstile when the secret is configured', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: false }) });
    const env = { ...baseEnv, TURNSTILE_SECRET_KEY: '1x_secret' };
    const res = await worker.fetch(leadRequest(validLead()), env);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Bot verification failed. Please try again.');
  });

  it('accepts a lead with a passing Turnstile token', async () => {
    const env = { ...baseEnv, TURNSTILE_SECRET_KEY: '1x_secret' };
    const res = await worker.fetch(leadRequest(validLead()), env);
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    // siteverify was called with the token + secret
    const verifyCall = global.fetch.mock.calls.find(([url]) => url.includes('siteverify'));
    expect(verifyCall).toBeTruthy();
    expect(JSON.parse(verifyCall[1].body).response).toBe('token');
  });

  it('fails open without TURNSTILE_SECRET_KEY (documented rollout behavior)', async () => {
    const res = await worker.fetch(leadRequest(validLead()), baseEnv);
    expect(res.status).toBe(200);
  });
});

describe('rate limiting', () => {
  it('keeps lead and estimate in separate buckets', async () => {
    const env = { STRIPE_SECRET_KEY: 'sk_test_x' }; // no ORS key: estimate returns 503 AFTER the rate-limit check
    for (let i = 0; i < 5; i++) {
      const res = await worker.fetch(leadRequest(validLead(), '9.9.9.9'), env);
      expect(res.status).toBe(200);
    }
    const blocked = await worker.fetch(leadRequest(validLead(), '9.9.9.9'), env);
    expect(blocked.status).toBe(429);

    // Same IP, estimate endpoint: separate bucket, so it passes the limiter (503 = no ORS key)
    const estimate = await worker.fetch(
      new Request('https://example.com/api/estimate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '9.9.9.9' },
        body: JSON.stringify({ address: 'Blaine, MN' }),
      }),
      env
    );
    expect(estimate.status).toBe(503);
  });
});

describe('Stripe webhook idempotency (INSERT OR IGNORE claims)', () => {
  beforeEach(() => {
    mockEvent.id = 'evt_checkout';
    mockEvent.type = 'checkout.session.completed';
    mockEvent.data = { object: { id: 'cs_1', invoice: null } };
    mockLineItems.data = [{ quantity: 2, price: { product: 'prod_sparkplug' } }];
  });

  it('deducts exactly once across duplicate deliveries of the same event', async () => {
    const { db, calls } = claimDb();
    const env = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', DB: db };

    const first = await worker.fetch(webhookRequest({ id: mockEvent.id }), env);
    expect(first.status).toBe(200);
    expect(calls.updates).toBe(1);

    const second = await worker.fetch(webhookRequest({ id: mockEvent.id }), env);
    expect(second.status).toBe(200);
    expect(calls.updates).toBe(1); // no double deduction
  });

  it('deducts invoice.paid once and skips on redelivery', async () => {
    const { db, calls } = claimDb();
    const env = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', DB: db };

    mockEvent.id = 'evt_invoice';
    mockEvent.type = 'invoice.paid';
    mockEvent.data = { object: { id: 'in_1', lines: { data: [{ quantity: 1, price: { product: 'prod_x' } }] } } };

    await worker.fetch(webhookRequest({ id: mockEvent.id }), env);
    expect(calls.updates).toBe(1);

    await worker.fetch(webhookRequest({ id: mockEvent.id }), env);
    expect(calls.updates).toBe(1);
  });

  it('skips checkout sessions that generated an invoice', async () => {
    const { db, calls } = claimDb();
    const env = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', DB: db };

    mockEvent.data = { object: { id: 'cs_invoice', invoice: 'in_999' } };

    const res = await worker.fetch(webhookRequest({ id: mockEvent.id }), env);
    expect(res.status).toBe(200);
    expect(calls.updates).toBe(0); // invoice.paid will handle the deduction
  });
});

describe('POST /api/upload', () => {
  const uploadEnv = () => ({
    ENVIRONMENT: 'dev', // bypass Access check in tests
    STRIPE_SECRET_KEY: 'sk_test_x',
    PHOTOS: { put: vi.fn().mockResolvedValue({}), get: vi.fn() },
  });

  it('rejects SVG/HTML bytes despite any Content-Type', async () => {
    const env = uploadEnv();
    const res = await worker.fetch(new Request('https://example.com/api/upload', {
      method: 'POST',
      headers: { 'content-type': 'image/svg+xml' },
      body: '<svg onload=alert(1)></svg>',
    }), env);
    expect(res.status).toBe(400);
    expect(env.PHOTOS.put).not.toHaveBeenCalled();
  });

  it('rejects uploads over 10MB', async () => {
    const env = uploadEnv();
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    const res = await worker.fetch(new Request('https://example.com/api/upload', {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg' },
      body: big,
    }), env);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Image size cannot exceed 10MB');
  });

  it('accepts real JPEG bytes and stores the sniffed content-type', async () => {
    const env = uploadEnv();
    const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const res = await worker.fetch(new Request('https://example.com/api/upload', {
      method: 'POST',
      headers: { 'content-type': 'image/png' }, // lying header — must be ignored
      body: jpeg,
    }), env);
    expect(res.status).toBe(200);
    expect(env.PHOTOS.put).toHaveBeenCalledWith(
      expect.stringMatching(/^part_\d+\.jpg$/),
      expect.any(ArrayBuffer), // request.arrayBuffer() copy, not the original Uint8Array
      { httpMetadata: { contentType: 'image/jpeg' } }
    );
  });

  it('serves photos with nosniff', async () => {
    const env = uploadEnv();
    env.PHOTOS.get.mockResolvedValue({
      writeHttpMetadata: vi.fn(),
      httpEtag: '"abc"',
      body: new Uint8Array([1, 2, 3]),
    });
    const res = await worker.fetch(new Request('https://example.com/api/photos/part_1.jpg'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
