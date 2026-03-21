import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('service catalog mode defaults backfill migration', () => {
  const migration = readRepoFile('server/migrations/20260321113000_backfill_service_catalog_mode_defaults.cjs');

  it('T004: backfills mode-default rows from service_prices and service_catalog fallback defaults', () => {
    expect(migration).toContain('INSERT INTO service_catalog_mode_defaults');
    expect(migration).toContain('FROM service_prices sp');
    expect(migration).toContain("CASE sc.billing_method WHEN 'per_unit' THEN 'usage' ELSE sc.billing_method END");
    expect(migration).toContain("COALESCE(sc.currency_code, 'USD')");
    expect(migration).toContain('AND NOT EXISTS (');
    expect(migration).toContain('FROM service_prices sp');
  });

  it('T005: fails fast when source billing modes are unmappable or required defaults remain missing', () => {
    expect(migration).toContain('encountered unmappable billing_method values');
    expect(migration).toContain('Backfill failed; required mode-default mappings are missing for active services');
    expect(migration).toContain('whereNotIn(normalizeBillingMode, ALLOWED_BILLING_MODES)');
    expect(migration).toContain('.andWhereNotExists(');
  });
});
