import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('tenant default tax rate tenant deletion ordering', () => {
  const source = readRepoFile('ee/temporal-workflows/src/activities/tenant-deletion-activities.ts');

  it('deletes tax_rates before tenant_settings, so the RESTRICT FK must be cleared first', () => {
    const taxRatesIndex = source.indexOf("'tax_components', 'tax_rates', 'tax_regions'");
    const tenantSettingsIndex = source.indexOf("\n  'tenant_settings',\n];");

    expect(taxRatesIndex).toBeGreaterThan(-1);
    expect(tenantSettingsIndex).toBeGreaterThan(-1);
    expect(taxRatesIndex).toBeLessThan(tenantSettingsIndex);
  });

  it('clears tenant_settings.default_tax_rate_id before the table order runs', () => {
    // tenant_settings.default_tax_rate_id references tax_rates ON DELETE
    // RESTRICT; deleting tax_rates first would otherwise be skipped and leave
    // the tenant's tax rates behind.
    expect(source).toContain('.update({ default_tax_rate_id: null })');
    expect(source).toContain('Cleared default_tax_rate_id references in tenant_settings');
  });
});
