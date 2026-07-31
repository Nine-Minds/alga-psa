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
    .filter((filePath) => fs.existsSync(path.join(repoRoot, filePath)))
    .filter((filePath) => /\.(ts|tsx)$/.test(filePath))
    .filter((filePath) => !filePath.endsWith('.d.ts'))
    .filter((filePath) => !/(^|\/)(?:__tests__|tests?)\//.test(filePath))
    .filter((filePath) => !/\.(?:test|spec)\.[tj]sx?$/.test(filePath));
}

function stripComments(source: string): string {
  let result = '';
  let index = 0;
  let state: 'code' | 'lineComment' | 'blockComment' | 'singleQuote' | 'doubleQuote' | 'template' = 'code';

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (state === 'lineComment') {
      if (char === '\n') {
        result += char;
        state = 'code';
      }
      index += 1;
      continue;
    }

    if (state === 'blockComment') {
      if (char === '\n') {
        result += char;
      }
      if (char === '*' && next === '/') {
        index += 2;
        state = 'code';
        continue;
      }
      index += 1;
      continue;
    }

    result += char;

    if (state === 'singleQuote' || state === 'doubleQuote' || state === 'template') {
      if (char === '\\') {
        result += next ?? '';
        index += 2;
        continue;
      }

      if (
        (state === 'singleQuote' && char === "'")
        || (state === 'doubleQuote' && char === '"')
        || (state === 'template' && char === '`')
      ) {
        state = 'code';
      }

      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      result = result.slice(0, -1);
      state = 'lineComment';
      index += 2;
      continue;
    }

    if (char === '/' && next === '*') {
      result = result.slice(0, -1);
      state = 'blockComment';
      index += 2;
      continue;
    }

    if (char === "'") {
      state = 'singleQuote';
    } else if (char === '"') {
      state = 'doubleQuote';
    } else if (char === '`') {
      state = 'template';
    }

    index += 1;
  }

  return result;
}

function findDroppedTableRuntimeUsages(relativePaths: string[]): string[] {
  const findings: string[] = [];
  const patterns = [
    /\b(?:trx|tx|knex|db)\(['"`]client_contract_lines['"`]\)/g,
    /\b(?:trx|tx|knex|db)\(['"`]client_contract_services['"`]\)/g,
    /\b(?:join|leftJoin|innerJoin|rightJoin)\(['"`]client_contract_lines(?:\s+as\s+[^'"`]+)?['"`]/g,
    /\b(?:join|leftJoin|innerJoin|rightJoin)\(['"`]client_contract_services(?:\s+as\s+[^'"`]+)?['"`]/g,
    /\b(?:table|from|into|tenantScopedTable|tenantTable|contextTable|unscopedTable)\s*\([^)]*['"`]client_contract_lines(?:\s+as\s+[^'"`]+)?['"`]/g,
    /\b(?:table|from|into|tenantScopedTable|tenantTable|contextTable|unscopedTable)\s*\([^)]*['"`]client_contract_services(?:\s+as\s+[^'"`]+)?['"`]/g,
    /\bfrom\s+client_contract_lines\b/gi,
    /\bfrom\s+client_contract_services\b/gi,
    /\bclient_contract_lines\s+as\s+/gi,
    /\bclient_contract_services\s+as\s+/gi,
  ];

  for (const relativePath of relativePaths) {
    const source = stripComments(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));

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

function findMixedTemplateRuntimeFallbackUsages(relativePaths: string[]): string[] {
  const findings: string[] = [];
  const patterns = [
    /template_contract_id\s*\?\?\s*[^;\n]*contract_id/g,
    /coalesce\s*\(\s*[^)]*template_contract_id[^,]*,\s*[^)]*contract_id[^)]*\)/gi,
    /cc"\s*\.\s*"template_contract_id"\s*=\s*"c"\s*\.\s*"contract_id"/gi,
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
      'shared/billingClients/clientCadenceScheduleRegeneration.ts',
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

  it('runtime package and shared sources do not query dropped client-contract line tables', () => {
    const findings = findDroppedTableRuntimeUsages([
      ...getTrackedSourceFiles('packages'),
      ...getTrackedSourceFiles('shared'),
    ]);

    expect(findings).toEqual([]);
  });

  it('T017: targeted runtime packages and scripts reject mixed template/runtime fallback patterns', () => {
    const findings = findMixedTemplateRuntimeFallbackUsages([
      'packages/clients/src/actions/clientContractActions.ts',
      'packages/clients/src/actions/clientContractLineActions.ts',
      'server/src/lib/api/services/ContractLineService.ts',
      'server/scripts/contract-template-decoupling.ts',
      'packages/billing/src/models/contract.ts',
    ]);

    expect(findings).toEqual([]);
  });
});
