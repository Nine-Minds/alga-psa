// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, './Reports.tsx'), 'utf8');

const view = (() => {
  const start = source.indexOf('function EmployeeUtilizationView(');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, end);
})();

describe('Employee Utilization report wiring', () => {
  it('is listed in the catalog and rendered from the selected-report switch', () => {
    expect(source).toContain("id: 'employee-utilization'");
    expect(source).toContain("titleKey: 'reportsPage.reportCatalog.employeeUtilization.title'");
    expect(source).toContain("category: 'operations'");
    expect(source).toContain("minimumTier: 'pro'");
    expect(source).toContain("selectedReportId === 'employee-utilization' ? (");
    expect(source).toContain('<EmployeeUtilizationView range={range} onWindowLoaded={setLoadedWindow} />');
  });

  it('handles the loading and error states of the report action', () => {
    expect(view).toContain('getEmployeeUtilizationReport(range)');
    expect(view).toContain('if (isReportActionError(data))');
    expect(view).toContain('if (error) return');
    expect(view).toContain('if (!report) return <LoadingReport />;');
    // The effect re-runs per range — preset or custom — and drops results from
    // a stale one.
    expect(view).toContain('}, [range, t, onWindowLoaded]);');
    expect(view).toContain('cancelled = true;');
  });

  it('switches to a custom window only once both bounds are picked, and back on a preset', () => {
    expect(source).toContain('<DateRangePicker');
    expect(source).toContain('customRange.from && customRange.to');
    expect(source).toContain('formatLocalYMD(customRange.from)');
    // A complete span the report cannot cover is checked, not sent.
    expect(source).toContain('checkReportDateRange(picked');
    expect(source).toContain('customPick && !customPick.problem ? customPick.range : rangeDays');
    // Clicking a preset clears the custom span rather than leaving two filters on.
    expect(source).toContain("setCustomRange({ from: undefined, to: undefined });");
    // The subtitle labels a custom span by its bounds, not as "last N days",
    // and the header follows the window the server echoed once it has one.
    expect(source).toContain("t('reportsPage.dateRange.customRange'");
    expect(source).toContain('loadedWindow ??');
  });

  it('renders capacity-aware metrics, including employees without capacity', () => {
    expect(view).toContain("t('reportsPage.metrics.workedHours'");
    expect(view).toContain("t('reportsPage.metrics.capacityHours'");
    expect(view).toContain("t('reportsPage.metrics.utilization'");
    expect(view).toContain("t('reportsPage.metrics.usersWithoutCapacity'");
    expect(view).toContain('report.summary.usersWithoutCapacity');
    expect(view).toContain("t('reportsPage.empty.noCapacity'");
    expect(view).toContain('row.utilizationPercent === null ?');
    expect(view).toContain('report.summary.overallUtilizationPercent === null');
  });

  it('provides a print variant of the summary and the per-user table', () => {
    expect(view).toContain('<PrintReportRoot>');
    expect(view).toContain('<PrintHeader title={printTitle} subtitle={printSubtitle} />');
    expect(view).toContain('<PrintSummary');
    expect(view).toContain('<PrintableTable');
    expect(view).toContain('emptyMessage={emptyText}');
  });
});
