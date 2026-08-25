// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getProjectHoursReport = vi.fn();

// The server-suite setup stubs this hook with empty automationIdProps, which
// strips DOM ids off UI Buttons — this test locates cards by #reports-view-*,
// so echo ids back with a local stub (same pattern as
// Reports.employeeUtilization.render.test.tsx).
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: (params?: { id?: string }) => ({
    automationIdProps: params?.id
      ? { id: params.id, 'data-automation-id': params.id }
      : {},
    updateMetadata: vi.fn(),
  }),
}));

vi.mock('next/link', () => ({
  default: ({ children, ...rest }: any) => <a {...rest}>{children}</a>,
}));

// Stable stub so the report effect (keyed on `t`) does not re-fetch on every
// render — same pattern as DeferredRevenueReport.expansion.test.tsx.
const stubT = (_key: string, options?: Record<string, any>) => {
  const template = options?.defaultValue ?? _key;
  if (typeof template !== 'string' || !options) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, token) =>
    options[token] === undefined ? match : String(options[token]),
  );
};
const stubTranslation = { t: stubT };

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => stubTranslation,
}));

vi.mock('@alga-psa/reporting/actions/projectReportActions', () => ({
  getProjectHoursReport: (...args: unknown[]) => getProjectHoursReport(...args),
}));

// The other reports stay pending so only the report under test renders content.
vi.mock('@alga-psa/reporting/actions/helpdeskReportActions', () => ({
  getEmailChannelHealthReport: vi.fn(() => new Promise(() => {})),
  getEmployeeUtilizationReport: vi.fn(() => new Promise(() => {})),
  getTeamPerformanceReport: vi.fn(() => new Promise(() => {})),
  getTicketAgingReport: vi.fn(() => new Promise(() => {})),
  getTicketWorkloadReport: vi.fn(() => new Promise(() => {})),
  getTimeUtilizationReport: vi.fn(() => new Promise(() => {})),
}));

// The reports catalog gates the deferred-revenue card behind the
// `release-v1-5-feature` flag (defaultValue: false). Stub the hook so the
// catalog renders deterministically without a SessionProvider/PostHog.
vi.mock('@alga-psa/ui/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => ({ enabled: false, loading: false, error: null }),
}));

const { default: Reports } = await import('./Reports');

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'p1',
    projectNumber: 'PRJ-0001',
    projectName: 'Yellow Brick Road',
    clientName: 'Emerald City',
    budgetedHours: 100,
    estimatedHours: 80,
    actualHours: 96,
    varianceHours: 16,
    percentUsed: 120,
    budgetPercentUsed: 96,
    openTasks: 2,
    closedTasks: 6,
    tasksOverEstimate: 1,
    phases: [
      {
        phaseId: 'ph1',
        phaseName: 'Paving',
        estimatedHours: 40,
        actualHours: 58,
        varianceHours: 18,
        openTasks: 1,
        closedTasks: 3,
      },
    ],
    ...overrides,
  };
}

function reportWith(projects: any[], overrides: Record<string, unknown> = {}) {
  return {
    summary: {
      projects: projects.length,
      budgetedHours: 100,
      estimatedHours: 80,
      actualHours: 96,
      projectsOverEstimate: 1,
      projectsOverBudget: 0,
      ...(overrides.summary as Record<string, unknown> | undefined),
    },
    projects,
    topOverruns: (overrides.topOverruns as any[]) ?? [],
  };
}

async function openProjectHours() {
  const { container } = render(<Reports productCode="psa" tier="pro" />);
  const viewButton = container.querySelector('#reports-view-project-hours');
  expect(viewButton).toBeTruthy();
  await userEvent.click(viewButton as Element);
  return container;
}

afterEach(() => {
  cleanup();
  getProjectHoursReport.mockReset();
});

describe('Project Hours vs Estimates report rendering', () => {
  it('renders budgeted, estimated and actual hours with the estimate-used bar', async () => {
    getProjectHoursReport.mockResolvedValue(reportWith([projectRow()]));

    await openProjectHours();

    expect(await screen.findAllByText('Yellow Brick Road')).not.toHaveLength(0);
    expect(screen.getAllByText('120%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('+16h').length).toBeGreaterThan(0);
    expect(getProjectHoursReport).toHaveBeenCalledTimes(1);
  });

  it('falls back to an explicit no-estimate state instead of a bogus percentage', async () => {
    getProjectHoursReport.mockResolvedValue(
      reportWith([projectRow({ estimatedHours: 0, varianceHours: 96, percentUsed: null })]),
    );

    await openProjectHours();

    await waitFor(() => expect(screen.getAllByText('n/a — no estimate set').length).toBeGreaterThan(0));
    expect(screen.queryByText('NaN%')).toBeNull();
    expect(screen.queryByText('Infinity%')).toBeNull();
  });

  it('expands a project into its per-phase hours', async () => {
    getProjectHoursReport.mockResolvedValue(reportWith([projectRow()]));

    const container = await openProjectHours();

    const toggle = await waitFor(() => {
      const node = container.querySelector('#project-hours-toggle-p1');
      expect(node).toBeTruthy();
      return node as Element;
    });
    expect(screen.queryByText('Paving')).toBeNull();

    await userEvent.click(toggle);

    expect(await screen.findByText('Paving')).toBeTruthy();
    expect(screen.getByText('3/4 tasks done')).toBeTruthy();
  });

  it('lists the largest task overruns and an empty state when there are none', async () => {
    getProjectHoursReport.mockResolvedValue(
      reportWith([projectRow()], {
        topOverruns: [
          {
            taskId: 't1',
            taskName: 'Oil the Tin Man',
            projectName: 'Yellow Brick Road',
            phaseName: 'Paving',
            estimatedHours: 2,
            actualHours: 9,
            varianceHours: 7,
          },
        ],
      }),
    );

    await openProjectHours();

    expect(await screen.findAllByText('Oil the Tin Man')).not.toHaveLength(0);
    expect(screen.getAllByText('+7h').length).toBeGreaterThan(0);
  });

  it('renders the empty state when no active projects are returned', async () => {
    getProjectHoursReport.mockResolvedValue(reportWith([]));

    await openProjectHours();

    expect(await screen.findAllByText('No data for this report.')).not.toHaveLength(0);
    expect(screen.getAllByText('No task has passed its estimate.').length).toBeGreaterThan(0);
  });
});
