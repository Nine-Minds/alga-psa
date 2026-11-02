import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant } from '@alga-psa/db';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';

/**
 * tag_references: a general "configuration points at this tag" table. Every cleanup path and the
 * option loader consult it, and nothing in packages/tags knows the referrer types. A synthetic
 * 'test_referrer' type is used throughout to make that explicit.
 */

const authMocks = vi.hoisted(() => ({
  user: null as any,
  tenant: null as string | null,
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (action: any) => (...args: any[]) =>
    action(authMocks.user, { tenant: authMocks.tenant }, ...args),
  withOptionalAuth: (action: any) => (...args: any[]) =>
    action(authMocks.user, authMocks.user ? { tenant: authMocks.tenant } : null, ...args),
}));
vi.mock('../../../../packages/tags/src/lib/authHelpers', () => ({
  hasPermissionAsync: async () => true,
  throwPermissionErrorAsync: async (action: string) => {
    throw new Error(`Permission denied: ${action}`);
  },
}));
vi.mock('../../lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/db')>()),
  getCurrentTenantId: async () => authMocks.tenant,
}));

const describeDb = await describeWithDb();

const TYPE = 'test_referrer';

let db: Knex;
let tenantA: string;
let tenantB: string;
let actorA: string;

async function seedTenant(label: string): Promise<{ tenant: string; actor: string }> {
  const tenant = uuidv4();
  const actor = uuidv4();
  await db('tenants').insert({
    tenant,
    client_name: `${label} ${tenant.slice(0, 8)}`,
    email: `${label}-${tenant.slice(0, 8)}@example.com`,
    product_code: 'psa',
  });
  await db('users').insert({
    tenant,
    user_id: actor,
    username: `actor-${actor.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `actor-${actor.slice(0, 8)}@example.com`,
    first_name: 'Actor',
    last_name: label,
    user_type: 'internal',
    is_inactive: false,
    timezone: 'UTC',
  });
  return { tenant, actor };
}

async function newTag(tenant: string, text: string, type = 'contact'): Promise<string> {
  const tag_id = uuidv4();
  await db('tag_definitions').insert({ tenant, tag_id, tag_text: text, tagged_type: type });
  return tag_id;
}

const exists = async (tenant: string, tagId: string) =>
  Boolean(await db('tag_definitions').where({ tenant, tag_id: tagId }).first());

describeDb('tag_references (DB)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection({ runSeeds: false });
    ({ tenant: tenantA, actor: actorA } = await seedTenant('RefsA'));
    ({ tenant: tenantB } = await seedTenant('RefsB'));
  }, 300000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, 60000);

  beforeEach(() => {
    authMocks.tenant = tenantA;
    authMocks.user = { user_id: actorA, user_type: 'internal', tenant: tenantA };
  });

  const api = () => import('../../../../packages/tags/src/lib/tagReferences');
  const model = async () => (await import('../../../../packages/tags/src/models/tagDefinition')).default;

  describe('(a) a referenced, unmapped tag survives every cleanup path', () => {
    it('TagDefinition.deleteOrphaned', async () => {
      const { replaceTagReferences } = await api();
      const TagDefinition = await model();
      const kept = await newTag(tenantA, `kept-${uuidv4()}`);
      const litter = await newTag(tenantA, `litter-${uuidv4()}`);
      await db.transaction((trx) => replaceTagReferences(trx, tenantA, TYPE, uuidv4(), [kept]));
      expect(await TagDefinition.deleteOrphaned(db, tenantA, [kept, litter])).toBe(1);
      expect(await exists(tenantA, kept)).toBe(true);
      expect(await exists(tenantA, litter)).toBe(false);
    });

    it('both tagCleanup modules (deleteEntityTags / deleteEntitiesTags)', async () => {
      const { replaceTagReferences } = await api();
      const packageCleanup = await import('../../../../packages/tags/src/lib/tagCleanup');
      const serverCleanup = await import('../../lib/utils/tagCleanup');

      for (const [label, cleanup] of [['package', packageCleanup], ['server', serverCleanup]] as const) {
        const kept = await newTag(tenantA, `${label}-kept-${uuidv4()}`);
        const litter = await newTag(tenantA, `${label}-litter-${uuidv4()}`);
        const entity = uuidv4();
        const entity2 = uuidv4();
        await db('tag_mappings').insert([
          { tenant: tenantA, mapping_id: uuidv4(), tag_id: kept, tagged_id: entity, tagged_type: 'contact' },
          { tenant: tenantA, mapping_id: uuidv4(), tag_id: litter, tagged_id: entity, tagged_type: 'contact' },
          { tenant: tenantA, mapping_id: uuidv4(), tag_id: kept, tagged_id: entity2, tagged_type: 'contact' },
          { tenant: tenantA, mapping_id: uuidv4(), tag_id: litter, tagged_id: entity2, tagged_type: 'contact' },
        ]);
        await db.transaction((trx) => replaceTagReferences(trx, tenantA, TYPE, uuidv4(), [kept]));

        await runWithTenant(tenantA, () => db.transaction((trx) => cleanup.deleteEntityTags(trx, entity, 'contact')));
        // entity2 still maps both, so nothing is orphaned yet.
        expect(await exists(tenantA, kept)).toBe(true);
        expect(await exists(tenantA, litter)).toBe(true);

        await runWithTenant(tenantA, () => db.transaction((trx) => cleanup.deleteEntitiesTags(trx, [entity2], 'contact')));
        expect(await exists(tenantA, kept)).toBe(true);
        expect(await exists(tenantA, litter)).toBe(false);
      }
    });

    it('the deleteTag orphan branch', async () => {
      const { replaceTagReferences } = await api();
      const tags = await import('../../../../packages/tags/src/actions/tagActions');
      const kept = await newTag(tenantA, `dt-kept-${uuidv4()}`);
      const litter = await newTag(tenantA, `dt-litter-${uuidv4()}`);
      const entity = uuidv4();
      const keptMapping = uuidv4();
      const litterMapping = uuidv4();
      await db('tag_mappings').insert([
        { tenant: tenantA, mapping_id: keptMapping, tag_id: kept, tagged_id: entity, tagged_type: 'contact' },
        { tenant: tenantA, mapping_id: litterMapping, tag_id: litter, tagged_id: entity, tagged_type: 'contact' },
      ]);
      await db.transaction((trx) => replaceTagReferences(trx, tenantA, TYPE, uuidv4(), [kept]));

      expect(await tags.deleteTag(keptMapping, true)).toBeUndefined();
      expect(await tags.deleteTag(litterMapping, true)).toBeUndefined();
      expect(await exists(tenantA, kept)).toBe(true);
      expect(await exists(tenantA, litter)).toBe(false);
    });
  });

  it('(b) the option loader lists a referenced, unmapped tag', async () => {
    const { replaceTagReferences } = await api();
    const tags = await import('../../../../packages/tags/src/actions/tagActions');
    const text = `listed-${uuidv4()}`;
    const plain = `plain-${uuidv4()}`;
    const kept = await newTag(tenantA, text);
    await newTag(tenantA, plain);
    await db.transaction((trx) => replaceTagReferences(trx, tenantA, TYPE, uuidv4(), [kept]));
    const listed = await tags.findAllTagsByType('contact');
    const texts = Array.isArray(listed) ? listed.map((t) => t.tag_text) : [];
    expect(texts).toContain(text);
    expect(texts).not.toContain(plain);
  });

  describe('(c) explicit delete removes the definition and its references', () => {
    it('with the FK present', async () => {
      const { replaceTagReferences } = await api();
      const TagDefinition = await model();
      const tag = await newTag(tenantA, `del-fk-${uuidv4()}`);
      await db.transaction((trx) => replaceTagReferences(trx, tenantA, TYPE, uuidv4(), [tag]));
      await db.transaction((trx) => TagDefinition.delete(trx, tenantA, tag));
      expect(await exists(tenantA, tag)).toBe(false);
      expect(await db('tag_references').where({ tenant: tenantA, tag_id: tag })).toHaveLength(0);
    });

    it('with the FK dropped (Citus), the explicit delete still clears the references', async () => {
      const { replaceTagReferences } = await api();
      const TagDefinition = await model();
      const tag = await newTag(tenantA, `del-nofk-${uuidv4()}`);
      await db.transaction((trx) => replaceTagReferences(trx, tenantA, TYPE, uuidv4(), [tag]));
      await db.raw('ALTER TABLE tag_references DROP CONSTRAINT tag_references_tag_definition_foreign');
      try {
        await db.transaction((trx) => TagDefinition.delete(trx, tenantA, tag));
        expect(await exists(tenantA, tag)).toBe(false);
        expect(await db('tag_references').where({ tenant: tenantA, tag_id: tag })).toHaveLength(0);
      } finally {
        await db('tag_references').whereNotIn('tag_id', db('tag_definitions').select('tag_id')).del();
        await db.raw(
          `ALTER TABLE tag_references ADD CONSTRAINT tag_references_tag_definition_foreign
           FOREIGN KEY (tenant, tag_id) REFERENCES tag_definitions (tenant, tag_id) ON DELETE CASCADE`,
        );
      }
    });
  });

  describe('(d) references are tenant scoped', () => {
    it('a reference in A does not protect a same-id or same-text tag in B', async () => {
      const { replaceTagReferences } = await api();
      const TagDefinition = await model();
      const sharedId = uuidv4();
      const text = `shared-${uuidv4()}`;
      await db('tag_definitions').insert([
        { tenant: tenantA, tag_id: sharedId, tag_text: text, tagged_type: 'contact' },
        { tenant: tenantB, tag_id: sharedId, tag_text: text, tagged_type: 'contact' },
      ]);
      await db.transaction((trx) => replaceTagReferences(trx, tenantA, TYPE, uuidv4(), [sharedId]));

      expect(await TagDefinition.deleteOrphaned(db, tenantB, [sharedId])).toBe(1);
      expect(await exists(tenantB, sharedId)).toBe(false);
      expect(await TagDefinition.deleteOrphaned(db, tenantA, [sharedId])).toBe(0);
      expect(await exists(tenantA, sharedId)).toBe(true);
    });

    it('the API cannot touch another tenant\'s rows', async () => {
      const { replaceTagReferences, deleteTagReferences } = await api();
      const tagB = await newTag(tenantB, `b-${uuidv4()}`);
      const referrer = uuidv4();
      await db.transaction((trx) => replaceTagReferences(trx, tenantB, TYPE, referrer, [tagB]));

      await db.transaction(async (trx) => {
        await replaceTagReferences(trx, tenantA, TYPE, referrer, []);
        await deleteTagReferences(trx, tenantA, TYPE, referrer);
      });
      expect(await db('tag_references').where({ tenant: tenantB, referrer_id: referrer })).toHaveLength(1);

      // A tag id that belongs to B cannot be referenced from A (composite FK).
      await expect(
        db.transaction((trx) => replaceTagReferences(trx, tenantA, TYPE, referrer, [tagB])),
      ).rejects.toThrow();
    });
  });

  describe('(e) replaceTagReferences', () => {
    it('replaces the set, deduplicates, and is idempotent', async () => {
      const { replaceTagReferences, deleteTagReferences } = await api();
      const t1 = await newTag(tenantA, `r1-${uuidv4()}`);
      const t2 = await newTag(tenantA, `r2-${uuidv4()}`);
      const t3 = await newTag(tenantA, `r3-${uuidv4()}`);
      const referrer = uuidv4();
      const other = uuidv4();
      const rows = async (id: string) =>
        (await db('tag_references').where({ tenant: tenantA, referrer_type: TYPE, referrer_id: id })).map((r) => r.tag_id).sort();

      await db.transaction((trx) => replaceTagReferences(trx, tenantA, TYPE, other, [t1]));
      await db.transaction((trx) => replaceTagReferences(trx, tenantA, TYPE, referrer, [t1, t2, t2]));
      expect(await rows(referrer)).toEqual([t1, t2].sort());
      await db.transaction((trx) => replaceTagReferences(trx, tenantA, TYPE, referrer, [t2, t3]));
      await db.transaction((trx) => replaceTagReferences(trx, tenantA, TYPE, referrer, [t2, t3]));
      expect(await rows(referrer)).toEqual([t2, t3].sort());
      expect(await rows(other)).toEqual([t1]);

      await db.transaction((trx) => deleteTagReferences(trx, tenantA, TYPE, referrer));
      expect(await rows(referrer)).toEqual([]);
      expect(await rows(other)).toEqual([t1]);
    });

    it('refuses to run outside a transaction', async () => {
      const { replaceTagReferences, deleteTagReferences } = await api();
      await expect(replaceTagReferences(db as any, tenantA, TYPE, uuidv4(), [])).rejects.toThrow(/transaction/);
      await expect(deleteTagReferences(db as any, tenantA, TYPE, uuidv4())).rejects.toThrow(/transaction/);
    });
  });
});
