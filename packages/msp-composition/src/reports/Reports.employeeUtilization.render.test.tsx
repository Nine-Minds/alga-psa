// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getEmployeeUtilizationReport = vi.fn();

// The server-suite setup stubs this hook with empty automationIdProps, which
// strips DOM ids off UI Buttons — this test locates cards by #reports-view-*,
// so echo ids back with a local stub (same pattern as
// QuickAddClient.ui-reflection.test.tsx) rather than vi.unmock, which is
// unreliable under the server suite's shared singleFork module cache.
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

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

vi.mock('@alga-psa/reporting/actions/helpdeskReportActions', () => ({
  getEmployeeUtilizationReport: (...args: unknown[]) => getEmployeeUtilizationReport(...args),
  // The other reports stay pending so only the report under test renders content.
  getEmailChannelHealthReport: vi.fn(() => new Promise(() => {})),
  getTeamPerformanceReport: vi.fn(() => new Promise(() => {})),
  getTicketAgingReport: vi.fn(() => new Promise(() => {})),
  getTicketWorkloadReport: vi.fn(() => new Promise(() => {})),
  getTimeUtilizationReport: vi.fn(() => new Promise(() => {})),
}));

// Project hours lives in its own action module; stub it so importing Reports
// does not drag the real server action (and next-auth) into the render suite.
vi.mock('@alga-psa/reporting/actions/projectReportActions', () => ({
  getProjectHoursReport: vi.fn(() => new Promise(() => {})),
}));

// The reports catalog gates the deferred-revenue card behind the
// `release-v1-5-feature` flag (defaultValue: false). Stub the hook so the
// catalog renders deterministically without a SessionProvider/PostHog.
vi.mock('@alga-psa/ui/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => ({ enabled: false, loading: false, error: null }),
}));

const { default: Reports } = await import('./Reports');

function reportWith(byUser: any[], summary: Partial<Record<string, unknown>> = {}) {
  return {
    rangeDays: 30,
    summary: {
      activeUsers: byUser.length,
      usersWithoutCapacity: byUser.filter((row) => row.capacityHours === null).length,
      totalWorkedHours: 0,
      workedHoursWithCapacity: 0,
      totalCapacityHours: 0,
      overallUtilizationPercent: null,
      ...summary,
    },
    byUser,
  };
}

async function openEmployeeUtilization() {
  const { container } = render(<Reports productCode="psa" tier="pro" />);
  const viewButton = container.querySelector('#reports-view-employee-utilization');
  expect(viewButton).toBeTruthy();
  await userEvent.click(viewButton as Element);
}

afterEach(() => {
  cleanup();
  getEmployeeUtilizationReport.mockReset();
});

describe('Employee Utilization report rendering', () => {
  it('renders worked, capacity and utilization for users that have a capacity', async () => {
    getEmployeeUtilizationReport.mockResolvedValue(
      reportWith(
        [
          { userId: 'u1', name: 'Dorothy Gale', workedHours: 120, billableHours: 90, entries: 20, capacityHours: 171.4, utilizationPercent: 70 },
        ],
        { totalWorkedHours: 120, workedHoursWithCapacity: 120, totalCapacityHours: 171.4, overallUtilizationPercent: 70 },
      ),
    );

    await openEmployeeUtilization();

    expect(await screen.findAllByText('Dorothy Gale')).not.toHaveLength(0);
    expect(screen.getAllByText('70%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('171.4h').length).toBeGreaterThan(0);
    expect(getEmployeeUtilizationReport).toHaveBeenCalledWith(30);
  });

  it('falls back to an explicit no-capacity state instead of a bogus percentage', async () => {
    getEmployeeUtilizationReport.mockResolvedValue(
      reportWith([
        { userId: 'u2', name: 'Toto Gale', workedHours: 42, billableHours: 10, entries: 8, capacityHours: null, utilizationPercent: null },
      ]),
    );

    await openEmployeeUtilization();

    expect(await screen.findAllByText('Toto Gale')).not.toHaveLength(0);
    await waitFor(() => expect(screen.getAllByText('n/a — no capacity set').length).toBeGreaterThan(0));
    expect(screen.queryByText('NaN%')).toBeNull();
    expect(screen.queryByText('Infinity%')).toBeNull();
  });

  it('marks a capacity that was only estimated from the weekly override', async () => {
    getEmployeeUtilizationReport.mockResolvedValue(
      reportWith([
        { userId: 'u3', name: 'Scarecrow', workedHours: 80, billableHours: 60, entries: 9, capacityHours: 171.4, capacitySource: 'weekly', utilizationPercent: 47 },
        { userId: 'u4', name: 'Tin Man', workedHours: 80, billableHours: 60, entries: 9, capacityHours: 168, capacitySource: 'schedule', utilizationPercent: 48 },
      ]),
    );

    await openEmployeeUtilization();

    // Only the estimated row is flagged; a scheduled denominator is exact.
    const flags = await screen.findAllByTitle('Estimated from weekly capacity; no working hours set.');
    expect(flags.length).toBe(1);
  });

  it('renders the empty state when no active users are returned', async () => {
    getEmployeeUtilizationReport.mockResolvedValue(reportWith([]));

    await openEmployeeUtilization();

    expect(await screen.findAllByText('No data for this report.')).not.toHaveLength(0);
  });
});
