import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

describe('client-owned contract report definitions', () => {
  it('uses client_contracts as the live fact table in the revenue definition', () => {
    const revenueDefinition = read('../packages/reporting/src/lib/reports/definitions/contracts/revenue.ts');

    expect(revenueDefinition).toContain("table: 'client_contracts'");
    expect(revenueDefinition).toContain("{ left: 'client_contracts.contract_id', right: 'contract_lines.contract_id' }");
    expect(revenueDefinition).toContain("{ field: 'client_contracts.is_active', operator: 'eq', value: true }");
    expect(revenueDefinition).not.toContain("{ field: 'contracts.is_active', operator: 'eq', value: true }");
  });

  it('keeps the expiration definition assignment-first instead of falling back to contracts.is_active', () => {
    const expirationDefinition = read('../packages/reporting/src/lib/reports/definitions/contracts/expiration.ts');

    expect(expirationDefinition).toContain("table: 'client_contracts'");
    expect(expirationDefinition).toContain("{ field: 'client_contracts.is_active', operator: 'eq', value: true }");
    expect(expirationDefinition).not.toContain("{ field: 'contracts.is_active', operator: 'eq', value: true }");
  });
});
