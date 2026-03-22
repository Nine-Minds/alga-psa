import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('service catalog mode defaults backfill migration', () => {
  const migration = readRepoFile('server/migrations/20260321113000_backfill_service_catalog_mode_defaults.cjs');

  it('T004: backfills mode-default rows from service_prices and service_catalog fallback defaults without distributed/local SQL joins', () => {
    expect(migration).toContain("const normalizeBillingMode = (billingMethod) =>");
    expect(migration).toContain("const servicePrices = await knex('service_prices')");
    expect(migration).toContain("const activeServices = await knex('service_catalog as sc')");
    expect(migration).toContain("await knex('service_catalog_mode_defaults')");
    expect(migration).toContain(".onConflict(['tenant', 'service_id', 'billing_mode', 'currency_code'])");
    expect(migration).not.toContain('FROM service_prices sp\n    INNER JOIN service_catalog sc');
  });

  it('T005: fails fast when source billing modes are unmappable or required defaults remain missing', () => {
    expect(migration).toContain('encountered unmappable billing_method values');
    expect(migration).toContain('Backfill failed; required mode-default mappings are missing for active services');
    expect(migration).toContain('!ALLOWED_BILLING_MODES.includes(normalizeBillingMode(row.billing_method))');
    expect(migration).toContain('return !insertedKeys.has');
  });
});
