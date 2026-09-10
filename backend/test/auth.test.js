import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync, sign as rsaSign } from 'node:crypto';

// Real RSA keypair so the worker's WebCrypto verification runs for real —
// no mocked verification, no test-only shortcuts.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });

const AUTH_DOMAIN = 'petersonenginerepair.cloudflareaccess.com';
const AUD = 'aud-test';
const OWNER_EMAIL = 'mattssmallenginerep@gmail.com';

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function makeToken({
  aud = AUD,
  email = OWNER_EMAIL,
  exp = Math.floor(Date.now() / 1000) + 3600,
  nbf = Math.floor(Date.now() / 1000) - 60,
  kid = 'test-kid',
  tampered = false,
  // Declared in the header only — the signature is always a real RS256 sig, so
  // this models a token that lies about its algorithm.
  alg = 'RS256',
} = {}) {
  const header = { alg, typ: 'JWT', kid };
  const payload = { iss: `https://${AUTH_DOMAIN}`, aud, email, exp, nbf, iat: Math.floor(Date.now() / 1000) - 120 };
  const h = b64url(header);
  const p = b64url(payload);
  const sig = rsaSign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url');
  // Flip the FIRST signature char, never the last. A 2048-bit RSA signature is
  // 342 base64url chars, so the trailing char's low bits are discarded when
  // atob() decodes it — tampering there is a no-op ~1/64 of the time.
  const tamperedSig = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
  const finalSig = tampered ? tamperedSig : sig;
  return `${h}.${p}.${finalSig}`;
}

import worker from '../index.js';

function partsRequest(token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['cf-access-jwt-assertion'] = token;
  return new Request('https://example.com/api/parts', { headers });
}

const authEnv = () => ({
  STRIPE_SECRET_KEY: 'sk_test_x',
  CLOUDFLARE_ACCESS_AUD: AUD,
  DB: { prepare: () => ({ all: async () => ({ results: [] }) }) },
});

describe('Cloudflare Access JWT verification (GET /api/parts)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
      if (String(url).includes('cdn-cgi/access/certs')) {
        return Promise.resolve({ ok: true, json: async () => ({ keys: [{ kid: 'test-kid', ...jwk }] }) });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('accepts a valid token', async () => {
    const res = await worker.fetch(partsRequest(makeToken()), authEnv());
    expect(res.status).toBe(200);
  });

  it('rejects a missing token', async () => {
    const res = await worker.fetch(partsRequest(null), authEnv());
    expect(res.status).toBe(401);
  });

  it('rejects a token for the wrong audience', async () => {
    const res = await worker.fetch(partsRequest(makeToken({ aud: 'other-app' })), authEnv());
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const res = await worker.fetch(partsRequest(makeToken({ exp: Math.floor(Date.now() / 1000) - 60 })), authEnv());
    expect(res.status).toBe(401);
  });

  it('rejects a token whose nbf is in the future', async () => {
    const res = await worker.fetch(partsRequest(makeToken({ nbf: Math.floor(Date.now() / 1000) + 3600 })), authEnv());
    expect(res.status).toBe(401);
  });

  it('accepts a token without an nbf claim', async () => {
    const res = await worker.fetch(partsRequest(makeToken({ nbf: undefined })), authEnv());
    expect(res.status).toBe(200);
  });

  it('rejects a tampered signature', async () => {
    const res = await worker.fetch(partsRequest(makeToken({ tampered: true })), authEnv());
    expect(res.status).toBe(401);
  });

  it('rejects a token for a non-owner email', async () => {
    const res = await worker.fetch(partsRequest(makeToken({ email: 'attacker@example.com' })), authEnv());
    expect(res.status).toBe(401);
  });

  // Regression: without an explicit alg pin, a token declaring HS256 (but
  // signed with a valid RS256 key) still verified against the issuer's JWKS.
  it('rejects a token whose header alg is not RS256', async () => {
    const res = await worker.fetch(partsRequest(makeToken({ alg: 'HS256' })), authEnv());
    expect(res.status).toBe(401);
  });

  it('rejects an unsigned alg:none token', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT', kid: 'test-kid' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: `https://${AUTH_DOMAIN}`, aud: AUD, email: OWNER_EMAIL,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    const res = await worker.fetch(partsRequest(`${header}.${payload}.`), authEnv());
    expect(res.status).toBe(401);
  });
});

describe('CORS: Access-Control-Allow-Origin echoes only allowed origins', () => {
  it('echoes ACAO for an allowed origin and omits it otherwise', async () => {
    const allowed = await worker.fetch(
      new Request('https://example.com/nope', { headers: { origin: 'https://petersonsmallenginerepair.com' } }),
      authEnv()
    );
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://petersonsmallenginerepair.com');

    const evil = await worker.fetch(
      new Request('https://example.com/nope', { headers: { origin: 'https://evil.com' } }),
      authEnv()
    );
    expect(evil.headers.get('Access-Control-Allow-Origin')).toBeNull();

    const noOrigin = await worker.fetch(new Request('https://example.com/nope'), authEnv());
    expect(noOrigin.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  // Regression: ACAO is request-derived, so responses must be cache-keyed on
  // Origin or a shared cache can hand one origin's ACAO to another.
  it('sends Vary: Origin on every response', async () => {
    for (const headers of [{ origin: 'https://petersonsmallenginerepair.com' }, { origin: 'https://evil.com' }, {}]) {
      const res = await worker.fetch(new Request('https://example.com/nope', { headers }), authEnv());
      expect(res.headers.get('Vary')).toBe('Origin');
    }
  });
});
