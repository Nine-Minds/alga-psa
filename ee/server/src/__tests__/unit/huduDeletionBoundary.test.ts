/**
 * T027/T028 — EE/CE deletion boundary for hudu_integrations (NFR7).
 *
 * hudu_integrations is EE-only: every read/write/delete must live under ee/.
 * CE runtime (server/src), CE migrations (server/migrations) and shared
 * packages (packages/, including the packages/ee stubs) must never name the
 * table, except for the shared tenant facade metadata registry. Mapping cleanup
 * is exempt because mappings live in the shared CE table
 * `tenant_external_entity_mappings`.
 *
 * Static sweep over the repo source — no DB.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd(), '..', '..');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs']);
const SHARED_PACKAGE_HUDU_METADATA_ALLOWLIST = [
  path.join('packages', 'db', 'src', 'lib', 'tenantTableMetadata.ts'),
];
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  'build',
  '.next',
  '.turbo',
  '.git',
  'playwright-report',
  'playwright-test-results',
]);

function findReferences(rootDir: string, needle: string): string[] {
  const hits: string[] = [];
  if (!fs.existsSync(rootDir)) {
    return hits;
  }

  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          stack.push(fullPath);
        }
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        continue;
      }
      if (fs.readFileSync(fullPath, 'utf8').includes(needle)) {
        hits.push(path.relative(repoRoot, fullPath));
      }
    }
  }

  return hits.sort();
}

describe('T027: hudu_integrations is referenced by EE code only', () => {
  it('CE runtime (server/src) never references hudu_integrations', () => {
    expect(findReferences(path.join(repoRoot, 'server', 'src'), 'hudu_integrations')).toEqual([]);
  });

  it('CE migrations (server/migrations) never reference hudu_integrations', () => {
    expect(findReferences(path.join(repoRoot, 'server', 'migrations'), 'hudu_integrations')).toEqual([]);
  });

  it('shared packages (including the packages/ee stubs) never reference hudu_integrations', () => {
    expect(findReferences(path.join(repoRoot, 'packages'), 'hudu_integrations')).toEqual(
      SHARED_PACKAGE_HUDU_METADATA_ALLOWLIST
    );
  });

  it('EE owns the table: the EE migration and EE repository reference it', () => {
    const eeHits = findReferences(path.join(repoRoot, 'ee'), 'hudu_integrations');

    expect(eeHits).toContain(
      path.join('ee', 'server', 'migrations', '20260609120000_create_hudu_integrations.cjs')
    );
    expect(eeHits).toContain(
      path.join('ee', 'server', 'src', 'lib', 'integrations', 'hudu', 'huduIntegrationRepository.ts')
    );
    // Every reference anywhere in the repo source lives under ee/.
    for (const hit of eeHits) {
      expect(hit.startsWith('ee/')).toBe(true);
    }
  });
});

describe('T028: hudu mapping cleanup targets the shared CE table only', () => {
  // NOTE: full T028 (CE client-delete removes integration_type='hudu' rows from
  // tenant_external_entity_mappings without touching hudu_integrations) can only
  // be exercised once the company-mapping group lands. What is verifiable now:
  // the declared mapping table is the shared CE-owned one, and nothing outside
  // ee/ names the EE-only table (covered above).

  it('the declared Hudu mapping table is the shared CE tenant_external_entity_mappings', async () => {
    const contracts = await import('../../lib/integrations/hudu/contracts');
    expect(contracts.HUDU_MAPPING_TABLE).toBe('tenant_external_entity_mappings');
  });

  it('tenant_external_entity_mappings is created by a CE migration (safe for CE cleanup)', () => {
    const ceMigrationsDir = path.join(repoRoot, 'server', 'migrations');
    const creators = fs
      .readdirSync(ceMigrationsDir)
      .filter((name) => name.endsWith('.cjs'))
      .filter((name) =>
        fs
          .readFileSync(path.join(ceMigrationsDir, name), 'utf8')
          .includes("createTable('tenant_external_entity_mappings'")
      );

    expect(creators.length).toBeGreaterThan(0);
  });

  it('no EE migration creates or drops the shared mapping table (CE owns its lifecycle)', () => {
    const eeMigrationsDir = path.join(repoRoot, 'ee', 'server', 'migrations');
    const offenders = fs
      .readdirSync(eeMigrationsDir)
      .filter((name) => name.endsWith('.cjs'))
      .filter((name) => {
        const content = fs.readFileSync(path.join(eeMigrationsDir, name), 'utf8');
        return (
          content.includes("createTable('tenant_external_entity_mappings'") ||
          content.includes("dropTable('tenant_external_entity_mappings'") ||
          content.includes("dropTableIfExists('tenant_external_entity_mappings'")
        );
      });

    expect(offenders).toEqual([]);
  });
});
