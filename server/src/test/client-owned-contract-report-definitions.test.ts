import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

describe('client-owned contract report definitions', () => {
  it('uses client_contracts as the live fact table in both revenue definition copies', () => {
    const serverRevenueDefinition = read('src/lib/reports/definitions/contracts/revenue.ts');
    const sharedRevenueDefinition = read('../packages/reporting/src/lib/reports/definitions/contracts/revenue.ts');

    for (const source of [serverRevenueDefinition, sharedRevenueDefinition]) {
      expect(source).toContain("table: 'client_contracts'");
      expect(source).toContain("{ left: 'client_contracts.contract_id', right: 'contract_lines.contract_id' }");
      expect(source).toContain("{ field: 'client_contracts.is_active', operator: 'eq', value: true }");
      expect(source).not.toContain("{ field: 'contracts.is_active', operator: 'eq', value: true }");
    }
  });

  it('keeps expiration definitions assignment-first instead of falling back to contracts.is_active', () => {
    const serverExpirationDefinition = read('src/lib/reports/definitions/contracts/expiration.ts');
    const sharedExpirationDefinition = read('../packages/reporting/src/lib/reports/definitions/contracts/expiration.ts');

    for (const source of [serverExpirationDefinition, sharedExpirationDefinition]) {
      expect(source).toContain("table: 'client_contracts'");
      expect(source).toContain("{ field: 'client_contracts.is_active', operator: 'eq', value: true }");
      expect(source).not.toContain("{ field: 'contracts.is_active', operator: 'eq', value: true }");
    }
  });
});
