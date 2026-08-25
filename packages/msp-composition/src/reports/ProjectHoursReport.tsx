'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { PrintableTable, type PrintableTableColumn } from '@alga-psa/ui/components/PrintableTable';
import { getErrorMessage } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getProjectHoursReport,
  type ProjectHoursProjectRow,
  type ProjectHoursReport,
} from '@alga-psa/reporting/actions/projectReportActions';
import {
  formatHours,
  isReportActionError,
  LoadingReport,
  MetricCard,
  PrintHeader,
  PrintReportRoot,
  PrintSummary,
} from './reportPrimitives';

/** Signed hours, so "+4.5h" reads as burn past the estimate. */
function formatVariance(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${formatHours(rounded)}`;
}

function varianceClass(value: number): string {
  if (value > 0) return 'text-[rgb(var(--color-destructive))]';
  if (value < 0) return 'text-[rgb(var(--color-text-500))]';
  return 'text-[rgb(var(--color-text-700))]';
}

function EstimateBar({ percentUsed, emptyText }: { percentUsed: number | null; emptyText: string }) {
  if (percentUsed === null) {
    return <span className="text-[rgb(var(--color-text-500))]">{emptyText}</span>;
  }
  const over = percentUsed > 100;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 rounded-full bg-[rgb(var(--color-border-200))]">
        <div
          className={`h-2 rounded-full ${over ? 'bg-[rgb(var(--color-destructive))]' : 'bg-[rgb(var(--color-primary-500))]'}`}
          style={{ width: `${Math.min(100, Math.max(4, percentUsed))}%` }}
        />
      </div>
      <span className="w-14 text-right font-medium text-[rgb(var(--color-text-900))]">{percentUsed}%</span>
    </div>
  );
}

export default function ProjectHoursView() {
  const { t } = useTranslation('msp/reports');
  const [report, setReport] = useState<ProjectHoursReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    getProjectHoursReport()
      .then((data) => {
        if (isReportActionError(data)) {
          if (!cancelled) setError(getErrorMessage(data));
          return;
        }
        if (!cancelled) setReport(data);
      })
      .catch((err) => {
        console.error('Failed to load project hours report:', err);
        if (!cancelled) setError(t('reportsPage.errors.loadReport', { defaultValue: 'Failed to load report.' }));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  if (error) return <p className="text-sm text-[rgb(var(--color-destructive))]">{error}</p>;
  if (!report) return <LoadingReport />;

  const emptyText = t('reportsPage.empty.noData', { defaultValue: 'No data for this report.' });
  const noEstimateText = t('reportsPage.empty.noEstimate', { defaultValue: 'n/a — no estimate set' });
  const printTitle = t('reportsPage.reportCatalog.projectHours.title', { defaultValue: 'Project Hours vs Estimates' });
  const printSubtitle = t('reportsPage.dateRange.allActiveProjects', { defaultValue: 'All active projects, life-to-date' });

  const summaryMetrics = [
    { label: t('reportsPage.metrics.activeProjects', { defaultValue: 'Active projects' }), value: report.summary.projects },
    { label: t('reportsPage.metrics.budgetedHours', { defaultValue: 'Budgeted hours' }), value: formatHours(report.summary.budgetedHours) },
    { label: t('reportsPage.metrics.estimatedHours', { defaultValue: 'Estimated hours' }), value: formatHours(report.summary.estimatedHours) },
    { label: t('reportsPage.metrics.actualHours', { defaultValue: 'Actual hours' }), value: formatHours(report.summary.actualHours) },
    { label: t('reportsPage.metrics.projectsOverEstimate', { defaultValue: 'Over estimate' }), value: report.summary.projectsOverEstimate },
    { label: t('reportsPage.metrics.projectsOverBudget', { defaultValue: 'Over budget' }), value: report.summary.projectsOverBudget },
  ];

  const projectColumns: PrintableTableColumn<ProjectHoursProjectRow>[] = [
    { key: 'project', header: t('reportsPage.table.project', { defaultValue: 'Project' }), render: (row) => row.projectName },
    { key: 'client', header: t('reportsPage.table.client', { defaultValue: 'Client' }), render: (row) => row.clientName },
    { key: 'budgeted', header: t('reportsPage.table.budgetedHours', { defaultValue: 'Budgeted' }), render: (row) => formatHours(row.budgetedHours) },
    { key: 'estimated', header: t('reportsPage.table.estimatedHours', { defaultValue: 'Estimated' }), render: (row) => formatHours(row.estimatedHours) },
    { key: 'actual', header: t('reportsPage.table.actualHours', { defaultValue: 'Actual' }), render: (row) => formatHours(row.actualHours) },
    { key: 'variance', header: t('reportsPage.table.variance', { defaultValue: 'Variance' }), render: (row) => formatVariance(row.varianceHours) },
    {
      key: 'used',
      header: t('reportsPage.table.estimateUsed', { defaultValue: 'Estimate used' }),
      render: (row) => (row.percentUsed === null ? noEstimateText : `${row.percentUsed}%`),
    },
  ];

  type OverrunRow = (typeof report.topOverruns)[number];
  const overrunColumns: PrintableTableColumn<OverrunRow>[] = [
    { key: 'task', header: t('reportsPage.table.task', { defaultValue: 'Task' }), render: (row) => row.taskName },
    { key: 'project', header: t('reportsPage.table.project', { defaultValue: 'Project' }), render: (row) => row.projectName },
    { key: 'phase', header: t('reportsPage.table.phase', { defaultValue: 'Phase' }), render: (row) => row.phaseName },
    { key: 'estimated', header: t('reportsPage.table.estimatedHours', { defaultValue: 'Estimated' }), render: (row) => formatHours(row.estimatedHours) },
    { key: 'actual', header: t('reportsPage.table.actualHours', { defaultValue: 'Actual' }), render: (row) => formatHours(row.actualHours) },
    { key: 'variance', header: t('reportsPage.table.variance', { defaultValue: 'Variance' }), render: (row) => formatVariance(row.varianceHours) },
  ];

  return (
    <>
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {summaryMetrics.map((metric) => (
            <MetricCard key={metric.label} label={metric.label} value={metric.value} />
          ))}
        </div>
        <div className="rounded-md border border-[rgb(var(--color-border-200))]">
          <div className="border-b border-[rgb(var(--color-border-200))] p-4">
            <h3 className="text-sm font-semibold text-[rgb(var(--color-text-900))]">
              {t('reportsPage.sections.hoursByProject', { defaultValue: 'Hours by project' })}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[rgb(var(--color-border-200))] text-sm">
              <thead className="bg-[rgb(var(--color-border-100))]">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-[rgb(var(--color-text-600))]">{t('reportsPage.table.project', { defaultValue: 'Project' })}</th>
                  <th className="px-4 py-3 text-right font-medium text-[rgb(var(--color-text-600))]">{t('reportsPage.table.budgetedHours', { defaultValue: 'Budgeted' })}</th>
                  <th className="px-4 py-3 text-right font-medium text-[rgb(var(--color-text-600))]">{t('reportsPage.table.estimatedHours', { defaultValue: 'Estimated' })}</th>
                  <th className="px-4 py-3 text-right font-medium text-[rgb(var(--color-text-600))]">{t('reportsPage.table.actualHours', { defaultValue: 'Actual' })}</th>
                  <th className="px-4 py-3 text-right font-medium text-[rgb(var(--color-text-600))]">{t('reportsPage.table.variance', { defaultValue: 'Variance' })}</th>
                  <th className="px-4 py-3 text-left font-medium text-[rgb(var(--color-text-600))]">{t('reportsPage.table.estimateUsed', { defaultValue: 'Estimate used' })}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgb(var(--color-border-200))]">
                {report.projects.length === 0 ? (
                  <tr>
                    <td className="px-4 py-5 text-[rgb(var(--color-text-500))]" colSpan={6}>
                      {emptyText}
                    </td>
                  </tr>
                ) : (
                  report.projects.map((project) => {
                    const expanded = expandedProjectId === project.projectId;
                    const ExpandIcon = expanded ? ChevronDown : ChevronRight;
                    return [
                      <tr key={project.projectId}>
                        <td className="px-4 py-3">
                          <button
                            id={`project-hours-toggle-${project.projectId}`}
                            type="button"
                            className="flex items-start gap-2 text-left"
                            aria-expanded={expanded}
                            onClick={() => setExpandedProjectId(expanded ? null : project.projectId)}
                          >
                            <ExpandIcon className="mt-0.5 h-4 w-4 text-[rgb(var(--color-text-500))]" />
                            <span>
                              <span className="block font-medium text-[rgb(var(--color-text-900))]">{project.projectName}</span>
                              <span className="block text-xs text-[rgb(var(--color-text-500))]">
                                {project.clientName || project.projectNumber}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right text-[rgb(var(--color-text-700))]">{formatHours(project.budgetedHours)}</td>
                        <td className="px-4 py-3 text-right text-[rgb(var(--color-text-700))]">{formatHours(project.estimatedHours)}</td>
                        <td className="px-4 py-3 text-right text-[rgb(var(--color-text-700))]">{formatHours(project.actualHours)}</td>
                        <td className={`px-4 py-3 text-right font-medium ${varianceClass(project.varianceHours)}`}>
                          {formatVariance(project.varianceHours)}
                        </td>
                        <td className="px-4 py-3">
                          <EstimateBar percentUsed={project.percentUsed} emptyText={noEstimateText} />
                        </td>
                      </tr>,
                      expanded ? (
                        <tr key={`${project.projectId}-phases`} className="bg-[rgb(var(--color-border-50))]">
                          <td className="px-4 py-3" colSpan={6}>
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--color-text-500))]">
                              {t('reportsPage.sections.hoursByPhase', { defaultValue: 'Hours by phase' })}
                            </p>
                            {project.phases.length === 0 ? (
                              <p className="text-sm text-[rgb(var(--color-text-500))]">{emptyText}</p>
                            ) : (
                              <ul className="space-y-2">
                                {project.phases.map((phase) => (
                                  <li key={phase.phaseId} className="grid gap-2 text-sm md:grid-cols-[1fr_90px_90px_90px_110px]">
                                    <span className="text-[rgb(var(--color-text-700))]">{phase.phaseName}</span>
                                    <span className="text-right text-[rgb(var(--color-text-700))]">{formatHours(phase.estimatedHours)}</span>
                                    <span className="text-right text-[rgb(var(--color-text-700))]">{formatHours(phase.actualHours)}</span>
                                    <span className={`text-right font-medium ${varianceClass(phase.varianceHours)}`}>
                                      {formatVariance(phase.varianceHours)}
                                    </span>
                                    <span className="text-right text-[rgb(var(--color-text-500))]">
                                      {t('reportsPage.table.tasksClosedOfTotal', {
                                        defaultValue: '{{closed}}/{{total}} tasks done',
                                        closed: phase.closedTasks,
                                        total: phase.closedTasks + phase.openTasks,
                                      })}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ) : null,
                    ];
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="rounded-md border border-[rgb(var(--color-border-200))]">
          <div className="border-b border-[rgb(var(--color-border-200))] p-4">
            <h3 className="text-sm font-semibold text-[rgb(var(--color-text-900))]">
              {t('reportsPage.sections.largestTaskOverruns', { defaultValue: 'Largest task overruns' })}
            </h3>
          </div>
          <div className="divide-y divide-[rgb(var(--color-border-200))]">
            {report.topOverruns.length === 0 ? (
              <p className="p-4 text-sm text-[rgb(var(--color-text-500))]">
                {t('reportsPage.empty.noOverruns', { defaultValue: 'No task has passed its estimate.' })}
              </p>
            ) : (
              report.topOverruns.map((task) => (
                <div key={task.taskId} className="grid gap-2 p-4 text-sm md:grid-cols-[2fr_1fr_90px_90px_90px]">
                  <span className="font-medium text-[rgb(var(--color-text-900))]">{task.taskName}</span>
                  <span className="text-[rgb(var(--color-text-500))]">{task.projectName}</span>
                  <span className="text-right text-[rgb(var(--color-text-700))]">{formatHours(task.estimatedHours)}</span>
                  <span className="text-right text-[rgb(var(--color-text-700))]">{formatHours(task.actualHours)}</span>
                  <span className={`text-right font-medium ${varianceClass(task.varianceHours)}`}>{formatVariance(task.varianceHours)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <PrintReportRoot>
        <PrintHeader title={printTitle} subtitle={printSubtitle} />
        <PrintSummary metrics={summaryMetrics} />
        <PrintableTable
          title={t('reportsPage.sections.hoursByProject', { defaultValue: 'Hours by project' })}
          rows={report.projects}
          columns={projectColumns}
          getRowKey={(row) => row.projectId}
          emptyMessage={emptyText}
        />
        <PrintableTable
          title={t('reportsPage.sections.largestTaskOverruns', { defaultValue: 'Largest task overruns' })}
          rows={report.topOverruns}
          columns={overrunColumns}
          getRowKey={(row) => row.taskId}
          emptyMessage={t('reportsPage.empty.noOverruns', { defaultValue: 'No task has passed its estimate.' })}
        />
      </PrintReportRoot>
    </>
  );
}
