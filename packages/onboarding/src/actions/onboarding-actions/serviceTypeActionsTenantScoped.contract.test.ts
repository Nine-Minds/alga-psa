import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'serviceTypeActions.ts');
const source = readFileSync(sourcePath, 'utf8');

describe('onboarding service type actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for tenant service type reads', () => {
    expect(source).toContain('createTenantScopedQuery(trx, {');
    expect(source).toContain("table: 'service_types'");
    expect(source).toContain("const [row] = await trx('service_types')");

    expect(source).not.toMatch(/trx\('service_types'\)\s*[\r\n]+\s*\.where\(\{\s*tenant/);
  });
});
