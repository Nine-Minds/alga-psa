import { describe, expect, it } from 'vitest';
import { resolveClosedMasterChoices } from '../ticketBundlePolicy';

describe('resolveClosedMasterChoices', () => {
  it('returns no choices for an open master', () => {
    expect(
      resolveClosedMasterChoices({ isClosed: false, requireNoOpenChildren: false })
    ).toEqual([]);
    expect(
      resolveClosedMasterChoices({ isClosed: false, requireNoOpenChildren: true })
    ).toEqual([]);
  });

  it('returns all three choices for a closed master when the rule is off', () => {
    expect(
      resolveClosedMasterChoices({ isClosed: true, requireNoOpenChildren: false })
    ).toEqual(['keep_closed', 'apply_resolution', 'reopen_master']);
  });

  it('drops keep_closed when the board forbids open children under a closed master', () => {
    expect(
      resolveClosedMasterChoices({ isClosed: true, requireNoOpenChildren: true })
    ).toEqual(['apply_resolution', 'reopen_master']);
  });
});
