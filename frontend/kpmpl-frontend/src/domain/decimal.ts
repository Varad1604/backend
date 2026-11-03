/**
 * Decimal-string helpers. Weights and readings are kept as strings to avoid binary
 * floating-point drift (10_SECURITY §3). Precision/units are NOT client-approved (D-12);
 * the 3-decimal kg / 2-decimal % limits below are prototype validation only.
 */
import type { DecimalString } from './types';

const DECIMAL_RE = /^\d{1,9}(\.\d{1,3})?$/;

export type DecimalCheck = { ok: true; value: DecimalString } | { ok: false; message: string };

export function parseDecimalInput(raw: string, opts: { maxDecimals: number; label: string; max?: number }): DecimalCheck {
  const v = raw.trim().replace(/,/g, '');
  if (v === '') return { ok: false, message: `Enter the ${opts.label}.` };
  if (v.startsWith('-')) return { ok: false, message: `${capitalise(opts.label)} cannot be negative.` };
  const re = new RegExp(`^\\d{1,9}(\\.\\d{1,${opts.maxDecimals}})?$`);
  if (!re.test(v)) {
    return { ok: false, message: `Enter a number with up to ${opts.maxDecimals} decimal places, e.g. ${opts.maxDecimals === 3 ? '15000.000' : '9.50'}.` };
  }
  const scaled = toScaled(v, opts.maxDecimals);
  if (scaled === 0n) return { ok: false, message: `${capitalise(opts.label)} must be greater than zero.` };
  if (opts.max !== undefined && scaled > BigInt(opts.max) * 10n ** BigInt(opts.maxDecimals)) {
    return { ok: false, message: `${capitalise(opts.label)} cannot be more than ${opts.max}.` };
  }
  return { ok: true, value: fromScaled(scaled, opts.maxDecimals) };
}

export function isDecimalString(v: string): boolean {
  return DECIMAL_RE.test(v);
}

function toScaled(v: string, decimals: number): bigint {
  const [i, f = ''] = v.split('.');
  return BigInt(i + f.padEnd(decimals, '0'));
}

function fromScaled(n: bigint, decimals: number): string {
  const s = n.toString().padStart(decimals + 1, '0');
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

/**
 * Net = gross − tare, displayed ONLY when both readings exist, units match and the
 * result is positive (KPM-M1-004). Returns null otherwise — never a silent negative.
 */
export function deriveNet(gross: { value: string; unit: string } | null, tare: { value: string; unit: string } | null): string | null {
  if (!gross || !tare) return null;
  if (gross.unit !== tare.unit) return null;
  if (!isDecimalString(gross.value) || !isDecimalString(tare.value)) return null;
  const net = toScaled(gross.value, 3) - toScaled(tare.value, 3);
  if (net <= 0n) return null;
  return fromScaled(net, 3);
}

/** Display formatting with Indian digit grouping; keeps all stored decimals. */
export function formatDecimal(v: string): string {
  const [i, f] = v.split('.');
  const grouped = BigInt(i || '0').toLocaleString('en-IN');
  return f !== undefined ? `${grouped}.${f}` : grouped;
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
