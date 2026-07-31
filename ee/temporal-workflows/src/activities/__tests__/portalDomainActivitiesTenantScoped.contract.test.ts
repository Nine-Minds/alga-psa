import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../portal-domain-activities.ts'), 'utf8');

describe('portal domain activities tenant-scoped query contract', () => {
  it('deletes portal domain records through tenantDb when tenant context is available', () => {
    expect(source).toContain('import { tenantDb } from "@alga-psa/db";');
    expect(source).toContain('tenantDb(knex, args.tenantId)');
    expect(source).toContain('.table(TABLE_NAME)');
    expect(source).not.toContain('.where({ id: args.portalDomainId, tenant: args.tenantId })');
  });
});
