import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/contractReportActions.ts', import.meta.url),
  'utf8'
);

describe('contractReportActions summary wiring', () => {
  it('derives YTD totals from the canonical recurring revenue helper instead of raw invoice headers', () => {
    expect(source).toContain('async function getContractRevenueYtdByAssignment(');
    expect(source).toContain('await getContractRevenueYtdByAssignment(');
    expect(source).not.toContain("const ytdResult = await knex('invoices')");
  });

  it('exposes at-risk count based on decision_due_date windows', () => {
    expect(source).toContain('export interface ContractReportSummary {');
    expect(source).toContain('atRiskDecisionCount: number;');
    expect(source).toContain('const summaryTodayDateOnly = today.toISOString().slice(0, 10);');
    expect(source).toContain("inNinetyDays.setUTCDate(inNinetyDays.getUTCDate() + 90);");
    // Tenant scoping now lives in the facade: db.table() scopes the at-risk read to the
    // tenant and db.tenantJoin() scopes the contracts join, replacing the raw knex('...') call.
    expect(source).toContain("const atRiskDecisionQuery = db.table('client_contracts as cc')");
    expect(source).toContain(
      "db.tenantJoin(atRiskDecisionQuery, 'contracts as c', 'cc.contract_id', 'c.contract_id');"
    );
    expect(source).toContain('const atRiskDecisions = await atRiskDecisionQuery.first()');
    expect(source).toContain(".whereNotNull('cc.decision_due_date')");
    expect(source).toContain(".andWhere((builder) => {\n        builder.whereNull('cc.start_date').orWhere('cc.start_date', '<=', summaryTodayDateOnly);\n      })");
    expect(source).toContain(".andWhere((builder) => {\n        builder.whereNull('cc.end_date').orWhere('cc.end_date', '>=', summaryTodayDateOnly);\n      })");
    expect(source).toContain(".andWhere('cc.decision_due_date', '>=', summaryTodayDateOnly)");
    expect(source).toContain(".andWhere('cc.decision_due_date', '<=', summaryNinetyDaysDateOnly)");
    expect(source).toContain(".countDistinct('cc.client_contract_id as count')");
    expect(source).not.toContain("'c.status': 'active'");
    expect(source).toContain('atRiskDecisionCount');
  });
});
