import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const localeActionFiles = [
  '../tenant-actions/tenantLocaleActions.ts',
  '../tenant-actions/tenantMspLocaleActions.ts',
  '../tenant-actions/tenantClientPortalLocaleActions.ts',
  'getInheritedLocale.ts',
  'getHierarchicalLocale.ts',
];

describe('tenant locale actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for locale setting and hierarchy roots', () => {
    for (const file of localeActionFiles) {
      const source = readFileSync(resolve(__dirname, file), 'utf8');
      expect(source).toContain('createTenantScopedQuery');
      expect(source).not.toContain(".where({ tenant })");
      expect(source).not.toContain('tenant: tenantId');
      expect(source).not.toContain('client_id: clientId, tenant');
      expect(source).not.toContain("knex('tenant_settings')\n    .where");
    }
  });
});
