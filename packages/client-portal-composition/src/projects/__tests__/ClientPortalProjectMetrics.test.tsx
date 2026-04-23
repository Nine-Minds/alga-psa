/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

const calculateProjectCompletionMock = vi.fn();

vi.mock('@alga-psa/projects/lib/projectUtils', () => ({
  calculateProjectCompletion: (...args: unknown[]) =>
    calculateProjectCompletionMock(...args)
}));

vi.mock('@alga-psa/projects/components/DonutChart', () => ({
  __esModule: true,
  default: ({ percentage }: { percentage: number }) => (
    <div data-testid="donut-chart">{Math.round(percentage)}</div>
  )
}));

vi.mock('@alga-psa/projects/components/HoursProgressBar', () => ({
  __esModule: true,
  default: ({ percentage }: { percentage: number }) => (
    <div data-testid="hours-progress-bar">{Math.round(percentage)}</div>
  )
}));

// `@alga-psa/ui/lib/i18n/client` is the app's i18n shim. Provide a minimal stub
// that returns the English default (second arg) for every `t()` call.
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultOrOpts?: unknown, maybeOpts?: unknown) => {
      const defaultValue = typeof defaultOrOpts === 'string' ? defaultOrOpts : _key;
      const opts = (typeof defaultOrOpts === 'object' ? defaultOrOpts : maybeOpts) as
        | Record<string, unknown>
        | undefined;
      if (!opts) return defaultValue;
      return defaultValue.replace(/\{\{(\w+)\}\}/g, (_m, name) =>
        String(opts[name] ?? '')
      );
    }
  })
}));

import { ClientPortalProjectMetrics } from '../ClientPortalProjectMetrics';

describe('ClientPortalProjectMetrics — Budget Hours visibility', () => {
  // Use distinctive decimal values that can't collide with task counts ("3 of 7")
  // so substring checks for hour leakage are unambiguous.
  const SPENT_HOURS = 12.3;         // tracked / logged time
  const BUDGETED_HOURS = 20.7;      // budget
  const REMAINING_HOURS = 8.4;
  const HOURS_PCT = 59;

  beforeEach(() => {
    calculateProjectCompletionMock.mockReset();
    calculateProjectCompletionMock.mockResolvedValue({
      taskCompletionPercentage: 42,
      completedTasks: 3,
      totalTasks: 7,
      hoursCompletionPercentage: HOURS_PCT,
      spentHours: SPENT_HOURS,
      budgetedHours: BUDGETED_HOURS,
      remainingHours: REMAINING_HOURS
    });
  });

  // Auto-cleanup between tests isn't firing reliably when this file runs
  // alongside others in the same vitest fork, so be explicit.
  afterEach(() => {
    cleanup();
  });

  it('renders the Budget Hours card when showBudgetHours=true', async () => {
    render(
      <ClientPortalProjectMetrics projectId="p-1" showBudgetHours={true} />
    );

    await waitFor(() => {
      expect(screen.getByText('Task Completion')).toBeInTheDocument();
    });
    expect(screen.getByText('Budget Hours')).toBeInTheDocument();
    expect(screen.getByText(`${HOURS_PCT}% of Budget Used`)).toBeInTheDocument();
    // Tracked time + budget are both rendered as part of the "X of Y hours" line.
    expect(
      screen.getByText(`${SPENT_HOURS.toFixed(1)} of ${BUDGETED_HOURS.toFixed(1)} hours`)
    ).toBeInTheDocument();
  });

  it('does NOT leak tracked time or budgeted hours when showBudgetHours=false', async () => {
    render(
      <ClientPortalProjectMetrics projectId="p-1" showBudgetHours={false} />
    );

    // Wait for data to finish loading — otherwise the loading skeleton masks
    // the real render and the negative assertions below would pass trivially.
    await waitFor(() => {
      expect(calculateProjectCompletionMock).toHaveBeenCalled();
      expect(screen.getByText('Task Completion')).toBeInTheDocument();
    });

    // Card header is gone.
    expect(screen.queryByText('Budget Hours')).not.toBeInTheDocument();
    // % of Budget Used line is gone.
    expect(screen.queryByText(/of Budget Used/i)).not.toBeInTheDocument();

    // CRITICAL — the actual hour numbers are absent from the DOM.
    // Budgeted total (budget):
    const budgetedStr = BUDGETED_HOURS.toFixed(1);
    expect(document.body.textContent ?? '').not.toContain(budgetedStr);
    // Tracked / logged time (spent):
    const spentStr = SPENT_HOURS.toFixed(1);
    expect(document.body.textContent ?? '').not.toContain(spentStr);
    // Remaining-hours breakdown (only shown inside the card's tooltip, but also
    // embedded in the tooltip markup via the HoursProgressBar — assert absent).
    expect(document.body.textContent ?? '').not.toContain(REMAINING_HOURS.toFixed(1));

    // Progress bar for hours is not rendered.
    expect(screen.queryByTestId('hours-progress-bar')).not.toBeInTheDocument();
  });

  it('defaults to hiding the Budget Hours card when the prop is omitted', async () => {
    render(<ClientPortalProjectMetrics projectId="p-1" />);

    await waitFor(() => {
      expect(screen.getByText('Task Completion')).toBeInTheDocument();
    });
    expect(screen.queryByText('Budget Hours')).not.toBeInTheDocument();
    // Double-check raw numbers are not leaking either.
    expect(document.body.textContent ?? '').not.toContain(BUDGETED_HOURS.toFixed(1));
    expect(document.body.textContent ?? '').not.toContain(SPENT_HOURS.toFixed(1));
    expect(screen.queryByTestId('hours-progress-bar')).not.toBeInTheDocument();
  });

  it('always renders the Task Completion card regardless of Budget Hours flag', async () => {
    const { rerender } = render(
      <ClientPortalProjectMetrics projectId="p-1" showBudgetHours={false} />
    );
    await waitFor(() => {
      expect(screen.getByText('Task Completion')).toBeInTheDocument();
    });

    rerender(
      <ClientPortalProjectMetrics projectId="p-1" showBudgetHours={true} />
    );
    await waitFor(() => {
      expect(screen.getByText('Task Completion')).toBeInTheDocument();
    });
  });
});
