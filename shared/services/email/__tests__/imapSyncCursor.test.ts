import { describe, it, expect } from 'vitest';
import { resolveImapSyncStartUid } from '../imapSyncCursor';

describe('resolveImapSyncStartUid (IMAP cursor semantics)', () => {
  it('resumes incrementally from a truthy cursor', () => {
    expect(resolveImapSyncStartUid('417', 500, 5)).toBe(418);
  });

  it("treats the '0' recovery marker as a full covering rescan from UID 1", () => {
    // The auth-pause recovery contract: last_uid = '0' must scan from the
    // beginning of the mailbox so the entire paused interval is covered —
    // not resume from the most recent window.
    expect(resolveImapSyncStartUid('0', 10_000, 5)).toBe(1);
  });

  it('starts from the most recent window on a missing cursor (initial connect)', () => {
    expect(resolveImapSyncStartUid(undefined, 10_000, 5)).toBe(9_995);
    expect(resolveImapSyncStartUid(undefined, 3, 5)).toBe(1);
    expect(resolveImapSyncStartUid(undefined, undefined, 5)).toBe(1);
  });
});
