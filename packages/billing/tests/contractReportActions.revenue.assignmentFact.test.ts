import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/contractReportActions.ts', import.meta.url),
  'utf8'
);
const revenueSource = source.split('/**\n * Get contract expiration report data')[0];

describe('contractReportActions revenue wiring', () => {
  it('uses client assignments as the live fact source for revenue rows', () => {
    expect(revenueSource).toContain("const data = await knex('client_contracts as cc')");
    expect(revenueSource).toContain(".where({ 'cc.tenant': tenant })");
    expect(revenueSource).toContain(".whereNotNull('c.owner_client_id')");
    expect(revenueSource).toContain('deriveClientContractStatus({');
    expect(revenueSource).toContain('const status = mapAssignmentStatusToRevenueStatus(assignmentStatus);');
    expect(revenueSource).not.toContain("const data = await knex('contracts as c')");
    expect(revenueSource).not.toContain("row.is_active ? 'active' : 'expired'");
  });

  it('counts live summary contracts from assignment-derived revenue rows instead of contracts.is_active', () => {
    expect(source).toContain("const activeContractCount = revenueData.filter((item) => item.status === 'active').length;");
    expect(source).not.toContain("const activeContracts = await knex('contracts')");
  });
});
