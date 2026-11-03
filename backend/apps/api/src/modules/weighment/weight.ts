// Pure decimal operations. No I/O, framework, binary floats or unit conversion.
export function scaledWeight(value: string): bigint {
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(value)) throw new RangeError('Invalid decimal weight.');
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole!) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (result <= 0n) throw new RangeError('Weight must be positive.');
  return result;
}
export function decimalWeight(value: bigint): string {
  if (value < 0n) throw new RangeError('Net weight cannot be negative.');
  return (value / 1000n).toString() + '.' + (value % 1000n).toString().padStart(3, '0');
}
export function netWeight(gross: { value: string; unit: string }, tare: { value: string; unit: string }) {
  if (gross.unit !== tare.unit) throw new RangeError('Gross and tare units must match.');
  return { value: decimalWeight(scaledWeight(gross.value) - scaledWeight(tare.value)), unit: gross.unit };
}
