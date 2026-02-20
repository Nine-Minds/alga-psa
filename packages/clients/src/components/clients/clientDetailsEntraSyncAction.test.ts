import { describe, expect, it } from 'vitest';

import { shouldShowEntraSyncAction } from './clientDetailsEntraSyncAction';

describe('shouldShowEntraSyncAction', () => {
  it('returns false when client sync flag is disabled', () => {
    expect(shouldShowEntraSyncAction('enterprise', false)).toBe(false);
  });

  it('returns true only when edition is enterprise and flag is enabled', () => {
    expect(shouldShowEntraSyncAction('enterprise', true)).toBe(true);
    expect(shouldShowEntraSyncAction('community', true)).toBe(false);
    expect(shouldShowEntraSyncAction(undefined, true)).toBe(false);
  });
});
