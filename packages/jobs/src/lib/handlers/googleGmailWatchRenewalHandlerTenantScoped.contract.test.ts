import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'googleGmailWatchRenewalHandler.ts'), 'utf8');

describe('Google Gmail watch renewal handler tenant-scoped query contract', () => {
  it('uses structural tenant scoping for aliased email provider roots', () => {
    expect(source).toContain('createTenantScopedQuery');
    expect(source).toContain("table: 'email_providers as ep'");
    expect(source).toContain('tenant: tenantId');
    expect(source).not.toContain(".andWhere('ep.tenant', tenantId)");
    expect(source).not.toContain(".where('ep.tenant', tenantId)");
  });
});
