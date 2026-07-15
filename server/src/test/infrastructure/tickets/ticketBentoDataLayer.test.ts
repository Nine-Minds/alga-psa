import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IUserWithRoles } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';

import { TestContext } from '../../../../test-utils/testContext';
import { createClient, createTenant, createUser } from '../../../../test-utils/testDataFactory';
import { getTicketTimelineEntries } from '@alga-psa/tickets/actions/ticketActivityActions';
import {
  getTicketBillingRollup,
  getTicketInteractions,
  getTicketScheduleEntries,
} from '@alga-psa/tickets/actions/ticketBentoActions';

const dbRef = vi.hoisted(() => ({
  knex: null as any,
  tenant: null as string | null,
}));

const authRef = vi.hoisted(() => ({
  user: null as any,
  canReadTicket: true,
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => {
      if (!dbRef.knex || !dbRef.tenant) {
        throw new Error('Test tenant transaction not initialized');
      }
      return { knex: dbRef.knex, tenant: dbRef.tenant };
    }),
  };
});

vi.mock('@alga-psa/auth', () => ({
  getCurrentUser: vi.fn(async () => authRef.user),
  getSession: vi.fn(async () =>
    authRef.user
      ? { user: { id: authRef.user.user_id, tenant: authRef.user.tenant } }
      : null,
  ),
  hasPermission: vi.fn(async (_user: IUserWithRoles, resource?: string, action?: string) =>
    resource === 'ticket' && action === 'read' ? authRef.canReadTicket : false,
  ),
  withAuth: (action: (...args: any[]) => any) => async (...args: any[]) => {
    if (!authRef.user) {
      throw new Error('Authentication required');
    }
    return action(authRef.user, { tenant: authRef.user.tenant }, ...args);
  },
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async (_user: IUserWithRoles, resource?: string, action?: string) =>
    resource === 'ticket' && action === 'read' ? authRef.canReadTicket : false,
  ),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const globalForVitest = globalThis as { TextEncoder: typeof NodeTextEncoder };
globalForVitest.TextEncoder = NodeTextEncoder;

process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;
if (process.env.DB_HOST === 'pgbouncer') {
  process.env.DB_HOST = 'localhost';
}

const { describeWithDb } = await import('../../../../test-utils/requireDb');
const describeDb = await describeWithDb();

const HOOK_TIMEOUT = 120_000;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext,
} = TestContext.createHelpers();

interface TicketSeed {
  ticketId: string;
  clientId: string;
  userId: string;
  tenantId: string;
}

describeDb('Ticket bento data layer DB integration', () => {
  let context: TestContext;
  let boardId: string | null = null;
  let statusId: string | null = null;
  let interactionDisplayOrder = 0;

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'ticket_audit_logs',
        'rmm_alerts',
        'rmm_integrations',
        'schedule_entry_assignees',
        'schedule_entries',
        'interactions',
        'interaction_types',
        'time_entries',
        'comments',
        'comment_threads',
        'client_contracts',
        'contracts',
        'tickets',
      ],
      clientName: 'Ticket Bento Integration Client',
      userType: 'internal',
    });
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    context = await resetContext();
    dbRef.knex = context.db;
    dbRef.tenant = context.tenantId;
    boardId = null;
    statusId = null;
    interactionDisplayOrder = 0;
    setAuthUser();
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    authRef.user = null;
    dbRef.knex = null;
    dbRef.tenant = null;
    await rollbackContext();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await cleanupContext();
  }, HOOK_TIMEOUT);

  function setAuthUser(
    overrides: Partial<IUserWithRoles> = {},
    options: { canReadTicket?: boolean } = {},
  ) {
    authRef.user = {
      ...context.user,
      tenant: context.tenantId,
      user_id: context.userId,
      user_type: 'internal',
      roles: [],
      ...overrides,
    };
    authRef.canReadTicket = options.canReadTicket ?? true;
  }

  async function ensureBoard(): Promise<string> {
    if (boardId) return boardId;

    const existing = await context.db('boards')
      .where({ tenant: context.tenantId })
      .first('board_id');
    if (existing?.board_id) {
      boardId = existing.board_id;
      return boardId;
    }

    boardId = uuidv4();
    await context.db('boards').insert({
      tenant: context.tenantId,
      board_id: boardId,
      board_name: `Bento Board ${boardId.slice(0, 8)}`,
      is_default: true,
    });
    return boardId;
  }

  async function ensureTicketStatus(): Promise<string> {
    if (statusId) return statusId;

    const existing = await context.db('statuses')
      .where({ tenant: context.tenantId, status_type: 'ticket' })
      .first('status_id');
    if (existing?.status_id) {
      statusId = existing.status_id;
      return statusId;
    }

    const columns = await context.db('statuses').columnInfo();
    statusId = uuidv4();
    const row: Record<string, unknown> = {
      tenant: context.tenantId,
      status_id: statusId,
      status_type: 'ticket',
      is_closed: false,
      is_default: true,
      order_number: 1000,
      created_by: context.userId,
    };

    if (columns.name) row.name = `Bento Open ${statusId.slice(0, 8)}`;
    if (columns.status_name) row.status_name = `Bento Open ${statusId.slice(0, 8)}`;
    if (columns.board_id) row.board_id = await ensureBoard();
    if (columns.item_type) row.item_type = 'ticket';

    await context.db('statuses').insert(row);
    return statusId;
  }

  async function createTicket(overrides: Partial<TicketSeed & {
    ticketNumber: string;
    title: string;
    enteredAt: string;
  }> = {}): Promise<TicketSeed> {
    const tenantId = overrides.tenantId ?? context.tenantId;
    const clientId = overrides.clientId ?? context.clientId;
    const userId = overrides.userId ?? context.userId;
    const ticketId = overrides.ticketId ?? uuidv4();
    const enteredAt = overrides.enteredAt ?? '2026-07-01T09:00:00.000Z';

    await context.db('tickets').insert({
      tenant: tenantId,
      ticket_id: ticketId,
      ticket_number: overrides.ticketNumber ?? `BENTO-${ticketId.slice(0, 8)}`,
      title: overrides.title ?? `Bento ticket ${ticketId.slice(0, 8)}`,
      client_id: clientId,
      board_id: tenantId === context.tenantId ? await ensureBoard() : null,
      status_id: tenantId === context.tenantId ? await ensureTicketStatus() : null,
      entered_by: userId,
      entered_at: enteredAt,
      updated_at: enteredAt,
      is_closed: false,
    });

    return { ticketId, clientId, userId, tenantId };
  }

  async function createComment(
    ticket: TicketSeed,
    options: {
      note: string;
      createdAt: string;
      isInternal?: boolean;
      isResolution?: boolean;
      authorType?: 'internal' | 'client' | 'unknown';
    },
  ): Promise<string> {
    const commentId = uuidv4();
    const threadId = uuidv4();

    await context.db('comment_threads').insert({
      tenant: ticket.tenantId,
      thread_id: threadId,
      ticket_id: ticket.ticketId,
      root_comment_id: commentId,
      is_internal: options.isInternal ?? false,
      last_activity_at: options.createdAt,
      created_at: options.createdAt,
      created_by: options.authorType === 'client' ? null : ticket.userId,
    });

    await context.db('comments').insert({
      tenant: ticket.tenantId,
      comment_id: commentId,
      thread_id: threadId,
      ticket_id: ticket.ticketId,
      user_id: options.authorType === 'client' ? null : ticket.userId,
      author_type: options.authorType ?? 'internal',
      note: options.note,
      is_internal: options.isInternal ?? false,
      is_resolution: options.isResolution ?? false,
      is_initial_description: false,
      created_at: options.createdAt,
      updated_at: options.createdAt,
    });

    return commentId;
  }

  async function createAudit(
    ticket: TicketSeed,
    options: {
      eventType?: string;
      occurredAt: string;
      details?: Record<string, unknown>;
    },
  ): Promise<string> {
    const auditId = uuidv4();
    await context.db('ticket_audit_logs').insert({
      tenant: ticket.tenantId,
      audit_id: auditId,
      ticket_id: ticket.ticketId,
      event_type: options.eventType ?? 'TICKET_CREATED',
      entity_type: 'ticket',
      entity_id: ticket.ticketId,
      actor_type: 'user',
      actor_user_id: ticket.userId,
      actor_display_name: 'Bento Tester',
      source: 'ui',
      occurred_at: options.occurredAt,
      changes: {},
      details: options.details ?? {},
      created_at: options.occurredAt,
    });
    return auditId;
  }

  async function createTimeEntry(
    ticket: TicketSeed,
    options: {
      startTime: string;
      endTime: string;
      billableDuration: number;
      invoiced?: boolean;
      notes?: string;
    },
  ): Promise<string> {
    const entryId = uuidv4();
    await context.db('time_entries').insert({
      tenant: ticket.tenantId,
      entry_id: entryId,
      user_id: ticket.userId,
      start_time: options.startTime,
      end_time: options.endTime,
      work_timezone: 'UTC',
      work_date: options.startTime.slice(0, 10),
      work_item_id: ticket.ticketId,
      work_item_type: 'ticket',
      approval_status: 'APPROVED',
      billable_duration: options.billableDuration,
      invoiced: options.invoiced ?? false,
      notes: options.notes ?? null,
    });
    return entryId;
  }

  async function createRmmAlert(ticket: TicketSeed, triggeredAt: string): Promise<string> {
    const integrationId = uuidv4();
    const alertId = uuidv4();

    await context.db('rmm_integrations').insert({
      tenant: ticket.tenantId,
      integration_id: integrationId,
      provider: `bento-${integrationId.slice(0, 8)}`,
      instance_url: 'https://rmm.example.test',
      is_active: true,
      sync_status: 'completed',
      settings: {},
      created_at: triggeredAt,
      updated_at: triggeredAt,
    });

    await context.db('rmm_alerts').insert({
      tenant: ticket.tenantId,
      alert_id: alertId,
      integration_id: integrationId,
      external_alert_id: `alert-${alertId}`,
      external_device_id: `device-${alertId.slice(0, 8)}`,
      severity: 'critical',
      priority: 'high',
      status: 'active',
      source_type: 'condition',
      alert_class: 'disk',
      message: 'Disk space critical',
      device_name: 'db-node-01',
      ticket_id: ticket.ticketId,
      triggered_at: triggeredAt,
      resolved_at: null,
      occurrence_count: 2,
      metadata: {},
      created_at: triggeredAt,
      updated_at: triggeredAt,
    });

    return alertId;
  }

  async function createScheduleEntry(
    ticket: TicketSeed,
    options: { title: string; start: Date; end: Date; status?: string },
  ): Promise<string> {
    const entryId = uuidv4();
    await context.db('schedule_entries').insert({
      tenant: ticket.tenantId,
      entry_id: entryId,
      title: options.title,
      work_item_id: ticket.ticketId,
      work_item_type: 'ticket',
      user_id: ticket.userId,
      scheduled_start: options.start.toISOString(),
      scheduled_end: options.end.toISOString(),
      status: options.status ?? 'scheduled',
      is_private: false,
    });
    await context.db('schedule_entry_assignees').insert({
      tenant: ticket.tenantId,
      entry_id: entryId,
      user_id: ticket.userId,
    });
    return entryId;
  }

  async function createInteraction(
    ticket: TicketSeed,
    options: { title: string; interactionDate: string; duration: number },
  ): Promise<string> {
    const typeId = uuidv4();
    const interactionId = uuidv4();

    await context.db('interaction_types').insert({
      tenant: ticket.tenantId,
      type_id: typeId,
      type_name: 'Phone Call',
      icon: 'phone',
      display_order: ++interactionDisplayOrder,
      is_request: false,
    });

    await context.db('interactions').insert({
      tenant: ticket.tenantId,
      interaction_id: interactionId,
      type_id: typeId,
      user_id: ticket.userId,
      client_id: ticket.clientId,
      ticket_id: ticket.ticketId,
      title: options.title,
      notes: `${options.title} notes`,
      interaction_date: options.interactionDate,
      start_time: options.interactionDate,
      end_time: new Date(new Date(options.interactionDate).getTime() + options.duration * 60000).toISOString(),
      duration: options.duration,
      visibility: 'internal',
    });

    return interactionId;
  }

  async function createActiveContract(ticket: TicketSeed, contractName: string): Promise<string> {
    const contractId = uuidv4();
    const clientContractId = uuidv4();
    const now = '2026-07-01T00:00:00.000Z';

    await context.db('contracts').insert({
      tenant: ticket.tenantId,
      contract_id: contractId,
      contract_name: contractName,
      contract_description: `${contractName} description`,
      owner_client_id: ticket.clientId,
      billing_frequency: 'monthly',
      currency_code: 'USD',
      is_active: true,
      is_template: false,
      status: 'active',
      created_at: now,
      updated_at: now,
    });

    await context.db('client_contracts').insert({
      tenant: ticket.tenantId,
      client_contract_id: clientContractId,
      client_id: ticket.clientId,
      contract_id: contractId,
      start_date: '2026-01-01T00:00:00.000Z',
      end_date: null,
      is_active: true,
      status: 'pending',
      po_required: false,
      po_number: null,
      created_at: now,
      updated_at: now,
    });

    return contractId;
  }

  it('T001 interleaves comments, audit rows, time entries, and alerts chronologically', async () => {
    const ticket = await createTicket();
    await createAudit(ticket, { occurredAt: '2026-07-01T10:00:00.000Z' });
    await createComment(ticket, {
      note: 'Client replied with details',
      authorType: 'client',
      createdAt: '2026-07-01T10:05:00.000Z',
    });
    await createTimeEntry(ticket, {
      startTime: '2026-07-01T10:10:00.000Z',
      endTime: '2026-07-01T10:40:00.000Z',
      billableDuration: 30,
      notes: 'Investigated the issue',
    });
    await createRmmAlert(ticket, '2026-07-01T10:45:00.000Z');

    const entries = await getTicketTimelineEntries(ticket.ticketId, {
      includeTimeEntries: true,
      includeAlerts: true,
      order: 'asc',
    });

    expect(entries.map((entry) => entry.type)).toEqual([
      'activity',
      'comment',
      'time_entry',
      'alert',
    ]);
    const occurredAt = entries.map((entry) => entry.occurredAt);
    expect(occurredAt).toEqual([...occurredAt].sort());
    expect(new Set(occurredAt).size).toBe(occurredAt.length);
  });

  it('T002 preserves comment lane flags for internal, client, and resolution comments', async () => {
    const ticket = await createTicket();
    await createComment(ticket, {
      note: 'Internal diagnostic note',
      isInternal: true,
      authorType: 'internal',
      createdAt: '2026-07-01T11:00:00.000Z',
    });
    await createComment(ticket, {
      note: 'Client reply note',
      isInternal: false,
      authorType: 'client',
      createdAt: '2026-07-01T11:05:00.000Z',
    });
    await createComment(ticket, {
      note: 'Resolution note',
      isInternal: false,
      isResolution: true,
      authorType: 'internal',
      createdAt: '2026-07-01T11:10:00.000Z',
    });

    const comments = (await getTicketTimelineEntries(ticket.ticketId, { order: 'asc' }))
      .filter((entry) => entry.type === 'comment')
      .map((entry) => entry.comment as Record<string, unknown>);

    const byNote = new Map(comments.map((comment) => [comment.note, comment]));
    expect(byNote.get('Internal diagnostic note')).toMatchObject({
      is_internal: true,
      is_resolution: false,
      author_type: 'internal',
    });
    expect(byNote.get('Client reply note')).toMatchObject({
      is_internal: false,
      is_resolution: false,
      author_type: 'client',
    });
    expect(byNote.get('Resolution note')).toMatchObject({
      is_internal: false,
      is_resolution: true,
      author_type: 'internal',
    });
  });

  it('T003 rejects client users and users without ticket:read', async () => {
    const ticket = await createTicket();
    await createAudit(ticket, { occurredAt: '2026-07-01T12:00:00.000Z' });

    setAuthUser({ user_type: 'client' });
    await expect(getTicketTimelineEntries(ticket.ticketId)).rejects.toThrow(/internal-only/i);

    setAuthUser({ user_type: 'internal' }, { canReadTicket: false });
    await expect(getTicketTimelineEntries(ticket.ticketId)).rejects.toThrow(/cannot read ticket/i);
  });

  it('T004 scopes timeline reads to the authenticated tenant', async () => {
    const sharedTicketId = uuidv4();
    const ticket = await createTicket({ ticketId: sharedTicketId });
    await createAudit(ticket, {
      occurredAt: '2026-07-01T13:00:00.000Z',
      details: { marker: 'first-tenant' },
    });

    const otherTenantId = await createTenant(context.db, 'Ticket Bento Foreign Tenant');
    const otherClientId = await createClient(context.db, otherTenantId, 'Foreign Client');
    const otherUserId = await createUser(context.db, otherTenantId, {
      username: `foreign-${sharedTicketId}`,
      email: `foreign-${sharedTicketId}@example.com`,
      user_type: 'internal',
    });
    const otherTicket = await createTicket({
      tenantId: otherTenantId,
      clientId: otherClientId,
      userId: otherUserId,
      ticketId: sharedTicketId,
      ticketNumber: `FOREIGN-${sharedTicketId.slice(0, 8)}`,
      title: 'Foreign tenant ticket',
    });
    await createAudit(otherTicket, {
      occurredAt: '2026-07-01T13:05:00.000Z',
      details: { marker: 'foreign-tenant' },
    });
    await createComment(otherTicket, {
      note: 'Foreign tenant comment',
      authorType: 'internal',
      createdAt: '2026-07-01T13:10:00.000Z',
    });

    const entries = await getTicketTimelineEntries(sharedTicketId, { order: 'asc' });

    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('activity');
    expect(entries[0].activity?.tenant).toBe(context.tenantId);
    expect(JSON.stringify(entries)).toContain('first-tenant');
    expect(JSON.stringify(entries)).not.toContain('foreign-tenant');
    expect(JSON.stringify(entries)).not.toContain('Foreign tenant comment');
  });

  it('T005 returns ticket schedule entries upcoming-first with assignee names', async () => {
    const ticket = await createTicket();
    const now = Date.now();
    const upcomingId = await createScheduleEntry(ticket, {
      title: 'Upcoming onsite visit',
      start: new Date(now + 60 * 60 * 1000),
      end: new Date(now + 2 * 60 * 60 * 1000),
    });
    const pastId = await createScheduleEntry(ticket, {
      title: 'Past triage call',
      start: new Date(now - 3 * 60 * 60 * 1000),
      end: new Date(now - 2 * 60 * 60 * 1000),
      status: 'completed',
    });

    const entries = await getTicketScheduleEntries(ticket.ticketId);

    expect(entries.map((entry) => entry.entryId)).toEqual([upcomingId, pastId]);
    expect(entries[0]).toMatchObject({
      title: 'Upcoming onsite visit',
      isUpcoming: true,
    });
    expect(entries[0].assignedUserNames).toContain(`${context.user.first_name} ${context.user.last_name}`);
    expect(entries[1]).toMatchObject({
      title: 'Past triage call',
      isUpcoming: false,
    });
  });

  it('T006 returns ticket interactions most-recent-first with type and duration', async () => {
    const ticket = await createTicket();
    const olderId = await createInteraction(ticket, {
      title: 'Older call',
      interactionDate: '2026-07-01T14:00:00.000Z',
      duration: 15,
    });
    const newerId = await createInteraction(ticket, {
      title: 'Newer call',
      interactionDate: '2026-07-01T15:00:00.000Z',
      duration: 25,
    });

    const interactions = await getTicketInteractions(ticket.ticketId);

    expect(interactions.map((interaction) => interaction.interactionId)).toEqual([newerId, olderId]);
    expect(interactions[0]).toMatchObject({
      title: 'Newer call',
      typeName: 'Phone Call',
      durationMinutes: 25,
      actorDisplayName: `${context.user.first_name} ${context.user.last_name}`,
    });
    expect(interactions[1]).toMatchObject({
      title: 'Older call',
      durationMinutes: 15,
    });
  });

  it('T007 sums billing minutes, respects invoiced state, and resolves active contract name', async () => {
    const ticket = await createTicket();
    await createTimeEntry(ticket, {
      startTime: '2026-07-01T16:00:00.000Z',
      endTime: '2026-07-01T16:45:00.000Z',
      billableDuration: 45,
      invoiced: true,
    });
    await createTimeEntry(ticket, {
      startTime: '2026-07-01T17:00:00.000Z',
      endTime: '2026-07-01T17:30:00.000Z',
      billableDuration: 30,
      invoiced: false,
    });
    await createTimeEntry(ticket, {
      startTime: '2026-07-01T18:00:00.000Z',
      endTime: '2026-07-01T18:20:00.000Z',
      billableDuration: 0,
      invoiced: false,
    });
    await createActiveContract(ticket, 'Bento Managed Services');

    const rollup = await getTicketBillingRollup(ticket.ticketId);

    expect(rollup).toEqual({
      totalMinutes: 95,
      billableMinutes: 75,
      entryCount: 3,
      uninvoicedBillableMinutes: 30,
      contractName: 'Bento Managed Services',
    });
  });

  it('T008 returns an explicit zeroed billing rollup with no time or active contract', async () => {
    const ticket = await createTicket();

    const rollup = await getTicketBillingRollup(ticket.ticketId);

    expect(rollup).toEqual({
      totalMinutes: 0,
      billableMinutes: 0,
      entryCount: 0,
      uninvoicedBillableMinutes: 0,
      contractName: null,
    });
  });

  it('T009 returns only the creation event for a new ticket timeline', async () => {
    const ticket = await createTicket();
    const auditId = await createAudit(ticket, {
      eventType: 'TICKET_CREATED',
      occurredAt: '2026-07-01T19:00:00.000Z',
    });

    const entries = await getTicketTimelineEntries(ticket.ticketId, { order: 'asc' });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'activity',
      sortId: auditId,
    });
    expect(entries[0].activity?.event_type).toBe('TICKET_CREATED');
  });
});
