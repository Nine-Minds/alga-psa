import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
const modelPath = 'packages/billing/src/models/contractTemplate.ts';

function readModel(): string {
  return fs.readFileSync(path.join(repoRoot, modelPath), 'utf8');
}

describe('contract template model tenant-scoped query contract', () => {
  it('uses structural tenant scoping for template reads, mutations, and cleanup roots', () => {
    const source = readModel();

    expect(source).toContain("import { createTenantKnex, tenantDb } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedTable(');
    expect(source).toContain('tenantDb(conn, tenant).table(table)');

    [
      'contract_templates',
      'contract_template_lines as lines',
      'contract_template_pricing_schedules',
      'contract_template_line_service_configuration',
      'contract_template_line_service_bucket_config',
      'contract_template_line_service_hourly_config',
      'contract_template_line_service_usage_config',
      'contract_line_service_bucket_config',
      'contract_line_service_hourly_config',
      'contract_line_service_hourly_configs',
      'contract_line_service_rate_tiers',
      'contract_line_service_usage_config',
      'contract_line_service_fixed_config',
      'contract_line_service_configuration',
      'contract_template_line_services',
      'contract_template_line_defaults',
      'contract_template_line_terms',
      'contract_template_line_fixed_config',
      'contract_template_lines',
      'contract_line_services',
      'contract_line_service_defaults',
      'contract_lines',
    ].forEach((table) => {
      expect(source).toContain(`tenantScopedTable(`);
      expect(source).toContain(`'${table}'`);
    });

    expect(source).not.toMatch(/\.where\(\{\s*tenant[,}]/);
    expect(source).not.toMatch(/\.where\(\{\s*'[^']*\.tenant':\s*tenant/);
    expect(source).not.toMatch(/\.where\(['"]tenant['"],\s*tenant\)/);
  });
});
