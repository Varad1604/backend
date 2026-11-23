/**
 * DataMan ERP weight normalization — the single conversion point between raw ERP
 * scalars and the kg-based KPMPL contract.
 *
 * Live verified evidence (2026-11-17, read-only queries via the authorized VPN path):
 *   - Weightment.Actual_GWeight / Tare_Weight / Net_Weight / Out_Tare_Weight /
 *     Out_Net_Weight are recorded in METRIC TONNES for gate entries that carry GRN
 *     evidence: PChallanDetail.Unit = 'MT', with DocQty = Net_Weight and
 *     RecptQty/AcpQty = Out_Net_Weight.
 *   - The GRN unit evidence applies only to those verified records. Entries WITHOUT a
 *     GRN (hence without PChallanDetail rows) have NO verifiable unit — their recorded
 *     values must never be relabeled or converted.
 *
 * Therefore every weight is normalized here exactly once (the read-only adapter
 * boundary), from raw ERP values:
 *   - unit evidence 'MT'  → exact decimal-point shift ×1000 into kg (string
 *     arithmetic — never floating-point multiplication), e.g. 16.420 MT → "16420" kg;
 *   - unit evidence 'KG'  → pass the raw value through as kg;
 *   - no evidence         → the raw value passes through with unit null and provenance
 *     'unverified'. KPMPL does not invent a kg value, does not relabel the data and
 *     keeps the uncertainty explicit for the UI.
 *
 * NULL means "not recorded in DataMan" and stays null — never zero.
 */

export type ErpWeightProvenance = 'grn' | 'unverified';

export interface ErpWeight {
  /** Stringified ERP scalar. For provenance 'grn' this is the kg value; for 'unverified' it is the raw recorded value. */
  value: string;
  /** 'kg' when the unit is verified; null when unit provenance cannot be established. */
  unit: 'kg' | null;
  provenance: ErpWeightProvenance;
}

/**
 * Shift a decimal string three places to the right (×1000) with pure string
 * arithmetic, so Decimal(12,3) values convert exactly: "16.42" → "16420",
 * "15.9" → "15900", "9.015" → "9015", "2" → "2000". Never multiplies floats.
 */
export function shiftDecimal3(raw: string): string {
  const negative = raw.startsWith('-');
  const digits = negative ? raw.slice(1) : raw;
  const [intPart, fracPart = ''] = digits.split('.');
  // Pad the fraction to at least three digits, then move three of them into the
  // integer part; anything beyond stays fractional (Decimal(12,3) never exceeds 3).
  const frac = fracPart.padEnd(3, '0');
  const kgInt = (intPart + frac.slice(0, 3)).replace(/^0+(?=\d)/, '');
  const kgFrac = frac.slice(3).replace(/0+$/, '');
  const result = kgFrac.length > 0 ? `${kgInt}.${kgFrac}` : kgInt;
  return negative ? `-${result}` : result;
}

/**
 * Normalize one raw ERP weight scalar against the gate's verified GRN unit evidence.
 * @param raw the raw ERP column value (number/string); null/undefined ⇒ not recorded.
 * @param grnUnit the agreeing PChallanDetail.Unit for this gate entry, or null when
 *                there is no GRN evidence (or the evidence disagrees/absent).
 */
export function normalizeErpWeight(raw: unknown, grnUnit: string | null | undefined): ErpWeight | null {
  if (raw === null || raw === undefined) return null;
  const rawText = String(raw);
  const unit = typeof grnUnit === 'string' ? grnUnit.trim().toUpperCase() : '';
  if (unit === 'MT') {
    return { value: shiftDecimal3(rawText), unit: 'kg', provenance: 'grn' };
  }
  if (unit === 'KG') {
    return { value: rawText, unit: 'kg', provenance: 'grn' };
  }
  // No verified unit: pass the recorded value through unchanged and say so.
  return { value: rawText, unit: null, provenance: 'unverified' };
}
