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

// Stable stubs, so the report effects (keyed on `t`) do not refetch on every
// render. Formatted days are wrapped so a test can tell they went through the
// locale formatter rather than being printed raw.
const stubT = (_key: string, options?: Record<string, any>) => {
  const template = options?.defaultValue ?? _key;
  if (typeof template !== 'string' || !options) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, token) =>
    options[token] === undefined ? match : String(options[token]),
  );
};
const stubTranslation = { t: stubT };
const stubFormatters = { formatCalendarDate: (day: string) => `day(${day})` };

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => stubTranslation,
  useFormatters: () => stubFormatters,
}));

// Driving the real calendar popover (and the i18n hooks DateTimeField wants)
// is not what this suite is about: the stub picks a fixed span in one click,
// exactly as the picker's onChange hands both bounds over. The second button
// hands over a backwards span, as a typed date could.
vi.mock('@alga-psa/ui/components/DateRangePicker', () => ({
  DateRangePicker: ({ id, onChange }: any) => (
    <div id={id}>
      <button
        type="button"
        id={`${id}-pick`}
        onClick={() => onChange({ from: new Date(2026, 0, 5), to: new Date(2026, 1, 3) })}
      >
        pick custom range
      </button>
      <button
        type="button"
        id={`${id}-pick-backwards`}
        onClick={() => onChange({ from: new Date(2026, 1, 3), to: new Date(2026, 0, 5) })}
      >
        pick backwards range
      </button>
    </div>
  ),
  formatLocalYMD: (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
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

const { default: Reports } = await import('./Reports');

function reportWith(byUser: any[], summary: Partial<Record<string, unknown>> = {}) {
  return {
    rangeDays: 30,
    range: null,
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

  it('re-requests the report for a custom window once both bounds are picked', async () => {
    getEmployeeUtilizationReport.mockResolvedValue(reportWith([]));

    const { container } = render(<Reports productCode="psa" tier="pro" />);
    await userEvent.click(container.querySelector('#reports-view-employee-utilization') as Element);
    await waitFor(() => expect(getEmployeeUtilizationReport).toHaveBeenCalledWith(30));

    await userEvent.click(container.querySelector('#reports-custom-range-pick') as Element);

    await waitFor(() =>
      expect(getEmployeeUtilizationReport).toHaveBeenLastCalledWith({ from: '2026-01-05', to: '2026-02-03' }),
    );

    // Back to a preset: the custom span is cleared, not stacked on top.
    await userEvent.click(container.querySelector('#reports-range-7') as Element);
    await waitFor(() => expect(getEmployeeUtilizationReport).toHaveBeenLastCalledWith(7));
  });

  it('labels the header with the window the server reports, locale-formatted', async () => {
    // The server cut the asked-for end back (to its today): the header must
    // follow what was reported on, not what was picked.
    getEmployeeUtilizationReport.mockImplementation((range: unknown) =>
      Promise.resolve(
        typeof range === 'object'
          ? { ...reportWith([]), rangeDays: 26, range: { from: '2026-01-05', to: '2026-01-30' } }
          : reportWith([]),
      ),
    );

    const { container } = render(<Reports productCode="psa" tier="pro" />);
    await userEvent.click(container.querySelector('#reports-view-employee-utilization') as Element);
    expect(await screen.findAllByText('Last 30 days')).not.toHaveLength(0);

    await userEvent.click(container.querySelector('#reports-custom-range-pick') as Element);

    expect(await screen.findAllByText('day(2026-01-05) to day(2026-01-30)')).not.toHaveLength(0);
    expect(screen.queryByText(/2026-02-03/)).toBeNull();
  });

  it('does not request a backwards span and says why instead', async () => {
    getEmployeeUtilizationReport.mockResolvedValue(reportWith([]));

    const { container } = render(<Reports productCode="psa" tier="pro" />);
    await userEvent.click(container.querySelector('#reports-view-employee-utilization') as Element);
    await waitFor(() => expect(getEmployeeUtilizationReport).toHaveBeenCalledWith(30));

    await userEvent.click(container.querySelector('#reports-custom-range-pick-backwards') as Element);

    expect(await screen.findByText('The end date is before the start date.')).toBeTruthy();
    expect(getEmployeeUtilizationReport).not.toHaveBeenCalledWith(expect.objectContaining({ from: expect.any(String) }));
  });

  it('shows the action error when the server refuses a custom window', async () => {
    getEmployeeUtilizationReport.mockImplementation((range: unknown) =>
      Promise.resolve(
        typeof range === 'object'
          ? { actionError: 'The custom date range starts after today, so there is nothing to report yet.' }
          : reportWith([]),
      ),
    );

    const { container } = render(<Reports productCode="psa" tier="pro" />);
    await userEvent.click(container.querySelector('#reports-view-employee-utilization') as Element);
    await userEvent.click(container.querySelector('#reports-custom-range-pick') as Element);

    expect(
      await screen.findByText('The custom date range starts after today, so there is nothing to report yet.'),
    ).toBeTruthy();
  });

  it('renders the empty state when no active users are returned', async () => {
    getEmployeeUtilizationReport.mockResolvedValue(reportWith([]));

    await openEmployeeUtilization();

    expect(await screen.findAllByText('No data for this report.')).not.toHaveLength(0);
  });
});
