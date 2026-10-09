import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection, createTenant, createUser } from './_dbTestUtils';

function tenantTable(db: Knex, tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

const runtimeState = vi.hoisted(() => ({
  db: null as Knex | null,
  tenantId: '',
  actorUserId: '',
  deniedPermissions: new Set<string>(),
  maxRecipients: undefined as number | undefined,
  sent: [] as Array<Record<string, any>>,
  templated: 0,
}));

vi.mock('../businessOperations/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../businessOperations/shared')>();
  return {
    ...actual,
    withTenantTransaction: async (_ctx: any, fn: any) => {
      if (!runtimeState.db) throw new Error('DB unavailable for test runtime state');
      return runtimeState.db.transaction(async (trx) => {
        await trx.raw(`select set_config('app.current_tenant', ?, true)`, [runtimeState.tenantId]);
        return fn({ tenantId: runtimeState.tenantId, actorUserId: runtimeState.actorUserId, trx });
      });
    },
    requirePermission: async (ctx: any, _tx: any, permission: { resource: string; action: string }) => {
      const key = `${permission.resource}:${permission.action}`;
      if (!runtimeState.deniedPermissions.has(key)) return;
      throw {
        category: 'ActionError',
        code: 'PERMISSION_DENIED',
        message: `Missing permission ${key}`,
        details: permission,
        nodePath: ctx?.stepPath ?? 'steps.email-action',
        at: new Date().toISOString(),
      };
    },
  };
});

vi.mock('../../registries/workflowEmailRegistry', () => ({
  getWorkflowEmailProvider: () => ({
    TenantEmailService: {
      getInstance: () => ({
        sendEmail: async (params: Record<string, any>) => {
          runtimeState.sent.push(params);
          return { success: true, messageId: 'msg-1', providerId: 'p1', providerType: 'stub', sentAt: new Date() };
        },
      }),
      getTenantEmailSettings: async () => ({ providerConfigs: [{ providerId: 'p1' }], outboundSenders: [] }),
      resolveOutboundSenderForTenant: async () => ({ from: { email: 'noreply@example.com' } }),
    },
    StaticTemplateProcessor: class {
      constructor(private subject: string, private html: string, private text?: string) {}
      async process() {
        runtimeState.templated += 1;
        return { subject: this.subject, html: this.html, text: this.text };
      }
    },
    EmailProviderManager: class {
      async initialize() {}
      async getAvailableProviders() {
        return [{ capabilities: { supportsAttachments: true, maxRecipientsPerMessage: runtimeState.maxRecipients } }];
      }
      async sendEmail() {
        return { success: true };
      }
    },
  }),
}));

import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerEmailActions } from '../businessOperations/email';

function actionCtx() {
  return {
    runId: uuidv4(),
    stepPath: 'steps.email-action',
    idempotencyKey: uuidv4(),
    attempt: 1,
    nowIso: () => new Date().toISOString(),
    env: {},
    tenantId: runtimeState.tenantId,
  };
}

async function sendEmail(input: Record<string, unknown>) {
  const action = getActionRegistryV2().get('email.send', 1);
  if (!action) throw new Error('Missing email.send@1');
  const parsed = action.inputSchema.parse({ subject: 'Reminder', text: 'Hello', ...input });
  return action.handler(parsed, actionCtx() as any) as Promise<any>;
}

async function createRole(db: Knex, tenantId: string, name: string, userIds: string[]): Promise<string> {
  const roleId = uuidv4();
  await tenantTable(db, tenantId, 'roles').insert({ tenant: tenantId, role_id: roleId, role_name: name, msp: true });
  for (const userId of userIds) {
    await tenantTable(db, tenantId, 'user_roles').insert({ tenant: tenantId, role_id: roleId, user_id: userId });
  }
  return roleId;
}

async function createTicket(db: Knex, tenantId: string, actorUserId: string, assignedTo: string | null): Promise<string> {
  const ticketId = uuidv4();
  let status = await tenantTable(db, tenantId, 'statuses').where({ status_type: 'ticket' }).first();
  if (!status) {
    [status] = await tenantTable(db, tenantId, 'statuses')
      .insert({ tenant: tenantId, name: 'Open', status_type: 'ticket', order_number: 1, created_by: actorUserId, is_closed: false, is_default: true })
      .returning('status_id');
  }
  const clientId = uuidv4();
  const now = new Date().toISOString();
  await tenantTable(db, tenantId, 'clients').insert({
    client_id: clientId,
    client_name: 'Test Client',
    tenant: tenantId,
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    url: '',
    created_at: now,
    updated_at: now,
    is_inactive: false,
  });
  await tenantTable(db, tenantId, 'tickets').insert({
    ticket_id: ticketId,
    client_id: clientId,
    tenant: tenantId,
    ticket_number: `WF-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    title: 'Waiting for client',
    status_id: status.status_id,
    entered_by: actorUserId,
    assigned_to: assignedTo,
  });
  return ticketId;
}

async function addResource(db: Knex, tenantId: string, ticketId: string, assignedTo: string, additionalUserId: string, assignedAt: string) {
  await tenantTable(db, tenantId, 'ticket_resources').insert({
    tenant: tenantId,
    ticket_id: ticketId,
    assigned_to: assignedTo,
    additional_user_id: additionalUserId,
    assigned_at: assignedAt,
  });
}

const emails = (list: Array<{ email: string }> | undefined) => (list ?? []).map((r) => r.email);

describe('email.send internal recipients (DB-backed)', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
    runtimeState.db = db;
    if (!getActionRegistryV2().get('email.send', 1)) registerEmailActions();
  }, 120000);

  afterAll(async () => {
    runtimeState.db = null;
    if (db) await db.destroy();
  });

  beforeEach(async () => {
    runtimeState.deniedPermissions.clear();
    runtimeState.sent.length = 0;
    runtimeState.templated = 0;
    runtimeState.maxRecipients = undefined;
    runtimeState.tenantId = await createTenant(db, 'Email Test Tenant');
    runtimeState.actorUserId = await createUser(db, runtimeState.tenantId, { email: `actor-${Date.now()}@example.com` });
  });

  it('T1: users.user_ids resolve to addresses with display names in To', async () => {
    const tid = runtimeState.tenantId;
    const a = await createUser(db, tid, { email: 'ann@example.com', first_name: 'Ann', last_name: 'Tech' });
    const b = await createUser(db, tid, { email: 'bob@example.com', first_name: 'Bob', last_name: 'Eng' });
    const out = await sendEmail({ users: { user_ids: [a, b] } });
    expect(out.status).toBe('sent');
    expect(runtimeState.sent[0].to).toEqual([
      { email: 'ann@example.com', name: 'Ann Tech' },
      { email: 'bob@example.com', name: 'Bob Eng' },
    ]);
    expect(out.internal_recipients).toEqual([
      { user_id: a, email: 'ann@example.com' },
      { user_id: b, email: 'bob@example.com' },
    ]);
    expect(out.skipped_users).toEqual([]);
  });

  it('T2: an inactive user is skipped and the others are emailed', async () => {
    const tid = runtimeState.tenantId;
    const a = await createUser(db, tid, { email: 'ann@example.com' });
    const gone = await createUser(db, tid, { email: 'gone@example.com', is_inactive: true });
    const out = await sendEmail({ users: { user_ids: [a, gone] } });
    expect(emails(runtimeState.sent[0].to)).toEqual(['ann@example.com']);
    expect(out.skipped_users).toEqual([{ user_id: gone, reason: 'inactive' }]);
  });

  it('T3: an unknown user id fails with NOT_FOUND before any send', async () => {
    const missing = uuidv4();
    await expect(sendEmail({ users: { user_ids: [missing] }, to: [{ email: 'c@example.com' }] })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      details: { missing_user_ids: [missing] },
    });
    expect(runtimeState.sent).toHaveLength(0);
  });

  it('T4: a user id from another tenant is NOT_FOUND', async () => {
    const other = await createTenant(db, 'Other Tenant');
    const foreign = await createUser(db, other, { email: 'foreign@example.com' });
    await expect(sendEmail({ users: { user_ids: [foreign] } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(runtimeState.sent).toHaveLength(0);
  });

  it('T5: a client user by id is skipped as not_internal; a client user via a role is not emailed', async () => {
    const tid = runtimeState.tenantId;
    const client = await createUser(db, tid, { email: 'client@example.com', user_type: 'client' });
    const staff = await createUser(db, tid, { email: 'staff@example.com' });
    const viaRole = await createUser(db, tid, { email: 'viarole@example.com', user_type: 'client' });
    await createRole(db, tid, 'Mixed', [viaRole, staff]);
    const out = await sendEmail({ users: { user_ids: [client], role_names: ['mixed'] } });
    expect(emails(runtimeState.sent[0].to)).toEqual(['staff@example.com']);
    expect(out.skipped_users).toEqual(
      expect.arrayContaining([
        { user_id: client, reason: 'not_internal' },
        { user_id: viaRole, reason: 'not_internal' },
      ])
    );
  });

  it('T6: a user with a blank email is skipped as no_email', async () => {
    const tid = runtimeState.tenantId;
    const blank = await createUser(db, tid, { email: ' ' });
    const a = await createUser(db, tid, { email: 'ann@example.com' });
    const out = await sendEmail({ users: { user_ids: [blank, a] } });
    expect(out.skipped_users).toEqual([{ user_id: blank, reason: 'no_email' }]);
    expect(emails(runtimeState.sent[0].to)).toEqual(['ann@example.com']);
  });

  it('T7: ticket_id with assigned emails only assigned_to', async () => {
    const tid = runtimeState.tenantId;
    const lead = await createUser(db, tid, { email: 'lead@example.com' });
    const extra = await createUser(db, tid, { email: 'extra@example.com' });
    const ticket = await createTicket(db, tid, runtimeState.actorUserId, lead);
    await addResource(db, tid, ticket, lead, extra, '2026-01-01T00:00:00Z');
    const out = await sendEmail({ ticket_id: ticket, ticket_assignees: 'assigned' });
    expect(emails(runtimeState.sent[0].to)).toEqual(['lead@example.com']);
    expect(out.internal_recipients).toEqual([{ user_id: lead, email: 'lead@example.com' }]);
  });

  it('T8: assigned_and_additional emails the assignee and every additional resource once; inactive resource skipped', async () => {
    const tid = runtimeState.tenantId;
    const lead = await createUser(db, tid, { email: 'lead@example.com' });
    const r1 = await createUser(db, tid, { email: 'r1@example.com' });
    const r2 = await createUser(db, tid, { email: 'r2@example.com' });
    const r3 = await createUser(db, tid, { email: 'r3@example.com', is_inactive: true });
    const ticket = await createTicket(db, tid, runtimeState.actorUserId, lead);
    await addResource(db, tid, ticket, lead, r2, '2026-01-02T00:00:00Z');
    await addResource(db, tid, ticket, lead, r1, '2026-01-01T00:00:00Z');
    await addResource(db, tid, ticket, lead, r3, '2026-01-03T00:00:00Z');
    // The assignee is also a role member and a picked user: still emailed once.
    const out = await sendEmail({ ticket_id: ticket, users: { user_ids: [lead] } });
    expect(emails(runtimeState.sent[0].to)).toEqual(['lead@example.com', 'r1@example.com', 'r2@example.com']);
    expect(out.skipped_users).toEqual([{ user_id: r3, reason: 'inactive' }]);
  });

  it('T9: an unassigned ticket gives NO_RECIPIENTS under error and skips under skip', async () => {
    const tid = runtimeState.tenantId;
    const ticket = await createTicket(db, tid, runtimeState.actorUserId, null);
    await expect(sendEmail({ ticket_id: ticket })).rejects.toMatchObject({ code: 'NO_RECIPIENTS' });
    const out = await sendEmail({ ticket_id: ticket, on_no_recipients: 'skip' });
    expect(out.status).toBe('skipped');
    expect(out.message_id).toBeNull();
    expect(out.internal_recipients).toEqual([]);
    expect(runtimeState.sent).toHaveLength(0);
  });

  it('T10: a ticket id from another tenant is NOT_FOUND', async () => {
    const other = await createTenant(db, 'Other Tenant');
    const otherActor = await createUser(db, other, { email: 'other-actor@example.com' });
    const foreignTicket = await createTicket(db, other, otherActor, otherActor);
    await expect(sendEmail({ ticket_id: foreignTicket })).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Ticket not found' });
    expect(runtimeState.sent).toHaveLength(0);
  });

  it('T11: role_ids and role_names (mixed case) expand to role members', async () => {
    const tid = runtimeState.tenantId;
    const a = await createUser(db, tid, { email: 'a@example.com' });
    const b = await createUser(db, tid, { email: 'b@example.com' });
    const roleA = await createRole(db, tid, 'Dispatcher', [a]);
    await createRole(db, tid, 'Technician', [b]);
    await sendEmail({ users: { role_ids: [roleA], role_names: ['tEcHnIcIaN'] } });
    expect(emails(runtimeState.sent[0].to).sort()).toEqual(['a@example.com', 'b@example.com']);
  });

  it('T12: an address equal to a literal to is not duplicated; users_as cc puts users in Cc', async () => {
    const tid = runtimeState.tenantId;
    const a = await createUser(db, tid, { email: 'ann@example.com' });
    const b = await createUser(db, tid, { email: 'bob@example.com' });
    await sendEmail({ to: [{ email: 'ANN@example.com' }], users: { user_ids: [a, b] }, users_as: 'cc' });
    expect(emails(runtimeState.sent[0].to)).toEqual(['ANN@example.com']);
    expect(emails(runtimeState.sent[0].cc)).toEqual(['bob@example.com']);
    runtimeState.sent.length = 0;
    await sendEmail({ to: [{ email: 'ann@example.com' }], users: { user_ids: [a] } });
    expect(emails(runtimeState.sent[0].to)).toEqual(['ann@example.com']);
  });

  it('T13: the recipient cap applies to the merged list and never truncates', async () => {
    const tid = runtimeState.tenantId;
    runtimeState.maxRecipients = 3;
    const tech = await createUser(db, tid, { email: 'tech@example.com' });
    const literals = [1, 2, 3].map((n) => ({ email: `l${n}@example.com` }));
    await expect(sendEmail({ to: literals, users: { user_ids: [tech] } })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { count: 4, max: 3 },
    });
    expect(runtimeState.sent).toHaveLength(0);
    // The cap fails before templating.
    expect(runtimeState.templated).toBe(0);

    await sendEmail({ to: literals.slice(0, 2), users: { user_ids: [tech] } });
    expect(runtimeState.sent).toHaveLength(1);
    expect(runtimeState.sent[0].to).toHaveLength(3);

    const members = [];
    for (let i = 0; i < 4; i += 1) members.push(await createUser(db, tid, { email: `m${i}@example.com` }));
    await createRole(db, tid, 'Everyone', members);
    runtimeState.sent.length = 0;
    await expect(sendEmail({ users: { role_names: ['Everyone'] } })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { count: 4, max: 3 },
    });
    expect(runtimeState.sent).toHaveLength(0);
  });

  it('T14: a legacy literal-only input sends the same lists and audits correct counts', async () => {
    const to = [{ email: 'a@example.com', name: 'A' }, { email: 'b@example.com' }];
    const cc = [{ email: 'c@example.com' }];
    const out = await sendEmail({ to, cc });
    expect(runtimeState.sent[0].to).toEqual(to);
    expect(runtimeState.sent[0].cc).toEqual(cc);
    expect(runtimeState.sent[0].bcc).toEqual([]);
    expect(out).toMatchObject({ success: true, status: 'sent', internal_recipients: [], skipped_users: [] });
    const audit = await tenantTable(db, runtimeState.tenantId, 'audit_logs').where({ operation: 'workflow_action:email.send' }).first();
    expect(audit.changed_data).toMatchObject({ to_count: 2, cc_count: 1, bcc_count: 0, internal_user_count: 0, skipped_user_count: 0 });
  });

  it('T16: ticket:read is required only when ticket_id is set', async () => {
    const tid = runtimeState.tenantId;
    const lead = await createUser(db, tid, { email: 'lead@example.com' });
    const ticket = await createTicket(db, tid, runtimeState.actorUserId, lead);
    runtimeState.deniedPermissions.add('ticket:read');
    await expect(sendEmail({ ticket_id: ticket })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(runtimeState.sent).toHaveLength(0);
    await expect(sendEmail({ to: [{ email: 'a@example.com' }] })).resolves.toMatchObject({ status: 'sent' });
  });
});
