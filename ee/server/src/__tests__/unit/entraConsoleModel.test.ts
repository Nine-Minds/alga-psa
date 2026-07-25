import { describe, expect, it } from 'vitest';
import {
  buildEntraAttentionItems,
  buildEntraRunHistoryCsv,
  filterEntraRuns,
  findLastRealRun,
  parseEntraConsoleTab,
  summarizeEntraRunResults,
  DEFAULT_ENTRA_HISTORY_FILTERS,
} from '@ee/components/settings/integrations/entra/entraConsoleModel';
import type {
  EntraConfirmedMapping,
  EntraStatusResponse,
  EntraSyncHistoryRun,
} from '@alga-psa/integrations/actions';

function mapping(overrides: Partial<EntraConfirmedMapping> = {}): EntraConfirmedMapping {
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

function run(overrides: Partial<EntraSyncHistoryRun> = {}): EntraSyncHistoryRun {
  return {
    runId: 'run-1',
    status: 'completed',
    runType: 'all-tenants',
    startedAt: '2026-07-25T10:00:00.000Z',
    completedAt: '2026-07-25T10:05:00.000Z',
    totalTenants: 2,
    processedTenants: 2,
    succeededTenants: 2,
    failedTenants: 0,
    isDryRun: false,
    scopeManagedTenantId: null,
    scopeClientId: null,
    ...overrides,
  };
}

const status = (overrides: Partial<EntraStatusResponse> = {}): EntraStatusResponse => ({
  status: 'connected',
  connectionType: 'direct',
  lastDiscoveryAt: '2026-07-25T09:00:00.000Z',
  mappedTenantCount: 1,
  nextSyncIntervalMinutes: 1440,
  availableConnectionTypes: ['direct', 'cipp'],
  lastValidatedAt: '2026-07-25T09:30:00.000Z',
  lastValidationError: null,
  ...overrides,
});

describe('parseEntraConsoleTab', () => {
  it('accepts known tabs and falls back to overview', () => {
    expect(parseEntraConsoleTab('history')).toBe('history');
    expect(parseEntraConsoleTab('review-queue')).toBe('review-queue');
    expect(parseEntraConsoleTab('nonsense')).toBe('overview');
    expect(parseEntraConsoleTab(null)).toBe('overview');
  });
});

describe('buildEntraAttentionItems', () => {
  const base = {
    status: status(),
    mappings: [mapping()],
    reviewQueueCount: 0,
    scheduleEnabled: true,
    runs: [run()],
  };

  it('says nothing when nothing is wrong', () => {
    expect(buildEntraAttentionItems(base)).toEqual([]);
  });

  it('leads with a broken connection and does not repeat it per client', () => {
    const items = buildEntraAttentionItems({
      ...base,
      status: status({ status: 'validation_failed' }),
      mappings: [
        mapping({ lastRunStatus: 'failed' }),
        mapping({ managedTenantId: 'managed-2', lastRunStatus: 'failed' }),
      ],
    });

    // Every client fails when the connection is down; listing each one buries
    // the one thing that has to be fixed.
    expect(items.map((item) => item.id)).toEqual(['connection']);
    expect(items[0].severity).toBe('blocking');
    expect(items[0].tab).toBe('connection');
  });

  it('groups failing clients into one item when the connection itself is fine', () => {
    const items = buildEntraAttentionItems({
      ...base,
      mappings: [
        mapping({ lastRunStatus: 'failed' }),
        mapping({ managedTenantId: 'managed-2', lastRunStatus: 'failed' }),
      ],
    });

    const failed = items.find((item) => item.id === 'failed-clients');
    expect(failed?.values?.count).toBe(2);
    expect(failed?.tab).toBe('clients');
    // The detail line names the clients, so the operator can tell one broken
    // client from five without opening the tab.
    expect(failed?.values?.clients).toBe('Contoso, Contoso');
    expect(failed?.actionKey).toBe('integrations.entra.console.attention.actions.viewClients');
  });

  it('names at most three failing clients and counts the rest', () => {
    const items = buildEntraAttentionItems({
      ...base,
      mappings: ['a', 'b', 'c', 'd', 'e'].map((suffix) =>
        mapping({
          managedTenantId: `managed-${suffix}`,
          clientName: `Client ${suffix.toUpperCase()}`,
          lastRunStatus: 'failed',
        })
      ),
    });

    expect(items.find((item) => item.id === 'failed-clients')?.values?.clients).toBe(
      'Client A, Client B, Client C +2'
    );
  });

  it('surfaces the review-queue backlog, unsynced clients, and a schedule that is off', () => {
    const items = buildEntraAttentionItems({
      ...base,
      reviewQueueCount: 3,
      scheduleEnabled: false,
      mappings: [mapping({ lastSyncedAt: null, lastRunStatus: null })],
    });

    expect(items.map((item) => item.id)).toEqual(['review-queue', 'never-synced', 'schedule-off']);
    expect(items.find((item) => item.id === 'review-queue')?.values).toEqual({ count: 3 });
    expect(items.find((item) => item.id === 'schedule-off')?.severity).toBe('info');
  });
});

describe('summarizeEntraRunResults', () => {
  it('adds the per-client results up into what the run did to the contact list', () => {
    const totals = summarizeEntraRunResults([
      { status: 'completed', linked: 153, created: 2, updated: 1, inactivated: 1, ambiguous: 0 },
      { status: 'completed', linked: 76, created: 0, updated: 0, inactivated: 0, ambiguous: 2 },
      { status: 'failed' },
    ]);

    expect(totals).toEqual({
      linked: 229,
      created: 2,
      updated: 1,
      inactivated: 1,
      ambiguous: 2,
      failed: 1,
    });
  });

  it('reports zeroes rather than NaN when a run recorded nothing', () => {
    expect(summarizeEntraRunResults([])).toEqual({
      linked: 0,
      created: 0,
      updated: 0,
      inactivated: 0,
      ambiguous: 0,
      failed: 0,
    });
  });
});

describe('findLastRealRun', () => {
  it('skips previews: a dry run changed nothing and is not the last sync', () => {
    const runs = [
      run({ runId: 'preview-1', isDryRun: true, runType: 'preflight' }),
      run({ runId: 'real-1' }),
    ];
    expect(findLastRealRun(runs)?.runId).toBe('real-1');
  });

  it('returns null when only previews exist', () => {
    expect(findLastRealRun([run({ isDryRun: true })])).toBeNull();
  });
});

describe('filterEntraRuns', () => {
  const runs = [
    run({ runId: 'scheduled-ok', runType: 'all-tenants' }),
    run({ runId: 'manual-failed', runType: 'single-tenant', status: 'failed' }),
    run({ runId: 'preview', runType: 'preflight', isDryRun: true }),
    run({ runId: 'partial', runType: 'single-tenant', status: 'partial' }),
  ];

  it('passes everything through by default', () => {
    expect(filterEntraRuns(runs, DEFAULT_ENTRA_HISTORY_FILTERS)).toHaveLength(4);
  });

  it('treats partial runs as failures worth seeing', () => {
    const filtered = filterEntraRuns(runs, { ...DEFAULT_ENTRA_HISTORY_FILTERS, onlyFailures: true });
    expect(filtered.map((entry) => entry.runId)).toEqual(['manual-failed', 'partial']);
  });

  it('separates scheduled runs from operator-triggered ones', () => {
    expect(
      filterEntraRuns(runs, { ...DEFAULT_ENTRA_HISTORY_FILTERS, trigger: 'scheduled' })
        .map((entry) => entry.runId)
    ).toEqual(['scheduled-ok']);

    expect(
      filterEntraRuns(runs, { ...DEFAULT_ENTRA_HISTORY_FILTERS, trigger: 'manual' })
        .map((entry) => entry.runId)
    ).toEqual(['manual-failed', 'preview', 'partial']);
  });

  it('can hide previews', () => {
    expect(
      filterEntraRuns(runs, { ...DEFAULT_ENTRA_HISTORY_FILTERS, includePreviews: false })
        .some((entry) => entry.isDryRun)
    ).toBe(false);
  });
});

describe('buildEntraRunHistoryCsv', () => {
  it('names the client instead of exporting a tenant GUID (F12)', () => {
    const csv = buildEntraRunHistoryCsv(
      [
        run({ runId: 'run-a', scopeManagedTenantId: 'managed-1', runType: 'single-tenant' }),
        run({ runId: 'run-b' }),
      ],
      new Map([['managed-1', 'Contoso']])
    );

    const [header, first, second] = csv.split('\n');
    expect(header).toContain('scope');
    expect(first).toContain('Contoso');
    expect(first).not.toContain('managed-1');
    expect(second).toContain('all clients');
  });

  it('marks previews as previews and escapes commas in client names', () => {
    const csv = buildEntraRunHistoryCsv(
      [run({ runId: 'run-c', isDryRun: true, scopeManagedTenantId: 'managed-1' })],
      new Map([['managed-1', 'Contoso, Inc.']])
    );

    expect(csv).toContain('preview');
    expect(csv).toContain('"Contoso, Inc."');
  });
});
