import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  HuntressEscalation,
  HuntressIncidentReport,
} from '@ee/interfaces/huntress.interfaces';

// vi.mock factories run during module import — hoist everything they read.
const { state, processIncidentMock, processEscalationMock, createKnexMock } = vi.hoisted(() => {
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

  return { state, processIncidentMock: vi.fn(), processEscalationMock: vi.fn(), createKnexMock };
});

vi.mock('@/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: createKnexMock(), tenant: 'tenant-1' })),
}));

vi.mock('@ee/lib/integrations/huntress/incidents/incidentProcessor', () => ({
  processIncident: processIncidentMock,
}));

vi.mock('@ee/lib/integrations/huntress/escalations/escalationProcessor', () => ({
  processEscalation: processEscalationMock,
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

function escalation(id: number, updatedAt: string): HuntressEscalation {
  return {
    id,
    organizations: [{ id: 1, name: 'Acme' }],
    severity: 'high',
    status: 'open',
    subject: `e${id}`,
    type: null,
    type_code: null,
    subtype: null,
    created_at: updatedAt,
    resolved_at: null,
    updated_at: updatedAt,
  };
}

function clientReturning(
  incidents: HuntressIncidentReport[],
  escalations: HuntressEscalation[] = []
) {
  return {
    listEscalationsPage: vi.fn(async () => ({
      escalations: [...escalations].sort(
        (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)
      ),
      pagination: {},
    })),
    getEscalation: vi.fn(),
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

  it('does not touch escalations when ingestion is off (the default)', async () => {
    state.client = clientReturning([], [escalation(1, '2026-06-09T09:00:00Z')]);
    const result = await pollHuntressIncidents({ tenantId: 'tenant-1', integrationId: 'int-1' });

    expect(result.success).toBe(true);
    expect(result.escalations).toBeUndefined();
    expect((state.client as any).listEscalationsPage).not.toHaveBeenCalled();
    expect(processEscalationMock).not.toHaveBeenCalled();
  });

  it('processes escalations ascending and advances their own cursor when enabled', async () => {
    state.integrationRow = {
      ...state.integrationRow!,
      settings: { ...completeSettings, ingestEscalations: true, escalationCursor: '2026-06-09T08:00:00Z' },
    };
    state.client = clientReturning(
      [incident(1, '2026-06-09T09:30:00Z')],
      [escalation(7, '2026-06-09T09:00:00Z'), escalation(8, '2026-06-09T10:00:00Z')]
    );
    processIncidentMock.mockResolvedValue({ ok: true, action: 'create_ticket' });
    processEscalationMock.mockResolvedValue({ ok: true, targets: [] });

    const result = await pollHuntressIncidents({ tenantId: 'tenant-1', integrationId: 'int-1' });

    expect(result.success).toBe(true);
    expect(result.escalations).toMatchObject({ processed: 2, failed: 0 });
    expect(processEscalationMock.mock.calls.map((c) => c[3].id)).toEqual([7, 8]);
    const saved = JSON.parse(String(state.updates[state.updates.length - 1].settings));
    expect(saved.incidentCursor).toBe('2026-06-09T09:30:00Z');
    expect(saved.escalationCursor).toBe('2026-06-09T10:00:00Z');
    expect(saved.ingestEscalations).toBe(true);
  });

  it('an escalation failure does not hold back the incident cursor', async () => {
    state.integrationRow = {
      ...state.integrationRow!,
      settings: { ...completeSettings, ingestEscalations: true, escalationCursor: '2026-06-09T08:00:00Z' },
    };
    state.client = clientReturning(
      [incident(1, '2026-06-09T09:30:00Z')],
      [escalation(7, '2026-06-09T09:00:00Z'), escalation(8, '2026-06-09T10:00:00Z')]
    );
    processIncidentMock.mockResolvedValue({ ok: true, action: 'create_ticket' });
    processEscalationMock
      .mockResolvedValueOnce({ ok: true, targets: [] })
      .mockResolvedValueOnce({ ok: false, targets: [], error: 'kaboom' });

    const result = await pollHuntressIncidents({ tenantId: 'tenant-1', integrationId: 'int-1' });

    expect(result.success).toBe(false);
    expect(result.processed).toBe(1);
    const finalUpdate = state.updates[state.updates.length - 1];
    expect(finalUpdate.sync_status).toBe('error');
    expect(finalUpdate.sync_error).toBe('Escalations: kaboom');
    const saved = JSON.parse(String(finalUpdate.settings));
    expect(saved.incidentCursor).toBe('2026-06-09T09:30:00Z');
    expect(saved.escalationCursor).toBe('2026-06-09T09:00:00Z');
  });

  it('an escalation list failure still lets incidents complete', async () => {
    state.integrationRow = {
      ...state.integrationRow!,
      settings: { ...completeSettings, ingestEscalations: true },
    };
    const client = clientReturning([incident(1, '2026-06-09T09:30:00Z')]);
    client.listEscalationsPage.mockRejectedValueOnce(new Error('403'));
    state.client = client;
    processIncidentMock.mockResolvedValue({ ok: true, action: 'create_ticket' });

    const result = await pollHuntressIncidents({ tenantId: 'tenant-1', integrationId: 'int-1' });

    expect(result.processed).toBe(1);
    expect(result.escalations?.error).toBe('403');
    const saved = JSON.parse(String(state.updates[state.updates.length - 1].settings));
    expect(saved.incidentCursor).toBe('2026-06-09T09:30:00Z');
  });

  it('does not bump the last-poll time when the incident list call fails', async () => {
    const client = clientReturning([]);
    client.listIncidentReportsPage.mockRejectedValueOnce(new Error('500'));
    state.client = client;

    const result = await pollHuntressIncidents({ tenantId: 'tenant-1', integrationId: 'int-1' });

    expect(result.success).toBe(false);
    const finalUpdate = state.updates[state.updates.length - 1];
    expect(finalUpdate.sync_status).toBe('error');
    expect(finalUpdate.sync_error).toBe('500');
    expect(finalUpdate).not.toHaveProperty('last_incremental_sync_at');
    expect(JSON.parse(String(finalUpdate.settings)).incidentCursor).toBe('2026-06-09T08:00:00Z');
  });
});
