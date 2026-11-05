import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../../test-utils/testDataFactory';

const require = createRequire(import.meta.url);
const migration = require('../../../../migrations/20261028010000_repair_kb_document_client_visibility.cjs');

let db: Knex;
let tenantId: string;
let otherTenantId: string;
const table = (name: string, tenant = tenantId) => tenantDb(db, tenant).table(name);

async function seed(tenant: string, user: string, label: string, status: string, audience: string, visible: boolean, kb = true) {
  const documentId = uuidv4();
  await table('documents', tenant).insert({
    tenant, document_id: documentId, document_name: label, user_id: user, created_by: user, order_number: 0,
    folder_path: kb ? '/Knowledge Base' : '/Other', entered_at: db.fn.now(), updated_at: db.fn.now(), is_client_visible: visible,
  });
  if (kb) {
    await table('kb_articles', tenant).insert({
      tenant, article_id: uuidv4(), document_id: documentId, slug: `${label}-${documentId.slice(0, 6)}`,
      article_type: 'how_to', audience, status, created_by: user, updated_by: user,
    });
  }
  return documentId;
}
const flag = async (id: string, tenant = tenantId) =>
  (await table('documents', tenant).where({ document_id: id }).first()).is_client_visible as boolean;

describe('repair_kb_document_client_visibility migration', () => {
  let user: string;
  let otherUser: string;

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
    tenantId = await createTenant(db, 'KB Repair Tenant');
    otherTenantId = await createTenant(db, 'KB Repair Other Tenant');
    user = await createUser(db, tenantId, { username: 'kb-repair' });
    otherUser = await createUser(db, otherTenantId, { username: 'kb-repair-other' });
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it('is a non-transactional, hide-only, idempotent repair with a no-op down', async () => {
    expect(migration.config).toEqual({ transaction: false });

    const drifted = {
      internal: await seed(tenantId, user, 'internal', 'published', 'internal', true),
      draft: await seed(tenantId, user, 'draft', 'draft', 'client', true),
      review: await seed(tenantId, user, 'review', 'review', 'public', true),
      archived: await seed(tenantId, user, 'archived', 'archived', 'client', true),
    };
    const keepClient = await seed(tenantId, user, 'pub-client', 'published', 'client', true);
    const keepPublic = await seed(tenantId, user, 'pub-public', 'published', 'public', true);
    const staleFalse = await seed(tenantId, user, 'stale-false', 'published', 'client', false);
    const nonKb = await seed(tenantId, user, 'plain-doc', 'n/a', 'n/a', true, false);
    const otherTenantDrift = await seed(otherTenantId, otherUser, 'other', 'draft', 'client', true);

    await migration.up(db);

    for (const id of Object.values(drifted)) expect(await flag(id)).toBe(false);
    expect(await flag(keepClient)).toBe(true);
    expect(await flag(keepPublic)).toBe(true);
    expect(await flag(staleFalse)).toBe(false); // hide-only: never sets true
    expect(await flag(nonKb)).toBe(true); // non-KB documents untouched
    // Every tenant with KB articles is repaired by its own tenant-pinned statement.
    expect(await flag(otherTenantDrift, otherTenantId)).toBe(false);

    // Idempotent: a second run changes nothing, not even updated_at.
    const before = await table('documents').where({ document_id: drifted.draft }).first();
    await migration.up(db);
    const after = await table('documents').where({ document_id: drifted.draft }).first();
    expect(after.updated_at).toEqual(before.updated_at);
    expect(await flag(keepClient)).toBe(true);

    await expect(migration.down(db)).resolves.toBeUndefined();
  });

  it('repairs a tenant whose drift spans more than one batch', async () => {
    const batchTenant = await createTenant(db, 'KB Repair Batch Tenant');
    const batchUser = await createUser(db, batchTenant, { username: 'kb-repair-batch' });
    const count = migration.BATCH_SIZE * 2 + 1;
    const docs = Array.from({ length: count }, (_, i) => ({
      tenant: batchTenant, document_id: uuidv4(), document_name: `batch-${i}`, user_id: batchUser, created_by: batchUser,
      order_number: 0, folder_path: '/Knowledge Base', entered_at: db.fn.now(), updated_at: db.fn.now(), is_client_visible: true,
    }));
    const articles = docs.map((d, i) => ({
      tenant: batchTenant, article_id: uuidv4(), document_id: d.document_id, slug: `batch-${i}-${d.document_id.slice(0, 6)}`,
      article_type: 'how_to', audience: 'internal', status: 'published', created_by: batchUser, updated_by: batchUser,
    }));
    for (let i = 0; i < count; i += 500) {
      await table('documents', batchTenant).insert(docs.slice(i, i + 500));
      await table('kb_articles', batchTenant).insert(articles.slice(i, i + 500));
    }
    const keep = await seed(batchTenant, batchUser, 'batch-keep', 'published', 'client', true);

    const updatedCounts: number[] = [];
    const recordUpdate = (response: { command?: string; rowCount?: number }) => {
      if (response?.command === 'UPDATE' && typeof response.rowCount === 'number') {
        updatedCounts.push(response.rowCount);
      }
    };
    db.on('query-response', recordUpdate);
    try {
      await migration.up(db);
    } finally {
      db.removeListener('query-response', recordUpdate);
    }
    expect(updatedCounts.length).toBeGreaterThanOrEqual(3);
    expect(updatedCounts.every((count) => count <= migration.BATCH_SIZE)).toBe(true);

    const stillVisible = await table('documents', batchTenant)
      .whereIn('document_id', docs.map((d) => d.document_id))
      .andWhere({ is_client_visible: true })
      .count<{ count: string }[]>('* as count');
    expect(Number(stillVisible[0].count)).toBe(0);
    expect(await flag(keep, batchTenant)).toBe(true);
  }, 120_000);
});
