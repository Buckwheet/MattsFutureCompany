import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  calculateFee, matchServiceArea, SERVICE_AREA_CITIES, buildEstimate,
  buildCustomerDeliveryBlock, validateEstimateInput
} from '../index.js';
import worker from '../index.js';

describe('calculateFee', () => {
  it('charges $1.50/mi round trip at 3 mi one-way', () => {
    const r = calculateFee(3);
    expect(r.roundTripMiles).toBe(6);
    expect(r.estimate).toBeCloseTo(9.0, 2);
    expect(r.outOfRange).toBe(false);
  });

  it('charges $1.50/mi at exactly 5 mi (boundary, inclusive)', () => {
    const r = calculateFee(5);
    expect(r.estimate).toBeCloseTo(15.0, 2); // 10 rt mi * 1.50
  });

  it('charges $2.00/mi just over 5 mi', () => {
    const r = calculateFee(5.1);
    expect(r.estimate).toBeCloseTo(20.4, 2); // 10.2 rt mi * 2.00
  });

  it('charges $2.00/mi at 8 mi one-way', () => {
    const r = calculateFee(8);
    expect(r.estimate).toBeCloseTo(32.0, 2);
  });

  it('charges $2.00/mi at exactly 20 mi (boundary, inclusive)', () => {
    const r = calculateFee(20);
    expect(r.estimate).toBeCloseTo(80.0, 2); // 40 rt mi * 2.00
    expect(r.outOfRange).toBe(false);
  });

  it('returns out of range just over 20 mi', () => {
    const r = calculateFee(20.1);
    expect(r.estimate).toBeNull();
    expect(r.outOfRange).toBe(true);
  });

  it('rejects negative input', () => {
    const r = calculateFee(-5);
    expect(r.estimate).toBeNull();
    expect(r.outOfRange).toBe(true);
  });

  it('rejects non-finite input', () => {
    expect(calculateFee(NaN).estimate).toBeNull();
    expect(calculateFee(Infinity).estimate).toBeNull();
    expect(calculateFee(undefined).estimate).toBeNull();
  });
});

describe('matchServiceArea', () => {
  it('matches exact city', () => {
    expect(matchServiceArea('Blaine')).toBe(true);
  });
  it('matches case-insensitively with whitespace', () => {
    expect(matchServiceArea('  coon rapids ')).toBe(true);
  });
  it('does not match a city outside the list', () => {
    expect(matchServiceArea('Minneapolis')).toBe(false);
  });
  it('handles empty/undefined', () => {
    expect(matchServiceArea('')).toBe(false);
    expect(matchServiceArea(undefined)).toBe(false);
  });
  it('exposes 14 service-area cities', () => {
    expect(SERVICE_AREA_CITIES).toHaveLength(14);
  });
});

describe('buildEstimate', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const env = { ORS_API_KEY: 'test-key' };

  it('builds an estimate from coordinates with mocked ORS', async () => {
    const distances = { distances: [[12875]] }; // meters origin->dest (~8 mi)
    const reverse = { features: [{ properties: { locality: 'Blaine', label: '123 Main St, Blaine, MN 55434' } }] };
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => distances })   // matrix
      .mockResolvedValueOnce({ ok: true, json: async () => reverse });    // reverse geocode

    const r = await buildEstimate(env, { lat: 45.16, lng: -93.23 });
    expect(r.oneWayMiles).toBeCloseTo(8.0, 1);
    expect(r.estimate).toBeCloseTo(32.0, 0);
    expect(r.city).toBe('Blaine');
    expect(r.inServiceArea).toBe(true);
    expect(r.mapLink).toContain('45.16');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/v2/matrix/driving-car'), expect.objectContaining({ method: 'POST' }));
  });

  it('constrains geocoding to the service metro (focus + boundary circle)', async () => {
    const geocode = { features: [{
      geometry: { coordinates: [-93.23, 45.16] },
      properties: { locality: 'Blaine', label: '123 Main St, Blaine, MN, USA' }
    }] };
    const matrix = { distances: [[12875]] };
    const reverse = { features: [{ properties: { locality: 'Blaine', label: '123 Main St, Blaine, MN, USA' } }] };
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => geocode })   // geocode (address path)
      .mockResolvedValueOnce({ ok: true, json: async () => matrix })    // matrix
      .mockResolvedValueOnce({ ok: true, json: async () => reverse });  // reverse geocode

    await buildEstimate({ ORS_API_KEY: 'test-key' }, { address: 'Blaine, MN' });

    const geocodeUrl = global.fetch.mock.calls[0][0];
    expect(geocodeUrl).toContain('focus.point.lat=45.159887');
    expect(geocodeUrl).toContain('focus.point.lon=-93.275209');
    expect(geocodeUrl).toContain('boundary.circle.lat=45.159887');
    expect(geocodeUrl).toContain('boundary.circle.lon=-93.275209');
    expect(geocodeUrl).toContain('boundary.circle.radius=64');
  });
});

describe('buildCustomerDeliveryBlock', () => {
  it('returns empty string when pickup not requested', () => {
    expect(buildCustomerDeliveryBlock('No', '123 Main St')).toBe('');
    expect(buildCustomerDeliveryBlock(undefined, '123 Main St')).toBe('');
  });

  it('shows the address and verify note when address present', () => {
    const html = buildCustomerDeliveryBlock('Yes', '7323 Peltier Circle, Blaine, MN');
    expect(html).toContain('Pickup/Delivery Address on file');
    expect(html).toContain('7323 Peltier Circle, Blaine, MN');
    expect(html).toContain('Please make sure this address is correct');
  });

  it('shows a fallback when pickup requested but no address', () => {
    const html = buildCustomerDeliveryBlock('Yes', '');
    expect(html).toContain('Pickup/Delivery requested');
    expect(html).toContain("I'll confirm your address");
    expect(html).not.toContain('Address on file');
  });

  it('escapes HTML in the address', () => {
    const html = buildCustomerDeliveryBlock('Yes', '<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>x</script>');
  });
});

describe('validateEstimateInput', () => {
  it('accepts in-range coordinates and a normal address', () => {
    expect(validateEstimateInput({ lat: 45.16, lng: -93.23 }).ok).toBe(true);
    expect(validateEstimateInput({ lat: '45.16', lng: '-93.23' }).ok).toBe(true);
    expect(validateEstimateInput({ address: 'Blaine, MN' }).ok).toBe(true);
    expect(validateEstimateInput({}).ok).toBe(true);
  });

  it('rejects out-of-range coordinates', () => {
    expect(validateEstimateInput({ lat: 999, lng: -500 }).ok).toBe(false);
    expect(validateEstimateInput({ lat: 90.0001, lng: 0 }).ok).toBe(false);
    expect(validateEstimateInput({ lat: 0, lng: -180.0001 }).ok).toBe(false);
    expect(validateEstimateInput({ lat: 45, lng: undefined }).ok).toBe(false);
  });

  it('rejects non-numeric and injection-shaped coordinate strings', () => {
    expect(validateEstimateInput({ lat: '45.1&evil=1', lng: -93.2 }).ok).toBe(false);
    expect(validateEstimateInput({ lat: 45.1, lng: '-93.2&point.lat=1' }).ok).toBe(false);
    expect(validateEstimateInput({ lat: '', lng: '' }).ok).toBe(false);
    expect(validateEstimateInput({ lat: NaN, lng: 0 }).ok).toBe(false);
  });

  it('rejects missing, empty, non-string, and oversized addresses', () => {
    expect(validateEstimateInput({ address: '' }).ok).toBe(false);
    expect(validateEstimateInput({ address: '   ' }).ok).toBe(false);
    expect(validateEstimateInput({ address: 123 }).ok).toBe(false);
    expect(validateEstimateInput({ address: 'a'.repeat(501) }).ok).toBe(false);
    expect(validateEstimateInput({ address: 'a'.repeat(500) }).ok).toBe(true);
  });

  it('throws a 400-tagged error from buildEstimate for invalid input', async () => {
    await expect(buildEstimate({ ORS_API_KEY: 'k' }, { lat: 999, lng: 0 }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('encodes destination coordinates in reverse-geocode and map links', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ distances: [[1609.344]] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ features: [] }) });

    const r = await buildEstimate({ ORS_API_KEY: 'k' }, { lat: '45.16', lng: '-93.23' });
    expect(global.fetch.mock.calls[1][0]).toContain('point.lat=45.16');
    expect(global.fetch.mock.calls[1][0]).toContain('point.lon=-93.23');
    expect(r.mapLink).toContain('mlat=45.16');
    expect(r.mapLink).toContain('mlon=-93.23');
  });
});

describe('POST /api/estimate input validation', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const estimateRequest = (payload, ip = '10.0.0.1') => new Request('https://example.com/api/estimate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify(payload),
  });

  const env = { STRIPE_SECRET_KEY: 'sk_test_x', ORS_API_KEY: 'ors_test' };

  it.each([
    ['out-of-range lat', { lat: 999, lng: -93.2 }],
    ['out-of-range lng', { lat: 45.1, lng: -500 }],
    ['non-numeric lat', { lat: '45.1&evil=1', lng: -93.2 }],
    ['oversized address', { address: 'a'.repeat(501) }],
    ['no location', {}],
  ])('returns 400 before calling ORS for %s', async (_label, payload) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await worker.fetch(estimateRequest(payload), env);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
