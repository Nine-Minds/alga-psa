import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { knex, type Knex } from 'knex';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { getSecret } from '@alga-psa/core/secrets';
import { v4 as uuidv4 } from 'uuid';

import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerCrmActions } from '../businessOperations/crm';
import { registerWorkflowEmailProvider, resetWorkflowEmailProvider } from '../../registries/workflowEmailRegistry';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../../..');
const TEST_DB_NAME = 'test_database';
const PRODUCTION_DB_NAMES = new Set(['sebastian_prod', 'production', 'prod', 'server']);

const publishWorkflowEventMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: (...args: any[]) => publishWorkflowEventMock(...args),
}));

function verifyTestDatabase(dbName: string): void {
  if (PRODUCTION_DB_NAMES.has(dbName.toLowerCase())) {
    throw new Error(`Attempting to use production database (${dbName}) for testing`);
  }
}

async function recreateDatabase(
  databaseName: string,
  dbHost: string,
  dbPort: number,
  adminUser: string,
  adminPassword: string,
  appUser: string,
  appPassword: string
): Promise<void> {
  const adminConnection = knex({
    client: 'pg',
    connection: {
      host: dbHost,
      port: dbPort,
      user: adminUser,
      password: adminPassword,
      database: 'postgres',
    },
    pool: { min: 1, max: 2 },
  });

  try {
    const safeDbName = databaseName.replace(/"/g, '""');
    await adminConnection.raw(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ? AND pid <> pg_backend_pid()',
      [databaseName]
    );
    await adminConnection.raw(`DROP DATABASE IF EXISTS "${safeDbName}"`);
    await adminConnection.raw(`CREATE DATABASE "${safeDbName}"`);
    await adminConnection.raw(`DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appUser}') THEN
          CREATE ROLE ${appUser} WITH LOGIN PASSWORD '${appPassword}';
        ELSE
          ALTER ROLE ${appUser} WITH LOGIN PASSWORD '${appPassword}';
        END IF;
      END;
    $$;`);
    await adminConnection.raw(`ALTER DATABASE "${safeDbName}" OWNER TO ${appUser}`);
    await adminConnection.raw(`GRANT ALL PRIVILEGES ON DATABASE "${safeDbName}" TO ${appUser}`);
  } finally {
    await adminConnection.destroy().catch(() => undefined);
  }
}

async function createTestDbConnection(): Promise<Knex> {
  const databaseName = process.env.DB_NAME_SERVER || TEST_DB_NAME;
  verifyTestDatabase(databaseName);

  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = Number.parseInt(process.env.DB_PORT || '5432', 10);
  const adminUser = process.env.DB_USER_ADMIN || 'postgres';
  const adminPassword = await getSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'postpass123');
  const appUser = process.env.DB_USER_SERVER || 'app_user';
  const appPassword = await getSecret('db_password_server', 'DB_PASSWORD_SERVER', 'postpass123');

  await recreateDatabase(databaseName, dbHost, dbPort, adminUser, adminPassword, appUser, appPassword);

  process.env.DB_HOST = dbHost;
  process.env.DB_PORT = String(dbPort);
  process.env.DB_NAME_SERVER = databaseName;
  process.env.DB_USER_SERVER = appUser;
  process.env.DB_USER_ADMIN = adminUser;

  const adminKnex = knex({
    client: 'pg',
    connection: {
      host: dbHost,
      port: dbPort,
      user: adminUser,
      password: adminPassword,
      database: databaseName,
    },
    migrations: { directory: path.join(repoRoot, 'server', 'migrations') },
    seeds: { directory: path.join(repoRoot, 'server', 'seeds', 'dev') },
  });

  await adminKnex.migrate.latest();
  await adminKnex.seed.run();
  await adminKnex.destroy();

  return knex({
    client: 'pg',
    connection: {
      host: dbHost,
      port: dbPort,
      user: appUser,
      password: appPassword,
      database: databaseName,
    },
    asyncStackTraces: true,
    pool: { min: 2, max: 20 },
  });
}

async function createTenant(db: Knex, name = 'Test Tenant'): Promise<string> {
  const tenantId = uuidv4();
  const now = new Date().toISOString();

  await db('tenants').insert({
    tenant: tenantId,
    client_name: name,
    phone_number: '555-0100',
    email: `test-${tenantId.substring(0, 8)}@example.com`,
    created_at: now,
    updated_at: now,
    payment_platform_id: `test-platform-${tenantId.substring(0, 8)}`,
    payment_method_id: `test-method-${tenantId.substring(0, 8)}`,
    auth_service_id: `test-auth-${tenantId.substring(0, 8)}`,
    plan: 'pro',
  });

  return tenantId;
}

async function createUser(db: Knex, tenantId: string, options: { email?: string; first_name?: string; last_name?: string } = {}): Promise<string> {
  const userId = uuidv4();

  await db('users').insert({
    user_id: userId,
    tenant: tenantId,
    username: `test.user.${userId}`,
    first_name: options.first_name || 'Test',
    last_name: options.last_name || 'User',
    email: options.email || `test.user.${userId}@example.com`,
    hashed_password: 'hashed_password_here',
    created_at: new Date(),
    two_factor_enabled: false,
    is_google_user: false,
    is_inactive: false,
    user_type: 'internal',
  });

  return userId;
}

async function createClient(db: Knex, tenantId: string, name = 'Test Client'): Promise<string> {
  const clientId = uuidv4();
  const now = new Date().toISOString();

  await db('clients').insert({
    client_id: clientId,
    client_name: name,
    tenant: tenantId,
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    created_at: now,
    updated_at: now,
    is_inactive: false,
    credit_balance: 0,
  });

  return clientId;
}

async function createContact(db: Knex, tenantId: string, clientId: string, name: string): Promise<string> {
  const contactId = uuidv4();
  await db('contacts').insert({
    tenant: tenantId,
    contact_name_id: contactId,
    full_name: name,
    client_id: clientId,
    email: `${contactId.slice(0, 8)}@example.com`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_inactive: false,
  });
  return contactId;
}

async function getTicketStatusId(db: Knex, tenantId: string, actorUserId: string): Promise<string> {
  const existing = await db('statuses')
    .where({ tenant: tenantId, status_type: 'ticket' })
    .orderBy('order_number', 'asc')
    .first();
  if (existing?.status_id) return existing.status_id;

  const [inserted] = await db('statuses')
    .insert({
      tenant: tenantId,
      name: 'Open',
      status_type: 'ticket',
      order_number: 1,
      created_by: actorUserId,
      is_closed: false,
      is_default: true,
    })
    .returning('status_id');
  return inserted.status_id;
}

async function createTicket(db: Knex, params: { tenantId: string; actorUserId: string; clientId: string; contactId?: string | null }): Promise<string> {
  const ticketId = uuidv4();
  const statusId = await getTicketStatusId(db, params.tenantId, params.actorUserId);

  await db('tickets').insert({
    ticket_id: ticketId,
    tenant: params.tenantId,
    ticket_number: `WF-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    title: 'Workflow Ticket',
    status_id: statusId,
    client_id: params.clientId,
    entered_by: params.actorUserId,
    contact_name_id: params.contactId ?? null,
  });

  return ticketId;
}

async function getDefaultInteractionStatusId(db: Knex, tenantId: string, actorUserId: string): Promise<string> {
  const existing = await db('statuses').where({ tenant: tenantId, status_type: 'interaction', is_default: true }).first();
  if (existing?.status_id) return existing.status_id;

  const [created] = await db('statuses')
    .insert({
      tenant: tenantId,
      name: 'Logged',
      status_type: 'interaction',
      order_number: 1,
      created_by: actorUserId,
      is_closed: false,
      is_default: true,
    })
    .returning('status_id');

  return created.status_id;
}

async function createInteractionStatus(db: Knex, tenantId: string, actorUserId: string, name: string): Promise<string> {
  const [status] = await db('statuses')
    .insert({
      tenant: tenantId,
      name,
      status_type: 'interaction',
      order_number: Math.floor(Math.random() * 1000) + 2,
      created_by: actorUserId,
      is_closed: false,
      is_default: false,
    })
    .returning('status_id');
  return status.status_id;
}

async function getAnyInteractionTypeId(db: Knex, tenantId: string): Promise<string> {
  const tenantType = await db('interaction_types').where({ tenant: tenantId }).first();
  if (tenantType?.type_id) return tenantType.type_id;

  const systemType = await db('system_interaction_types').first();
  if (!systemType?.type_id) {
    throw new Error('Expected at least one system_interaction_types row in seeded DB');
  }
  return systemType.type_id;
}

async function createInteractionType(db: Knex, tenantId: string, name: string): Promise<string> {
  const typeId = uuidv4();
  await db('interaction_types').insert({
    tenant: tenantId,
    type_id: typeId,
    type_name: name,
    icon: 'phone',
  });
  return typeId;
}

async function createInteraction(
  db: Knex,
  params: {
    tenantId: string;
    actorUserId: string;
    clientId: string;
    contactId?: string | null;
    ticketId?: string | null;
    typeId: string;
    statusId?: string | null;
    title?: string;
    notes?: string;
    interactionDate?: string;
  }
): Promise<string> {
  const interactionId = uuidv4();
  const interactionDate = params.interactionDate ?? new Date().toISOString();

  await db('interactions').insert({
    tenant: params.tenantId,
    interaction_id: interactionId,
    type_id: params.typeId,
    contact_name_id: params.contactId ?? null,
    client_id: params.clientId,
    ticket_id: params.ticketId ?? null,
    user_id: params.actorUserId,
    title: params.title ?? 'Interaction',
    notes: params.notes ?? null,
    interaction_date: interactionDate,
    start_time: interactionDate,
    end_time: interactionDate,
    duration: 0,
    status_id: params.statusId ?? null,
    visibility: 'internal',
    category: 'general',
    tags: ['seed'],
  });

  return interactionId;
}

async function createQuote(
  db: Knex,
  params: {
    tenantId: string;
    actorUserId: string;
    clientId: string;
    contactId?: string | null;
    title?: string;
    status?: string;
    isTemplate?: boolean;
  }
): Promise<string> {
  const quoteId = uuidv4();
  await db('quotes').insert({
    tenant: params.tenantId,
    quote_id: quoteId,
    quote_number: `Q-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    client_id: params.clientId,
    contact_id: params.contactId ?? null,
    title: params.title ?? 'Workflow Quote',
    description: 'Quote description',
    quote_date: new Date().toISOString(),
    status: params.status ?? 'draft',
    version: 1,
    subtotal: 10000,
    discount_total: 0,
    tax: 0,
    total_amount: 10000,
    currency_code: 'USD',
    is_template: params.isTemplate ?? false,
    created_by: params.actorUserId,
    updated_by: params.actorUserId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return quoteId;
}

const runtimeState = vi.hoisted(() => ({
  db: null as Knex | null,
  tenantId: '',
  actorUserId: '',
  deniedPermissions: new Set<string>(),
}));

vi.mock('../businessOperations/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../businessOperations/shared')>();

  return {
    ...actual,
    withTenantTransaction: async (_ctx: any, fn: any) => {
      if (!runtimeState.db) {
        throw new Error('DB unavailable for test runtime state');
      }

      return runtimeState.db.transaction(async (trx) => {
        await trx.raw('select set_config(\'app.current_tenant\', ?, true)', [runtimeState.tenantId]);
        return fn({
          tenantId: runtimeState.tenantId,
          actorUserId: runtimeState.actorUserId,
          trx,
        });
      });
    },
    requirePermission: async (ctx: any, _tx: any, permission: { resource: string; action: string }) => {
      const key = `${permission.resource}:${permission.action}`;
      if (!runtimeState.deniedPermissions.has(key)) return;
      throw {
        category: 'ActionError',
        code: 'PERMISSION_DENIED',
        message: `Missing permission ${key}`,
        details: { permission: key },
        nodePath: ctx?.stepPath ?? 'steps.crm-action',
        at: new Date().toISOString(),
      };
    },
  };
});

function getAction(actionId: string) {
  const action = getActionRegistryV2().get(actionId, 1);
  if (!action) throw new Error(`Missing action ${actionId}@1`);
  return action;
}

function actionCtx(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    runId: uuidv4(),
    stepPath: 'steps.crm-action',
    idempotencyKey: uuidv4(),
    attempt: 1,
    nowIso: () => new Date().toISOString(),
    env: {},
    tenantId: runtimeState.tenantId,
    ...overrides,
  };
}

async function invokeAction(actionId: string, input: Record<string, unknown>, ctxOverrides: Record<string, unknown> = {}) {
  const action = getAction(actionId);
  const parsedInput = action.inputSchema.parse(input);
  return action.handler(parsedInput, actionCtx(ctxOverrides) as any);
}

describe('crm workflow runtime DB-backed action handlers', () => {
  let db: Knex;

  beforeAll(async () => {
    if (!getActionRegistryV2().get('crm.send_quote', 1)) {
      registerCrmActions();
    }

    db = await createTestDbConnection();
    runtimeState.db = db;
  }, 180000);

  beforeEach(async () => {
    publishWorkflowEventMock.mockClear();

    const tenantId = await createTenant(db, `Workflow CRM Runtime Test ${Date.now()}`);
    const actorUserId = await createUser(db, tenantId, {
      first_name: 'Workflow',
      last_name: 'Actor',
    });

    runtimeState.tenantId = tenantId;
    runtimeState.actorUserId = actorUserId;
    runtimeState.deniedPermissions.clear();

    registerWorkflowEmailProvider({
      TenantEmailService: {
        getInstance: () => ({
          sendEmail: async () => ({ success: true, messageId: 'msg-test-1' }),
        }),
        getTenantEmailSettings: async () => ({ providerConfigs: [] }),
      },
      StaticTemplateProcessor: class {
        subject: string;
        html: string;
        text?: string;

        constructor(subject: string, html: string, text?: string) {
          this.subject = subject;
          this.html = html;
          this.text = text;
        }

        async process() {
          return { subject: this.subject, html: this.html, text: this.text };
        }
      } as any,
      EmailProviderManager: class {
        async initialize() {}
        async getAvailableProviders() {
          return [];
        }
        async sendEmail() {
          return { success: true };
        }
      } as any,
    });
  });

  afterAll(async () => {
    resetWorkflowEmailProvider();
    await db?.destroy();
    runtimeState.db = null;
  });

  it('T004: crm.find_activities returns tenant-scoped filtered summaries and rejects unbounded searches', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Activity Client');
    const contactId = await createContact(db, runtimeState.tenantId, clientId, 'Activity Contact');
    const ticketId = await createTicket(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      contactId,
    });
    const typeId = await getAnyInteractionTypeId(db, runtimeState.tenantId);
    const statusId = await getDefaultInteractionStatusId(db, runtimeState.tenantId, runtimeState.actorUserId);

    await createInteraction(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      contactId,
      ticketId,
      typeId,
      statusId,
      title: 'Keep me',
      notes: 'Interaction details for preview behavior',
    });

    const otherTenant = await createTenant(db, 'Other CRM Tenant');
    const otherUser = await createUser(db, otherTenant);
    const otherClient = await createClient(db, otherTenant, 'Other Client');
    const otherTypeId = await getAnyInteractionTypeId(db, otherTenant);
    await createInteraction(db, {
      tenantId: otherTenant,
      actorUserId: otherUser,
      clientId: otherClient,
      typeId: otherTypeId,
      title: 'Other tenant interaction',
    });

    const result = await invokeAction('crm.find_activities', {
      client_id: clientId,
      limit: 10,
      on_empty: 'return_empty',
    });

    expect(result.count).toBe(1);
    expect(result.activities[0].client_id).toBe(clientId);
    expect(result.activities[0].title).toBe('Keep me');
    expect(result.activities[0].notes_preview).toContain('Interaction details');

    await expect(
      invokeAction('crm.find_activities', {
        limit: 10,
        on_empty: 'return_empty',
      })
    ).rejects.toThrow();
  });

  it('T005/T006: crm.update_activity updates allowed fields, validates status/type ids, and writes audit', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Update Client');
    const typeId = await getAnyInteractionTypeId(db, runtimeState.tenantId);
    const statusId = await getDefaultInteractionStatusId(db, runtimeState.tenantId, runtimeState.actorUserId);
    const nextStatusId = await createInteractionStatus(db, runtimeState.tenantId, runtimeState.actorUserId, 'Follow-up Complete');
    const nextTypeId = await createInteractionType(db, runtimeState.tenantId, 'QBR');

    const activityId = await createInteraction(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      typeId,
      statusId,
      title: 'Original Title',
      notes: 'Original notes',
    });

    const updated = await invokeAction('crm.update_activity', {
      activity_id: activityId,
      patch: {
        title: 'Updated Title',
        notes: 'Updated notes',
        status_id: nextStatusId,
        type_id: nextTypeId,
        visibility: 'client_visible',
        category: 'outcome',
        tags: ['completed', 'followup'],
      },
      reason: 'workflow update test',
    });

    expect(updated.activity_before.title).toBe('Original Title');
    expect(updated.activity_after.title).toBe('Updated Title');
    expect(updated.activity_after.status_id).toBe(nextStatusId);
    expect(updated.activity_after.type_id).toBe(nextTypeId);
    expect(updated.changed_fields).toEqual(expect.arrayContaining(['title', 'notes', 'status_id', 'type_id', 'visibility', 'category', 'tags']));

    const audit = await db('audit_logs')
      .where({ tenant: runtimeState.tenantId, operation: 'workflow_action:crm.update_activity' })
      .orderBy('timestamp', 'desc')
      .first();

    expect(audit).toBeTruthy();

    const otherTenantId = await createTenant(db, `Other Tenant ${Date.now()}`);
    const otherUserId = await createUser(db, otherTenantId);
    const otherClientId = await createClient(db, otherTenantId, 'Other Client');
    const otherTypeId = await getAnyInteractionTypeId(db, otherTenantId);
    const otherActivityId = await createInteraction(db, {
      tenantId: otherTenantId,
      actorUserId: otherUserId,
      clientId: otherClientId,
      typeId: otherTypeId,
    });

    await expect(
      invokeAction('crm.update_activity', {
        activity_id: otherActivityId,
        patch: { title: 'Should fail' },
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(
      invokeAction('crm.update_activity', {
        activity_id: activityId,
        patch: {},
      })
    ).rejects.toThrow();

    await expect(
      invokeAction('crm.update_activity', {
        activity_id: activityId,
        patch: { status_id: uuidv4() },
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      invokeAction('crm.update_activity', {
        activity_id: activityId,
        patch: { type_id: uuidv4() },
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('T007/T008/T009: crm.schedule_activity validates context, creates follow-up, audits, and publishes INTERACTION_LOGGED', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Schedule Client');
    const contactId = await createContact(db, runtimeState.tenantId, clientId, 'Schedule Contact');
    const ticketId = await createTicket(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      contactId,
    });
    const typeId = await getAnyInteractionTypeId(db, runtimeState.tenantId);
    await getDefaultInteractionStatusId(db, runtimeState.tenantId, runtimeState.actorUserId);

    const now = new Date();
    const startTime = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const endTime = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();

    const scheduled = await invokeAction('crm.schedule_activity', {
      contact_id: contactId,
      ticket_id: ticketId,
      type_id: typeId,
      title: 'Schedule follow-up call',
      notes: 'Discuss deployment',
      start_time: startTime,
      end_time: endTime,
      visibility: 'internal',
      category: 'follow-up',
      tags: ['qbr'],
    });

    expect(scheduled.activity.client_id).toBe(clientId);
    expect(scheduled.activity.contact_id).toBe(contactId);
    expect(scheduled.activity.ticket_id).toBe(ticketId);
    expect(scheduled.activity.duration).toBe(60);

    const stored = await db('interactions')
      .where({ tenant: runtimeState.tenantId, interaction_id: scheduled.activity.activity_id })
      .first();

    expect(stored).toBeTruthy();

    const audit = await db('audit_logs')
      .where({ tenant: runtimeState.tenantId, operation: 'workflow_action:crm.schedule_activity' })
      .orderBy('timestamp', 'desc')
      .first();

    expect(audit).toBeTruthy();
    expect(publishWorkflowEventMock).toHaveBeenCalledTimes(1);
    expect(publishWorkflowEventMock.mock.calls[0]?.[0]).toMatchObject({
      eventType: 'INTERACTION_LOGGED',
      idempotencyKey: `interaction_logged:${scheduled.activity.activity_id}`,
    });

    await expect(
      invokeAction('crm.schedule_activity', {
        type_id: typeId,
        title: 'Missing context',
        start_time: startTime,
      })
    ).rejects.toThrow();

    const otherClientId = await createClient(db, runtimeState.tenantId, 'Other Client');
    const wrongContactId = await createContact(db, runtimeState.tenantId, otherClientId, 'Wrong Contact');

    await expect(
      invokeAction('crm.schedule_activity', {
        client_id: clientId,
        contact_id: wrongContactId,
        type_id: typeId,
        title: 'Mismatched contact',
        start_time: startTime,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      invokeAction('crm.schedule_activity', {
        client_id: clientId,
        ticket_id: ticketId,
        type_id: uuidv4(),
        title: 'Invalid type',
        start_time: startTime,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      invokeAction('crm.schedule_activity', {
        client_id: clientId,
        type_id: typeId,
        status_id: uuidv4(),
        title: 'Invalid status',
        start_time: startTime,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      invokeAction('crm.schedule_activity', {
        client_id: clientId,
        type_id: typeId,
        title: 'Invalid window',
        start_time: endTime,
        end_time: startTime,
      })
    ).rejects.toThrow();
  });

  it('T010/T011: crm.send_quote sends eligible quotes, writes activity/audit, and rejects ineligible cases', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Quote Client');
    const contactId = await createContact(db, runtimeState.tenantId, clientId, 'Quote Contact');

    const quoteId = await createQuote(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      contactId,
      status: 'draft',
      isTemplate: false,
    });

    const sent = await invokeAction('crm.send_quote', {
      quote_id: quoteId,
      email_addresses: ['custom@example.com'],
      subject: 'Workflow quote send',
      message: 'Please review this quote',
      no_op_if_already_sent: true,
    });

    expect(sent.previous_status).toBe('draft');
    expect(sent.new_status).toBe('sent');
    expect(sent.email_sent).toBe(true);
    expect(sent.recipients).toEqual(expect.arrayContaining(['custom@example.com']));
    expect(sent.message_id).toBe('msg-test-1');

    const updated = await db('quotes').where({ tenant: runtimeState.tenantId, quote_id: quoteId }).first();
    expect(updated.status).toBe('sent');
    expect(updated.sent_at).toBeTruthy();

    const sentActivity = await db('quote_activities')
      .where({ tenant: runtimeState.tenantId, quote_id: quoteId, activity_type: 'sent' })
      .first();
    expect(sentActivity).toBeTruthy();

    const sendAudit = await db('audit_logs')
      .where({ tenant: runtimeState.tenantId, operation: 'workflow_action:crm.send_quote' })
      .orderBy('timestamp', 'desc')
      .first();

    expect(sendAudit).toBeTruthy();

    const templateQuoteId = await createQuote(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      status: 'draft',
      isTemplate: true,
    });

    await expect(
      invokeAction('crm.send_quote', { quote_id: templateQuoteId })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const rejectedQuoteId = await createQuote(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      status: 'rejected',
      isTemplate: false,
    });

    await expect(
      invokeAction('crm.send_quote', { quote_id: rejectedQuoteId })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await db('tenant_settings')
      .insert({
        tenant: runtimeState.tenantId,
        settings: JSON.stringify({ billing: { quotes: { approvalRequired: true } } }),
      })
      .onConflict('tenant')
      .merge({ settings: JSON.stringify({ billing: { quotes: { approvalRequired: true } } }) });

    const pendingQuoteId = await createQuote(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      status: 'draft',
      isTemplate: false,
    });

    await expect(
      invokeAction('crm.send_quote', { quote_id: pendingQuoteId })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const otherTenantId = await createTenant(db, 'Other Quote Tenant');
    const otherUser = await createUser(db, otherTenantId);
    const otherClient = await createClient(db, otherTenantId, 'Other Quote Client');
    const otherQuoteId = await createQuote(db, {
      tenantId: otherTenantId,
      actorUserId: otherUser,
      clientId: otherClient,
      status: 'draft',
    });

    await expect(
      invokeAction('crm.send_quote', { quote_id: otherQuoteId })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('T012: CRM read/mutation/send actions return PERMISSION_DENIED based on mapped permissions', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Permission Client');
    const typeId = await getAnyInteractionTypeId(db, runtimeState.tenantId);
    const quoteId = await createQuote(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      status: 'draft',
    });

    const activityId = await createInteraction(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      typeId,
    });

    const checks: Array<{ actionId: string; denied: string; input: Record<string, unknown> }> = [
      {
        actionId: 'crm.find_activities',
        denied: 'client:read',
        input: { client_id: clientId, on_empty: 'return_empty' },
      },
      {
        actionId: 'crm.update_activity',
        denied: 'client:update',
        input: { activity_id: activityId, patch: { title: 'Denied' } },
      },
      {
        actionId: 'crm.schedule_activity',
        denied: 'client:update',
        input: { client_id: clientId, type_id: typeId, title: 'Denied', start_time: new Date().toISOString() },
      },
      {
        actionId: 'crm.send_quote',
        denied: 'billing:update',
        input: { quote_id: quoteId },
      },
      {
        actionId: 'crm.send_quote',
        denied: 'billing:read',
        input: { quote_id: quoteId },
      },
    ];

    for (const check of checks) {
      runtimeState.deniedPermissions.clear();
      runtimeState.deniedPermissions.add(check.denied);
      await expect(invokeAction(check.actionId, check.input)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    }

    runtimeState.deniedPermissions.clear();
  });

  it('T014: crm.create_activity_note remains functional after CRM action expansion', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Legacy Note Client');

    const note = await invokeAction('crm.create_activity_note', {
      target: {
        type: 'client',
        id: clientId,
      },
      body: 'Legacy note preserved',
      visibility: 'internal',
      category: 'note',
      tags: ['legacy'],
    });

    expect(note.note_id).toBeTruthy();

    const stored = await db('interactions')
      .where({ tenant: runtimeState.tenantId, interaction_id: note.note_id })
      .first();

    expect(stored).toBeTruthy();
    expect(stored.client_id).toBe(clientId);
    expect(stored.notes).toBe('Legacy note preserved');
  });
});
