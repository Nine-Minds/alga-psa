import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/contractReportActions.ts', import.meta.url),
  'utf8'
);

describe('contractReportActions summary wiring', () => {
  it('exposes at-risk count based on decision_due_date windows', () => {
    expect(source).toContain('export interface ContractReportSummary {');
    expect(source).toContain('atRiskDecisionCount: number;');
    expect(source).toContain('const summaryTodayDateOnly = today.toISOString().slice(0, 10);');
    expect(source).toContain("inNinetyDays.setUTCDate(inNinetyDays.getUTCDate() + 90);");
    expect(source).toContain("const atRiskDecisions = await knex('client_contracts as cc')");
    expect(source).toContain(".whereNotNull('cc.decision_due_date')");
    expect(source).toContain(".andWhere('cc.decision_due_date', '>=', summaryTodayDateOnly)");
    expect(source).toContain(".andWhere('cc.decision_due_date', '<=', summaryNinetyDaysDateOnly)");
    expect(source).toContain(".countDistinct('cc.client_contract_id as count')");
    expect(source).toContain('atRiskDecisionCount');
  });
});
