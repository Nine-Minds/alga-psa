import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../../../server/test-utils/dbConfig';
import { createTenant, createUser, createClient, createClientLocation } from '../../../../../server/test-utils/testDataFactory';

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
        nodePath: ctx?.stepPath ?? 'steps.client-action',
        at: new Date().toISOString(),
      };
    },
  };
});

import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerClientActions } from '../businessOperations/clients';

function getAction(actionId: string) {
  const action = getActionRegistryV2().get(actionId, 1);
  if (!action) throw new Error(`Missing action ${actionId}@1`);
  return action;
}

function actionCtx(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    runId: uuidv4(),
    stepPath: 'steps.client-action',
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

async function createTicketForClient(
  db: Knex,
  params: {
    tenantId: string;
    actorUserId: string;
    clientId: string;
    contactId?: string | null;
    locationId?: string | null;
    title?: string;
  }
): Promise<string> {
  const ticketId = uuidv4();
  const statusId = await getTicketStatusId(db, params.tenantId, params.actorUserId);

  await db('tickets').insert({
    ticket_id: ticketId,
    tenant: params.tenantId,
    ticket_number: `WF-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    title: params.title ?? 'Workflow Test Ticket',
    status_id: statusId,
    client_id: params.clientId,
    entered_by: params.actorUserId,
    contact_name_id: params.contactId ?? null,
    location_id: params.locationId ?? null,
  });

  return ticketId;
}

async function createContactForClient(db: Knex, tenantId: string, clientId: string, fullName: string): Promise<string> {
  const contactId = uuidv4();
  await db('contacts').insert({
    tenant: tenantId,
    contact_name_id: contactId,
    full_name: fullName,
    client_id: clientId,
    email: `${contactId.slice(0, 8)}@example.com`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_inactive: false,
  });
  return contactId;
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

describe('client workflow runtime DB-backed action handlers', () => {
  let db: Knex;

  beforeAll(async () => {
    if (!getActionRegistryV2().get('clients.add_interaction', 1)) {
      registerClientActions();
    }

    db = await createTestDbConnection();
    runtimeState.db = db;
  }, 180000);

  beforeEach(async () => {
    const tenantId = await createTenant(db, `Workflow Client Runtime Test ${Date.now()}`);
    const actorUserId = await createUser(db, tenantId, {
      user_type: 'internal',
      first_name: 'Workflow',
      last_name: 'Actor',
    });

    runtimeState.tenantId = tenantId;
    runtimeState.actorUserId = actorUserId;
    runtimeState.deniedPermissions.clear();
  });

  afterAll(async () => {
    await db.destroy();
    runtimeState.db = null;
  });

  it('T004: clients.create creates tenant-scoped client summary and initial tags; actionProvided idempotency uses actionProvidedKey fallback', async () => {
    const action = getAction('clients.create');
    const keyFromContext = action.idempotency.mode === 'actionProvided'
      ? action.idempotency.key({}, actionCtx({ runId: 'run-fixed', stepPath: 'steps.fixed' }) as any)
      : '';

    expect(action.idempotency.mode).toBe('actionProvided');
    expect(keyFromContext).toBe('run:run-fixed:steps.fixed');

    const result = await invokeAction('clients.create', {
      client_name: 'Workflow Created Client',
      tags: ['vip', 'automation'],
    });

    expect(result.client.client_id).toBeTruthy();
    expect(result.client.client_name).toBe('Workflow Created Client');
    expect(result.tags.map((tag: { tag_text: string }) => tag.tag_text).sort()).toEqual(['automation', 'vip']);

    const client = await db('clients')
      .where({ tenant: runtimeState.tenantId, client_id: result.client.client_id })
      .first();
    expect(client).toBeTruthy();

    const mappings = await db('tag_mappings as tm')
      .join('tag_definitions as td', function joinTagDefs() {
        this.on('tm.tenant', 'td.tenant').andOn('tm.tag_id', 'td.tag_id');
      })
      .where({
        'tm.tenant': runtimeState.tenantId,
        'tm.tagged_type': 'client',
        'tm.tagged_id': result.client.client_id,
      })
      .select('td.tag_text');

    expect(mappings.map((row: { tag_text: string }) => row.tag_text).sort()).toEqual(['automation', 'vip']);
  });

  it('T005: clients.update applies patch and rejects cross-tenant client id as not found', async () => {
    const ownClientId = await createClient(db, runtimeState.tenantId, 'Own Client');

    const updated = await invokeAction('clients.update', {
      client_id: ownClientId,
      patch: {
        client_name: 'Own Client Updated',
        notes: 'Patched by workflow',
      },
    });

    expect(updated.client_after.client_name).toBe('Own Client Updated');
    expect(updated.changed_fields).toEqual(expect.arrayContaining(['client_name', 'notes']));

    const otherTenantId = await createTenant(db, `Other Tenant ${Date.now()}`);
    const otherClientId = await createClient(db, otherTenantId, 'Other Client');

    await expect(
      invokeAction('clients.update', {
        client_id: otherClientId,
        patch: { client_name: 'Should Fail' },
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('T006: clients.delete requires confirm=true, deletes a dependency-free client, blocks default client and dependency-backed client', async () => {
    const deletableClientId = await createClient(db, runtimeState.tenantId, 'Delete Me');

    await expect(
      invokeAction('clients.delete', {
        client_id: deletableClientId,
        confirm: false,
      })
    ).rejects.toThrow();

    const deleted = await invokeAction('clients.delete', {
      client_id: deletableClientId,
      confirm: true,
    });

    expect(deleted).toEqual({ deleted: true, client_id: deletableClientId });
    const afterDelete = await db('clients').where({ tenant: runtimeState.tenantId, client_id: deletableClientId }).first();
    expect(afterDelete).toBeFalsy();

    const defaultClientId = await createClient(db, runtimeState.tenantId, 'Default Client Guard');
    await db('tenant_companies').insert({
      tenant: runtimeState.tenantId,
      client_id: defaultClientId,
      is_default: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await expect(
      invokeAction('clients.delete', {
        client_id: defaultClientId,
        confirm: true,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const blockedClientId = await createClient(db, runtimeState.tenantId, 'Blocked Client');
    await createTicketForClient(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId: blockedClientId,
      title: 'Dependency Ticket',
    });

    await expect(
      invokeAction('clients.delete', {
        client_id: blockedClientId,
        confirm: true,
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('T007: clients.duplicate copies safe fields/tags, copies locations only when requested, and does not copy contacts', async () => {
    const sourceClientId = await createClient(db, runtimeState.tenantId, 'Source Client', {
      billing_email: 'billing@example.com',
      notes: 'Source notes',
      url: 'https://example.com',
    });

    await invokeAction('clients.add_tag', { client_id: sourceClientId, tags: ['gold', 'managed'] });
    await createClientLocation(db, sourceClientId, runtimeState.tenantId, {
      location_name: 'HQ',
      city: 'Seattle',
      address_line1: '123 Main',
    } as any);
    await createContactForClient(db, runtimeState.tenantId, sourceClientId, 'Source Contact');

    const noLocations = await invokeAction('clients.duplicate', {
      source_client_id: sourceClientId,
      client_name: 'Source Clone No Locations',
      copy_tags: true,
      copy_locations: false,
    });

    expect(noLocations.duplicate_client.client_name).toBe('Source Clone No Locations');
    expect(noLocations.copied_tags).toBeGreaterThanOrEqual(2);
    expect(noLocations.copied_locations).toBe(0);

    const cloneIdA = noLocations.duplicate_client.client_id;
    const cloneALocations = await db('client_locations').where({ tenant: runtimeState.tenantId, client_id: cloneIdA });
    const cloneAContacts = await db('contacts').where({ tenant: runtimeState.tenantId, client_id: cloneIdA });
    expect(cloneALocations.length).toBe(0);
    expect(cloneAContacts.length).toBe(0);

    const withLocations = await invokeAction('clients.duplicate', {
      source_client_id: sourceClientId,
      client_name: 'Source Clone With Locations',
      copy_tags: true,
      copy_locations: true,
    });

    const cloneIdB = withLocations.duplicate_client.client_id;
    const cloneBLocations = await db('client_locations').where({ tenant: runtimeState.tenantId, client_id: cloneIdB });
    const cloneBContacts = await db('contacts').where({ tenant: runtimeState.tenantId, client_id: cloneIdB });

    expect(withLocations.copied_locations).toBeGreaterThanOrEqual(1);
    expect(cloneBLocations.length).toBeGreaterThanOrEqual(1);
    expect(cloneBContacts.length).toBe(0);

    const cloneTagTexts = await db('tag_mappings as tm')
      .join('tag_definitions as td', function joinTagDefs() {
        this.on('tm.tenant', 'td.tenant').andOn('tm.tag_id', 'td.tag_id');
      })
      .where({
        'tm.tenant': runtimeState.tenantId,
        'tm.tagged_type': 'client',
        'tm.tagged_id': cloneIdB,
      })
      .select('td.tag_text');

    expect(cloneTagTexts.map((row: { tag_text: string }) => row.tag_text).sort()).toEqual(['gold', 'managed']);
  });

  it('T008: clients.add_tag creates missing definitions and no-ops duplicate mappings', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Tag Target');

    const first = await invokeAction('clients.add_tag', { client_id: clientId, tags: ['priority', 'managed'] });
    expect(first.added_count).toBe(2);
    expect(first.existing_count).toBe(0);

    const second = await invokeAction('clients.add_tag', { client_id: clientId, tags: ['priority'] });
    expect(second.added_count).toBe(0);
    expect(second.existing_count).toBe(1);

    const mappings = await db('tag_mappings as tm')
      .join('tag_definitions as td', function joinTagDefs() {
        this.on('tm.tenant', 'td.tenant').andOn('tm.tag_id', 'td.tag_id');
      })
      .where({
        'tm.tenant': runtimeState.tenantId,
        'tm.tagged_type': 'client',
        'tm.tagged_id': clientId,
      })
      .select('td.tag_text');

    expect(mappings.map((row: { tag_text: string }) => row.tag_text).sort()).toEqual(['managed', 'priority']);
    expect(mappings.length).toBe(2);
  });

  it('T009/T010: clients.assign_to_ticket preserves omitted fields, supports explicit null clears, and rejects invalid contact/location ownership', async () => {
    const clientA = await createClient(db, runtimeState.tenantId, 'Client A');
    const clientB = await createClient(db, runtimeState.tenantId, 'Client B');

    const contactA = await createContactForClient(db, runtimeState.tenantId, clientA, 'Contact A');
    const locationA = await createClientLocation(db, clientA, runtimeState.tenantId, {
      location_name: 'A-HQ',
      city: 'Austin',
    } as any);

    const ticketId = await createTicketForClient(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId: clientA,
      contactId: contactA,
      locationId: locationA,
    });

    const preserved = await invokeAction('clients.assign_to_ticket', {
      client_id: clientB,
      ticket_id: ticketId,
    });

    expect(preserved.previous_client_id).toBe(clientA);
    expect(preserved.current_client_id).toBe(clientB);
    expect(preserved.previous_contact_id).toBe(contactA);
    expect(preserved.current_contact_id).toBe(contactA);
    expect(preserved.previous_location_id).toBe(locationA);
    expect(preserved.current_location_id).toBe(locationA);

    const cleared = await invokeAction('clients.assign_to_ticket', {
      client_id: clientB,
      ticket_id: ticketId,
      contact_id: null,
      location_id: null,
    });

    expect(cleared.current_contact_id).toBeNull();
    expect(cleared.current_location_id).toBeNull();

    const invalidContact = await createContactForClient(db, runtimeState.tenantId, clientA, 'Wrong Contact');
    await expect(
      invokeAction('clients.assign_to_ticket', {
        client_id: clientB,
        ticket_id: ticketId,
        contact_id: invalidContact,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const invalidLocation = await createClientLocation(db, clientA, runtimeState.tenantId, {
      location_name: 'Wrong Location',
      city: 'Portland',
    } as any);

    await expect(
      invokeAction('clients.assign_to_ticket', {
        client_id: clientB,
        ticket_id: ticketId,
        location_id: invalidLocation,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('T011: clients.add_note creates notes document when missing and appends to existing document', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Note Target');

    const first = await invokeAction('clients.add_note', {
      client_id: clientId,
      body: 'First workflow note',
    });

    expect(first.created_document).toBe(true);
    expect(first.document_id).toBeTruthy();

    const second = await invokeAction('clients.add_note', {
      client_id: clientId,
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
  });

  it('T012: clients.add_interaction logs interaction, uses default status, validates contact/ticket relationships, and returns summary', async () => {
    const clientA = await createClient(db, runtimeState.tenantId, 'Interaction Client A');
    const clientB = await createClient(db, runtimeState.tenantId, 'Interaction Client B');

    const contactA = await createContactForClient(db, runtimeState.tenantId, clientA, 'Interaction Contact');
    const ticketA = await createTicketForClient(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId: clientA,
      contactId: contactA,
    });
    const ticketB = await createTicketForClient(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId: clientB,
    });

    const typeId = await getAnyInteractionTypeId(db, runtimeState.tenantId);
    const defaultStatusId = await getDefaultInteractionStatusId(db, runtimeState.tenantId, runtimeState.actorUserId);

    const result = await invokeAction('clients.add_interaction', {
      client_id: clientA,
      type_id: typeId,
      title: 'Workflow Logged Interaction',
      contact_id: contactA,
      ticket_id: ticketA,
      notes: 'Call summary',
    });

    expect(result.client_id).toBe(clientA);
    expect(result.contact_id).toBe(contactA);
    expect(result.ticket_id).toBe(ticketA);
    expect(result.status_id).toBe(defaultStatusId);
    expect(result.user_id).toBe(runtimeState.actorUserId);

    const stored = await db('interactions')
      .where({ tenant: runtimeState.tenantId, interaction_id: result.interaction_id })
      .first();
    expect(stored).toBeTruthy();

    await expect(
      invokeAction('clients.add_interaction', {
        client_id: clientA,
        type_id: typeId,
        title: 'Invalid Ticket Relationship',
        ticket_id: ticketB,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('T013: each mutating client action returns PERMISSION_DENIED when required permission is missing', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Permission Client');
    const targetClientId = await createClient(db, runtimeState.tenantId, 'Permission Target');
    const contactId = await createContactForClient(db, runtimeState.tenantId, clientId, 'Permission Contact');
    const locationId = await createClientLocation(db, clientId, runtimeState.tenantId, { location_name: 'Permission HQ' } as any);
    const ticketId = await createTicketForClient(db, {
      tenantId: runtimeState.tenantId,
      actorUserId: runtimeState.actorUserId,
      clientId,
      contactId,
      locationId,
    });
    const interactionTypeId = await getAnyInteractionTypeId(db, runtimeState.tenantId);

    const checks: Array<{ actionId: string; denied: string; input: Record<string, unknown> }> = [
      { actionId: 'clients.create', denied: 'client:create', input: { client_name: 'Denied Create' } },
      { actionId: 'clients.update', denied: 'client:update', input: { client_id: clientId, patch: { notes: 'Denied' } } },
      { actionId: 'clients.archive', denied: 'client:update', input: { client_id: clientId } },
      { actionId: 'clients.delete', denied: 'client:delete', input: { client_id: clientId, confirm: true } },
      {
        actionId: 'clients.duplicate',
        denied: 'client:read',
        input: { source_client_id: clientId, client_name: 'Denied Duplicate', copy_tags: true, copy_locations: false },
      },
      { actionId: 'clients.add_tag', denied: 'client:update', input: { client_id: clientId, tags: ['x'] } },
      {
        actionId: 'clients.assign_to_ticket',
        denied: 'client:read',
        input: { client_id: targetClientId, ticket_id: ticketId },
      },
      { actionId: 'clients.add_note', denied: 'client:update', input: { client_id: clientId, body: 'Denied note' } },
      {
        actionId: 'clients.add_interaction',
        denied: 'client:update',
        input: { client_id: clientId, type_id: interactionTypeId, title: 'Denied interaction' },
      },
    ];

    for (const check of checks) {
      runtimeState.deniedPermissions.clear();
      runtimeState.deniedPermissions.add(check.denied);
      await expect(invokeAction(check.actionId, check.input)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    }

    runtimeState.deniedPermissions.clear();
  });

  it('T015: clients.archive sets inactive + deactivates contacts/client users and no-ops already inactive', async () => {
    const clientId = await createClient(db, runtimeState.tenantId, 'Archive Target');
    const contactId = await createContactForClient(db, runtimeState.tenantId, clientId, 'Client Contact');

    const clientUserId = await createUser(db, runtimeState.tenantId, {
      user_type: 'client',
      contact_id: contactId,
      is_inactive: false,
    });

    const first = await invokeAction('clients.archive', { client_id: clientId });
    expect(first.archived).toBe(true);
    expect(first.previous_is_inactive).toBe(false);
    expect(first.current_is_inactive).toBe(true);

    const archivedClient = await db('clients').where({ tenant: runtimeState.tenantId, client_id: clientId }).first();
    const archivedContact = await db('contacts').where({ tenant: runtimeState.tenantId, contact_name_id: contactId }).first();
    const archivedClientUser = await db('users').where({ tenant: runtimeState.tenantId, user_id: clientUserId }).first();

    expect(Boolean(archivedClient?.is_inactive)).toBe(true);
    expect(Boolean(archivedContact?.is_inactive)).toBe(true);
    expect(Boolean(archivedClientUser?.is_inactive)).toBe(true);

    const second = await invokeAction('clients.archive', { client_id: clientId });
    expect(second.archived).toBe(false);
    expect(second.previous_is_inactive).toBe(true);
    expect(second.current_is_inactive).toBe(true);
  });
});
