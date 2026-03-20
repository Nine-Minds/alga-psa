import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../../../..');

function getTrackedSourceFiles(relativeRoot: string): string[] {
  return execSync(`git ls-files -- ${relativeRoot}`, {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .map((filePath) => filePath.trim())
    .filter((filePath) => filePath.length > 0)
    .filter((filePath) => filePath.endsWith('.ts'));
}

function findDroppedTableRuntimeUsages(relativePaths: string[]): string[] {
  const findings: string[] = [];
  const patterns = [
    /\b(?:trx|tx|knex|db)\(['"`]client_contract_lines['"`]\)/g,
    /\b(?:trx|tx|knex|db)\(['"`]client_contract_services['"`]\)/g,
    /\b(?:join|leftJoin|innerJoin|rightJoin)\(['"`]client_contract_lines(?:\s+as\s+[^'"`]+)?['"`]/g,
    /\b(?:join|leftJoin|innerJoin|rightJoin)\(['"`]client_contract_services(?:\s+as\s+[^'"`]+)?['"`]/g,
    /\bfrom\s+client_contract_lines\b/gi,
    /\bfrom\s+client_contract_services\b/gi,
    /\bclient_contract_lines\s+as\s+/gi,
    /\bclient_contract_services\s+as\s+/gi,
  ];

  for (const relativePath of relativePaths) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(source)) {
        findings.push(`${relativePath}: ${pattern}`);
      }
    }
  }

  return findings;
}

function findTemplateProvenanceLiveJoinUsages(relativePaths: string[]): string[] {
  const findings: string[] = [];
  const pattern = /coalesce\s*\(\s*cc\.template_contract_id\s*,\s*cc\.contract_id\s*\)/g;

  for (const relativePath of relativePaths) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    pattern.lastIndex = 0;
    if (pattern.test(source)) {
      findings.push(`${relativePath}: ${pattern}`);
    }
  }

  return findings;
}

describe('client-contract-line runtime source guards', () => {
  it('T019: no live recurring or invoicing action queries dropped client-contract line tables', () => {
    const findings = findDroppedTableRuntimeUsages(
      getTrackedSourceFiles('packages/billing/src/actions'),
    );

    expect(findings).toEqual([]);
  });

  it('T020: no live billing service queries dropped client-contract line tables for runtime logic', () => {
    const findings = findDroppedTableRuntimeUsages(
      getTrackedSourceFiles('packages/billing/src/services'),
    );

    expect(findings).toEqual([]);
  });

  it('live recurring loaders do not follow template provenance instead of the client-owned contract', () => {
    const findings = findTemplateProvenanceLiveJoinUsages([
      'packages/billing/src/actions/billingAndTax.ts',
      'packages/billing/src/actions/clientCadenceScheduleRegeneration.ts',
      'packages/billing/src/lib/billing/billingEngine.ts',
    ]);

    expect(findings).toEqual([]);
  });

  it('T114: client portal runtime sources do not query dropped client-contract line tables', () => {
    const findings = findDroppedTableRuntimeUsages(
      getTrackedSourceFiles('packages/client-portal/src/actions'),
    );

    expect(findings).toEqual([]);
  });

  it('T114: clients runtime sources do not query dropped client-contract line tables', () => {
    const findings = findDroppedTableRuntimeUsages([
      ...getTrackedSourceFiles('packages/clients/src/actions'),
      ...getTrackedSourceFiles('packages/clients/src/models'),
    ]);

    expect(findings).toEqual([]);
  });
});
