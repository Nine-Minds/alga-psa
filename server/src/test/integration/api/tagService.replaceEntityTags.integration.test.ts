import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { TagService } from '@/lib/api/services/TagService';

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

/**
 * No route mounts ApiTagController.replaceEntityTags, so the hang is reachable
 * through the service method; drive it directly against a real database.
 */

let db: Knex;
const tenantsToCleanup = new Set<string>();

function tenantTable(tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

function tenantRows() {
  return tenantDb(db, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await tenantTable(tenantId, 'tag_mappings').del();
  await tenantTable(tenantId, 'tag_definitions').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

async function createTenant(): Promise<string> {
  const tenantId = uuidv4();
  tenantsToCleanup.add(tenantId);
  await tenantRows().insert({
    tenant: tenantId,
    client_name: `Tag Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
  });
  return tenantId;
}

function serviceFor(tenantId: string): TagService {
  const service = new TagService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
  return service;
}

async function mappedTexts(tenantId: string, entityId: string): Promise<string[]> {
  const rows = await tenantTable(tenantId, 'tag_mappings as tm')
    .join('tag_definitions as td', function () {
      this.on('td.tag_id', 'tm.tag_id').andOn('td.tenant', 'tm.tenant');
    })
    .where('tm.tagged_id', entityId)
    .select('td.tag_text');
  return rows.map((row: { tag_text: string }) => row.tag_text).sort();
}

async function mappingCount(tenantId: string, entityId: string): Promise<number> {
  const rows = await tenantTable(tenantId, 'tag_mappings').where({ tagged_id: entityId });
  return rows.length;
}

/** Fails the test (instead of hanging it) if the service does not settle. */
function within5s<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('replaceEntityTags did not settle within 5s (hang)')), 5000)),
  ]);
}

describe('TagService.replaceEntityTags (real database)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
  }, 120_000);

  afterEach(async () => {
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
    }
    tenantsToCleanup.clear();
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  // created_by is nullable; no user fixture is needed for the mapping rows.
  const ctx = {} as any;

  it('replaces [a,b] with [b,c] without hanging on the overlapping tag', async () => {
    const tenantId = await createTenant();
    const service = serviceFor(tenantId);
    const entityId = uuidv4();

    await service.tagEntity(entityId, 'contact', ['alpha', 'beta'], {}, ctx);
    expect(await mappedTexts(tenantId, entityId)).toEqual(['alpha', 'beta']);

    const result = await within5s(service.replaceEntityTags(entityId, 'contact', ['beta', 'gamma'], {}, ctx));

    expect(result.map((tag) => tag.tag_text).sort()).toEqual(['beta', 'gamma']);
    expect(await mappedTexts(tenantId, entityId)).toEqual(['beta', 'gamma']);
    expect(await mappingCount(tenantId, entityId)).toBe(2);
  }, 15_000);

  it('clears the entity when replaced with an empty list', async () => {
    const tenantId = await createTenant();
    const service = serviceFor(tenantId);
    const entityId = uuidv4();

    await service.tagEntity(entityId, 'contact', ['alpha', 'beta'], {}, ctx);
    await within5s(service.replaceEntityTags(entityId, 'contact', [], {}, ctx));

    expect(await mappingCount(tenantId, entityId)).toBe(0);
  }, 15_000);

  it('is idempotent when the same replace runs twice', async () => {
    const tenantId = await createTenant();
    const service = serviceFor(tenantId);
    const entityId = uuidv4();

    await within5s(service.replaceEntityTags(entityId, 'contact', ['beta', 'gamma'], {}, ctx));
    await within5s(service.replaceEntityTags(entityId, 'contact', ['beta', 'gamma'], {}, ctx));

    expect(await mappedTexts(tenantId, entityId)).toEqual(['beta', 'gamma']);
    expect(await mappingCount(tenantId, entityId)).toBe(2);
  }, 15_000);
});
