import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HuntressIncidentReport } from '@ee/interfaces/huntress.interfaces';

// vi.mock factories run during module import — hoist everything they read.
const { state, processIncidentMock, createKnexMock } = vi.hoisted(() => {
  const state: {
    integrationRow: Record<string, unknown> | undefined;
    updates: Array<Record<string, unknown>>;
    client: unknown;
  } = { integrationRow: undefined, updates: [], client: undefined };

  function createKnexMock() {
    const builder: any = {
      where: vi.fn(() => builder),
      first: vi.fn(async () => (state.integrationRow ? { ...state.integrationRow } : undefined)),
      update: vi.fn(async (vals: Record<string, unknown>) => {
        state.updates.push(vals);
        return 1;
      }),
    };
    const knex: any = vi.fn(() => builder);
    knex.fn = { now: () => new Date().toISOString() };
    return knex;
  }

  return { state, processIncidentMock: vi.fn(), createKnexMock };
});

vi.mock('@/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: createKnexMock(), tenant: 'tenant-1' })),
}));

vi.mock('@ee/lib/integrations/huntress/incidents/incidentProcessor', () => ({
  processIncident: processIncidentMock,
}));

vi.mock('@ee/lib/integrations/huntress/huntressClient', () => ({
  createHuntressClient: vi.fn(async () => state.client),
}));

import { pollHuntressIncidents } from '@ee/lib/integrations/huntress/incidents/incidentPoller';

function incident(id: number, updatedAt: string): HuntressIncidentReport {
  return {
    id,
    account_id: 1,
    agent_id: null,
    organization_id: 1,
    subject: `i${id}`,
    summary: null,
    body: null,
    severity: 'low',
    status: 'sent',
    platform: null,
    indicator_types: [],
    indicator_counts: {},
    sent_at: updatedAt,
    closed_at: null,
    status_updated_at: null,
    updated_at: updatedAt,
  };
}

const completeSettings = {
  boardId: 'b1',
  fallbackClientId: 'c1',
  fallbackBoardId: 'b2',
  severityPriorityMap: { critical: 'p1', high: 'p2', low: 'p3' },
  incidentCursor: '2026-06-09T08:00:00Z',
  backfillDays: 7,
  pollIntervalMinutes: 5,
};

function clientReturning(incidents: HuntressIncidentReport[]) {
  return {
    listIncidentReportsPage: vi.fn(async () => ({
      // API returns newest first.
      incident_reports: [...incidents].sort(
        (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)
      ),
      pagination: {},
    })),
    getAgent: vi.fn(),
    getOrganization: vi.fn(),
  };
}

describe('pollHuntressIncidents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.updates = [];
    state.integrationRow = {
      tenant: 'tenant-1',
      integration_id: 'int-1',
      provider: 'huntress',
      is_active: true,
      settings: completeSettings,
    };
    state.client = clientReturning([]);
  });

  it('skips without polling when routing config is incomplete', async () => {
    state.integrationRow = {
      ...state.integrationRow!,
      settings: { ...completeSettings, boardId: undefined },
    };
    const result = await pollHuntressIncidents({ tenantId: 'tenant-1', integrationId: 'int-1' });
    expect(result.skipped).toBe('routing_config_incomplete');
    expect(processIncidentMock).not.toHaveBeenCalled();
  });

  it('marks the integration errored when credentials are missing', async () => {
    state.client = null;
    const result = await pollHuntressIncidents({ tenantId: 'tenant-1', integrationId: 'int-1' });
    expect(result.success).toBe(false);
    expect(state.updates.some((u) => u.sync_status === 'error')).toBe(true);
  });

  it('processes incidents in ascending order and advances the cursor past all of them', async () => {
    state.client = clientReturning([
      incident(1, '2026-06-09T09:00:00Z'),
      incident(2, '2026-06-09T10:00:00Z'),
    ]);
    processIncidentMock.mockResolvedValue({ ok: true, action: 'create_ticket' });

    const result = await pollHuntressIncidents({ tenantId: 'tenant-1', integrationId: 'int-1' });

    expect(result.success).toBe(true);
    expect(result.processed).toBe(2);
    expect(processIncidentMock.mock.calls.map((c) => c[3].id)).toEqual([1, 2]);

    const finalUpdate = state.updates[state.updates.length - 1];
    expect(finalUpdate.sync_status).toBe('completed');
    expect(JSON.parse(String(finalUpdate.settings)).incidentCursor).toBe('2026-06-09T10:00:00Z');
  });

  it('stops at the first failure so the failed incident is retried next cycle', async () => {
    state.client = clientReturning([
      incident(1, '2026-06-09T09:00:00Z'),
      incident(2, '2026-06-09T10:00:00Z'),
      incident(3, '2026-06-09T11:00:00Z'),
    ]);
    processIncidentMock
      .mockResolvedValueOnce({ ok: true, action: 'create_ticket' })
      .mockResolvedValueOnce({ ok: false, action: 'error', error: 'boom' })
      .mockResolvedValue({ ok: true, action: 'create_ticket' });

    const result = await pollHuntressIncidents({ tenantId: 'tenant-1', integrationId: 'int-1' });

    expect(result.success).toBe(false);
    expect(result.processed).toBe(1);
    expect(processIncidentMock).toHaveBeenCalledTimes(2); // third never attempted

    const finalUpdate = state.updates[state.updates.length - 1];
    expect(finalUpdate.sync_status).toBe('error');
    expect(finalUpdate.sync_error).toBe('boom');
    // Cursor stops at the last successful incident.
    expect(JSON.parse(String(finalUpdate.settings)).incidentCursor).toBe('2026-06-09T09:00:00Z');
  });
});
