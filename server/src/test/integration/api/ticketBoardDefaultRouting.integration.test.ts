import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { TicketService } from '@/lib/api/services/TicketService';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../../test-utils/testDataFactory';
import { createTicketFromEmail } from '@alga-psa/shared/workflow/actions/emailWorkflowActions';

const HOOK_TIMEOUT = 300_000;

describe('REST ticket creation applies board-default routing', () => {
  let db: Knex;
  let tenant: string;
  let clientId: string;
  let actorId: string;
  let defaultUserId: string;
  let otherUserId: string;
  let inactiveUserId: string;
  let boardId: string;
  let statusId: string;
  let priorityId: string;
  let defaultTeamId: string;
  let explicitTeamId: string;
  let defaultTeamMemberId: string;
  let service: TicketService;

  const table = (name: string) => tenantDb(db, tenant).table(name);

  beforeAll(async () => {
    db = await createTestDbConnection();
    tenant = await createTenant(db, `Ticket routing ${uuidv4().slice(0, 8)}`);
    clientId = await createClient(db, tenant, 'Routing client');
    actorId = await createUser(db, tenant);
    defaultUserId = await createUser(db, tenant);
    otherUserId = await createUser(db, tenant);
    inactiveUserId = await createUser(db, tenant, { is_inactive: true });
    boardId = uuidv4();
    statusId = uuidv4();
    priorityId = uuidv4();
    defaultTeamId = uuidv4();
    explicitTeamId = uuidv4();
    defaultTeamMemberId = await createUser(db, tenant);

    await table('teams').insert([
      { tenant, team_id: defaultTeamId, team_name: 'Default routing team', manager_id: otherUserId },
      { tenant, team_id: explicitTeamId, team_name: 'Explicit routing team', manager_id: actorId },
    ]);
    await table('boards').insert({
      tenant, board_id: boardId, board_name: 'Routing board', is_default: false,
      default_assigned_to: defaultUserId, default_assigned_team_id: defaultTeamId,
    });
    await table('statuses').insert({
      tenant, status_id: statusId, board_id: boardId, name: 'New', status_type: 'ticket',
      item_type: 'ticket', is_closed: false, is_default: true, order_number: 1, created_by: actorId,
    });
    await table('priorities').insert({
      tenant, priority_id: priorityId, priority_name: 'Medium', item_type: 'ticket', order_number: 1,
      color: '#777777', created_by: actorId,
    });
    await table('team_members').insert([
      { tenant, team_id: defaultTeamId, user_id: otherUserId },
      { tenant, team_id: defaultTeamId, user_id: defaultTeamMemberId },
    ]);

    service = new TicketService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant });
    vi.spyOn(service as any, 'safePublishEvent').mockResolvedValue(undefined);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (db) await db.destroy();
  });

  async function createTicket(overrides: Record<string, unknown> = {}) {
    return service.create({
      title: `Routing test ${uuidv4().slice(0, 8)}`,
      client_id: clientId,
      board_id: boardId,
      status_id: statusId,
      priority_id: priorityId,
      ...overrides,
    } as any, { tenant, userId: actorId } as any);
  }

  it('applies both defaults and team-member resources to REST-created tickets', async () => {
    const created = await createTicket();

    expect(created.assigned_to).toBe(defaultUserId);
    expect(created.assigned_team_id).toBe(defaultTeamId);
    const members = await table('ticket_resources')
      .where({ ticket_id: created.ticket_id, role: 'team_member' })
      .pluck('additional_user_id');
    expect(members).toContain(defaultTeamMemberId);
  });

  it('preserves explicit user and team values', async () => {
    const created = await createTicket({ assigned_to: actorId, assigned_team_id: explicitTeamId });
    expect(created.assigned_to).toBe(actorId);
    expect(created.assigned_team_id).toBe(explicitTeamId);
  });

  it('does not apply a default team when the caller explicitly names a user', async () => {
    const created = await createTicket({ assigned_to: actorId });
    expect(created.assigned_to).toBe(actorId);
    expect(created.assigned_team_id).toBeNull();
  });

  it('preserves explicit nulls and does not let the team lead replace them', async () => {
    const created = await createTicket({ assigned_to: null, assigned_team_id: null });
    expect(created.assigned_to).toBeNull();
    expect(created.assigned_team_id).toBeNull();
  });

  it('applies an omitted user default when team is explicitly null', async () => {
    const created = await createTicket({ assigned_team_id: null });
    expect(created.assigned_to).toBe(defaultUserId);
    expect(created.assigned_team_id).toBeNull();
  });

  it('keeps explicit null user unassigned when the team field is omitted', async () => {
    const created = await createTicket({ assigned_to: null });
    expect(created.assigned_to).toBeNull();
    expect(created.assigned_team_id).toBeNull();
  });

  it('soft-fails an inactive default user and continues creating the ticket', async () => {
    await table('boards').where({ board_id: boardId }).update({
      default_assigned_to: inactiveUserId,
      default_assigned_team_id: null,
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const created = await createTicket();
      expect(created.assigned_to).toBeNull();
      expect(created.assigned_team_id).toBeNull();
      expect(warning).toHaveBeenCalledWith(
        'Ignoring stale board default assignee during ticket creation', expect.any(Object),
      );
    } finally {
      warning.mockRestore();
      await table('boards').where({ board_id: boardId }).update({
        default_assigned_to: defaultUserId,
        default_assigned_team_id: defaultTeamId,
      });
    }
  });

  it('soft-fails a default team with no lead and continues creating the ticket', async () => {
    const leadlessTeamId = uuidv4();
    await table('teams').insert({ tenant, team_id: leadlessTeamId, team_name: 'Leadless routing team', manager_id: null });
    await table('boards').where({ board_id: boardId }).update({ default_assigned_team_id: leadlessTeamId });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const created = await createTicket();
      expect(created.ticket_id).toBeTruthy();
      expect(created.assigned_team_id).toBeNull();
      expect(warning).toHaveBeenCalledWith(
        'Ignoring stale board default team during ticket creation', expect.objectContaining({
          teamId: leadlessTeamId, reason: 'team_lead_missing',
        }),
      );
    } finally {
      warning.mockRestore();
      await table('boards').where({ board_id: boardId }).update({ default_assigned_team_id: defaultTeamId });
      await table('teams').where({ team_id: leadlessTeamId }).delete();
    }
  });

  it.each(['board-user', 'team-lead', 'explicit-user', 'explicit-null'] as const)(
    'publishes email assignment once from persisted routing: %s', async (routing) => {
      const expectedAssignee = routing === 'explicit-null' ? null
        : routing === 'explicit-user' ? actorId
        : routing === 'team-lead' ? otherUserId : defaultUserId;
      let emailTrx: Knex.Transaction;
      let observedCreatedEventRouting: { assigned_to: string | null; assigned_team_id: string | null } | undefined;
      const publisher = {
        publishTicketCreated: vi.fn(async ({ ticketId }: { ticketId: string }) => {
          const row = await tenantDb(emailTrx, tenant).table('tickets').where({ ticket_id: ticketId }).first();
          observedCreatedEventRouting = { assigned_to: row.assigned_to, assigned_team_id: row.assigned_team_id };
        }),
        publishTicketAssigned: vi.fn(async () => undefined),
      };
      const emailTicket = await db.transaction(async (trx) => {
        emailTrx = trx;
        if (routing === 'team-lead') {
          await tenantDb(trx, tenant).table('boards').where({ board_id: boardId })
            .update({ default_assigned_to: null });
        }
        return createTicketFromEmail({
          ...(routing === 'explicit-null' ? { assigned_to: null }
            : routing === 'explicit-user' ? { assigned_to: actorId } : {}),
          title: `Email routing ${uuidv4().slice(0, 8)}`,
          description: 'Inbound email body',
          client_id: clientId,
          source: 'email',
          board_id: boardId,
          status_id: statusId,
          priority_id: priorityId,
          email_metadata: { messageId: `routing-${uuidv4()}@example.test` },
        }, tenant, actorId, {
          existingConnection: trx,
          eventPublisher: publisher as any,
          analyticsTracker: { trackTicketCreated: vi.fn(), trackFeatureUsage: vi.fn() } as any,
        }).finally(async () => {
          if (routing === 'team-lead') {
            await tenantDb(trx, tenant).table('boards').where({ board_id: boardId })
              .update({ default_assigned_to: defaultUserId });
          }
        });
      });

      const created = await table('tickets').where({ ticket_id: emailTicket.ticket_id }).first();
      const expectedTeam = routing === 'explicit-user' || routing === 'explicit-null' ? null : defaultTeamId;
      expect(created.assigned_to).toBe(expectedAssignee);
      expect(created.assigned_team_id).toBe(expectedTeam);
      expect(publisher.publishTicketAssigned).toHaveBeenCalledTimes(expectedAssignee ? 1 : 0);
      if (expectedAssignee) {
        expect(publisher.publishTicketAssigned).toHaveBeenCalledWith(expect.objectContaining({
          ticketId: emailTicket.ticket_id, userId: expectedAssignee, tenantId: tenant,
        }));
      }
      expect(publisher.publishTicketCreated).toHaveBeenCalledTimes(1);
      expect(observedCreatedEventRouting).toEqual({ assigned_to: expectedAssignee, assigned_team_id: expectedTeam });
    },
  );
});
