import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Automation alert ids are deterministic (`automation:<device>:<name>`), so a
 * re-firing after the ticket closed hits the same rmm_alerts row. When no reset
 * ever lands (resetAlertOnTicketClose=false, no adapter, lost TICKET_CLOSED) the
 * row stays `active`; processTriggered must look at the linked ticket instead of
 * treating the row as a redelivery forever.
 */
const h = vi.hoisted(() => ({
  state: {
    existing: undefined as Record<string, unknown> | undefined,
    /** Result of the tickets⋈statuses lookup: undefined = ticket row gone. */
    linkedTicket: undefined as { is_closed: boolean } | undefined,
    updates: [] as Array<{ table: string; patch: Record<string, unknown> }>,
  },
}));

const EXTERNAL_ID = 'automation:device-1:disk full';
const RULE = {
  rule_id: 'rule-1',
  name: 'catch-all',
  conditions: {},
  actions: { createTicket: true, resetAlertOnTicketClose: false },
};

vi.mock('@alga-psa/db', () => ({
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({}),
  registerAfterCommit: () => undefined,
  tenantDb: () => ({
    tenantJoin: () => undefined,
    table: (name: string) => {
      const qb: any = {
        where: () => qb,
        andWhere: () => qb,
        andWhereNot: () => qb,
        whereNotNull: () => qb,
        orderBy: () => qb,
        select: () => qb,
        update: async (patch: Record<string, unknown>) => {
          h.state.updates.push({ table: name, patch });
          return 1;
        },
        insert: () => ({ returning: async () => [{ alert_id: 'alert-new' }] }),
        then: (resolve: (v: unknown) => unknown) =>
          resolve(name === 'rmm_alert_rules' ? [RULE] : []),
        first: async () => {
          switch (name) {
            case 'tenant_external_entity_mappings':
              return { alga_entity_id: 'asset-1' };
            case 'assets':
              return { asset_id: 'asset-1', client_id: 'client-1' };
            case 'rmm_alerts':
              return h.state.existing;
            case 'tickets as t':
              return h.state.linkedTicket;
            default:
              return undefined;
          }
        },
      };
      return qb;
    },
  }),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn() }));
vi.mock('../ticketCreator', () => ({
  addAlertInternalNote: async () => undefined,
  createTicketForAlert: async () => ({ ticket_id: 'ticket-new' }),
  providerLabel: (p: string) => p,
}));
vi.mock('../ticketCreatedEvent', () => ({ publishRmmTicketCreated: async () => undefined }));

import { processRmmAlertEvent } from '../processRmmAlertEvent';

const event = {
  kind: 'triggered',
  tenantId: 'tenant-1',
  integrationId: 'int-1',
  provider: 'levelio',
  externalAlertId: EXTERNAL_ID,
  externalDeviceId: 'device-1',
  severity: 'critical',
  occurredAt: '2026-10-16T00:00:00.000Z',
} as any;

function existingRow(overrides: Record<string, unknown> = {}) {
  return { alert_id: 'alert-1', status: 'active', ticket_id: 'ticket-old', device_name: 'SRV-01', ...overrides };
}

describe('processTriggered with an existing live-status row', () => {
  beforeEach(() => {
    h.state.existing = existingRow();
    h.state.linkedTicket = { is_closed: false };
    h.state.updates = [];
  });

  it('stays skipped for a redelivery whose ticket is still open', async () => {
    const result = await processRmmAlertEvent({ knex: {} as any }, event);
    expect(result).toMatchObject({ outcome: 'skipped', alertId: 'alert-1', ticketId: 'ticket-old' });
    expect(h.state.updates.some((u) => 'ticket_id' in u.patch)).toBe(false);
  });

  it('creates a new ticket when the linked ticket is closed, even with resetAlertOnTicketClose=false', async () => {
    h.state.linkedTicket = { is_closed: true };
    const result = await processRmmAlertEvent({ knex: {} as any }, event);
    expect(result).toMatchObject({ outcome: 'ticket_created', alertId: 'alert-1', ticketId: 'ticket-new' });
    expect(
      h.state.updates.some(
        (u) => u.table === 'rmm_alerts' && u.patch.ticket_id === null && u.patch.resolved_at === null && u.patch.status === 'active'
      )
    ).toBe(true);
    expect(h.state.updates.some((u) => u.table === 'rmm_alerts' && u.patch.ticket_id === 'ticket-new')).toBe(true);
  });

  it('treats a deleted linked ticket (no FK) like a closed one', async () => {
    h.state.linkedTicket = undefined;
    const result = await processRmmAlertEvent({ knex: {} as any }, event);
    expect(result).toMatchObject({ outcome: 'ticket_created', ticketId: 'ticket-new' });
  });

  it('keeps skipping rows with no ticket (e.g. recorded-only or suppressed)', async () => {
    h.state.existing = existingRow({ ticket_id: null, status: 'suppressed' });
    h.state.linkedTicket = undefined;
    const result = await processRmmAlertEvent({ knex: {} as any }, event);
    expect(result.outcome).toBe('skipped');
  });
});
