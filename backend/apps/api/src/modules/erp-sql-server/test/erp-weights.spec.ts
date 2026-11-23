import { describe, expect, it } from 'vitest';
import { normalizeErpWeight, shiftDecimal3 } from '../erp-weights';

/**
 * Weight-mapping regression — the core of the DataMan correction.
 *
 * Live-verified reference records (read-only SQL Server queries, 2026-11-17):
 * every gate below carries GRN evidence (PChallanDetail.Unit = 'MT'), so the raw ERP
 * scalars are metric tonnes and MUST arrive at the API as exact kg values — converted
 * once, here, by decimal-point shift, never by float multiplication and never
 * recomputed from other columns.
 */
describe('shiftDecimal3 (exact string ×1000)', () => {
  it('shifts the reference gate scalars exactly, without float drift', () => {
    expect(shiftDecimal3('16.42')).toBe('16420');   // gate 17110013 gross
    expect(shiftDecimal3('6.44')).toBe('6440');     // gate 17110013 final tare
    expect(shiftDecimal3('9.98')).toBe('9980');     // gate 17110013 weighbridge net
    expect(shiftDecimal3('10.04')).toBe('10040');   // gate 17110013 document net
    expect(shiftDecimal3('15.9')).toBe('15900');    // gate 17110001 gross
    expect(shiftDecimal3('9.015')).toBe('9015');    // gate 17110001 final tare
    expect(shiftDecimal3('6.885')).toBe('6885');    // gate 17110001 both nets
    expect(shiftDecimal3('6.18')).toBe('6180');     // gate 17110015 gross
    expect(shiftDecimal3('3.57')).toBe('3570');     // gate 17110015 final tare
    expect(shiftDecimal3('2.61')).toBe('2610');     // gate 17110015 weighbridge net
    expect(shiftDecimal3('2.62')).toBe('2620');     // gate 17110015 document net
    expect(shiftDecimal3('6.41')).toBe('6410');     // gate 17110030 gross
    expect(shiftDecimal3('4.41')).toBe('4410');     // gate 17110030 final tare
    expect(shiftDecimal3('2')).toBe('2000');        // gate 17110030 nets (integral MT)
  });

  it('keeps genuine sub-kilogram precision and rejects float multiplication drift', () => {
    expect(shiftDecimal3('0.001')).toBe('1');
    expect(shiftDecimal3('0.0005')).toBe('0.5');    // beyond Decimal(12,3) but the helper stays exact
    // The float trap this helper must never hit: 1.005 is a legal Decimal(12,3) ERP
    // scalar, and JS multiplication corrupts it — the string shift cannot.
    expect(1.005 * 1000).toBe(1004.9999999999999);  // what float math would record
    expect(shiftDecimal3('1.005')).toBe('1005');    // what the ERP actually recorded
  });

  it('handles negatives and strips only insignificant zeros', () => {
    expect(shiftDecimal3('-1.5')).toBe('-1500');
    expect(shiftDecimal3('0.01')).toBe('10');
    expect(shiftDecimal3('0')).toBe('0');
    expect(shiftDecimal3('0.000')).toBe('0');
  });
});

describe('normalizeErpWeight (provenance-driven, kg contract)', () => {
  it('converts verified MT values to exact kg with grn provenance', () => {
    // Gate 17110013's four verified scalars.
    expect(normalizeErpWeight(16.42, 'MT')).toEqual({ value: '16420', unit: 'kg', provenance: 'grn' });
    expect(normalizeErpWeight(6.44, 'MT')).toEqual({ value: '6440', unit: 'kg', provenance: 'grn' });
    expect(normalizeErpWeight(9.98, 'MT')).toEqual({ value: '9980', unit: 'kg', provenance: 'grn' });
    expect(normalizeErpWeight(10.04, 'MT')).toEqual({ value: '10040', unit: 'kg', provenance: 'grn' });
    // Driver may deliver the scalar already stringified — same result.
    expect(normalizeErpWeight('15.9', 'MT')).toEqual({ value: '15900', unit: 'kg', provenance: 'grn' });
  });

  it('passes KG-evidenced values through as kg without conversion (no double conversion)', () => {
    expect(normalizeErpWeight(15900, 'KG')).toEqual({ value: '15900', unit: 'kg', provenance: 'grn' });
    expect(normalizeErpWeight('16420.000', 'kg')).toEqual({ value: '16420.000', unit: 'kg', provenance: 'grn' });
  });

  it('never invents kg when unit provenance cannot be established', () => {
    // No GRN evidence: the raw value passes through, unit null, uncertainty explicit.
    expect(normalizeErpWeight(22.11, null)).toEqual({ value: '22.11', unit: null, provenance: 'unverified' });
    expect(normalizeErpWeight('6.885', undefined)).toEqual({ value: '6.885', unit: null, provenance: 'unverified' });
    // Disagreeing/unknown unit strings are equally unverified — never guessed.
    expect(normalizeErpWeight(22.11, 'TON')).toEqual({ value: '22.11', unit: null, provenance: 'unverified' });
    expect(normalizeErpWeight(22.11, '')).toEqual({ value: '22.11', unit: null, provenance: 'unverified' });
  });

  it('keeps NULL (not recorded) and genuine zero distinct', () => {
    expect(normalizeErpWeight(null, 'MT')).toBeNull();
    expect(normalizeErpWeight(undefined, 'MT')).toBeNull();
    expect(normalizeErpWeight(0, 'MT')).toEqual({ value: '0', unit: 'kg', provenance: 'grn' });
    expect(normalizeErpWeight(0.000, null)).toEqual({ value: '0', unit: null, provenance: 'unverified' });
  });
});
