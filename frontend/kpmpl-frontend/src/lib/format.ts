import { uuidV4 } from './ids';
import { config } from '../config';

const dt = new Intl.DateTimeFormat('en-IN', {
  timeZone: config.displayTimeZone,
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
});
const t = new Intl.DateTimeFormat('en-IN', { timeZone: config.displayTimeZone, hour: '2-digit', minute: '2-digit', hour12: true });
const d = new Intl.DateTimeFormat('en-IN', { timeZone: config.displayTimeZone, day: '2-digit', month: 'short', year: 'numeric' });

export const formatDateTime = (iso: string | null | undefined) => (iso ? `${dt.format(new Date(iso))} IST` : '—');
export const formatTime = (iso: string) => t.format(new Date(iso));
export const formatDate = (iso: string) => d.format(new Date(iso));

export function isToday(iso: string): boolean {
  return d.format(new Date(iso)) === d.format(new Date());
}

export function relativeAge(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h ${mins % 60} min ago`;
  const days = Math.floor(h / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

/** One key per logical write; reused on retry (useWrite). UUID v4 per brief §3. */
export function newIdempotencyKey(): string {
  return uuidV4();
}

/** Value for <input type="datetime-local"> expressed in IST regardless of the device clock zone. */
export function toIstInput(d: Date = new Date()): string {
  const ist = new Date(d.getTime() + 330 * 60000);
  return ist.toISOString().slice(0, 16);
}
/** Parse an IST datetime-local value ("2026-11-02T10:30") to an ISO instant; null if invalid. */
export function fromIstInput(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}:00+05:30`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** CSV text (RFC 4180 quoting, UTF-8 BOM). Values are written as text so refs like 0008-HO keep their form. */
export function buildCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const q = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula-injection guard (brief §5.5: = + - @)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + [header, ...rows].map((r) => r.map(q).join(',')).join('\r\n');
}

/** Save a Blob as a file via a temporary object URL. */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
