import { describe, expect, it } from 'vitest';
import { decimalWeight, netWeight, scaledWeight } from './weight';
describe('decimal weight rules', () => {
  it('keeps exact thousandths across the full numeric(12,3) range', () => {
    expect(decimalWeight(scaledWeight('999999999.999'))).toBe('999999999.999');
    expect(netWeight({ value: '0.003', unit: 'kg' }, { value: '0.001', unit: 'kg' })).toEqual({ value: '0.002', unit: 'kg' });
    expect(decimalWeight(scaledWeight('000000008.1'))).toBe('8.100');
  });
  it('allows zero net but rejects negative net and incompatible units', () => {
    expect(netWeight({ value: '1', unit: 'mt' }, { value: '1.000', unit: 'mt' }).value).toBe('0.000');
    expect(() => netWeight({ value: '1', unit: 'kg' }, { value: '2', unit: 'kg' })).toThrow();
    expect(() => netWeight({ value: '1', unit: 'mt' }, { value: '1', unit: 'kg' })).toThrow();
  });
  it('rejects values which would need rounding, parsing or overflow', () => {
    for (const value of ['0', '-1', '1e3', '1.0001', '1000000000', 'NaN', ' 1 ']) expect(() => scaledWeight(value)).toThrow();
  });
});
