import { describe, expect, it } from 'vitest';
import type { IStatus } from '@alga-psa/types';
import { derivePortalStatusOptions } from './portalStatusOptions';

function status(overrides: Partial<IStatus>): IStatus {
  return {
    status_id: overrides.status_id ?? 'status',
    tenant: 'tenant-1',
    name: overrides.name ?? 'Status',
    status_type: 'ticket',
    ...overrides,
  } as IStatus;
}

describe('derivePortalStatusOptions', () => {
  const restrictedA = status({ status_id: 'A', name: 'Restricted A', portal_selectable: false });
  const selectableB = status({ status_id: 'B', name: 'Selectable B', portal_selectable: true });
  const options = [restrictedA, selectableB];

  it('keeps the current restricted status visible so the label still renders', () => {
    expect(derivePortalStatusOptions(options, 'A').map((option) => option.status_id)).toEqual(['A', 'B']);
  });

  it('drops a restricted status immediately after the ticket leaves it', () => {
    expect(derivePortalStatusOptions(options, 'B').map((option) => option.status_id)).toEqual(['B']);
    expect(derivePortalStatusOptions(options, null).map((option) => option.status_id)).toEqual(['B']);
  });

  it('treats an omitted portal_selectable as selectable', () => {
    const legacy = status({ status_id: 'C', name: 'Legacy' });
    expect(derivePortalStatusOptions([legacy], null).map((option) => option.status_id)).toEqual(['C']);
  });
});
