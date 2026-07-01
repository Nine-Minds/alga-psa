/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ClientBillingSchedule } from '../../../../../packages/clients/src/components/clients/ClientBillingSchedule';

vi.mock('react-hot-toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, title, children, footer }: any) => (
    isOpen ? (
      <div>
        <div>{title}</div>
        {children}
        {footer}
      </div>
    ) : null
  ),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, options, onValueChange }: any) => (
    <select
      id={id}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  ),
}));

const mockGetClientBillingCycleAnchor = vi.fn(async () => ({
  billingCycle: 'monthly',
  anchor: { dayOfMonth: 1, monthOfYear: null, dayOfWeek: null, referenceDate: null },
  cadenceContext: {
    cadenceOwner: 'client',
    changeScopeDescription: 'Client-schedule edits affect future client-cadence windows only.',
    scheduleDescription: 'Client cadence drives these invoice windows. Contract-anniversary lines keep their own cadence.',
    previewDescription: 'This preview is for client-cadence windows only. Contract cadence is previewed at the recurring line.',
    previewHeading: 'Upcoming client-owned invoice windows (preview)',
  }
}));

const mockPreviewBillingPeriodsForSchedule = vi.fn(async () => ({
  cadenceContext: {
    cadenceOwner: 'client',
    changeScopeDescription: 'Client-schedule edits affect future client-cadence windows only.',
    scheduleDescription: 'Client cadence drives these invoice windows. Contract-anniversary lines keep their own cadence.',
    previewDescription: 'This preview is for client-cadence windows only. Contract cadence is previewed at the recurring line.',
    previewHeading: 'Upcoming client-owned invoice windows (preview)',
  },
  periods: [
    { periodStartDate: '2026-01-01T00:00:00Z', periodEndDate: '2026-02-01T00:00:00Z' },
    { periodStartDate: '2026-02-01T00:00:00Z', periodEndDate: '2026-03-01T00:00:00Z' },
    { periodStartDate: '2026-03-01T00:00:00Z', periodEndDate: '2026-04-01T00:00:00Z' },
  ],
}));

const mockUpdateClientBillingSchedule = vi.fn(async () => ({ success: true }));
const mockPreviewClientCadenceChange = vi.fn(async () => ({
  billingCycle: 'monthly',
  unbilledPeriodsToRegenerate: 2,
  linesAffected: 1,
  regenerationStart: '2026-02-01T00:00:00Z',
  billedPeriodsInRange: false,
  affectedScheduleKeys: [],
}));
const mockPreviewBillingHistoryBootstrap = vi.fn(async () => ({
  requestedHistoryStartDate: '2025-01-15T00:00:00Z',
  normalizedHistoryStartBoundary: '2025-01-01T00:00:00Z',
  earliestInvoicedCycleStartBoundary: null,
  status: 'eligible',
  blockedReason: null,
  affectedUninvoicedCycleCount: 0,
}));

const mockCreateNextBillingCycle = vi.fn(async () => ({ success: true }));

vi.mock('../../../../../packages/clients/src/lib/billingHelpers', () => ({
  getClientBillingCycleAnchorAsync: (...args: any[]) => mockGetClientBillingCycleAnchor(...args),
  previewBillingPeriodsForScheduleAsync: (...args: any[]) => mockPreviewBillingPeriodsForSchedule(...args),
  previewBillingHistoryBootstrapAsync: (...args: any[]) => mockPreviewBillingHistoryBootstrap(...args),
  previewClientCadenceChangeAsync: (...args: any[]) => mockPreviewClientCadenceChange(...args),
  updateClientBillingScheduleAsync: (...args: any[]) => mockUpdateClientBillingSchedule(...args),
  createNextBillingCycleAsync: (...args: any[]) => mockCreateNextBillingCycle(...args),
}));

describe('ClientBillingSchedule', () => {
  // RTL auto-cleanup only registers for the first test file in the shared fork,
  // so clean up explicitly to avoid this file's render leaking into the next file.
  afterEach(() => {
    cleanup();
  });

  it('saves a monthly day-of-month anchor via updateClientBillingSchedule', async () => {
    render(<ClientBillingSchedule clientId="client-1" />);

    await waitFor(() => {
      expect(screen.getByText('Edit Schedule')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Create Next Cycle'));
    await waitFor(() => {
      expect(mockCreateNextBillingCycle).toHaveBeenCalledWith('client-1');
    });

    fireEvent.click(screen.getByText('Edit Schedule'));
    await waitFor(() => {
      expect(screen.getByText('Review changes')).toBeTruthy();
    });

    expect(screen.getByText(
      'Client cadence drives these invoice windows. Contract-anniversary lines keep their own cadence.'
    )).toBeTruthy();
    expect(screen.getByText(
      'This preview is for client-cadence windows only. Contract cadence is previewed at the recurring line.'
    )).toBeTruthy();
    expect(screen.getByText('Upcoming client-owned invoice windows (preview)')).toBeTruthy();

    await waitFor(() => {
      expect(mockPreviewBillingPeriodsForSchedule).toHaveBeenCalled();
      expect(screen.getByText('2026-01-01 → 2026-02-01')).toBeTruthy();
      expect(screen.getByText('2026-02-01 → 2026-03-01')).toBeTruthy();
      expect(screen.getByText('2026-03-01 → 2026-04-01')).toBeTruthy();
    });

    const daySelect = document.getElementById('client-billing-anchor-day-of-month') as HTMLSelectElement | null;
    expect(daySelect).toBeTruthy();
    fireEvent.change(daySelect as HTMLSelectElement, { target: { value: '10' } });

    await waitFor(() => {
      expect(mockPreviewBillingPeriodsForSchedule).toHaveBeenCalledWith(
        'monthly',
        expect.objectContaining({ dayOfMonth: 10 }),
        expect.objectContaining({ count: 3, referenceDate: expect.any(String) })
      );
    });

    // Saving is now a two-step flow: "Review changes" computes the cadence-change
    // impact, then "Confirm & save" applies it (commit 9b88ef86c7).
    fireEvent.click(screen.getByText('Review changes'));

    await waitFor(() => {
      expect(mockPreviewClientCadenceChange).toHaveBeenCalledWith({
        clientId: 'client-1',
        billingCycle: 'monthly',
        anchor: {
          dayOfMonth: 10,
          monthOfYear: null,
          dayOfWeek: null,
          referenceDate: null
        },
      });
      expect(screen.getByText('Confirm & save')).toBeTruthy();
    });

    expect(screen.getByText('Review before you apply')).toBeTruthy();

    fireEvent.click(screen.getByText('Confirm & save'));

    await waitFor(() => {
      expect(mockUpdateClientBillingSchedule).toHaveBeenCalledWith({
        clientId: 'client-1',
        billingCycle: 'monthly',
        anchor: {
          dayOfMonth: 10,
          monthOfYear: null,
          dayOfWeek: null,
          referenceDate: null
        },
        billingHistoryStartDate: null,
      });
    });
  });
});
