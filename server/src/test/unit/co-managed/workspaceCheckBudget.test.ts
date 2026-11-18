import { afterEach, describe, expect, it } from 'vitest';
import {
  isCoManagedWorkspace, registerWriteAdmissionResolver, resetWriteAdmissionCache, resetWriteAdmissionResolver,
} from '@alga-psa/db/writeAdmission';

/**
 * The MSP ticket page asks `isCoManagedWorkspace` on every render. Steady state for a psa
 * tenant must be zero SQL: the first answer is remembered forever, and with no resolver
 * registered nothing is ever read.
 */
function countingKnex(productCode: string | null) {
  const queries: string[] = [];
  const builder: any = {
    where: () => builder,
    first: async () => { queries.push('tenants'); return { product_code: productCode }; },
  };
  const knex: any = (table: string) => { builder.table = table; return builder; };
  knex.table = knex; knex.withSchema = () => knex;
  knex.raw = async () => { queries.push('raw'); return { rows: [] }; };
  return { knex, queries };
}

describe('workspace check cost (msp ticket page)', () => {
  afterEach(() => { resetWriteAdmissionResolver(); resetWriteAdmissionCache(); });

  it('reads nothing when no resolver is registered', async () => {
    resetWriteAdmissionResolver();
    const { knex, queries } = countingKnex('psa');
    for (let i = 0; i < 5; i++) expect(await isCoManagedWorkspace(knex, 'tenant-a')).toBe(false);
    expect(queries).toHaveLength(0);
  });

  it('pays at most one lookup for a psa tenant, then zero', async () => {
    registerWriteAdmissionResolver(async () => ({ canWrite: true }));
    const { knex, queries } = countingKnex('psa');
    for (let i = 0; i < 20; i++) expect(await isCoManagedWorkspace(knex, 'tenant-b')).toBe(false);
    expect(queries.length).toBeLessThanOrEqual(1);
    const after = queries.length;
    for (let i = 0; i < 20; i++) await isCoManagedWorkspace(knex, 'tenant-b');
    expect(queries).toHaveLength(after);
  });
});
