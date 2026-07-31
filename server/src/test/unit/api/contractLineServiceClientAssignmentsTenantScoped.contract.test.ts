import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/ContractLineService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('contract line service client-assignment tenant-scoped query contract', () => {
  it('uses structural tenant scoping for client assignment read and update roots', () => {
    const assignmentSection = sectionBetween(
      '// COMPANY ASSIGNMENT OPERATIONS',
      '// PLAN ACTIVATION AND LIFECYCLE'
    );

    expect(assignmentSection).toContain('tenantDb(');
    expect(assignmentSection).toContain('tenantDb(');
    expect(assignmentSection).toContain(".table('contract_lines as cl')");
    expect(assignmentSection).toContain(".table('client_contracts')");
    expect(assignmentSection).toContain(".table('contract_lines')");

    expect(assignmentSection).not.toMatch(/knex\('contract_lines as cl'\)\s*\./);
    expect(assignmentSection).not.toMatch(/trx\('client_contracts'\)\s*\.(?:where|first)/);
    expect(assignmentSection).not.toMatch(/trx\('contract_lines as cl'\)\s*\./);
    expect(assignmentSection).not.toMatch(/trx\('contract_lines'\)\s*\.(?:where|update|delete)/);
    expect(assignmentSection).not.toMatch(/\.where\('(?:cl\.)?tenant', context\.tenant\)/);
  });
});
