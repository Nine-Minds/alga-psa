/**
 * CM L4a deploy-fix: the shared-comment action gate is "admits, else serves", so a customer co_managed
 * workspace (a relationship row, NO entitlement row) can post and reply on its own shared ticket, while
 * FORCE_CAPABILITIES=co-managed:off refuses before any SQL and writes nothing.
 *
 * The capability gate and its co-managed resolvers are REAL (database reads through the admin
 * connection). Stand-ins: the rollout flag provider, the session (withAuth / browser actor), and the
 * shared-work admission, session-expiry, lifecycle and transport seams.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

const mocks = vi.hoisted(() => ({ actor: undefined as any, db: undefined as any, createTenantKnex: vi.fn() }));
vi.mock('@alga-psa/core/features', () => ({ isFeatureFlagEnabled: vi.fn(async () => true) }));
vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn({ user_id: mocks.actor.userId, user_type: 'internal' }, { tenant: mocks.actor.tenant }, ...args), getSession: vi.fn(), getApiKeyUserOverride: vi.fn() }));
vi.mock('../../lib/co-managed/browserActor', () => ({ coManagedBrowserActor: async () => mocks.actor }));
vi.mock('@alga-psa/db', async importOriginal => ({ ...(await importOriginal<any>()), createTenantKnex: async () => { mocks.createTenantKnex(); return { knex: mocks.db }; } }));
const admit = async (db: Knex, actor: any, resource: any, _action: string, work: (context: any) => Promise<unknown>) => {
  const run = (trx: Knex.Transaction) => work({ trx, actor: { tenant: actor.tenant, userId: actor.userId }, sessionId: actor.sessionId, resource, redactedFields: [] });
  return (db as any).isTransaction ? run(db as Knex.Transaction) : db.transaction(run);
};
vi.mock('../../../../packages/co-managed/src/sharedWork', async importOriginal => ({ ...(await importOriginal<any>()), withCoManagedSharedWork: admit }));
vi.mock('../../../../packages/co-managed/src/customerWork', async importOriginal => ({ ...(await importOriginal<any>()), withCoManagedCustomerTicket: admit }));
vi.mock('../../../../packages/co-managed/src/sharedWorkIdentity', async importOriginal => ({ ...(await importOriginal<any>()), assertCoManagedSessionUnexpired: async () => {} }));
vi.mock('@alga-psa/licensing/lifecycle', async importOriginal => ({ ...(await importOriginal<any>()), assertCoManagedOperationalWrite: async () => {} }));
vi.mock('@alga-psa/event-bus/publishers', async importOriginal => ({ ...(await importOriginal<any>()), publishStoredWorkflowEvent: vi.fn(), publishWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/tickets/lib/liveUpdates', async importOriginal => ({ ...(await importOriginal<any>()), publishTicketUpdate: vi.fn() }));

let db: Knex, tenant: string, userId: string, actor: any, resource: any;

beforeAll(async () => {
  db = await createTestDbConnection();
  tenant = await createTenant(db, 'Customer');
  userId = await createUser(db, tenant, { first_name: 'Casey', last_name: 'Owner' });
  const sponsor = await createTenant(db, 'MSP');
  const clientId = uuidv4(), boardId = uuidv4(), statusId = uuidv4(), priorityId = uuidv4(), ticketId = uuidv4(), relationshipId = uuidv4();
  const t = (name: string) => db(name);
  await t('clients').insert({ tenant, client_id: clientId, client_name: 'Acme', billing_cycle: 'monthly', is_tax_exempt: false });
  await t('boards').insert({ tenant, board_id: boardId, board_name: 'Support', is_default: true, is_inactive: false });
  await t('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'High', item_type: 'ticket', color: '#EF4444', order_number: 10, created_by: userId });
  await t('statuses').insert({ tenant, status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket', is_closed: false, is_default: true, order_number: 10, created_by: userId });
  await t('tickets').insert({ tenant, ticket_id: ticketId, ticket_number: `T-${Date.now()}`, title: 'Shared', client_id: clientId, board_id: boardId, status_id: statusId, priority_id: priorityId, entered_by: userId });
  await t('co_management_relationships').insert({ tenant, relationship_id: relationshipId, sponsor_tenant: sponsor, sponsor_client_id: uuidv4() });
  actor = { kind: 'session', tenant, userId, sessionId: uuidv4() };
  mocks.actor = actor;
  mocks.db = db;
  resource = { kind: 'ticket', tenant, relationshipId, id: ticketId };
});
afterAll(async () => { await db?.destroy(); });

afterAll(async () => { await db?.destroy(); });
afterEach(() => { delete process.env.FORCE_CAPABILITIES; });

// The server entry registers the real co-managed resolvers at boot; do the same here (idempotent).
const registerResolvers = async () => (await import('../../../../packages/co-managed/src/capability')).registerCoManagedCapability();
const act = async () => (await import('../../lib/actions/coManagedTicketCommentActions')).createCoManagedTicketCommentAction;
const reset = async () => { await registerResolvers(); (await import('@alga-psa/core/capability/testing')).clearCapabilityCache(); };
const count = async () => Number((await db('comments').where({ tenant, ticket_id: resource.id }).count('* as n').first())!.n);

describe('shared comment action gate (unmocked capability)', () => {
  it('lets a co_managed customer workspace with no entitlement row post a shared_it root and a reply', async () => {
    expect(await db('co_managed_entitlements').where({ tenant })).toHaveLength(0);
    await reset();
    const create = await act();
    const root = await create(resource, { operationId: uuidv4(), audience: 'shared_it', text: 'root' } as any);
    expect(root).toMatchObject({ ok: true });
    const parent = (root as any).receipt;
    const reply = await create(resource, { operationId: uuidv4(), parent: { storeTenant: parent.storeTenant, threadId: parent.threadId, commentId: parent.commentId }, text: 'reply' } as any);
    expect(reply).toMatchObject({ ok: true });
    expect(await db('comments').where({ tenant, ticket_id: resource.id })).toHaveLength(2);
    expect(await db('comment_threads').where({ tenant, thread_id: parent.threadId }).first()).toMatchObject({ collaboration_audience: 'shared_it' });
  });

  it('refuses with CAPABILITY_UNAVAILABLE before any SQL under FORCE_CAPABILITIES=co-managed:off, writing nothing', async () => {
    const before = await count();
    process.env.FORCE_CAPABILITIES = 'co-managed:off';
    await reset();
    mocks.createTenantKnex.mockClear();
    const create = await act();
    await expect(create(resource, { operationId: uuidv4(), audience: 'shared_it', text: 'blocked' } as any)).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
    expect(mocks.createTenantKnex).not.toHaveBeenCalled();
    expect(await count()).toBe(before);
  });

  it('refuses a tenant that neither has an entitlement nor participates', async () => {
    const stranger = await createTenant(db, 'Plain PSA');
    const strangerUser = await createUser(db, stranger, {});
    const previous = mocks.actor;
    mocks.actor = { kind: 'session', tenant: stranger, userId: strangerUser, sessionId: uuidv4() };
    try {
      await reset();
      const create = await act();
      await expect(create(resource, { operationId: uuidv4(), audience: 'shared_it', text: 'nope' } as any)).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
    } finally { mocks.actor = previous; }
  });
});
