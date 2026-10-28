/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ClientContractLineDashboard from './ClientContractLineDashboard';
import { ClientCrossFeatureProvider } from '../../context/ClientCrossFeatureContext';

vi.mock('@alga-psa/reporting/actions', () => ({
  getRecentClientInvoices: vi.fn().mockResolvedValue([]),
  getHoursByServiceType: vi.fn().mockResolvedValue([]),
  getRemainingBucketUnits: vi.fn().mockResolvedValue([]),
  getUsageDataMetrics: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/ui/components', () => ({
  BucketUsageChart: () => null,
}));

vi.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => () => null,
}));

describe('ClientContractLineDashboard unresolved-charge review window', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // The dashboard range is "last 30 days" including today; the review's window
  // end is exclusive, so work done today must fall inside it.
  it('reviews the last 30 days including today', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 25, 14, 0, 0));
    const review = vi.fn(() => <div data-testid="review" />);
    render(
      <ClientCrossFeatureProvider value={{ renderClientUnresolvedChargeReview: review } as any}>
        <ClientContractLineDashboard clientId="client-1" />
      </ClientCrossFeatureProvider>,
    );
    expect(screen.getByTestId('review')).toBeInTheDocument();
    expect(review).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'client-1',
      windowStart: '2026-09-25',
      windowEnd: '2026-10-26',
    }));
  });
});
