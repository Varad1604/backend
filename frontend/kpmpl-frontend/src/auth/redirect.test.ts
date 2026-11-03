import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './redirect';

describe('safeReturnPath', () => {
  it.each(['/receiving/v1', '/overview?x=1', '/head-office/p1'])('accepts in-app path %s', (p) => {
    expect(safeReturnPath(p)).toBe(p);
  });
  it.each(['//evil.example', '/\\evil.example', 'https://evil.example', 'receiving', '/login', '/login?x', '', null, 42])('rejects %s', (p) => {
    expect(safeReturnPath(p)).toBeNull();
  });
});
