import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../../../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('contract line repositories tenant-scoped query contract', () => {
  const repositoryPaths = [
    'packages/billing/src/repositories/contractLineRepository.ts',
    'server/src/lib/repositories/contractLineRepository.ts',
  ];

  it.each(repositoryPaths)('uses structural tenant scoping for top read and attachment roots in %s', (relativePath) => {
    const source = readRepoFile(relativePath);
    const section = sectionBetween(source, 'async function isTemplateContract', 'export async function ensureTemplateLineSnapshot');

    expect(source).toContain("import { createTenantScopedQuery } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedTable(knex: TenantScopedKnex, tenant: string, table: string): Knex.QueryBuilder');
    expect(source).toContain('createTenantScopedQuery(knex, { table, tenant }).builder');

    expect(section).toContain("tenantScopedTable(knex, tenant, 'contract_templates')");
    expect(section).toContain("tenantScopedTable(knex, tenant, 'contract_template_lines')");
    expect(section).toContain("tenantScopedTable(knex, tenant, 'contract_lines')");
    expect(section).toContain("tenantScopedTable(knex, tenant, 'contract_template_lines as lines')");
    expect(section).toContain("tenantScopedTable(knex, tenant, 'contract_lines as cl')");

    expect(section).not.toMatch(/\.where\(\{\s*tenant[,}]/);
    expect(section).not.toMatch(/\.where\(\{\s*'[^']*\.tenant':\s*tenant/);
    expect(section).not.toMatch(/\.where\(['"]tenant['"],\s*tenant\)/);
  });

  it.each(repositoryPaths)('uses structural tenant scoping for template snapshot and clone roots in %s', (relativePath) => {
    const source = readRepoFile(relativePath);
    const section = sectionBetween(source, 'export async function ensureTemplateLineSnapshot', 'export async function addContractLine');

    expect(section).toContain("tenantScopedTable(knex, tenant, 'contract_template_lines')");
    expect(section).toContain("tenantScopedTable(knex, tenant, 'contract_lines')");
    expect(section).toContain("tenantScopedTable(trx, tenant, 'contract_template_lines')");
    expect(section).toContain("tenantScopedTable(trx, tenant, 'contract_template_line_fixed_config')");
    expect(section).toContain("tenantScopedTable(trx, tenant, 'contract_template_line_services')");
    expect(section).toContain("tenantScopedTable(trx, tenant, 'contract_template_line_service_configuration')");
    expect(section).toContain("tenantScopedTable(trx, tenant, 'contract_template_line_service_bucket_config')");
    expect(section).toContain("tenantScopedTable(trx, tenant, 'contract_template_line_service_hourly_config')");
    expect(section).toContain("tenantScopedTable(trx, tenant, 'contract_template_line_service_usage_config')");
    expect(section).toContain("tenantScopedTable(trx, tenant, 'contract_template_line_defaults')");

    expect(section).not.toMatch(/\.where\(\{\s*tenant[,}]/);
    expect(section).not.toMatch(/\.where\(\{\s*'[^']*\.tenant':\s*tenant/);
    expect(section).not.toMatch(/\.where\(['"]tenant['"],\s*tenant\)/);
  });
});
