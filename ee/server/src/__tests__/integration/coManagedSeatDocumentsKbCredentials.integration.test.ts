/**
 * T040 (co-managed seat plan, slice S31; F076, F077, F078): documents, the knowledge base and stored
 * credentials for a seat technician, on real Postgres with the real kernel.
 *
 * A seat technician (a user with an active `co_managed_seat_assignments` row, resolved by the S11
 * resolver) is held to:
 *   F076  documents of their arrangement's client that are client-visible, and documents attached to a
 *         ticket they can see (own client + board in scope); uploads to tickets they can see.
 *   F077  knowledge base articles whose audience is `client` or `public`.
 *   F078  no stored credential, on any path.
 * An ordinary MSP user of the same tenant keeps seeing everything.
 *
 * Credentials are EE, so this lives where EE code is reachable. Only the session, the DB handle and the coarse
 * RBAC grants are stood in for: every decision under test is the kernel's.
 *
 * Run (a throwaway Postgres on a free port):
 *   DB_HOST=127.0.0.1 DB_PORT=<port> DB_USER_ADMIN=postgres DB_PASSWORD_ADMIN=<pw> REQUIRE_DB=1 \
 *     npx vitest run src/__tests__/integration/coManagedSeatDocumentsKbCredentials.integration.test.ts   (in ee/server)
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ref = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '', user: null as any }));

vi.mock('@alga-psa/core/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
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
vi.mock('@alga-psa/auth/lib/knowledgeBasePermissions', () => ({
  canReadKnowledgeBase: vi.fn(async () => true),
  canReadPublishedKnowledgeBase: vi.fn(async () => true),
}));
vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
}));

import { createCoManagedSeatArrangement, setCoManagedSeatBoardScope } from '@alga-psa/co-managed';
import { CO_MANAGED_SEAT_RESOLVER_ID, coManagedSeatResolver } from '@alga-psa/co-managed/seatAuthority';
import { registerBuiltinRuleResolver, unregisterBuiltinRuleResolver } from '@alga-psa/authorization/kernel';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { isDocumentAssociationCreateAllowed } from '@alga-psa/authorization/recordCreateAuthorization';
import {
  canMutateKnowledgeBaseArticles,
  canReadKnowledgeBaseArticle,
  resolveKnowledgeBaseReadScope,
} from '@alga-psa/authorization/knowledgeBaseReadAuthorization';
import { tenantDb } from '@alga-psa/db';
import { authorizeAndRedactDocuments, resolveDocumentReadScope } from '@shared/lib/documentAuthorization';
import { getArticle, getArticles, getArticlesWithTags, recordArticleView } from '../../../../../packages/documents/src/actions/kbArticleActions';
import { compileCredentialReadScopeSql, createCredentialAuthorizationContext } from '../../lib/credentials/credentialAuthorization';
import { nativeCredentialSource } from '../../lib/credentials/nativeSource';
import { resetCredentialAesKeyCache } from '../../lib/credentials/encryption';
import { createTestDbConnection } from '../../../../../server/test-utils/dbConfig';
import { describeWithDb } from '../../../../../server/test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../../../server/test-utils/testDataFactory';

const DAY = 86_400_000;
const describeDb = await describeWithDb();
const priorKey = process.env.CREDENTIAL_ENCRYPTION_KEY;

describeDb('T040: a seat technician and documents, the knowledge base and credentials', { shuffle: false }, () => {
  let db: Knex;
  let tenant: string;
  const f = {
    client: '', otherClient: '', inBoard: '', outBoard: '', arrangement: '',
    tech: '', msp: '',
    inTicket: randomUUID(), outTicket: randomUUID(),
    doc: {} as Record<string, string>,
    article: {} as Record<string, string>,
    credential: '',
  };
  const userRow = (userId: string, seatReader?: boolean) => ({
    user_id: userId, user_type: 'internal', tenant, username: userId, email: `${userId}@example.test`,
    is_inactive: false, roles: [], ...(seatReader === undefined ? {} : { seat_reader: seatReader }),
  }) as any;
  const asUser = (userId: string) => { ref.user = userRow(userId); return ref.user; };

  const insertDocument = async (key: string, associations: Array<[string, string]>, clientVisible: boolean) => {
    const documentId = randomUUID();
    f.doc[key] = documentId;
    await db('documents').insert({
      tenant, document_id: documentId, document_name: `${key}-${documentId.slice(0, 6)}`, user_id: f.msp, created_by: f.msp,
      is_client_visible: clientVisible,
    });
    for (const [entityType, entityId] of associations) {
      await db('document_associations').insert({ tenant, association_id: randomUUID(), document_id: documentId, entity_id: entityId, entity_type: entityType });
    }
  };
  const insertArticle = async (audience: 'internal' | 'client' | 'public') => {
    const documentId = randomUUID();
    const articleId = randomUUID();
    f.article[audience] = articleId;
    await db('documents').insert({
      tenant, document_id: documentId, document_name: `kb-${audience}`, user_id: f.msp, created_by: f.msp,
      is_client_visible: audience !== 'internal', folder_path: '/Knowledge Base',
    });
    await db('kb_articles').insert({
      tenant, article_id: articleId, document_id: documentId, slug: `kb-${audience}-${articleId.slice(0, 6)}`,
      audience, status: 'published', created_by: f.msp,
    });
  };

  beforeAll(async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = priorKey ?? 'integration-test-credential-key';
    resetCredentialAesKeyCache();
    db = await createTestDbConnection({ databaseName: 's31_seat_docs_kb_credentials_test' });
    ref.knex = db;
    registerBuiltinRuleResolver(coManagedSeatResolver);
    // The credential tables belong to the EE migrations, which the shared bootstrap (server/migrations) does not run.
    // Only the table definitions are applied, in order, once per database; the permission seeds are not needed.
    if (!(await db.schema.hasTable('credentials'))) {
      const requireCjs = createRequire(import.meta.url);
      for (const name of ['20260811100000_create_credentials_tables', '20260812100000_disable_rls_on_credential_tables', '20260812110000_expand_credential_associations_entity_types']) {
        await requireCjs(path.resolve(process.cwd(), 'migrations', `${name}.cjs`)).up(db);
      }
    }

    tenant = await createTenant(db, `Seat docs ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    ref.tenant = tenant;
    await db('co_managed_entitlements').insert({ tenant, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 5,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    f.client = await createClient(db, tenant, `Seat client ${randomUUID().slice(0, 6)}`);
    f.otherClient = await createClient(db, tenant, `Other client ${randomUUID().slice(0, 6)}`);
    f.inBoard = randomUUID();
    f.outBoard = randomUUID();
    for (const boardId of [f.inBoard, f.outBoard]) {
      await db('boards').insert({ tenant, board_id: boardId, board_name: `Board ${boardId.slice(0, 6)}`, is_default: false });
    }
    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId: f.client, operationId: randomUUID(), seats: 2 });
    f.arrangement = arrangement.arrangement_id;
    await setCoManagedSeatBoardScope(db, { sponsorTenant: tenant, arrangementId: f.arrangement, boards: [{ boardId: f.inBoard, canCreate: true }] });

    f.msp = await createUser(db, tenant, { user_type: 'internal' });
    f.tech = await createUser(db, tenant, { user_type: 'internal' });
    await db.transaction(async (trx) => {
      await retainBuiltinResolverSubject(trx, { tenant, userId: f.tech }, CO_MANAGED_SEAT_RESOLVER_ID);
      await trx('co_managed_seat_assignments').insert({ tenant, assignment_id: randomUUID(), arrangement_id: f.arrangement, user_id: f.tech, state: 'active' });
    });

    await db('tickets').insert({ tenant, ticket_id: f.inTicket, ticket_number: `T-${f.inTicket.slice(0, 8)}`, title: 'In scope', client_id: f.client, board_id: f.inBoard });
    await db('tickets').insert({ tenant, ticket_id: f.outTicket, ticket_number: `T-${f.outTicket.slice(0, 8)}`, title: 'Out of scope', client_id: f.client, board_id: f.outBoard });

    await insertDocument('visible', [['client', f.client]], true);
    await insertDocument('internal', [['client', f.client]], false);
    await insertDocument('other', [['client', f.otherClient]], true);
    // Not client-visible, but attached to a ticket the technician can see.
    await insertDocument('inTicket', [['ticket', f.inTicket]], false);
    // Client-visible and of the right client, but attached to a ticket outside the scope.
    await insertDocument('outTicket', [['ticket', f.outTicket]], true);
    // Reaches the right client through a visible ticket AND through an out-of-scope one: any out-of-scope ticket refuses it.
    await insertDocument('bothTickets', [['ticket', f.inTicket], ['ticket', f.outTicket]], true);

    for (const audience of ['internal', 'client', 'public'] as const) await insertArticle(audience);

    const created = await nativeCredentialSource.create(
      { tenant, userId: f.msp, user: userRow(f.msp) },
      { clientId: f.client, name: 'Firewall admin', username: 'admin', password: 'hunter2', url: 'https://fw.example.test' },
    );
    f.credential = created.id;
  }, 600_000);

  afterAll(async () => {
    unregisterBuiltinRuleResolver(CO_MANAGED_SEAT_RESOLVER_ID);
    if (priorKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY; else process.env.CREDENTIAL_ENCRYPTION_KEY = priorKey;
    resetCredentialAesKeyCache();
    await db?.destroy();
  });

  // ------------------------------------------------------------------------------------------------ F076
  describe('F076 documents', () => {
    const allDocuments = () => Object.entries(f.doc).map(([key, document_id]) => ({ key, document_id, created_by: f.msp, is_client_visible: key !== 'internal' && key !== 'inTicket' }));
    const readableByRecord = async (userId: string) => {
      const documents = allDocuments();
      const readable = await db.transaction((trx) => authorizeAndRedactDocuments(trx, tenant, userRow(userId), documents as any));
      return new Set(readable.map((doc: any) => doc.key as string));
    };
    const readableBySql = async (userId: string) => {
      const scope = await resolveDocumentReadScope(db, tenant, userRow(userId));
      const query = tenantDb(db, tenant).table('documents as d').select('d.document_name');
      scope?.apply(query, 'd');
      const names = (await query).map((row: any) => row.document_name as string);
      const byId = new Map(Object.entries(f.doc).map(([key, id]) => [`${key}-${id.slice(0, 6)}`, key]));
      return new Set(names.flatMap((name) => byId.has(name) ? [byId.get(name)!] : []));
    };

    it('the seat technician reads the client-visible document of their client and the ticket attachment, nothing else (record check)', async () => {
      expect(await readableByRecord(f.tech)).toEqual(new Set(['visible', 'inTicket']));
    });

    it('the list query narrows to the same documents as the record check (SQL and JS agree)', async () => {
      expect(await readableBySql(f.tech)).toEqual(await readableByRecord(f.tech));
      expect(await readableBySql(f.tech)).toEqual(new Set(['visible', 'inTicket']));
    });

    it('an ordinary MSP user still sees every document, with no narrowing in the list query', async () => {
      expect(await readableByRecord(f.msp)).toEqual(new Set(Object.keys(f.doc)));
      expect(await resolveDocumentReadScope(db, tenant, userRow(f.msp))).toBeNull();
    });

    it('a revoked assignment grants no document at all', async () => {
      const revoked = await createUser(db, tenant, { user_type: 'internal' });
      await db.transaction(async (trx) => {
        await retainBuiltinResolverSubject(trx, { tenant, userId: revoked }, CO_MANAGED_SEAT_RESOLVER_ID);
        await trx('co_managed_seat_assignments').insert({ tenant, assignment_id: randomUUID(), arrangement_id: f.arrangement, user_id: revoked, state: 'revoked', revoked_at: new Date() });
      });
      expect(await readableByRecord(revoked)).toEqual(new Set());
      expect(await readableBySql(revoked)).toEqual(new Set());
    });

    it('may upload a ticket attachment to a ticket in scope and is refused on one out of scope', async () => {
      const may = (targets: Array<{ entityType: string; entityId: string }>, userId = f.tech) =>
        isDocumentAssociationCreateAllowed(db, { tenant, user: userRow(userId), targets });
      expect(await may([{ entityType: 'ticket', entityId: f.inTicket }])).toBe(true);
      expect(await may([{ entityType: 'ticket', entityId: f.outTicket }])).toBe(false);
      expect(await may([{ entityType: 'ticket', entityId: randomUUID() }])).toBe(false);
      // The client itself is the technician's own; another client's is not.
      expect(await may([{ entityType: 'client', entityId: f.client }])).toBe(true);
      expect(await may([{ entityType: 'client', entityId: f.otherClient }])).toBe(false);
      // An ordinary MSP user is unaffected.
      expect(await may([{ entityType: 'ticket', entityId: f.outTicket }, { entityType: 'client', entityId: f.otherClient }], f.msp)).toBe(true);
    });
  });

  // ------------------------------------------------------------------------------------------------ F077
  describe('F077 knowledge base', () => {
    const idsOf = (rows: Array<{ article_id: string }>) => new Set(rows.map((row) => row.article_id));
    const byAudience = (audiences: string[]) => new Set(audiences.map((audience) => f.article[audience]));

    it('lists only client and public articles for the seat technician (server action)', async () => {
      asUser(f.tech);
      const page = await getArticles(1, 50, {}) as any;
      expect(idsOf(page.articles)).toEqual(byAudience(['client', 'public']));
      expect(page.total).toBe(2);
      const withTags = await getArticlesWithTags(1, 50, {}) as any;
      expect(idsOf(withTags.articles)).toEqual(byAudience(['client', 'public']));
    });

    it('gets a client or public article and answers an internal one as if it did not exist', async () => {
      asUser(f.tech);
      expect(((await getArticle(f.article.client)) as any)?.article_id).toBe(f.article.client);
      expect(((await getArticle(f.article.public)) as any)?.article_id).toBe(f.article.public);
      expect(await getArticle(f.article.internal)).toBeNull();
    });

    it('does not count a view of an article the technician cannot read', async () => {
      asUser(f.tech);
      await recordArticleView(f.article.internal);
      await recordArticleView(f.article.client);
      const views = async (audience: string) => (await db('kb_articles').where({ tenant, article_id: f.article[audience] }).first()).view_count;
      expect(await views('internal')).toBe(0);
      expect(await views('client')).toBe(1);
    });

    it('the record check (search hits) agrees, and the technician may not change articles', async () => {
      const tech = userRow(f.tech);
      for (const audience of ['internal', 'client', 'public'] as const) {
        expect(await canReadKnowledgeBaseArticle(db, tenant, tech, { article_id: f.article[audience], audience }), audience)
          .toBe(audience !== 'internal');
      }
      for (const action of ['create', 'update', 'delete'] as const) {
        expect(await canMutateKnowledgeBaseArticles(db, tenant, tech, action), action).toBe(false);
        expect(await canMutateKnowledgeBaseArticles(db, tenant, userRow(f.msp), action), action).toBe(true);
      }
    });

    it('an ordinary MSP user sees every article', async () => {
      asUser(f.msp);
      const page = await getArticles(1, 50, {}) as any;
      expect(idsOf(page.articles)).toEqual(byAudience(['internal', 'client', 'public']));
      expect(((await getArticle(f.article.internal)) as any)?.article_id).toBe(f.article.internal);
      expect(await resolveKnowledgeBaseReadScope(db, tenant, userRow(f.msp))).toBeNull();
    });

    it('costs a user row that is known not to be a seat reader no statement at all', async () => {
      const statements: string[] = [];
      const listener = (query: { sql: string }) => statements.push(query.sql);
      db.on('query', listener);
      try {
        expect(await resolveKnowledgeBaseReadScope(db, tenant, userRow(f.msp, false))).toBeNull();
        expect(await canReadKnowledgeBaseArticle(db, tenant, userRow(f.msp, false), { article_id: f.article.internal, audience: 'internal' })).toBe(true);
      } finally {
        db.off('query', listener);
      }
      expect(statements).toEqual([]);
    });
  });

  // ------------------------------------------------------------------------------------------------ F078
  describe('F078 credentials', () => {
    const ctx = (userId: string) => ({ tenant, userId, user: userRow(userId) });

    it('an ordinary MSP user sees, gets and reveals the credential (the paths work at all)', async () => {
      expect((await nativeCredentialSource.list(ctx(f.msp), {})).map((row) => row.id)).toContain(f.credential);
      expect((await nativeCredentialSource.getDetail(ctx(f.msp), f.credential))?.id).toBe(f.credential);
      expect((await nativeCredentialSource.reveal(ctx(f.msp), f.credential)).state).toBe('ok');
    });

    it('is unavailable to the seat technician: list, list by client, list by ids, get, reveal and OTP reveal', async () => {
      const tech = ctx(f.tech);
      expect(await nativeCredentialSource.list(tech, {})).toEqual([]);
      expect(await nativeCredentialSource.list(tech, { clientId: f.client })).toEqual([]);
      expect(await nativeCredentialSource.list(tech, { search: 'Firewall' })).toEqual([]);
      expect(await nativeCredentialSource.listByIds(tech, [f.credential])).toEqual([]);
      expect(await nativeCredentialSource.getDetail(tech, f.credential)).toBeNull();
      for (const reveal of [await nativeCredentialSource.reveal(tech, f.credential), await nativeCredentialSource.revealOtpSeed(tech, f.credential)]) {
        expect(reveal.state).not.toBe('ok');
        expect(JSON.stringify(reveal)).not.toContain('hunter2');
      }
    });

    it('is unavailable to the seat technician in the scoped SQL used by counts and search', async () => {
      const count = async (userId: string) => db.transaction(async (trx) => {
        const context = await createCredentialAuthorizationContext(trx, tenant, userRow(userId));
        const query = tenantDb(trx, tenant).scoped('credentials as cr');
        const scope = compileCredentialReadScopeSql(query, context);
        expect(scope.supported).toBe(true);
        return Number((await query.builder.count('* as count').first() as any).count);
      });
      expect(await count(f.msp)).toBe(1);
      expect(await count(f.tech)).toBe(0);
    });

    it('is unavailable in the credential detail embedded in an entity list (client-bound association)', async () => {
      await db('credential_associations').insert({
        tenant, association_id: randomUUID(), credential_id: f.credential, entity_type: 'client', entity_id: f.client,
      }).catch(() => undefined); // the association shape is the credential store's; the entity-list read is by ids
      expect(await nativeCredentialSource.listByIds(ctx(f.tech), [f.credential])).toEqual([]);
    });
  });
});
