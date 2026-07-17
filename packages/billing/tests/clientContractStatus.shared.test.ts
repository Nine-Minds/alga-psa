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

  it('normalizes knex Date values for assignment start, end, and current dates', () => {
    expect(
      deriveClientContractStatus({
        isActive: true,
        startDate: new Date('2026-04-01T00:00:00.000Z'),
        endDate: null,
        now: new Date('2026-03-16T12:00:00.000Z'),
      })
    ).toBe('draft');

    expect(
      deriveClientContractStatus({
        isActive: true,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-03-15T00:00:00.000Z'),
        now: new Date('2026-03-16T12:00:00.000Z'),
      })
    ).toBe('expired');
  });

  it('always presents assignments belonging to draft contract headers as draft', () => {
    expect(
      deriveClientContractStatus({
        isActive: false,
        startDate: '2026-01-01',
        endDate: '2026-02-01',
        contractStatus: 'draft',
        now: '2026-03-16',
      })
    ).toBe('draft');
  });

  it('leaves lifecycle derivation unchanged for non-draft contract headers', () => {
    expect(
      deriveClientContractStatus({
        isActive: false,
        startDate: '2026-01-01',
        endDate: null,
        contractStatus: 'active',
        now: '2026-03-16',
      })
    ).toBe('terminated');
  });
});
