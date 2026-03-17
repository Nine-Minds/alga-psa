import { describe, expect, it } from 'vitest';
import { deriveClientContractStatus } from '../../../shared/billingClients/clientContractStatus';

describe('deriveClientContractStatus', () => {
  it('T023: derives active, expired, draft, and terminated states from assignment lifecycle fields', () => {
    expect(
      deriveClientContractStatus({
        isActive: true,
        startDate: '2026-03-01',
        endDate: null,
        now: '2026-03-16',
      })
    ).toBe('active');

    expect(
      deriveClientContractStatus({
        isActive: true,
        startDate: '2026-01-01',
        endDate: '2026-03-15',
        now: '2026-03-16',
      })
    ).toBe('expired');

    expect(
      deriveClientContractStatus({
        isActive: true,
        startDate: '2026-04-01',
        endDate: null,
        now: '2026-03-16',
      })
    ).toBe('draft');

    expect(
      deriveClientContractStatus({
        isActive: false,
        startDate: '2026-04-01',
        endDate: null,
        now: '2026-03-16',
      })
    ).toBe('draft');

    expect(
      deriveClientContractStatus({
        isActive: false,
        startDate: '2026-03-01',
        endDate: null,
        now: '2026-03-16',
      })
    ).toBe('terminated');
  });
});
