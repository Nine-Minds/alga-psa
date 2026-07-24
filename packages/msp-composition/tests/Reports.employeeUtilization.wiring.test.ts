import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/reports/Reports.tsx', import.meta.url), 'utf8');

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
    expect(source).toContain('<EmployeeUtilizationView rangeDays={rangeDays} />');
  });

  it('handles the loading and error states of the report action', () => {
    expect(view).toContain('getEmployeeUtilizationReport(rangeDays)');
    expect(view).toContain('if (isReportActionError(data))');
    expect(view).toContain('if (error) return');
    expect(view).toContain('if (!report) return <LoadingReport />;');
    // The effect re-runs per range and drops results from a stale range.
    expect(view).toContain('}, [rangeDays, t]);');
    expect(view).toContain('cancelled = true;');
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
