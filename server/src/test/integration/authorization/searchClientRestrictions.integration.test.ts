/**
 * T018 (S17, F028-F031): app search respects client and board restrictions.
 *
 * Seeds three clients, each with a contact, an interaction, a ticket (on its own board), a document
 * and a time entry, plus legacy (unscoped) index rows for all of them. Then:
 *  - the per-tenant re-index fills client_scope_id from the tenant table manifest,
 *  - a subject whose bundle restricts clients to two of the three searches through the real
 *    runAppSearch (resolveClientAccess -> ACL predicate -> per-row verifiers) and never gets the third client's records,
 *  - a subject whose bundle restricts ticket boards gets tickets of those boards only,
 *  - strict-type records with no client scope are hidden from narrowed subjects and shown to unrestricted ones,
 *  - a second re-index run changes nothing.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { TestContext } from '../../../../test-utils/testContext';
import { createClient, createUser } from '../../../../test-utils/testDataFactory';

const dbMocks = vi.hoisted(() => ({ knex: undefined as unknown }));

// The re-index job opens its own tenant connection; in the test it must be the suite database.
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return { ...actual, createTenantKnex: async () => ({ knex: dbMocks.knex, tenant: undefined }) };
});

import { runWithTenant, tenantDb } from '@alga-psa/db';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';
import { resolveClientAccess, runAppSearch } from '@alga-psa/search/runAppSearch';
import { getIndexer } from '@alga-psa/search';
import { upsertSearchDoc } from '@alga-psa/search/upsert';
import type { IUserWithRoles, SearchObjectType } from '@alga-psa/types';
import { searchClientScopeReindexHandler } from '../../../lib/jobs/handlers/searchClientScopeReindexHandler';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 900_000;
const TERM = 'zorblaxsearchterm';

const SEARCH_PERMISSIONS = [
  ['client', 'read'],
  ['contact', 'read'],
  ['ticket', 'read'],
  ['interaction', 'read'],
  ['document', 'read'],
  ['time', 'read'],
] as const;
const ALL_TYPES: SearchObjectType[] = ['client', 'contact', 'ticket', 'interaction', 'document', 'time_entry'];
const CLIENT_RESOURCES = ['client', 'contact', 'ticket', 'interaction', 'document', 'time_entry', 'project', 'asset'];

interface Seeded {
  clientId: string;
  boardId: string;
  contactId: string;
  ticketId: string;
  interactionId: string;
  documentId: string;
  timeEntryId: string;
}

describe('search respects client and board restrictions (T018)', () => {
  let ctx: TestContext;
  let db: Knex;
  let tenant: string;
  let a: Seeded;
  let b: Seeded;
  let c: Seeded;
  let orphanDocumentId: string;
  let restrictedUser: IUserWithRoles;
  let boardUser: IUserWithRoles;
  let unrestrictedUser: IUserWithRoles;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: [
        'authorization_bundle_assignments',
        'authorization_bundle_rules',
        'authorization_bundle_revisions',
        'authorization_bundles',
        'user_roles',
        'role_permissions',
        'roles',
        'permissions',
      ],
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    db = ctx.db;
    dbMocks.knex = db;
    tenant = ctx.tenantId;
    await seed();
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  const table = (name: string) => tenantDb(db, tenant).table(name);
  const insertRow = (name: string, row: Record<string, unknown>) => db(name).insert({ tenant, ...row });

  async function seedClientRecords(label: string, timeEntryOwnerId: string): Promise<Seeded> {
    const clientId = await createClient(db, tenant, `${TERM} ${label} client`);
    const boardId = randomUUID();
    await insertRow('boards', { board_id: boardId, board_name: `${label} board` });
    const contactId = randomUUID();
    await insertRow('contacts', { contact_name_id: contactId, full_name: `${TERM} ${label} contact`, client_id: clientId });
    const ticketId = randomUUID();
    await insertRow('tickets', {
      ticket_id: ticketId,
      ticket_number: `S17-${label}-${randomUUID().slice(0, 6)}`,
      title: `${TERM} ${label} ticket`,
      client_id: clientId,
      board_id: boardId,
    });
    const typeId = randomUUID();
    await insertRow('interaction_types', { type_id: typeId, type_name: `Call ${label} ${typeId.slice(0, 6)}` });
    const interactionId = randomUUID();
    await insertRow('interactions', {
      interaction_id: interactionId,
      type_id: typeId,
      user_id: ctx.user.user_id,
      client_id: clientId,
      title: `${TERM} ${label} interaction`,
    });
    const documentId = randomUUID();
    await insertRow('documents', {
      document_id: documentId,
      document_name: `${TERM} ${label} document`,
      user_id: ctx.user.user_id,
      created_by: ctx.user.user_id,
    });
    await insertRow('document_associations', {
      association_id: randomUUID(),
      document_id: documentId,
      entity_id: clientId,
      entity_type: 'client',
    });
    const timeEntryId = randomUUID();
    await insertRow('time_entries', {
      entry_id: timeEntryId,
      // Time-entry search rows are visible to their owner only, so the narrowed subject owns them:
      // what hides the third client's entry from that subject is the client scope, not ownership.
      user_id: timeEntryOwnerId,
      work_item_id: ticketId,
      work_item_type: 'ticket',
      start_time: new Date('2026-01-05T09:00:00Z'),
      end_time: new Date('2026-01-05T10:00:00Z'),
      work_date: '2026-01-05',
      work_timezone: 'UTC',
      notes: `${TERM} ${label} time entry`,
    });
    return { clientId, boardId, contactId, ticketId, interactionId, documentId, timeEntryId };
  }

  /** A pre-S17 index row: the indexer's document with no client scope. */
  async function indexAsLegacy(objectType: SearchObjectType, objectId: string): Promise<void> {
    const indexer = getIndexer(objectType)!;
    const doc = await indexer.loadOne(db, tenant, objectId);
    expect(doc, `${objectType} ${objectId} indexes`).not.toBeNull();
    // Tickets already carry their scope in the indexer; clear it to stand in for a row written before S17.
    await upsertSearchDoc(db, { ...doc!, acl: { ...doc!.acl, clientScopeId: undefined } });
  }

  async function seedUser(label: string): Promise<IUserWithRoles> {
    const userId = await createUser(db, tenant, { first_name: label });
    const roleId = randomUUID();
    await insertRow('roles', { role_id: roleId, role_name: `${label}-search-role`, msp: true, client: false });
    for (const [resource, action] of SEARCH_PERMISSIONS) {
      const permissionId = randomUUID();
      await insertRow('permissions', { permission_id: permissionId, resource, action, msp: true, client: false });
      await insertRow('role_permissions', { role_id: roleId, permission_id: permissionId });
    }
    await insertRow('user_roles', { user_id: userId, role_id: roleId });
    const row = await table('users').where({ user_id: userId }).first();
    return { ...row, roles: [{ role_id: roleId }] } as unknown as IUserWithRoles;
  }

  async function restrictUser(
    user: IUserWithRoles,
    rules: Array<{ resourceType: string; templateKey: string; config: Record<string, unknown> }>,
  ): Promise<void> {
    const created = await createAuthorizationBundle(db, { tenant, name: `S17-${randomUUID()}`, actorUserId: ctx.user.user_id });
    for (const rule of rules) {
      await upsertBundleRule(db, {
        tenant,
        bundleId: created.bundleId,
        revisionId: created.revisionId,
        action: 'read',
        actorUserId: ctx.user.user_id,
        ...rule,
      });
    }
    await publishBundleRevision(db as any, { tenant, bundleId: created.bundleId, revisionId: created.revisionId, actorUserId: ctx.user.user_id });
    await createBundleAssignment(db, { tenant, bundleId: created.bundleId, targetType: 'user', targetId: user.user_id, actorUserId: ctx.user.user_id });
  }

  async function seed(): Promise<void> {
    restrictedUser = await seedUser('restricted');
    boardUser = await seedUser('boards');
    unrestrictedUser = await seedUser('unrestricted');
    a = await seedClientRecords('alpha', restrictedUser.user_id);
    b = await seedClientRecords('bravo', restrictedUser.user_id);
    c = await seedClientRecords('charlie', restrictedUser.user_id);

    // A document nobody linked to a client: a strict type with no client scope.
    orphanDocumentId = randomUUID();
    await insertRow('documents', {
      document_id: orphanDocumentId,
      document_name: `${TERM} orphan document`,
      user_id: ctx.user.user_id,
      created_by: ctx.user.user_id,
    });

    for (const s of [a, b, c]) {
      await indexAsLegacy('client', s.clientId);
      await indexAsLegacy('contact', s.contactId);
      await indexAsLegacy('ticket', s.ticketId);
      await indexAsLegacy('interaction', s.interactionId);
      await indexAsLegacy('document', s.documentId);
      await indexAsLegacy('time_entry', s.timeEntryId);
    }
    await indexAsLegacy('document', orphanDocumentId);

    await restrictUser(
      restrictedUser,
      CLIENT_RESOURCES.map((resourceType) => ({
        resourceType,
        templateKey: 'selected_clients',
        config: { selectedClientIds: [a.clientId, b.clientId] },
      })),
    );
    await restrictUser(boardUser, [
      { resourceType: 'ticket', templateKey: 'selected_boards', config: { selectedBoardIds: [a.boardId] } },
    ]);
  }

  const search = (user: IUserWithRoles) =>
    runWithTenant(tenant, () => runAppSearch(db, tenant, user, { query: TERM, types: ALL_TYPES, limit: 100 } as any));

  const idsOf = async (user: IUserWithRoles) => new Set((await search(user)).results.map((row) => row.id));

  const scopes = async () =>
    (await table('app_search_index').select('object_type', 'object_id', 'client_scope_id').orderBy('object_id'))
      .map((row: any) => `${row.object_type}:${row.object_id}:${row.client_scope_id ?? 'null'}`);

  const reindex = () => runWithTenant(tenant, () => searchClientScopeReindexHandler({ tenantId: tenant, batchSize: 2 }));

  const everythingOf = (s: Seeded) => [s.clientId, s.contactId, s.ticketId, s.interactionId, s.documentId, s.timeEntryId];

  it('fills client scope on existing rows, and a second run changes nothing', async () => {
    const before = await scopes();
    expect(before.every((row) => row.endsWith(':null'))).toBe(true);

    await reindex();
    const once = await scopes();
    for (const s of [a, b, c]) {
      for (const [type, id] of [
        ['client', s.clientId],
        ['contact', s.contactId],
        ['ticket', s.ticketId],
        ['interaction', s.interactionId],
        ['document', s.documentId],
        ['time_entry', s.timeEntryId],
      ] as const) {
        // Tickets were scoped by their indexer before S17; the legacy rows above cleared it, but the job only owns the five new types.
        if (type === 'ticket') continue;
        expect(once).toContain(`${type}:${id}:${s.clientId}`);
      }
    }
    expect(once).toContain(`document:${orphanDocumentId}:null`);

    await reindex();
    expect(await scopes()).toEqual(once);
  }, HOOK_TIMEOUT);

  it('a subject restricted to two clients never gets a record of the third', async () => {
    await reindex();
    // Tickets keep their own indexer's scope; re-run it the way a live TICKET_UPDATED event would.
    for (const s of [a, b, c]) {
      const doc = await getIndexer('ticket')!.loadOne(db, tenant, s.ticketId);
      await upsertSearchDoc(db, doc!);
    }

    const seen = await idsOf(restrictedUser);
    for (const id of [...everythingOf(a), ...everythingOf(b)]) expect(seen.has(id), `visible ${id}`).toBe(true);
    for (const id of everythingOf(c)) expect(seen.has(id), `hidden ${id}`).toBe(false);

    const result = await search(restrictedUser);
    // Counts agree with the page: nothing of client three is counted either.
    expect(result.totalCount).toBe(result.results.length);

    // The second run of the job leaves the narrowed subject's results as they were.
    await reindex();
    expect(await idsOf(restrictedUser)).toEqual(seen);
  }, HOOK_TIMEOUT);

  it('a subject restricted to selected boards gets tickets of those boards only', async () => {
    await reindex();
    for (const s of [a, b, c]) {
      const doc = await getIndexer('ticket')!.loadOne(db, tenant, s.ticketId);
      await upsertSearchDoc(db, doc!);
    }

    const seen = await idsOf(boardUser);
    expect(seen.has(a.ticketId)).toBe(true);
    expect(seen.has(b.ticketId)).toBe(false);
    expect(seen.has(c.ticketId)).toBe(false);
    // The board restriction names tickets only: other types stay visible to this subject.
    expect(seen.has(c.contactId)).toBe(true);
  }, HOOK_TIMEOUT);

  it('hides strict-type records with no client scope from narrowed subjects, not from unrestricted ones', async () => {
    await reindex();

    expect((await idsOf(unrestrictedUser)).has(orphanDocumentId)).toBe(true);
    expect((await idsOf(restrictedUser)).has(orphanDocumentId)).toBe(false);

    // Before the job has run, the same holds for every unscoped row: narrowed subjects see none of them.
    await table('app_search_index').whereIn('object_type', ['client', 'contact', 'interaction', 'document', 'time_entry']).update({ client_scope_id: null });
    const narrowed = await idsOf(restrictedUser);
    for (const s of [a, b, c]) for (const id of [s.clientId, s.contactId, s.interactionId, s.documentId, s.timeEntryId]) {
      expect(narrowed.has(id), `unscoped ${id}`).toBe(false);
    }
    const unrestricted = await idsOf(unrestrictedUser);
    for (const s of [a, b, c]) expect(unrestricted.has(s.documentId)).toBe(true);
  }, HOOK_TIMEOUT);

  it('leaves unrestricted users on the all mode with one probe query and no clients scan', async () => {
    // A tenant that uses no bundle at all.
    await table('authorization_bundle_assignments').del();

    const statements: string[] = [];
    const record = (query: { sql: string }) => statements.push(query.sql);
    db.on('query', record);
    try {
      expect(await runWithTenant(tenant, () => resolveClientAccess(db, tenant, restrictedUser))).toEqual({ mode: 'all' });
    } finally {
      db.removeListener('query', record);
    }
    expect(statements).toHaveLength(1);
    expect(statements[0]).not.toMatch(/from "clients"/i);
  }, HOOK_TIMEOUT);
});
