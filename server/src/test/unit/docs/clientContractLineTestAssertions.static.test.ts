import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../../../..');

function getTrackedTestFiles(): string[] {
  return execSync('git ls-files -- server/src/test packages/billing/tests', {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .map((filePath) => filePath.trim())
    .filter((filePath) => filePath.length > 0)
    .filter((filePath) => filePath.endsWith('.test.ts') || filePath.endsWith('.spec.ts'));
}

describe('client-contract-line test assertion hygiene (static)', () => {
  it('T022: tracked tests do not assert dropped client-contract tables as expected live runtime behavior', () => {
    const findings: string[] = [];

    for (const relativePath of getTrackedTestFiles()) {
      const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
      const lines = content.split(/\r?\n/);

      for (const [index, line] of lines.entries()) {
        const treatsClientContractLinesAsExpected =
          (line.includes("toContain('client_contract_lines'") ||
            line.includes('toContain("client_contract_lines"')) &&
          !line.includes('.not.toContain(');
        const treatsClientContractServicesAsExpected =
          (line.includes("toContain('client_contract_services'") ||
            line.includes('toContain("client_contract_services"')) &&
          !line.includes('.not.toContain(');
        const expectsDroppedClientLineTableToExist =
          (line.includes("hasTable('client_contract_lines')") ||
            line.includes('hasTable("client_contract_lines")')) &&
          line.includes('.toBe(true)');
        const expectsDroppedClientServiceTableToExist =
          (line.includes("hasTable('client_contract_services')") ||
            line.includes('hasTable("client_contract_services")')) &&
          line.includes('.toBe(true)');

        if (
          treatsClientContractLinesAsExpected ||
          treatsClientContractServicesAsExpected ||
          expectsDroppedClientLineTableToExist ||
          expectsDroppedClientServiceTableToExist
        ) {
          findings.push(`${relativePath}:${index + 1}:${line.trim()}`);
        }
      }
    }

    expect(findings).toEqual([]);
  });
});
