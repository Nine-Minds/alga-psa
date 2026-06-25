// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

describe('quote API service tenant-scoped query contract', () => {
  it('uses structural tenant scoping for custom quote roots', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'server/src/lib/api/services/QuoteService.ts'),
      'utf8'
    );

    expect(source).toContain('createTenantScopedQuery(trx, {');
    expect(source).toContain("table: 'quotes as q'");
    expect(source).toContain("alias: 'q'");
    expect(source).toContain("table: 'clients'");
    expect(source).toContain("table: 'default_billing_settings'");
    expect(source).toContain("table: 'quote_items'");
    expect(source).not.toContain("alias: 'clients'");
    expect(source).not.toContain("alias: 'default_billing_settings'");
    expect(source).not.toContain("alias: 'quote_items'");
    expect(source).not.toMatch(/trx\('quotes as q'\)[\s\S]*?\.where\('q\.tenant', context\.tenant\)/);
    expect(source).not.toMatch(/trx\('clients'\)[\s\S]*?tenant: context\.tenant/);
    expect(source).not.toMatch(/trx\('default_billing_settings'\)[\s\S]*?tenant: context\.tenant/);
    expect(source).not.toMatch(/trx\('quote_items'\)[\s\S]*?tenant: context\.tenant/);
  });
});
