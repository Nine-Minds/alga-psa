/**
 * alga-2026-0003229 (card db5eb198): a client-portal reader of a published client/public KB article can load the
 * article's uploaded images. Real Postgres, real kernel: the rule `readable_via_published_parent`, both facets,
 * and the real read path `getAuthorizedDocumentByFileId`. Only the logger is stubbed.
 *
 * Run (throwaway Postgres on a free port, from server/):
 *   TEST_DB_PORT=35432 REQUIRE_DB=1 DB_PORT=35432 npx vitest run src/test/integration/kbArticleImageClientAccess.integration.test.ts
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { tenantDb } from '@alga-psa/db';
import {
  authorizeAndRedactDocuments,
  authorizeAndRedactDocumentsForAction,
  createDocumentRelationshipSqlAdapter,
} from '@shared/lib/documentAuthorization';
import { compileRelationshipTemplateSql, evaluateRelationshipTemplate } from '@alga-psa/authorization/kernel';
import { getAuthorizedDocumentByFileId } from '../../../../packages/documents/src/actions/documentActions';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const describeDb = await describeWithDb();

describeDb('KB article images readable by client portal users', { shuffle: false }, () => {
  let db: Knex;
  let tenant: string;
  let otherTenant: string;
  let client: string;
  let otherTenantClient: string;
  let msp: string;
  const users = { client: null as any, otherTenantClient: null as any, msp: null as any };
  // key -> { articleDoc, image }
  const kb: Record<string, { articleDoc: string; image: string; file: string }> = {};

  const userRow = (userId: string, t: string, type: 'client' | 'internal', clientId?: string) =>
    ({ user_id: userId, tenant: t, user_type: type, username: userId, email: `${userId}@example.test`,
       is_inactive: false, roles: [], ...(clientId ? { clientId } : {}) }) as any;

  const insertDoc = async (t: string, name: string, by: string, visible: boolean) => {
    const documentId = randomUUID();
    const fileId = randomUUID();
    await db('external_files').insert({
      tenant: t, file_id: fileId, file_name: name, original_name: name, mime_type: 'image/png',
      file_size: 1, storage_path: `kb/${fileId}.png`, uploaded_by_id: by,
    });
    await db('documents').insert({
      tenant: t, document_id: documentId, document_name: name, user_id: by, created_by: by,
      is_client_visible: visible, file_id: fileId,
    });
    return documentId;
  };
  const seed = async (key: string, opts: { status?: string; audience?: string; article?: boolean; imageVisible?: boolean }) => {
    const articleDoc = await insertDoc(tenant, `art-${key}`, msp, true);
    const image = await insertDoc(tenant, `img-${key}`, msp, opts.imageVisible ?? true);
    if (opts.article !== false) {
      await db('kb_articles').insert({
        tenant, article_id: randomUUID(), document_id: articleDoc, slug: `kb-${key}-${randomUUID().slice(0, 6)}`,
        audience: opts.audience ?? 'client', status: opts.status ?? 'published', created_by: msp,
      });
    }
    await db('document_associations').insert({
      tenant, association_id: randomUUID(), document_id: image, entity_id: articleDoc, entity_type: 'document',
    });
    const [row] = await db('documents').where({ tenant, document_id: image }).select('file_id');
    kb[key] = { articleDoc, image, file: row.file_id };
  };
  const imageDocs = async (keys: string[]) =>
    (await db('documents').where({ tenant }).whereIn('document_id', keys.map((k) => kb[k].image))) as any[];

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 'kb_image_client_access_test' });
    tenant = await createTenant(db, `KB img ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    otherTenant = await createTenant(db, `KB img other ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    client = await createClient(db, tenant, `Client ${randomUUID().slice(0, 6)}`);
    otherTenantClient = await createClient(db, otherTenant, `Other ${randomUUID().slice(0, 6)}`);
    msp = await createUser(db, tenant, { user_type: 'internal' });
    const clientUser = await createUser(db, tenant, { user_type: 'client' });
    const otherUser = await createUser(db, otherTenant, { user_type: 'client' });
    users.client = userRow(clientUser, tenant, 'client', client);
    users.otherTenantClient = userRow(otherUser, otherTenant, 'client', otherTenantClient);
    users.msp = userRow(msp, tenant, 'internal');

    await seed('published', {});
    await seed('public', { audience: 'public' });
    await seed('internal', { audience: 'internal' });
    await seed('draft', { status: 'draft' });
    await seed('archived', { status: 'archived' });
    await seed('noArticle', { article: false });
    // Published client article, but the image itself is not client-visible: the visibility gate still refuses it.
    await seed('hiddenImage', { imageVisible: false });
  }, 600_000);

  afterAll(async () => {
    await db?.destroy();
  });

  const allKeys = () => Object.keys(kb);
  const recordReadable = async (user: any, keys = allKeys(), t = tenant) => {
    const docs = await db('documents').where({ tenant: t }).whereIn('document_id', keys.map((k) => kb[k].image));
    const out = await db.transaction((trx) => authorizeAndRedactDocuments(trx, t, user, docs as any));
    const byId = new Map(keys.map((k) => [kb[k].image, k]));
    return new Set(out.map((d: any) => byId.get(d.document_id)!));
  };

  describe('1. record facet', () => {
    it('marks the child of a published client/public article readable, and nothing else', async () => {
      // Observed through the kernel: only the readable-via-parent rule can admit these (no client, not owned).
      expect(await recordReadable(users.client)).toEqual(new Set(['published', 'public']));
    });

    it('refuses internal, draft, archived and parentless-article images', async () => {
      const readable = await recordReadable(users.client, ['internal', 'draft', 'archived', 'noArticle']);
      expect(readable.size).toBe(0);
    });

    it('the template itself refuses anything but an explicit true', () => {
      const input = (record: any) => ({ subject: { userId: 'u' }, record }) as any;
      expect(evaluateRelationshipTemplate('readable_via_published_parent', input({ readableViaPublishedParent: true }))).toBe(true);
      for (const v of [undefined, false, 'true', 1, null]) {
        expect(evaluateRelationshipTemplate('readable_via_published_parent', input({ readableViaPublishedParent: v }))).toBe(false);
      }
    });

    it('the batch query is tenant-scoped: the same ids in another tenant grant nothing', async () => {
      // A child in the other tenant associated to the (tenant A) published article's document id.
      const foreignImage = randomUUID();
      const foreignCreator = await createUser(db, otherTenant, { user_type: 'internal' });
      await db('documents').insert({
        tenant: otherTenant, document_id: foreignImage, document_name: 'foreign', user_id: foreignCreator,
        created_by: foreignCreator, is_client_visible: true,
      });
      await db('document_associations').insert({
        tenant: otherTenant, association_id: randomUUID(), document_id: foreignImage,
        entity_id: kb.published.articleDoc, entity_type: 'document',
      });
      const docs = await db('documents').where({ tenant: otherTenant, document_id: foreignImage });
      const out = await db.transaction((trx) => authorizeAndRedactDocuments(trx, otherTenant, users.otherTenantClient, docs as any));
      expect(out).toHaveLength(0);
    });
  });

  describe('2. SQL facet', () => {
    const sqlReadable = async (keys = allKeys()) => {
      const query = tenantDb(db, tenant).table('documents as d').select('d.document_id').whereIn('d.document_id', keys.map((k) => kb[k].image));
      compileRelationshipTemplateSql(query as any, 'readable_via_published_parent', {
        subject: { tenant, userId: users.client.user_id } as any,
        adapter: createDocumentRelationshipSqlAdapter({ documentAlias: 'd' }),
      });
      const ids = new Set((await query).map((r: any) => r.document_id as string));
      return new Set(keys.filter((k) => ids.has(kb[k].image)));
    };

    it('narrows to the same set as the record facet (allowed and refused)', async () => {
      const sql = await sqlReadable();
      expect(sql).toEqual(new Set(['published', 'public']));
      expect(sql).toEqual(await recordReadable(users.client));
    });

    it('additionally requires is_client_visible (SQL facet), refusing the hidden image', async () => {
      expect((await sqlReadable(['hiddenImage'])).size).toBe(0);
      expect((await recordReadable(users.client, ['hiddenImage'])).size).toBe(0);
    });

    it('denies everything when the adapter does not implement it', async () => {
      const query = tenantDb(db, tenant).table('documents as d').select('d.document_id');
      compileRelationshipTemplateSql(query as any, 'readable_via_published_parent', {
        subject: { tenant, userId: 'x' } as any,
        adapter: { applyAssignedUsers: () => undefined },
      });
      expect(await query).toHaveLength(0);
    });

    it('is tenant-matched: an article in another tenant with the same document id does not grant', async () => {
      const t2doc = randomUUID();
      const t2child = randomUUID();
      for (const id of [t2doc, t2child]) {
        await db('documents').insert({ tenant: otherTenant, document_id: id, document_name: id, user_id: users.otherTenantClient.user_id, created_by: users.otherTenantClient.user_id, is_client_visible: true });
      }
      // The published client article lives in otherTenant, the association in `tenant`.
      await db('kb_articles').insert({ tenant: otherTenant, article_id: randomUUID(), document_id: t2doc, slug: `x-${randomUUID().slice(0, 6)}`, audience: 'client', status: 'published' });
      await db('documents').insert({ tenant, document_id: t2doc, document_name: 'shadow', user_id: msp, created_by: msp, is_client_visible: true });
      await db('documents').insert({ tenant, document_id: t2child, document_name: 'shadowchild', user_id: msp, created_by: msp, is_client_visible: true });
      await db('document_associations').insert({ tenant, association_id: randomUUID(), document_id: t2child, entity_id: t2doc, entity_type: 'document' });
      const query = tenantDb(db, tenant).table('documents as d').select('d.document_id').where('d.document_id', t2child);
      compileRelationshipTemplateSql(query as any, 'readable_via_published_parent', {
        subject: { tenant, userId: 'x' } as any,
        adapter: createDocumentRelationshipSqlAdapter({ documentAlias: 'd' }),
      });
      expect(await query).toHaveLength(0);
    });
  });

  describe('3. real path (getAuthorizedDocumentByFileId) as a client subject', () => {
    const get = (user: any, key: string, t = tenant) =>
      db.transaction((trx) => getAuthorizedDocumentByFileId(trx, t, user, kb[key].file));

    it('returns the image of a published client article, and of a public one', async () => {
      expect((await get(users.client, 'published'))?.document_id).toBe(kb.published.image);
      expect((await get(users.client, 'public'))?.document_id).toBe(kb.public.image);
    });

    it('returns null when the article is internal, draft, archived, parentless, or the image is not client-visible', async () => {
      for (const key of ['internal', 'draft', 'archived', 'noArticle', 'hiddenImage']) {
        expect(await get(users.client, key), key).toBeNull();
      }
    });

    it('returns null for a client user from another tenant', async () => {
      expect(await get(users.otherTenantClient, 'published', otherTenant)).toBeNull();
    });

    it('unpublishing revokes access on the next request', async () => {
      await seed('toggle', {});
      expect(await get(users.client, 'toggle')).not.toBeNull();
      await db('kb_articles').where({ tenant, document_id: kb.toggle.articleDoc }).update({ status: 'draft' });
      expect(await get(users.client, 'toggle')).toBeNull();
    });

    it('RBAC watch point: the product read scope admits the portal client role (non-co-managed and co-managed tenant with a document read grant)', async () => {
      // Non-co-managed (psa): the gate adds no restriction. Proven by the successful reads above.
      // Co-managed: the gate requires a `document` read grant on a client role of the user.
      const t = await createTenant(db, `KB comanaged ${randomUUID().slice(0, 6)}`, { productCode: 'co_managed' as any });
      const c = await createClient(db, t, `C ${randomUUID().slice(0, 6)}`);
      const m = await createUser(db, t, { user_type: 'internal' });
      const u = await createUser(db, t, { user_type: 'client' });
      const row = userRow(u, t, 'client', c);
      const art = randomUUID(); const img = randomUUID(); const file = randomUUID();
      await db('external_files').insert({ tenant: t, file_id: file, file_name: 'i', original_name: 'i', mime_type: 'image/png', file_size: 1, storage_path: `kb/${file}.png`, uploaded_by_id: m });
      for (const [id, f] of [[art, null], [img, file]] as const) {
        await db('documents').insert({ tenant: t, document_id: id, document_name: id, user_id: m, created_by: m, is_client_visible: true, file_id: f });
      }
      await db('kb_articles').insert({ tenant: t, article_id: randomUUID(), document_id: art, slug: `s-${randomUUID().slice(0, 6)}`, audience: 'client', status: 'published' });
      await db('document_associations').insert({ tenant: t, association_id: randomUUID(), document_id: img, entity_id: art, entity_type: 'document' });
      const run = () => db.transaction((trx) => getAuthorizedDocumentByFileId(trx, t, row, file));
      // Without a grant the gate (pre-existing, not part of this card) hides it.
      expect(await run()).toBeNull();
      const roleId = randomUUID(); const permId = randomUUID();
      await db('roles').insert({ tenant: t, role_id: roleId, role_name: 'Client', description: 'c', msp: false, client: true });
      await db('permissions').insert({ tenant: t, permission_id: permId, resource: 'document', action: 'read', msp: false, client: true });
      await db('role_permissions').insert({ tenant: t, role_id: roleId, permission_id: permId });
      await db('user_roles').insert({ tenant: t, user_id: u, role_id: roleId });
      expect((await run())?.document_id).toBe(img);
    });
  });

  describe('4. mutation guard', () => {
    it('returns nothing for the client subject on update and delete, while read passes', async () => {
      const docs = await imageDocs(['published']);
      for (const action of ['update', 'delete'] as const) {
        const out = await db.transaction((trx) => authorizeAndRedactDocumentsForAction(trx, tenant, users.client, docs as any, action));
        expect(out, action).toHaveLength(0);
      }
      const read = await db.transaction((trx) => authorizeAndRedactDocumentsForAction(trx, tenant, users.client, docs as any, 'read'));
      expect(read).toHaveLength(1);
    });
  });

  describe('5. MSP regression', () => {
    it('an MSP user who did not upload the image may still update it (the mutation guard does not touch MSP)', async () => {
      const otherMsp = userRow(await createUser(db, tenant, { user_type: 'internal' }), tenant, 'internal');
      const docs = await imageDocs(['published', 'internal']);
      for (const action of ['update', 'delete'] as const) {
        const out = await db.transaction((trx) => authorizeAndRedactDocumentsForAction(trx, tenant, otherMsp, docs as any, action));
        expect(out, action).toHaveLength(2);
      }
    });

    it('an MSP user still reads both client-audience and internal-audience images (record check and real path)', async () => {
      const readable = await recordReadable(users.msp, ['published', 'internal', 'draft']);
      expect(readable).toEqual(new Set(['published', 'internal', 'draft']));
      for (const key of ['published', 'internal']) {
        const doc = await db.transaction((trx) => getAuthorizedDocumentByFileId(trx, tenant, users.msp, kb[key].file));
        expect(doc?.document_id, key).toBe(kb[key].image);
      }
    });
  });
});
