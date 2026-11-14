/**
 * T014 (alga-2026-0003209, S12): document lists and tag lists cover only readable records.
 *
 *  - F019: the document list, the folder tree and folder list, folder statistics and the entity-type
 *    filter are computed over documents the subject may read.
 *  - F020: tag lists and tag suggestions are derived only from records the subject may read.
 *
 * Real DB, real kernel, real bundle resolution. Only the session (withAuth / withOptionalAuth), the DB handle
 * and the coarse RBAC grant are stood in for, so every decision under test comes from the bundle rules.
 *
 * Fixture: clients A, B, C. A user narrowed (document:read, tag:read) to A and B. An un-narrowed control user.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../../test-utils/testDataFactory';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';

const ref = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '', user: null as any }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: ref.knex, tenant: ref.tenant })),
  getConnection: vi.fn(async () => ref.knex),
}));
vi.mock('@alga-psa/db/tenant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db/tenant')>()),
  createTenantKnex: vi.fn(async () => ({ knex: ref.knex, tenant: ref.tenant })),
}));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  withAuth: (action: any) => (...args: any[]) => action(ref.user, { tenant: ref.tenant }, ...args),
  withOptionalAuth: (action: any) => (...args: any[]) => action(ref.user, { tenant: ref.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
  getApiKeyUserOverride: () => null,
  getSession: async () => null,
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
}));

import {
  getAllDocuments,
  getDistinctEntityTypes,
  getDocumentsByFolder,
  getFolderStats,
  getFolderTree,
  getFolders,
} from '../../../../../packages/documents/src/actions/documentActions';
import { findAllTagsByType, getAllTags } from '../../../../../packages/tags/src/actions/tagActions';
import { authorizeAndRedactDocuments, resolveDocumentReadScope } from '@shared/lib/documentAuthorization';

const flatten = (nodes: any[]): string[] => nodes.flatMap((node) => [node.path, ...flatten(node.children ?? [])]);
const isDenied = (value: unknown) => Boolean(value && typeof value === 'object' && ('permissionError' in value || 'actionError' in value));

describe('T014: document lists and tag lists cover only readable records', () => {
  let db: Knex;
  let tenant: string;
  const mark = uuidv4().slice(0, 8);
  const ids = {
    clientA: uuidv4(), clientB: uuidv4(), clientC: uuidv4(),
    ticketA: uuidv4(), ticketC: uuidv4(),
    admin: '', narrowed: '', ownerNarrowed: '', control: '',
    doc: {} as Record<string, string>,
    tag: {} as Record<string, string>,
  };

  const insertDocument = async (key: string, folderPath: string | null, associations: Array<[string, string]>, createdBy = ids.admin, size = 10) => {
    const documentId = uuidv4();
    ids.doc[key] = documentId;
    await db('documents').insert({
      tenant, document_id: documentId, document_name: `${key}-${mark}`, user_id: createdBy, created_by: createdBy,
      folder_path: folderPath, file_size: size, is_client_visible: false,
    });
    for (const [entityType, entityId] of associations) {
      await db('document_associations').insert({ tenant, association_id: uuidv4(), document_id: documentId, entity_id: entityId, entity_type: entityType });
    }
  };

  const insertTag = async (key: string, taggedType: string, mappedTo: string[]) => {
    const tagId = uuidv4();
    ids.tag[key] = tagId;
    await db('tag_definitions').insert({ tenant, tag_id: tagId, tag_text: `${key}-${mark}`, tagged_type: taggedType });
    for (const taggedId of mappedTo) {
      await db('tag_mappings').insert({ tenant, mapping_id: uuidv4(), tag_id: tagId, tagged_id: taggedId, tagged_type: taggedType, created_by: ids.admin });
    }
  };

  const bundleFor = async (name: string, targetUser: string, rules: Array<{ resourceType: string; templateKey: string; clients?: string[] }>) => {
    const bundle = await createAuthorizationBundle(db, { tenant, name: `${name}-${mark}`, actorUserId: ids.admin });
    for (const rule of rules) {
      await upsertBundleRule(db, {
        tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId,
        resourceType: rule.resourceType, action: 'read', templateKey: rule.templateKey as any,
        config: rule.clients ? { selectedClientIds: rule.clients } : {}, actorUserId: ids.admin,
      });
    }
    await publishBundleRevision(db as any, { tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: ids.admin });
    await createBundleAssignment(db, { tenant, bundleId: bundle.bundleId, targetType: 'user', targetId: targetUser, actorUserId: ids.admin });
  };

  beforeAll(async () => {
    db = await createTestDbConnection();
    ref.knex = db;
    tenant = await createTenant(db, `Doc tag scope ${mark}`);
    ref.tenant = tenant;
    ids.admin = await createUser(db, tenant, { first_name: 'Ada', last_name: 'Admin' });
    ids.narrowed = await createUser(db, tenant, { user_type: 'internal', first_name: 'Nora', last_name: 'Narrowed' });
    ids.ownerNarrowed = await createUser(db, tenant, { user_type: 'internal', first_name: 'Owen', last_name: 'Owner' });
    ids.control = await createUser(db, tenant, { user_type: 'internal', first_name: 'Uma', last_name: 'Unrestricted' });

    for (const [clientId, name] of [[ids.clientA, 'A'], [ids.clientB, 'B'], [ids.clientC, 'C']] as const) {
      await db('clients').insert({ tenant, client_id: clientId, client_name: `Client ${name} ${mark}`, billing_cycle: 'monthly', is_tax_exempt: false });
    }
    for (const [ticketId, clientId, label] of [[ids.ticketA, ids.clientA, 'A'], [ids.ticketC, ids.clientC, 'C']] as const) {
      await db('tickets').insert({ tenant, ticket_id: ticketId, ticket_number: `T-${mark}-${label}`, title: `Ticket ${label}`, client_id: clientId });
    }

    // Documents. Folder paths are deliberately shared between readable and unreadable documents where it matters.
    await insertDocument('docA', '/A-docs', [['client', ids.clientA]], ids.admin, 100);
    await insertDocument('docTicketA', '/A-docs', [['ticket', ids.ticketA]], ids.admin, 1);
    await insertDocument('docC', '/Shared/C-secret', [['ticket', ids.ticketC]], ids.admin, 1000);
    await insertDocument('docCClient', '/C-only', [['client', ids.clientC]], ids.admin, 10000);
    await insertDocument('docAC', '/Shared/Both', [['client', ids.clientA], ['client', ids.clientC]], ids.admin, 5);
    // C is listed first in the association rows: the answer must not depend on association order.
    await insertDocument('docCA', '/Shared/Both', [['client', ids.clientC], ['client', ids.clientA]], ids.admin, 7);
    await insertDocument('docUser', '/Mine', [['user', ids.ownerNarrowed]], ids.admin, 3);
    await insertDocument('docTeam', '/Mine', [['team', uuidv4()]], ids.admin, 3);
    await insertDocument('docNone', null, [], ids.admin, 3);
    await insertDocument('docCreated', '/Mine', [], ids.ownerNarrowed, 3);

    // Folders. Empty explicit folders: one per entity, one with no entity at all.
    for (const [path, entityType, entityId] of [
      ['/Empty-A', 'client', ids.clientA],
      ['/Empty-C', 'client', ids.clientC],
      ['/Unscoped-empty', null, null],
    ] as const) {
      await db('document_folders').insert({
        tenant, folder_id: uuidv4(), folder_path: path, folder_name: path.slice(1), entity_id: entityId, entity_type: entityType,
        is_client_visible: false, created_by: ids.admin,
      });
    }

    // Tags. Mapped to A's ticket, C's ticket, both, and to kinds that have no client.
    await insertTag('tagA', 'ticket', [ids.ticketA]);
    await insertTag('tagC', 'ticket', [ids.ticketC]);
    await insertTag('tagBoth', 'ticket', [ids.ticketA, ids.ticketC]);
    await insertTag('tagKb', 'knowledge_base_article', [uuidv4()]);
    await insertTag('tagForm', 'workflow_form', [uuidv4()]);
    await insertTag('tagOrphan', 'ticket', []);

    // Narrowed subject: documents and tags limited to A and B. Second subject: documents by ownership only.
    await bundleFor('clients-a-b', ids.narrowed, [
      { resourceType: 'document', templateKey: 'selected_clients', clients: [ids.clientA, ids.clientB] },
      { resourceType: 'tag', templateKey: 'selected_clients', clients: [ids.clientA, ids.clientB] },
    ]);
    await bundleFor('own-or-assigned', ids.ownerNarrowed, [{ resourceType: 'document', templateKey: 'own_or_assigned' }]);
  }, 900_000);

  afterAll(async () => {
    if (!db) return;
    try {
      const { rows } = await db.raw(`SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema = 'public' AND c.column_name = 'tenant'`);
      let pending: string[] = rows.map((r: any) => r.table_name);
      for (let pass = 0; pass < 12 && pending.length; pass++) {
        const blocked: string[] = [];
        for (const table of pending) {
          try { await db.raw('DELETE FROM ?? WHERE tenant = ?::uuid', [table, tenant]); } catch { blocked.push(table); }
        }
        if (blocked.length === pending.length) break;
        pending = blocked;
      }
    } catch {
      // best-effort cleanup of a disposable tenant
    }
    await db.destroy();
  }, 120_000);

  const actAs = (userId: string) => { ref.user = { user_id: userId, user_type: 'internal', tenant, email: `${userId}@example.com` }; };
  const names = (docs: Array<{ document_name: string }>) => docs.map((d) => d.document_name.replace(`-${mark}`, '')).sort();
  const tagTexts = (tags: Array<{ tag_text: string }>) => [...new Set(tags.map((t) => t.tag_text.replace(`-${mark}`, '')))].sort();

  describe('F019 documents', () => {
    it('the narrowed subject lists only documents readable through A or B, including one shared with C', async () => {
      actAs(ids.narrowed);
      const page = await getAllDocuments(undefined, 1, 50) as any;
      expect(names(page.documents)).toEqual(['docA', 'docAC', 'docCA', 'docTicketA']);
      expect(page.totalCount).toBe(4);
    });

    it('lists no document that only reaches C, and none without a client, however the page is cut', async () => {
      actAs(ids.narrowed);
      const first = await getAllDocuments(undefined, 1, 2) as any;
      const second = await getAllDocuments(undefined, 2, 2) as any;
      expect(first.totalCount).toBe(4);
      expect(names([...first.documents, ...second.documents])).toEqual(['docA', 'docAC', 'docCA', 'docTicketA']);
    });

    it('a folder holds only the readable documents, and the count agrees', async () => {
      actAs(ids.narrowed);
      const shared = await getDocumentsByFolder('/Shared', true, 1, 50) as any;
      expect(names(shared.documents)).toEqual(['docAC', 'docCA']);
      expect(shared.total).toBe(2);
    });

    it('folder tree and folder list show readable folders, their ancestors and in-scope entity folders only', async () => {
      actAs(ids.narrowed);
      const tree = await getFolderTree() as any[];
      expect(flatten(tree).sort()).toEqual(['/A-docs', '/Empty-A', '/Shared', '/Shared/Both']);
      expect(await getFolders()).toEqual(['/A-docs', '/Empty-A', '/Shared/Both']);
      // Counts are over readable documents only.
      const shared = tree.find((node) => node.path === '/Shared');
      expect(shared.documentCount).toBe(2);
    });

    it('an entity-scoped tree for the out-of-scope client shows only what is also readable through A or B', async () => {
      actAs(ids.narrowed);
      // C's own documents and C's empty entity folder are gone; the A+C documents stay, as they are readable.
      expect(flatten(await getFolderTree(ids.clientC, 'client') as any[]).sort()).toEqual(['/Shared', '/Shared/Both']);
      expect(flatten(await getFolderTree(ids.clientA, 'client') as any[]).sort()).toEqual(['/A-docs', '/Empty-A', '/Shared', '/Shared/Both']);
    });

    it('folder statistics count and sum only readable documents', async () => {
      actAs(ids.narrowed);
      expect(await getFolderStats('/Shared')).toEqual({ path: '/Shared', documentCount: 2, totalSize: 12 });
      expect(await getFolderStats('/C-only')).toEqual({ path: '/C-only', documentCount: 0, totalSize: 0 });
    });

    it('offers only entity types that readable documents have', async () => {
      actAs(ids.narrowed);
      // docC (ticket C) and docUser (user) are unreadable, so neither type is offered; docTicketA contributes ticket.
      expect(await getDistinctEntityTypes()).toEqual(['client', 'ticket']);
    });

    it('control: an un-narrowed user sees everything, exactly as before', async () => {
      actAs(ids.control);
      const page = await getAllDocuments(undefined, 1, 50) as any;
      expect(page.totalCount).toBe(10);
      expect(flatten(await getFolderTree() as any[]).sort()).toEqual(
        ['/A-docs', '/C-only', '/Empty-A', '/Empty-C', '/Mine', '/Shared', '/Shared/Both', '/Shared/C-secret', '/Unscoped-empty']
      );
      expect(await getFolderStats('/Shared')).toEqual({ path: '/Shared', documentCount: 3, totalSize: 1012 });
      expect(await getDistinctEntityTypes()).toEqual(['client', 'team', 'ticket', 'user']);
    });
  });

  describe('F020 tags', () => {
    it('getAllTags returns only mappings on records the narrowed subject may read', async () => {
      actAs(ids.narrowed);
      const tags = await getAllTags() as any[];
      expect(tagTexts(tags)).toEqual(['tagA', 'tagBoth']);
      // The mapping on C\'s ticket is not revealed, even for a tag that is also on A's.
      expect(tags.map((t) => t.tagged_id)).not.toContain(ids.ticketC);
      expect(tags.filter((t) => t.tag_text.startsWith('tagBoth')).map((t) => t.tagged_id)).toEqual([ids.ticketA]);
    });

    it('suggestions: a tag on A and C is offered, a tag only on C is not, nor orphans or client-less kinds', async () => {
      actAs(ids.narrowed);
      expect(tagTexts(await findAllTagsByType('ticket') as any[])).toEqual(['tagA', 'tagBoth']);
      expect(await findAllTagsByType('knowledge_base_article')).toEqual([]);
      expect(await findAllTagsByType('workflow_form')).toEqual([]);
    });

    it('control: an un-narrowed user sees every tag', async () => {
      actAs(ids.control);
      expect(tagTexts(await getAllTags() as any[])).toEqual(['tagA', 'tagBoth', 'tagC', 'tagForm', 'tagKb']);
      expect(tagTexts(await findAllTagsByType('ticket') as any[])).toEqual(['tagA', 'tagBoth', 'tagC']);
      expect(tagTexts(await findAllTagsByType('knowledge_base_article') as any[])).toEqual(['tagKb']);
    });

    it('no user: the behaviour is unchanged', async () => {
      ref.user = null;
      expect(await getAllTags()).toEqual([]);
    });
  });

  describe('the SQL scope and the record check decide alike', () => {
    const readableBySql = async (userId: string): Promise<string[]> => {
      const user = { user_id: userId, user_type: 'internal', tenant } as any;
      const scope = await resolveDocumentReadScope(db, tenant, user);
      expect(scope).not.toBeNull();
      const query = db('documents as d').where('d.tenant', tenant).select('d.document_id');
      scope!.apply(query, 'd');
      return (await query).map((row: any) => row.document_id).sort();
    };
    const readableByRecord = async (userId: string): Promise<string[]> => {
      const user = { user_id: userId, user_type: 'internal', tenant } as any;
      const all = await db('documents').where({ tenant }).select('document_id', 'created_by', 'is_client_visible');
      const readable = await db.transaction((trx) => authorizeAndRedactDocuments(trx, tenant, user, all as any[]));
      return readable.map((d: any) => d.document_id).sort();
    };

    it.each([
      ['selected_clients on A and B', () => ids.narrowed],
      ['own_or_assigned', () => ids.ownerNarrowed],
    ])('%s: same allow/deny for every document', async (_label, subject) => {
      const userId = subject();
      const bySql = await readableBySql(userId);
      expect(bySql).toEqual(await readableByRecord(userId));
      expect(bySql.length).toBeGreaterThan(0);
    });

    it('the ownership subject reads the document it created and the one it is associated with, nothing else', async () => {
      expect(await readableBySql(ids.ownerNarrowed)).toEqual([ids.doc.docUser, ids.doc.docCreated].sort());
    });

    it('a subject nothing narrows gets no scope: no clause is added', async () => {
      expect(await resolveDocumentReadScope(db, tenant, { user_id: ids.control, user_type: 'internal', tenant } as any)).toBeNull();
    });
  });

  it('is not a denial of the action itself: the narrowed subject may still call every list', async () => {
    actAs(ids.narrowed);
    for (const result of [await getAllDocuments(undefined, 1, 5), await getFolderTree(), await getDistinctEntityTypes()]) {
      expect(isDenied(result)).toBe(false);
    }
  });
});
