import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const packageSource = readFileSync(new URL('./QueryBuilder.ts', import.meta.url), 'utf8');
const serverSource = readFileSync(
  new URL('../../../../../../server/src/lib/reports/builders/QueryBuilder.ts', import.meta.url),
  'utf8'
);

describe('report QueryBuilder tenant facade wiring', () => {
  it.each([
    ['package reporting builder', packageSource],
    ['server reporting builder', serverSource],
  ])('%s routes regular roots and tenant joins through tenantDb', (_label, source) => {
    expect(source).toContain("import { tenantDb } from '@alga-psa/db';");
    expect(source).toContain('return tenantDb(trx, tenant).table(queryDef.table);');
    expect(source).toContain('return tenantDb(trx, tenant).tenantJoin(');
    expect(source).toContain('private static isTenantScopeFilter(');
    expect(source).toContain('private static isTenantEqualityJoinCondition(');

    expect(source).not.toContain('let query = trx(queryDef.table);');
    expect(source).not.toContain('this.applyJoin(query, join);');
  });
});
