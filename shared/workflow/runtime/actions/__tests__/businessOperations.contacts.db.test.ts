import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { knex, type Knex } from 'knex';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { getSecret } from '@alga-psa/core/secrets';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../../..');
const TEST_DB_NAME = 'test_database';
const PRODUCTION_DB_NAMES = new Set(['sebastian_prod', 'production', 'prod', 'server']);

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

async function createUser(
  db: Knex,
  tenantId: string,
  options: {
    email?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
    user_type?: 'client' | 'internal';
    is_inactive?: boolean;
    contact_id?: string;
  } = {}
): Promise<string> {
  const userId = uuidv4();

  await db('users').insert({
    user_id: userId,
    tenant: tenantId,
    username: options.username || `test.user.${userId}`,
    first_name: options.first_name || 'Test',
    last_name: options.last_name || 'User',
    email: options.email || `test.user.${userId}@example.com`,
    hashed_password: 'hashed_password_here',
    created_at: new Date(),
    two_factor_enabled: false,
    is_google_user: false,
    is_inactive: options.is_inactive ?? false,
    user_type: options.user_type || 'internal',
    contact_id: options.contact_id,
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
    url: '',
    created_at: now,
    updated_at: now,
    is_inactive: false,
    credit_balance: 0,
  });

  return clientId;
}

async function createContactRaw(
  db: Knex,
  tenantId: string,
  options: {
    full_name?: string;
    email?: string;
    client_id?: string | null;
    is_inactive?: boolean;
    notes_document_id?: string | null;
  } = {}
): Promise<string> {
  const contactId = uuidv4();
  const now = new Date().toISOString();

  await db('contacts').insert({
    tenant: tenantId,
    contact_name_id: contactId,
    full_name: options.full_name ?? `Contact ${contactId.slice(0, 6)}`,
    email: options.email ?? `${contactId.slice(0, 8)}@example.com`,
    client_id: options.client_id ?? null,
    is_inactive: options.is_inactive ?? false,
    notes_document_id: options.notes_document_id ?? null,
    primary_email_canonical_type: 'work',
    created_at: now,
    updated_at: now,
  });

  return contactId;
}

async function createTicketStatusId(db: Knex, tenantId: string, actorUserId: string): Promise<string> {
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

async function createTicket(
  db: Knex,
  params: {
    tenantId: string;
    actorUserId: string;
    clientId?: string | null;
    contactId?: string | null;
    title?: string;
  }
): Promise<string> {
  const ticketId = uuidv4();
  const statusId = await createTicketStatusId(db, params.tenantId, params.actorUserId);

  await db('tickets').insert({
    ticket_id: ticketId,
    tenant: params.tenantId,
    ticket_number: `WF-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    title: params.title ?? 'Workflow Test Ticket',
    status_id: statusId,
    client_id: params.clientId ?? null,
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

async function getAnyInteractionTypeId(db: Knex, tenantId: string): Promise<string> {
  const tenantType = await db('interaction_types').where({ tenant: tenantId }).first();
  if (tenantType?.type_id) return tenantType.type_id;

  const systemType = await db('system_interaction_types').first();
  if (!systemType?.type_id) {
    throw new Error('Expected at least one system_interaction_types row in seeded DB');
  }
  return systemType.type_id;
}

const runtimeState = vi.hoisted(() => ({
  db: null as Knex | null,
  tenantId: '',
  actorUserId: '',
  deniedPermissions: new Set<string>(),
  publishedEvents: [] as Array<{ eventType: string; payload: Record<string, unknown>; idempotencyKey: string }>,
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async (event: { eventType: string; payload: Record<string, unknown>; idempotencyKey: string }) => {
    runtimeState.publishedEvents.push(event);
  }),
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
        await trx.raw(`select set_config('app.current_tenant', ?, true)`, [runtimeState.tenantId]);
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
        nodePath: ctx?.stepPath ?? 'steps.contact-action',
        at: new Date().toISOString(),
      };
    },
  };
});

import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerContactActions } from '../businessOperations/contacts';

function getAction(actionId: string) {
  const action = getActionRegistryV2().get(actionId, 1);
  if (!action) throw new Error(`Missing action ${actionId}@1`);
  return action;
}

function actionCtx(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    runId: uuidv4(),
    stepPath: 'steps.contact-action',
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

describe('contact workflow runtime DB-backed action handlers', () => {
  let db: Knex;

  beforeAll(async () => {
    if (!getActionRegistryV2().get('contacts.move_to_client', 1)) {
      registerContactActions();
    }

    db = await createTestDbConnection();
    runtimeState.db = db;
  }, 180000);

  beforeEach(async () => {
    const tenantId = await createTenant(db, `Workflow Contact Runtime Test ${Date.now()}`);
    const actorUserId = await createUser(db, tenantId, {
      user_type: 'internal',
      first_name: 'Workflow',
      last_name: 'Actor',
    });

    runtimeState.tenantId = tenantId;
    runtimeState.actorUserId = actorUserId;
    runtimeState.deniedPermissions.clear();
    runtimeState.publishedEvents.length = 0;
  });

  afterAll(async () => {
    await db?.destroy();
    runtimeState.db = null;
  });

  it('T003: contacts.create creates scoped contact rows and returns compact output; duplicate email conflicts', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Create Client');
    const action = getAction('contacts.create');
    const keyFromContext = action.idempotency.mode === 'actionProvided'
      ? action.idempotency.key({}, actionCtx({ runId: 'run-fixed', stepPath: 'steps.fixed' }) as any)
      : '';

    expect(action.idempotency.mode).toBe('actionProvided');
    expect(keyFromContext).toBe('run:run-fixed:steps.fixed');

    const created = await invokeAction('contacts.create', {
      full_name: 'Created Contact',
      email: 'created.contact@example.com',
      client_id: clientId,
      role: 'Manager',
      notes: 'Created by workflow',
      phone_numbers: [{ phone_number: '555-0101', canonical_type: 'work', is_default: true }],
      additional_email_addresses: [{ email_address: 'created.contact+alt@example.com', canonical_type: 'personal' }],
    });

    expect(created.created).toBe(true);
    expect(created.contact.full_name).toBe('Created Contact');
    expect(created.contact.email).toBe('created.contact@example.com');
    expect(created.contact.client_id).toBe(clientId);

    const dbContact = await db('contacts')
      .where({ tenant: runtimeState.tenantId, contact_name_id: created.contact.contact_name_id })
      .first();
    expect(dbContact).toBeTruthy();

    const phones = await db('contact_phone_numbers')
      .where({ tenant: runtimeState.tenantId, contact_name_id: created.contact.contact_name_id });
    expect(phones.length).toBe(1);

    const additionalEmails = await db('contact_additional_email_addresses')
      .where({ tenant: runtimeState.tenantId, contact_name_id: created.contact.contact_name_id });
    expect(additionalEmails.length).toBe(1);

    await expect(
      invokeAction('contacts.create', {
        full_name: 'Duplicate Contact',
        email: 'created.contact@example.com',
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('T004: contacts.update patches supplied fields, preserves omitted fields, returns before/after and enforces model email rules', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Update Client');
    const contactId = await invokeAction('contacts.create', {
      full_name: 'Update Target',
      email: 'update.target@example.com',
      client_id: clientId,
      role: 'Initial',
      notes: 'Initial Notes',
      phone_numbers: [{ phone_number: '555-0102', canonical_type: 'work', is_default: true }],
      additional_email_addresses: [{ email_address: 'update.target+alt@example.com', canonical_type: 'personal' }],
    }).then((result) => result.contact.contact_name_id as string);

    const updated = await invokeAction('contacts.update', {
      contact_id: contactId,
      patch: {
        full_name: 'Updated Name',
        role: 'Updated Role',
      },
    });

    expect(updated.contact_before.contact_name_id).toBe(contactId);
    expect(updated.contact_after.full_name).toBe('Updated Name');
    expect(updated.changed_fields).toEqual(expect.arrayContaining(['full_name', 'role']));

    const stored = await db('contacts').where({ tenant: runtimeState.tenantId, contact_name_id: contactId }).first();
    expect(stored.email).toBe('update.target@example.com');
    expect(stored.notes).toBe('Initial Notes');

    const cleared = await invokeAction('contacts.update', {
      contact_id: contactId,
      patch: {
        role: null,
        notes: null,
      },
    });
    expect(cleared.changed_fields).toEqual(expect.arrayContaining(['role', 'notes']));

    const clearedStored = await db('contacts').where({ tenant: runtimeState.tenantId, contact_name_id: contactId }).first();
    expect(clearedStored.role).toBeNull();
    expect(clearedStored.notes).toBeNull();

    await expect(
      invokeAction('contacts.update', {
        contact_id: contactId,
        patch: {
          email: null,
        },
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      invokeAction('contacts.update', {
        contact_id: contactId,
        patch: {
          email: 'new.primary@example.com',
        },
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('T005: contacts.add_to_client assigns unassigned contacts, no-ops on same client, and conflicts on other client', async () => {
    const clientA = await createClient(db, runtimeState.tenantId, 'Client A');
    const clientB = await createClient(db, runtimeState.tenantId, 'Client B');
    const contactId = await createContactRaw(db, runtimeState.tenantId, { client_id: null });

    const assigned = await invokeAction('contacts.add_to_client', {
      contact_id: contactId,
      client_id: clientA,
    });

    expect(assigned.previous_client_id).toBeNull();
    expect(assigned.current_client_id).toBe(clientA);
    expect(assigned.noop).toBe(false);

    const noop = await invokeAction('contacts.add_to_client', {
      contact_id: contactId,
      client_id: clientA,
    });
    expect(noop.noop).toBe(true);

    await expect(
      invokeAction('contacts.add_to_client', {
        contact_id: contactId,
        client_id: clientB,
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('T006: contacts.move_to_client moves contact, no-ops when repeated, and enforces expected_current_client_id', async () => {
    const clientA = await createClient(db, runtimeState.tenantId, 'Client A');
    const clientB = await createClient(db, runtimeState.tenantId, 'Client B');
    const contactId = await createContactRaw(db, runtimeState.tenantId, { client_id: clientA });

    const moved = await invokeAction('contacts.move_to_client', {
      contact_id: contactId,
      target_client_id: clientB,
      expected_current_client_id: clientA,
    });
    expect(moved.previous_client_id).toBe(clientA);
    expect(moved.current_client_id).toBe(clientB);
    expect(moved.noop).toBe(false);

    const noop = await invokeAction('contacts.move_to_client', {
      contact_id: contactId,
      target_client_id: clientB,
    });
    expect(noop.noop).toBe(true);

    await expect(
      invokeAction('contacts.move_to_client', {
        contact_id: contactId,
        target_client_id: clientA,
        expected_current_client_id: clientA,
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('T007: contacts.assign_to_ticket updates only contact_name_id and enforces client relationship', async () => {
    const clientA = await createClient(db, runtimeState.tenantId, 'Ticket Client A');
    const clientB = await createClient(db, runtimeState.tenantId, 'Ticket Client B');

    const contactA = await createContactRaw(db, runtimeState.tenantId, { client_id: clientA });
    const contactB = await createContactRaw(db, runtimeState.tenantId, { client_id: clientB });

    const ticketWithClient = await createTicket(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId: clientA,
      contactId: null,
    });

    const assigned = await invokeAction('contacts.assign_to_ticket', {
      ticket_id: ticketWithClient,
      contact_id: contactA,
    });
    expect(assigned.previous_contact_id).toBeNull();
    expect(assigned.current_contact_id).toBe(contactA);

    await expect(
      invokeAction('contacts.assign_to_ticket', {
        ticket_id: ticketWithClient,
        contact_id: contactB,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const ticketAfter = await db('tickets').where({ tenant: runtimeState.tenantId, ticket_id: ticketWithClient }).first();
    expect(ticketAfter.contact_name_id).toBe(contactA);
    expect(ticketAfter.client_id).toBe(clientA);
  });

  it('T008: contacts.add_tag creates/reuses definitions and mappings and remains idempotent', async () => {
    const contactId = await createContactRaw(db, runtimeState.tenantId, { client_id: null });

    const first = await invokeAction('contacts.add_tag', {
      contact_id: contactId,
      tags: ['priority', 'managed'],
    });
    expect(first.added_count).toBe(2);
    expect(first.existing_count).toBe(0);

    const second = await invokeAction('contacts.add_tag', {
      contact_id: contactId,
      tags: ['priority'],
    });
    expect(second.added_count).toBe(0);
    expect(second.existing_count).toBe(1);

    const mappings = await db('tag_mappings as tm')
      .join('tag_definitions as td', function joinTagDefs() {
        this.on('tm.tenant', 'td.tenant').andOn('tm.tag_id', 'td.tag_id');
      })
      .where({
        'tm.tenant': runtimeState.tenantId,
        'tm.tagged_type': 'contact',
        'tm.tagged_id': contactId,
      })
      .select('td.tag_text');

    expect(mappings.map((row: { tag_text: string }) => row.tag_text).sort()).toEqual(['managed', 'priority']);
    expect(mappings.length).toBe(2);
  });

  it('T009: contacts.duplicate requires new email, supports overrides and tag copy, and excludes historical relationships', async () => {
    const sourceClient = await createClient(db, runtimeState.tenantId, 'Source Client');
    const targetClient = await createClient(db, runtimeState.tenantId, 'Target Client');
    const sourceContact = await invokeAction('contacts.create', {
      full_name: 'Source Contact',
      email: 'source.contact@example.com',
      client_id: sourceClient,
      role: 'Source Role',
      notes: 'Source Notes',
      phone_numbers: [{ phone_number: '555-0110', canonical_type: 'work', is_default: true }],
      additional_email_addresses: [{ email_address: 'source.contact+alt@example.com', canonical_type: 'personal' }],
    }).then((result) => result.contact.contact_name_id as string);

    await invokeAction('contacts.add_tag', {
      contact_id: sourceContact,
      tags: ['vip', 'imported'],
    });

    const sourceTicket = await createTicket(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId: sourceClient,
      contactId: sourceContact,
    });

    await db('interactions').insert({
      tenant: runtimeState.tenantId,
      interaction_id: uuidv4(),
      type_id: await getAnyInteractionTypeId(db, runtimeState.tenantId),
      contact_name_id: sourceContact,
      client_id: sourceClient,
      user_id: runtimeState.actorUserId,
      ticket_id: sourceTicket,
      title: 'Source Interaction',
      notes: 'Source interaction notes',
      interaction_date: new Date().toISOString(),
      start_time: new Date().toISOString(),
      end_time: new Date().toISOString(),
      duration: 0,
      status_id: await getDefaultInteractionStatusId(db, runtimeState.tenantId, runtimeState.actorUserId),
    });

    const duplicate = await invokeAction('contacts.duplicate', {
      source_contact_id: sourceContact,
      email: 'duplicate.contact@example.com',
      full_name: 'Duplicate Contact',
      target_client_id: targetClient,
      copy_tags: true,
    });

    expect(duplicate.source_contact.contact_name_id).toBe(sourceContact);
    expect(duplicate.duplicate_contact.full_name).toBe('Duplicate Contact');
    expect(duplicate.duplicate_contact.client_id).toBe(targetClient);
    expect(duplicate.copied_tags).toBeGreaterThanOrEqual(2);

    const duplicatedId = duplicate.duplicate_contact.contact_name_id;
    const duplicatedTickets = await db('tickets').where({ tenant: runtimeState.tenantId, contact_name_id: duplicatedId });
    const duplicatedInteractions = await db('interactions').where({ tenant: runtimeState.tenantId, contact_name_id: duplicatedId });
    expect(duplicatedTickets.length).toBe(0);
    expect(duplicatedInteractions.length).toBe(0);

    await expect(
      invokeAction('contacts.duplicate', {
        source_contact_id: sourceContact,
        email: 'source.contact@example.com',
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('T010: contacts.add_note creates and appends notes document without creating interaction rows', async () => {
    const contactId = await createContactRaw(db, runtimeState.tenantId, { client_id: null });

    const first = await invokeAction('contacts.add_note', {
      contact_id: contactId,
      body: 'First workflow note',
    });
    expect(first.created_document).toBe(true);

    const second = await invokeAction('contacts.add_note', {
      contact_id: contactId,
      body: 'Second workflow note',
    });
    expect(second.created_document).toBe(false);
    expect(second.document_id).toBe(first.document_id);

    const contentRow = await db('document_block_content')
      .where({ tenant: runtimeState.tenantId, document_id: first.document_id })
      .first();
    const blocks = typeof contentRow?.block_data === 'string' ? JSON.parse(contentRow.block_data) : contentRow?.block_data;
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.length).toBeGreaterThanOrEqual(2);

    const interactions = await db('interactions')
      .where({ tenant: runtimeState.tenantId, contact_name_id: contactId })
      .select('interaction_id');
    expect(interactions.length).toBe(0);
  });

  it('T011: contacts.add_interaction uses contact-derived client, default status, actor ownership, and ticket validation', async () => {
    const clientA = await createClient(db, runtimeState.tenantId, 'Interaction A');
    const clientB = await createClient(db, runtimeState.tenantId, 'Interaction B');
    const contact = await createContactRaw(db, runtimeState.tenantId, { client_id: clientA });

    const ticketA = await createTicket(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId: clientA,
      contactId: contact,
    });
    const ticketB = await createTicket(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId: clientB,
    });

    const typeId = await getAnyInteractionTypeId(db, runtimeState.tenantId);
    const defaultStatusId = await getDefaultInteractionStatusId(db, runtimeState.tenantId, runtimeState.actorUserId);

    const result = await invokeAction('contacts.add_interaction', {
      contact_id: contact,
      interaction_type_id: typeId,
      title: 'Workflow Interaction',
      ticket_id: ticketA,
      notes: 'Logged from workflow',
    });

    expect(result.contact_id).toBe(contact);
    expect(result.client_id).toBe(clientA);
    expect(result.ticket_id).toBe(ticketA);
    expect(result.status_id).toBe(defaultStatusId);
    expect(result.user_id).toBe(runtimeState.actorUserId);

    await expect(
      invokeAction('contacts.add_interaction', {
        contact_id: contact,
        interaction_type_id: typeId,
        title: 'Invalid Ticket',
        ticket_id: ticketB,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('T012: contacts.delete requires confirm, supports return_false, hard-deletes eligible contacts, and returns dependency conflicts', async () => {
    const deletableContact = await createContactRaw(db, runtimeState.tenantId, { client_id: null });

    await expect(
      invokeAction('contacts.delete', {
        contact_id: deletableContact,
        confirm: false,
      })
    ).rejects.toThrow();

    const deleted = await invokeAction('contacts.delete', {
      contact_id: deletableContact,
      confirm: true,
    });
    expect(deleted).toEqual({ deleted: true, contact_id: deletableContact });

    const deletedRow = await db('contacts').where({ tenant: runtimeState.tenantId, contact_name_id: deletableContact }).first();
    expect(deletedRow).toBeFalsy();

    const missingResult = await invokeAction('contacts.delete', {
      contact_id: uuidv4(),
      confirm: true,
      on_not_found: 'return_false',
    });
    expect(missingResult.deleted).toBe(false);

    const blockedClient = await createClient(db, runtimeState.tenantId, 'Blocked Client');
    const blockedContact = await createContactRaw(db, runtimeState.tenantId, { client_id: blockedClient });
    await createTicket(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId: blockedClient,
      contactId: blockedContact,
    });

    await expect(
      invokeAction('contacts.delete', {
        contact_id: blockedContact,
        confirm: true,
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('T013: each mutating contacts action enforces required permissions', async () => {
    const clientA = await createClient(db, runtimeState.tenantId, 'Perm Client A');
    const clientB = await createClient(db, runtimeState.tenantId, 'Perm Client B');
    const contactA = await createContactRaw(db, runtimeState.tenantId, { client_id: clientA });
    const ticketA = await createTicket(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId: clientA,
      contactId: contactA,
    });
    const interactionTypeId = await getAnyInteractionTypeId(db, runtimeState.tenantId);

    const checks: Array<{ actionId: string; denied: string; input: Record<string, unknown> }> = [
      { actionId: 'contacts.create', denied: 'contact:create', input: { full_name: 'Denied', email: 'denied@example.com' } },
      { actionId: 'contacts.update', denied: 'contact:update', input: { contact_id: contactA, patch: { full_name: 'Denied' } } },
      { actionId: 'contacts.deactivate', denied: 'contact:update', input: { contact_id: contactA } },
      { actionId: 'contacts.delete', denied: 'contact:delete', input: { contact_id: contactA, confirm: true } },
      {
        actionId: 'contacts.duplicate',
        denied: 'contact:read',
        input: { source_contact_id: contactA, email: 'dup.denied@example.com' },
      },
      { actionId: 'contacts.add_tag', denied: 'contact:update', input: { contact_id: contactA, tags: ['x'] } },
      {
        actionId: 'contacts.assign_to_ticket',
        denied: 'ticket:update',
        input: { contact_id: contactA, ticket_id: ticketA },
      },
      { actionId: 'contacts.add_note', denied: 'contact:update', input: { contact_id: contactA, body: 'Denied note' } },
      {
        actionId: 'contacts.add_interaction',
        denied: 'contact:update',
        input: { contact_id: contactA, interaction_type_id: interactionTypeId, title: 'Denied interaction' },
      },
      {
        actionId: 'contacts.add_to_client',
        denied: 'contact:update',
        input: { contact_id: contactA, client_id: clientB },
      },
      {
        actionId: 'contacts.move_to_client',
        denied: 'contact:update',
        input: { contact_id: contactA, target_client_id: clientB },
      },
    ];

    for (const check of checks) {
      runtimeState.deniedPermissions.clear();
      runtimeState.deniedPermissions.add(check.denied);
      await expect(invokeAction(check.actionId, check.input)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    }

    runtimeState.deniedPermissions.clear();
  });

  it('T014: side-effectful contacts actions write audits and create/update/deactivate publish contact events', async () => {
    const clientA = await createClient(db, runtimeState.tenantId, 'Audit Client A');
    const clientB = await createClient(db, runtimeState.tenantId, 'Audit Client B');

    const created = await invokeAction('contacts.create', {
      full_name: 'Audit Contact',
      email: 'audit.contact@example.com',
      client_id: clientA,
    });

    const contactId = created.contact.contact_name_id as string;

    await invokeAction('contacts.update', {
      contact_id: contactId,
      patch: { full_name: 'Audit Contact Updated' },
    });

    await invokeAction('contacts.add_tag', { contact_id: contactId, tags: ['audit-tag'] });

    const ticket = await createTicket(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId: clientA,
      contactId: null,
    });

    await invokeAction('contacts.assign_to_ticket', { contact_id: contactId, ticket_id: ticket });
    await invokeAction('contacts.add_note', { contact_id: contactId, body: 'Audit note body' });

    await getDefaultInteractionStatusId(db, runtimeState.tenantId, runtimeState.actorUserId);

    await invokeAction('contacts.add_interaction', {
      contact_id: contactId,
      interaction_type_id: await getAnyInteractionTypeId(db, runtimeState.tenantId),
      title: 'Audit interaction',
    });

    await invokeAction('contacts.move_to_client', {
      contact_id: contactId,
      target_client_id: clientB,
      expected_current_client_id: clientA,
    });

    await invokeAction('contacts.deactivate', { contact_id: contactId });

    const auditRows = await db('audit_logs')
      .where({ tenant: runtimeState.tenantId, table_name: 'workflow_runs', user_id: runtimeState.actorUserId })
      .whereIn('operation', [
        'workflow_action:contacts.create',
        'workflow_action:contacts.update',
        'workflow_action:contacts.add_tag',
        'workflow_action:contacts.assign_to_ticket',
        'workflow_action:contacts.add_note',
        'workflow_action:contacts.add_interaction',
        'workflow_action:contacts.move_to_client',
        'workflow_action:contacts.deactivate',
      ]);

    const operations = new Set(auditRows.map((row: { operation: string }) => row.operation));
    expect(operations.has('workflow_action:contacts.create')).toBe(true);
    expect(operations.has('workflow_action:contacts.update')).toBe(true);
    expect(operations.has('workflow_action:contacts.deactivate')).toBe(true);

    const eventTypes = runtimeState.publishedEvents.map((event) => event.eventType);
    expect(eventTypes).toContain('CONTACT_CREATED');
    expect(eventTypes).toContain('CONTACT_UPDATED');
    expect(eventTypes).toContain('CONTACT_ARCHIVED');
  });

  it('T014b: contact create/update/deactivate events are published for unassigned contacts', async () => {
    const created = await invokeAction('contacts.create', {
      full_name: 'Unassigned Event Contact',
      email: 'unassigned.event@example.com',
    });

    const contactId = created.contact.contact_name_id as string;
    await invokeAction('contacts.update', {
      contact_id: contactId,
      patch: { full_name: 'Unassigned Event Contact Updated' },
    });
    await invokeAction('contacts.deactivate', { contact_id: contactId });

    const contactEvents = runtimeState.publishedEvents.filter((event) =>
      ['CONTACT_CREATED', 'CONTACT_UPDATED', 'CONTACT_ARCHIVED'].includes(event.eventType)
    );

    expect(contactEvents.map((event) => event.eventType)).toEqual([
      'CONTACT_CREATED',
      'CONTACT_UPDATED',
      'CONTACT_ARCHIVED',
    ]);
    for (const event of contactEvents) {
      expect(event.payload.contactId).toBe(contactId);
      expect(event.payload).not.toHaveProperty('clientId');
    }
  });

  it('T015: contacts.deactivate sets inactive and is idempotent on repeated calls', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Deactivate Client');
    const contactId = await createContactRaw(db, runtimeState.tenantId, { client_id: clientId, is_inactive: false });

    const first = await invokeAction('contacts.deactivate', { contact_id: contactId });
    expect(first.deactivated).toBe(true);
    expect(first.noop).toBe(false);
    expect(first.previous_is_inactive).toBe(false);
    expect(first.current_is_inactive).toBe(true);

    const second = await invokeAction('contacts.deactivate', { contact_id: contactId });
    expect(second.deactivated).toBe(false);
    expect(second.noop).toBe(true);
    expect(second.previous_is_inactive).toBe(true);
    expect(second.current_is_inactive).toBe(true);
  });
});
