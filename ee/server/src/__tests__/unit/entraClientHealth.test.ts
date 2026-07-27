import { describe, expect, it } from 'vitest';
import {
  countEntraClientsByFilter,
  entraClientHealth,
  matchesEntraClientFilter,
  sortEntraClientsWorstFirst,
} from '@ee/components/settings/integrations/entra/entraClientHealth';
import type { EntraConfirmedMapping } from '@alga-psa/integrations/actions';

function client(overrides: Partial<EntraConfirmedMapping> = {}): EntraConfirmedMapping {
  return {
    managedTenantId: 'managed-1',
    entraTenantId: 'entra-1',
    clientId: 'client-1',
    clientName: 'Contoso',
    displayName: 'Contoso Ltd',
    primaryDomain: 'contoso.com',
    sourceUserCount: 10,
    lastSyncedAt: '2026-07-25T10:00:00.000Z',
    lastRunStatus: 'completed',
    ...overrides,
  };
}

describe('entraClientHealth', () => {
  it('names every state a run can actually leave a client in', () => {
    expect(entraClientHealth(client({ lastRunStatus: 'completed' }))).toBe('synced');
    expect(entraClientHealth(client({ lastRunStatus: 'failed' }))).toBe('failed');
    // The notification rules count partial as a failure; the badge used to call
    // it "Never synced".
    expect(entraClientHealth(client({ lastRunStatus: 'partial' }))).toBe('partial');
    expect(entraClientHealth(client({ lastRunStatus: 'running' }))).toBe('running');
    expect(entraClientHealth(client({ lastRunStatus: null, lastSyncedAt: null }))).toBe('never');
  });

  it('does not call a client that has synced "never synced" because of an unknown status', () => {
    expect(entraClientHealth(client({ lastRunStatus: 'queued' }))).toBe('synced');
  });
});

describe('matchesEntraClientFilter', () => {
  it('counts a partly failed client as failing, where the old predicate hid it', () => {
    expect(matchesEntraClientFilter(client({ lastRunStatus: 'partial' }), 'failing')).toBe(true);
    expect(matchesEntraClientFilter(client({ lastRunStatus: 'failed' }), 'failing')).toBe(true);
    expect(matchesEntraClientFilter(client({ lastRunStatus: 'completed' }), 'failing')).toBe(false);
  });

  it('agrees with the badge about what "never synced" means', () => {
    const midRun = client({ lastRunStatus: 'running', lastSyncedAt: '2026-07-25T10:00:00.000Z' });
    expect(matchesEntraClientFilter(midRun, 'never-synced')).toBe(false);
    expect(entraClientHealth(midRun)).not.toBe('never');
  });
});

describe('sortEntraClientsWorstFirst', () => {
  it('puts what needs a person at the top, stalest first inside a bucket', () => {
    const rows = [
      client({ managedTenantId: 'ok', clientName: 'Healthy Ltd', lastRunStatus: 'completed' }),
      client({ managedTenantId: 'never', clientName: 'New Ltd', lastRunStatus: null, lastSyncedAt: null }),
      client({ managedTenantId: 'partial', clientName: 'Partly Ltd', lastRunStatus: 'partial' }),
      client({ managedTenantId: 'failed-old', clientName: 'Old Ltd', lastRunStatus: 'failed', lastSyncedAt: '2026-07-01T10:00:00.000Z' }),
      client({ managedTenantId: 'failed-new', clientName: 'Recent Ltd', lastRunStatus: 'failed', lastSyncedAt: '2026-07-24T10:00:00.000Z' }),
    ];

    expect(sortEntraClientsWorstFirst(rows).map((row) => row.managedTenantId)).toEqual([
      'failed-old',
      'failed-new',
      'partial',
      'never',
      'ok',
    ]);
  });
});

describe('countEntraClientsByFilter', () => {
  it('tells each filter whether it is worth clicking', () => {
    const counts = countEntraClientsByFilter([
      client({ lastRunStatus: 'failed' }),
      client({ lastRunStatus: 'partial' }),
      client({ lastRunStatus: 'completed' }),
      client({ lastRunStatus: null, lastSyncedAt: null }),
    ]);

    expect(counts).toEqual({ all: 4, failing: 2, 'never-synced': 1, synced: 1 });
  });
});
