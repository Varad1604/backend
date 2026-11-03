/** Only in-app paths are accepted as a return target. */
export function safeReturnPath(from: unknown): string | null {
  // Backslashes are rejected too: react-router 6 Link/navigate open-redirect advisory GHSA-wrjc-x8rr-h8h6.
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//') || from.includes('\\') || from.startsWith('/login')) return null;
  return from;
}
