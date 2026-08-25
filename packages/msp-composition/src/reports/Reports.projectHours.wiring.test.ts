// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const catalog = readFileSync(resolve(__dirname, './Reports.tsx'), 'utf8');
const view = readFileSync(resolve(__dirname, './ProjectHoursReport.tsx'), 'utf8');

describe('Project Hours report wiring', () => {
  it('is listed in the catalog and rendered from the selected-report switch', () => {
    expect(catalog).toContain("id: 'project-hours'");
    expect(catalog).toContain("titleKey: 'reportsPage.reportCatalog.projectHours.title'");
    expect(catalog).toContain("category: 'operations'");
    expect(catalog).toContain("products: ['psa'],\n    minimumTier: 'pro',\n    kind: 'embedded',\n    icon: Target,");
    expect(catalog).toContain("selectedReportId === 'project-hours' ? (");
    expect(catalog).toContain('<ProjectHoursView />');
  });

  it('labels the panel as life-to-date rather than the selected day range', () => {
    // Budget-versus-actual is cumulative, so the 7/30/90d selector does not
    // narrow it; showing "Last 30 days" over these numbers would be a lie.
    expect(catalog).toContain("selectedReportId === 'project-hours'");
    expect(catalog).toContain("t('reportsPage.dateRange.allActiveProjects'");
  });

  it('handles the loading and error states of the report action', () => {
    expect(view).toContain('getProjectHoursReport()');
    expect(view).toContain('if (isReportActionError(data))');
    expect(view).toContain('if (error) return');
    expect(view).toContain('if (!report) return <LoadingReport />;');
    expect(view).toContain('cancelled = true;');
  });

  it('renders estimate-aware metrics, including projects with no estimate', () => {
    expect(view).toContain("t('reportsPage.metrics.budgetedHours'");
    expect(view).toContain("t('reportsPage.metrics.estimatedHours'");
    expect(view).toContain("t('reportsPage.metrics.actualHours'");
    expect(view).toContain("t('reportsPage.metrics.projectsOverEstimate'");
    expect(view).toContain("t('reportsPage.empty.noEstimate'");
    expect(view).toContain('percentUsed === null');
  });

  it('provides a print variant of the summary and both tables', () => {
    expect(view).toContain('<PrintReportRoot>');
    expect(view).toContain('<PrintHeader title={printTitle} subtitle={printSubtitle} />');
    expect(view).toContain('<PrintSummary metrics={summaryMetrics} />');
    expect(view).toContain('<PrintableTable');
    expect(view).toContain('emptyMessage={emptyText}');
  });

  it('shares the report chrome with the other embedded views instead of copying it', () => {
    expect(view).toContain("} from './reportPrimitives';");
    expect(catalog).toContain("} from './reportPrimitives';");
  });
});
