import { describe, expect, it } from 'vitest';

import { shouldShowEntraSyncAction } from './clientDetailsEntraSyncAction';

describe('shouldShowEntraSyncAction', () => {
  it('returns false when client sync flag is disabled', () => {
    expect(shouldShowEntraSyncAction('enterprise', false, { entra_tenant_id: 'entra-1' })).toBe(false);
  });

  it('returns false when edition is not enterprise', () => {
    expect(shouldShowEntraSyncAction('community', true, { entra_tenant_id: 'entra-1' })).toBe(false);
    expect(shouldShowEntraSyncAction(undefined, true, { entra_tenant_id: 'entra-1' })).toBe(false);
  });

  it('T126: returns true for mapped clients and false for unmapped clients', () => {
    expect(shouldShowEntraSyncAction('enterprise', true, { entra_tenant_id: 'entra-mapped' })).toBe(true);
    expect(shouldShowEntraSyncAction('enterprise', true, { entra_tenant_id: '' })).toBe(false);
    expect(shouldShowEntraSyncAction('enterprise', true, { entra_tenant_id: null })).toBe(false);
    expect(shouldShowEntraSyncAction('enterprise', true, null)).toBe(false);
  });
});
