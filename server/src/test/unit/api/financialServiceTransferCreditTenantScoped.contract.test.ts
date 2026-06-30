import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/FinancialService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('financial service transfer-credit tenant-scoped query contract', () => {
  it('uses structural tenant scoping for transfer-credit read and update roots', () => {
    const transferSection = sectionBetween('async transferCredit', 'async listClientCredits');

    expect(transferSection).toContain('tenantDb(');
    expect(transferSection).toContain(".table('credit_tracking')");
    expect(transferSection).toContain(".table('clients')");

    expect(transferSection).not.toMatch(/trx\('(?:credit_tracking|clients)'\)\s*\.(?:where|first|update|delete|select)/);
    expect(transferSection).not.toMatch(/where\(\{\s*[^}]*tenant\s*[,}]/);
  });
});
