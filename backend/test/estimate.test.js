import { describe, it, expect } from 'vitest';
import { calculateFee, matchServiceArea, SERVICE_AREA_CITIES } from '../index.js';

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
