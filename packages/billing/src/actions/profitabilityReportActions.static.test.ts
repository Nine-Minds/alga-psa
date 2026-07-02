import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.resolve(testDir, 'profitabilityReportActions.ts'), 'utf8');
const repoRoot = path.resolve(testDir, '../../../..');

describe('profitability report action SQL contracts', () => {
  it('counts the required earned-revenue invoice statuses and excludes non-countable statuses by allow-list', () => {
    for (const status of ['sent', 'paid', 'partially_applied', 'overdue', 'open', 'completed', 'Unpaid']) {
      expect(source).toContain(`'${status}'`);
    }
    expect(source).toContain('inv.status = ANY(?::text[])');
  });

  it('uses fixed-detail allocated amounts when present and net_amount otherwise', () => {
    expect(source).toContain('COUNT(iifd.item_detail_id) FILTER (WHERE iifd.item_detail_id IS NOT NULL) > 0');
    expect(source).toContain('SUM(iifd.allocated_amount)');
    expect(source).toContain('MAX(ic.net_amount)');
  });

  it('normalizes invoice currency and flags unconverted foreign revenue with null exchange rates', () => {
    expect(source).toContain('exchange_rate_basis_points');
    expect(source).toContain('ROUND((cd.amount_cents::numeric * cd.exchange_rate_basis_points::numeric) / 10000)');
    expect(source).toContain('cd.exchange_rate_basis_points IS NULL) AS unconverted');
  });

  it('costs labor by work_date, actual duration, resolved cost rate, and approval warning minutes', () => {
    expect(source).toContain('te.work_date >= ?::date');
    expect(source).toContain('te.work_date <= ?::date');
    expect(source).toContain('GREATEST(0, EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60)');
    expect(source).toContain('FROM user_cost_rates ucr');
    expect(source).toContain('ORDER BY ucr.user_id IS NULL, ucr.effective_from DESC, ucr.rate_id');
    expect(source).toContain("fact.approval_status !== 'APPROVED'");
  });

  it('attributes time-entry clients through all supported work item types', () => {
    expect(source).toContain("WHEN te.work_item_type = 'ticket' THEN t.client_id");
    expect(source).toContain("WHEN te.work_item_type = 'project_task' THEN p.client_id");
    expect(source).toContain("WHEN te.work_item_type = 'interaction' THEN i.client_id");
    expect(source).toContain("WHEN te.work_item_type = 'appointment_request' THEN ar.client_id");
  });

  it('routes agreement cost through contract_lines to client_contracts without client_contract_lines', () => {
    expect(source).toContain('LEFT JOIN contract_lines cli');
    expect(source).toContain('cc_inner.contract_id = c.contract_id');
    expect(source).toContain('ORDER BY cc_inner.start_date DESC, cc_inner.client_contract_id');
    expect(source).not.toContain('client_contract_lines');
  });

  it('dates material cost/revenue per PRD rules and flags uncosted and currency-mismatched materials', () => {
    expect(source).toContain("FROM ticket_materials tm");
    expect(source).toContain("FROM project_materials pm");
    expect(source).toContain("(mr.created_at AT TIME ZONE 'UTC')::date");
    expect(source).toContain('(sc.cost IS NULL) AS uncosted');
    expect(source).toContain('(COALESCE(mr.currency_code, ?) <> ?) AS currency_mismatch');
  });

  it('attributes ticket hourly revenue only through item_id-linked invoice time entries', () => {
    expect(source).toContain('FROM invoice_time_entries ite');
    expect(source).toContain('AND ic.item_id = ite.item_id');
    expect(source).toContain('AND ite.item_id IS NOT NULL');
    expect(source).toContain('SUM(COALESCE(te.billable_duration, 0)) OVER (PARTITION BY ic.item_id)');
    expect(source).toContain('item_amount_cents::numeric * billable_minutes::numeric');
  });

  it('allocates only fixed and bucket detail charges with resolvable service or invoice windows', () => {
    expect(source).toContain('WITH allocation_charges');
    expect(source).toContain("LOWER(COALESCE(cl.contract_line_type, '')) IN ('fixed', 'bucket')");
    expect(source).toContain('COALESCE(iid.service_period_start::date, inv.billing_period_start::date) AS window_start');
    expect(source).toContain('COALESCE(iid.service_period_end::date, inv.billing_period_end::date) AS window_end');
    expect(source).toContain('COALESCE(iid.service_period_start::date, inv.billing_period_start::date) IS NOT NULL');
    expect(source).toContain('COALESCE(iid.service_period_end::date, inv.billing_period_end::date) IS NOT NULL');
  });

  it('uses largest-remainder ticket allocation for fixed and bucket cents', () => {
    expect(source).toContain('function allocateCents');
    expect(source).toContain('remaining = absoluteAmount - allocations.reduce');
    expect(source).toContain('right.remainder - left.remainder || left.ticketId.localeCompare(right.ticketId)');
  });

  it('keeps tenant predicates in raw query joins', () => {
    expect(source).toContain('WHERE ic.tenant = ?');
    expect(source).toContain('AND inv.tenant = ?');
    expect(source).toContain('ON inv.tenant = ic.tenant');
    expect(source).toContain('ON t.tenant = te.tenant');
    expect(source).toContain('ON sc.tenant = ?');
  });

  it('removes the old contract-report profitability stub and registry definition', () => {
    const contractReportActions = readFileSync(path.resolve(testDir, 'contractReportActions.ts'), 'utf8');
    const reportRegistry = readFileSync(path.resolve(repoRoot, 'packages/reporting/src/lib/reports/core/ReportRegistry.ts'), 'utf8');
    const contractDefinitionsIndex = readFileSync(path.resolve(repoRoot, 'packages/reporting/src/lib/reports/definitions/contracts/index.ts'), 'utf8');

    expect(contractReportActions).not.toContain('getProfitabilityReport');
    expect(contractReportActions).not.toContain('interface Profitability');
    expect(reportRegistry).not.toContain('contractProfitabilityReport');
    expect(contractDefinitionsIndex).not.toContain('./profitability');
    expect(existsSync(path.resolve(repoRoot, 'packages/reporting/src/lib/reports/definitions/contracts/profitability.ts'))).toBe(false);
  });
});
