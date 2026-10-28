import { afterAll, beforeAll, expect, it } from 'vitest';
import { knex as createKnex } from 'knex';
import type { Knex } from 'knex';
import table from '../../../../packages/predicates/spec/conformance.json';
import type { ConformanceTable } from '@alga-psa/predicates';
import { PredicateSchemaError } from '@alga-psa/predicates';
import type { QuerySchema } from '@alga-psa/predicates';
import { compilePredicate } from '@alga-psa/predicates/sql';
import { wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';

/**
 * T004 / T005: the SQL compiler against real PostgreSQL. Rows live in TEMP tables inside one
 * transaction (nothing is persisted); the query schema is declared here so the compiler is exercised
 * on its own, independent of the ticket schema.
 */
const describeDb = await describeWithDb();
const conformance = table as unknown as ConformanceTable;

const TENANT = '00000000-0000-4000-8000-000000000001';
const OTHER_TENANT = '00000000-0000-4000-8000-000000000002';

const schema: QuerySchema = {
  table: 'conf_item',
  attributes: {
    s: { kind: 'column', column: 's', type: 'string' },
    n: { kind: 'column', column: 'n', type: 'number' },
    b: { kind: 'column', column: 'b', type: 'boolean' },
    tags: { kind: 'set', table: 'conf_tag', local: 'row_id', foreign: 'row_id', valueColumn: 'tag', valueType: 'string' },
  },
  relations: {
    owner: {
      kind: 'one',
      table: 'conf_owner',
      local: 'owner_id',
      foreign: 'owner_id',
      attributes: {
        label: { kind: 'column', column: 'label', type: 'string' },
        tags: { kind: 'set', table: 'conf_owner_tag', local: 'owner_id', foreign: 'owner_id', valueColumn: 'tag', valueType: 'string' },
      },
    },
  },
  children: { childColumn: 'parent_id', parentColumn: 'row_id' },
};

let db: Knex;
let trx: Knex.Transaction;

describeDb('predicates SQL compiler', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = createKnex({
      client: 'pg',
      connection: {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USER_ADMIN,
        password: process.env.DB_PASSWORD_ADMIN,
        database: 'postgres',
      },
      pool: { min: 1, max: 1 },
    });
    trx = await db.transaction();
    await trx.raw(`CREATE TEMP TABLE conf_item (tenant uuid, row_id text, s text, n numeric, b boolean, owner_id text, parent_id text)`);
    await trx.raw(`CREATE TEMP TABLE conf_tag (tenant uuid, row_id text, tag text)`);
    await trx.raw(`CREATE TEMP TABLE conf_owner (tenant uuid, owner_id text, label text)`);
    await trx.raw(`CREATE TEMP TABLE conf_owner_tag (tenant uuid, owner_id text, tag text)`);
  });

  afterAll(async () => {
    await trx?.rollback();
    await db?.destroy();
  });

  const matching = async (predicate: Parameters<typeof compilePredicate>[2], options = { rootAlias: 'i' } as any) => {
    const rows = await trx('conf_item as i')
      .where('i.tenant', TENANT)
      .whereRaw(compilePredicate(trx, schema, predicate, options))
      .select('i.row_id')
      .orderBy('i.row_id');
    return rows.map((row: { row_id: string }) => row.row_id);
  };

  for (const testCase of conformance.cases) {
    if (testCase.skip?.sql) continue;
    it(`conformance: ${testCase.id}`, async () => {
      await trx.raw('TRUNCATE conf_item, conf_tag');
      for (const row of testCase.rows) {
        const record = row.record as { s?: string; n?: number; b?: boolean; tags?: string[] };
        await trx('conf_item').insert({
          tenant: TENANT,
          row_id: row.id,
          s: record.s ?? null,
          n: record.n ?? null,
          b: record.b ?? null,
        });
                const tags = record.tags ?? [];
        if (tags.length > 0) {
          await trx('conf_tag').insert(tags.map((tag) => ({ tenant: TENANT, row_id: row.id, tag })));
          // Same tags under another tenant's row id must never be seen.
          await trx('conf_tag').insert(tags.map((tag) => ({ tenant: OTHER_TENANT, row_id: row.id, tag })));
        }
      }
      const expected = testCase.rows.filter((row) => row.expected).map((row) => row.id).sort();
      expect(await matching(testCase.predicate)).toEqual(expected);
    });
  }

  describe('T005: self-or-any-child and tenancy', () => {
    beforeAll(async () => {
      await trx.raw('TRUNCATE conf_item, conf_tag, conf_owner, conf_owner_tag');
      await trx('conf_owner').insert([
        { tenant: TENANT, owner_id: 'o-vip', label: 'vip owner' },
        { tenant: TENANT, owner_id: 'o-plain', label: 'plain owner' },
        // Same owner id in another tenant, tagged VIP: must never leak into TENANT results.
        { tenant: OTHER_TENANT, owner_id: 'o-plain', label: 'foreign' },
      ]);
      await trx('conf_owner_tag').insert([
        { tenant: TENANT, owner_id: 'o-vip', tag: 'VIP' },
        { tenant: OTHER_TENANT, owner_id: 'o-plain', tag: 'VIP' },
      ]);
      await trx('conf_item').insert([
        { tenant: TENANT, row_id: 'master-vip-child', owner_id: 'o-plain', parent_id: null },
        { tenant: TENANT, row_id: 'child-vip', owner_id: 'o-vip', parent_id: 'master-vip-child' },
        { tenant: TENANT, row_id: 'master-plain', owner_id: 'o-plain', parent_id: null },
        { tenant: TENANT, row_id: 'child-plain', owner_id: 'o-plain', parent_id: 'master-plain' },
        { tenant: TENANT, row_id: 'master-own-vip', owner_id: 'o-vip', parent_id: null },
        { tenant: TENANT, row_id: 'no-owner', owner_id: null, parent_id: null },
        // Child in another tenant pointing at a TENANT master: must not be a child of it.
        { tenant: OTHER_TENANT, row_id: 'foreign-child', owner_id: 'o-vip', parent_id: 'master-plain' },
      ]);
      await trx('conf_tag').insert([
        { tenant: TENANT, row_id: 'child-plain', tag: 'urgent' },
        { tenant: OTHER_TENANT, row_id: 'master-plain', tag: 'urgent' },
      ]);
    });

    const owner = (operator: any, value?: any) => ({ path: 'owner.tags', operator, ...(value ? { value } : {}) });

    it('without the modifier a relation clause sees only the row itself', async () => {
      expect(await matching(owner('in', ['VIP']))).toEqual(['child-vip', 'master-own-vip']);
    });

    it('with the modifier a parent matches through a child on a one-relation', async () => {
      expect(await matching(owner('in', ['VIP']), { rootAlias: 'i', selfOrAnyChild: true })).toEqual([
        'child-vip',
        'master-own-vip',
        'master-vip-child',
      ]);
    });

    it('with the modifier a parent matches through a child on a set attribute', async () => {
      const ids = await matching({ path: 'tags', operator: 'in', value: ['urgent'] }, { rootAlias: 'i', selfOrAnyChild: true });
      expect(ids).toEqual(['child-plain', 'master-plain']);
    });

    it('complement operators negate the whole self-or-any-child match; no owner satisfies not_in', async () => {
      expect(await matching(owner('not_in', ['VIP']), { rootAlias: 'i', selfOrAnyChild: true })).toEqual([
        'child-plain',
        'master-plain',
        'no-owner',
      ]);
      expect(await matching(owner('is_empty'))).toEqual(['child-plain', 'master-plain', 'master-vip-child', 'no-owner']);
    });

    it('does not apply the modifier to a clause on the row own column', async () => {
      const ids = await matching({ path: 's', operator: 'is_empty' }, { rootAlias: 'i', selfOrAnyChild: true });
      expect(ids).toHaveLength(6);
    });

    it('correlates every hop on tenant in the compiled SQL', () => {
      const raw = compilePredicate(trx, schema, owner('in', ['VIP']) as any, { rootAlias: 'i', selfOrAnyChild: true });
      const sql = raw.toSQL().sql;
      expect(sql.match(/"tenant" = /g)?.length ?? sql.match(/tenant/g)?.length).toBeGreaterThanOrEqual(3);
      expect(sql).toMatch(/__p\d+"\."tenant" = "i"\."tenant"/);
    });

    it('rejects selfOrAnyChild when the schema declares no children', () => {
      const { children: _children, ...bare } = schema;
      expect(() =>
        compilePredicate(trx, bare, owner('in', ['VIP']) as any, { rootAlias: 'i', selfOrAnyChild: true }),
      ).toThrow(PredicateSchemaError);
    });
  });
});
