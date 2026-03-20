import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import net from 'node:net';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { processInboundEmailInApp } from '@alga-psa/shared/services/email/processInboundEmailInApp';

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

const dbReachable: boolean = await new Promise((resolve) => {
  const host = process.env.DB_HOST || 'localhost';
  const port = Number(process.env.DB_PORT || '5432');
  const socket = net.createConnection({ host, port });
  const done = (value: boolean) => {
    socket.removeAllListeners();
    socket.destroy();
    resolve(value);
  };
  socket.on('connect', () => done(true));
  socket.on('error', () => done(false));
  socket.setTimeout(500, () => done(false));
});
const describeDb = dbReachable ? describe : describe.skip;

let db: Knex;
let tenantId: string;
let boardId: string;
let statusId: string;
let priorityId: string;
let enteredByUserId: string;
let fallbackClientId: string;
let actionRegistry: any;

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(async () => {
    if (!db) throw new Error('Test DB not initialized');
    return db;
  }),
  destroyAdminConnection: vi.fn(async () => {}),
}));

async function createRoutingBoardVariant(namePrefix: string): Promise<string> {
  const sourceBoard = await db('boards')
    .where({ tenant: tenantId, board_id: boardId })
    .first<any>();
  if (!sourceBoard) {
    throw new Error('Expected source board for routing variant');
  }

  const newBoardId = uuidv4();
  const {
    board_id: _sourceBoardId,
    created_at: _sourceCreatedAt,
    updated_at: _sourceUpdatedAt,
    ...sourceRest
  } = sourceBoard;

  await db('boards').insert({
    ...sourceRest,
    board_id: newBoardId,
    board_name: `${namePrefix}-${newBoardId.slice(0, 6)}`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  return newBoardId;
}

async function createInboundDefaults(params: {
  boardId: string;
  descriptionPrefix: string;
  clientId?: string | null;
}): Promise<string> {
  const defaultsId = uuidv4();
  await db('inbound_ticket_defaults').insert({
    id: defaultsId,
    tenant: tenantId,
    short_name: `${params.descriptionPrefix}-${defaultsId.slice(0, 6)}`,
    display_name: `${params.descriptionPrefix}-${defaultsId.slice(0, 6)}`,
    description: `${params.descriptionPrefix} defaults`,
    board_id: params.boardId,
    status_id: statusId,
    priority_id: priorityId,
    client_id: params.clientId ?? null,
    entered_by: enteredByUserId,
    is_active: true,
    is_default: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  return defaultsId;
}

async function createProviderWithDefaults(params: { mailboxPrefix: string }) {
  const providerId = uuidv4();
  const mailbox = `${params.mailboxPrefix}-${uuidv4().slice(0, 6)}@example.com`;
  const providerDefaultsId = await createInboundDefaults({
    boardId,
    descriptionPrefix: `provider-${params.mailboxPrefix}`,
    clientId: fallbackClientId,
  });

  await db('email_providers').insert({
    id: providerId,
    tenant: tenantId,
    provider_type: 'google',
    provider_name: `Provider ${params.mailboxPrefix}`,
    mailbox,
    is_active: true,
    status: 'connected',
    vendor_config: JSON.stringify({}),
    inbound_ticket_defaults_id: providerDefaultsId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  return { providerId, mailbox, providerDefaultsId };
}

function getActionContext() {
  return {
    runId: 'test-run',
    stepPath: '0',
    tenantId,
    idempotencyKey: 'test',
    attempt: 1,
    nowIso: () => new Date().toISOString(),
    env: {},
  } as any;
}

describeDb('resolve_inbound_ticket_context destination routing (integration)', () => {
  const cleanup: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    db = await createTestDbConnection();

    const tenant = await db('tenants').first<{ tenant: string }>('tenant');
    if (!tenant?.tenant) throw new Error('Expected seeded tenant');
    tenantId = tenant.tenant;

    const client = await db('clients').where({ tenant: tenantId }).first<{ client_id: string }>('client_id');
    if (!client?.client_id) throw new Error('Expected seeded client');
    fallbackClientId = client.client_id;

    const board = await db('boards').where({ tenant: tenantId }).first<{ board_id: string }>('board_id');
    if (!board?.board_id) throw new Error('Expected seeded board');
    boardId = board.board_id;

    const status = await db('statuses')
      .where({ tenant: tenantId, status_type: 'ticket' })
      .first<{ status_id: string }>('status_id');
    if (!status?.status_id) throw new Error('Expected seeded ticket status');
    statusId = status.status_id;

    const priority = await db('priorities').where({ tenant: tenantId }).first<{ priority_id: string }>('priority_id');
    if (!priority?.priority_id) throw new Error('Expected seeded priority');
    priorityId = priority.priority_id;

    const user = await db('users').where({ tenant: tenantId }).first<{ user_id: string }>('user_id');
    if (!user?.user_id) throw new Error('Expected seeded user');
    enteredByUserId = user.user_id;

    const { getActionRegistryV2 } = await import('@alga-psa/workflows/runtime');
    const { registerEmailWorkflowActionsV2 } = await import(
      '@alga-psa/workflows/runtime/actions/registerEmailWorkflowActions'
    );
    actionRegistry = getActionRegistryV2();
    if (!actionRegistry.get('resolve_inbound_ticket_context', 1)) {
      registerEmailWorkflowActionsV2();
    }
  }, 180_000);

  afterEach(async () => {
    while (cleanup.length) {
      const fn = cleanup.pop();
      if (fn) await fn();
    }
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('returns contact override destination outcome for exact sender', async () => {
    const action = actionRegistry.get('resolve_inbound_ticket_context', 1);
    if (!action) throw new Error('Expected resolve_inbound_ticket_context@1');

    const { providerId, providerDefaultsId } = await createProviderWithDefaults({ mailboxPrefix: 'ctx-contact-override' });
    cleanup.push(async () => {
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: providerDefaultsId }).delete();
    });

    const overrideBoardId = await createRoutingBoardVariant('ctx-contact-override-board');
    const overrideDefaultsId = await createInboundDefaults({
      boardId: overrideBoardId,
      descriptionPrefix: 'ctx-contact-override',
    });
    cleanup.push(async () => {
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: overrideDefaultsId }).delete();
      await db('boards').where({ tenant: tenantId, board_id: overrideBoardId }).delete();
    });

    const contactClientId = uuidv4();
    const contactId = uuidv4();
    const senderEmail = `ctx-contact-override-${uuidv4().slice(0, 6)}@example.com`;
    await db('clients').insert({
      tenant: tenantId,
      client_id: contactClientId,
      client_name: `Context Contact Override Client ${uuidv4().slice(0, 6)}`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db('contacts').insert({
      tenant: tenantId,
      contact_name_id: contactId,
      full_name: 'Context Contact Override',
      email: senderEmail,
      client_id: contactClientId,
      inbound_ticket_defaults_id: overrideDefaultsId,
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('contacts').where({ tenant: tenantId, contact_name_id: contactId }).delete();
      await db('clients').where({ tenant: tenantId, client_id: contactClientId }).delete();
    });

    const output = await action.handler(
      { tenantId, providerId, senderEmail },
      getActionContext()
    );

    expect(output.ticketDefaults).toBeTruthy();
    expect(output.ticketDefaults.board_id).toBe(overrideBoardId);
    expect(output.targetClientId).toBe(contactClientId);
    expect(output.targetContactId).toBe(contactId);
  });

  it("returns client's destination outcome when exact sender has no contact override", async () => {
    const action = actionRegistry.get('resolve_inbound_ticket_context', 1);
    if (!action) throw new Error('Expected resolve_inbound_ticket_context@1');

    const { providerId, providerDefaultsId } = await createProviderWithDefaults({ mailboxPrefix: 'ctx-client-default' });
    cleanup.push(async () => {
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: providerDefaultsId }).delete();
    });

    const clientDefaultBoardId = await createRoutingBoardVariant('ctx-client-default-board');
    const clientDefaultDefaultsId = await createInboundDefaults({
      boardId: clientDefaultBoardId,
      descriptionPrefix: 'ctx-client-default',
    });
    cleanup.push(async () => {
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: clientDefaultDefaultsId }).delete();
      await db('boards').where({ tenant: tenantId, board_id: clientDefaultBoardId }).delete();
    });

    const destinationClientId = uuidv4();
    const contactId = uuidv4();
    const senderEmail = `ctx-client-default-${uuidv4().slice(0, 6)}@example.com`;
    await db('clients').insert({
      tenant: tenantId,
      client_id: destinationClientId,
      client_name: `Context Client Default ${uuidv4().slice(0, 6)}`,
      inbound_ticket_defaults_id: clientDefaultDefaultsId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db('contacts').insert({
      tenant: tenantId,
      contact_name_id: contactId,
      full_name: 'Context Client Default Contact',
      email: senderEmail,
      client_id: destinationClientId,
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('contacts').where({ tenant: tenantId, contact_name_id: contactId }).delete();
      await db('clients').where({ tenant: tenantId, client_id: destinationClientId }).delete();
    });

    const output = await action.handler(
      { tenantId, providerId, senderEmail },
      getActionContext()
    );

    expect(output.ticketDefaults).toBeTruthy();
    expect(output.ticketDefaults.board_id).toBe(clientDefaultBoardId);
    expect(output.targetClientId).toBe(destinationClientId);
    expect(output.targetContactId).toBe(contactId);
  });

  it('returns domain-matched client destination outcome when sender is unknown contact', async () => {
    const action = actionRegistry.get('resolve_inbound_ticket_context', 1);
    if (!action) throw new Error('Expected resolve_inbound_ticket_context@1');

    const { providerId, providerDefaultsId } = await createProviderWithDefaults({ mailboxPrefix: 'ctx-domain-default' });
    cleanup.push(async () => {
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: providerDefaultsId }).delete();
    });

    const domainDefaultBoardId = await createRoutingBoardVariant('ctx-domain-default-board');
    const domainDefaultDefaultsId = await createInboundDefaults({
      boardId: domainDefaultBoardId,
      descriptionPrefix: 'ctx-domain-default',
    });
    cleanup.push(async () => {
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: domainDefaultDefaultsId }).delete();
      await db('boards').where({ tenant: tenantId, board_id: domainDefaultBoardId }).delete();
    });

    const domainClientId = uuidv4();
    const domain = `ctx-routing-${uuidv4().slice(0, 6)}.com`;
    await db('clients').insert({
      tenant: tenantId,
      client_id: domainClientId,
      client_name: `Context Domain Default Client ${uuidv4().slice(0, 6)}`,
      inbound_ticket_defaults_id: domainDefaultDefaultsId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    const domainMappingId = uuidv4();
    await db('client_inbound_email_domains').insert({
      tenant: tenantId,
      id: domainMappingId,
      client_id: domainClientId,
      domain,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('client_inbound_email_domains').where({ tenant: tenantId, id: domainMappingId }).delete();
      await db('clients').where({ tenant: tenantId, client_id: domainClientId }).delete();
    });

    const output = await action.handler(
      { tenantId, providerId, senderEmail: `unknown@${domain}` },
      getActionContext()
    );

    expect(output.ticketDefaults).toBeTruthy();
    expect(output.ticketDefaults.board_id).toBe(domainDefaultBoardId);
    expect(output.targetClientId).toBe(domainClientId);
    expect(output.targetContactId ?? null).toBeNull();
  });

  it('matches in-app destination selection for the same sender/provider input', async () => {
    const action = actionRegistry.get('resolve_inbound_ticket_context', 1);
    if (!action) throw new Error('Expected resolve_inbound_ticket_context@1');

    const { providerId, mailbox, providerDefaultsId } = await createProviderWithDefaults({ mailboxPrefix: 'ctx-parity' });
    cleanup.push(async () => {
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: providerDefaultsId }).delete();
    });

    const parityBoardId = await createRoutingBoardVariant('ctx-parity-board');
    const parityDefaultsId = await createInboundDefaults({
      boardId: parityBoardId,
      descriptionPrefix: 'ctx-parity',
    });
    cleanup.push(async () => {
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: parityDefaultsId }).delete();
      await db('boards').where({ tenant: tenantId, board_id: parityBoardId }).delete();
    });

    const parityClientId = uuidv4();
    const senderEmail = `ctx-parity-${uuidv4().slice(0, 6)}@example.com`;
    await db('clients').insert({
      tenant: tenantId,
      client_id: parityClientId,
      client_name: `Context Parity Client ${uuidv4().slice(0, 6)}`,
      inbound_ticket_defaults_id: parityDefaultsId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    const contactId = uuidv4();
    await db('contacts').insert({
      tenant: tenantId,
      contact_name_id: contactId,
      full_name: 'Context Parity Contact',
      email: senderEmail,
      client_id: parityClientId,
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await db('contacts').where({ tenant: tenantId, contact_name_id: contactId }).delete();
      await db('clients').where({ tenant: tenantId, client_id: parityClientId }).delete();
    });

    const contextOutput = await action.handler(
      { tenantId, providerId, senderEmail },
      getActionContext()
    );

    const subject = `Context parity subject ${uuidv4().slice(0, 6)}`;
    const inAppResult = await processInboundEmailInApp({
      tenantId,
      providerId,
      emailData: {
        id: `new-email-${uuidv4()}`,
        provider: 'google',
        providerId,
        tenant: tenantId,
        receivedAt: new Date().toISOString(),
        from: { email: senderEmail, name: 'Context Parity Contact' },
        to: [{ email: mailbox, name: 'Support' }],
        subject,
        body: { text: 'Hello', html: undefined },
        attachments: [],
      } as any,
    });

    expect(inAppResult.outcome).toBe('created');

    const ticket = await db('tickets')
      .where({ tenant: tenantId, title: subject })
      .first<any>();
    expect(ticket).toBeDefined();
    expect(contextOutput.ticketDefaults.board_id).toBe(ticket.board_id);
    expect(contextOutput.targetClientId).toBe(ticket.client_id);
    expect(contextOutput.targetContactId ?? null).toBe(ticket.contact_name_id ?? null);

    cleanup.push(async () => {
      await db('comments').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
      await db('tickets').where({ tenant: tenantId, ticket_id: ticket.ticket_id }).delete();
    });
  });
});
