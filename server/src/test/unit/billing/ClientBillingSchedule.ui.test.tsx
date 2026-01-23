/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ClientBillingSchedule } from 'server/src/components/clients/ClientBillingSchedule';

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
  Dialog: ({ isOpen, title, children }: any) => (
    isOpen ? (
      <div>
        <div>{title}</div>
        {children}
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
  anchor: { dayOfMonth: 1, monthOfYear: null, dayOfWeek: null, referenceDate: null }
}));

const mockPreviewBillingPeriodsForSchedule = vi.fn(async () => ([
  { periodStartDate: '2026-01-01T00:00:00Z', periodEndDate: '2026-02-01T00:00:00Z' },
  { periodStartDate: '2026-02-01T00:00:00Z', periodEndDate: '2026-03-01T00:00:00Z' },
  { periodStartDate: '2026-03-01T00:00:00Z', periodEndDate: '2026-04-01T00:00:00Z' },
]));

vi.mock('@alga-psa/billing/actions', () => ({
  getClientBillingCycleAnchor: (...args: any[]) => mockGetClientBillingCycleAnchor(...args),
  previewBillingPeriodsForSchedule: (...args: any[]) => mockPreviewBillingPeriodsForSchedule(...args),
}));

const mockUpdateClientBillingSchedule = vi.fn(async () => ({ success: true }));

vi.mock('@alga-psa/billing/actions', () => ({
  updateClientBillingSchedule: (...args: any[]) => mockUpdateClientBillingSchedule(...args),
}));

const mockCreateNextBillingCycle = vi.fn(async () => ({ success: true }));

vi.mock('@alga-psa/billing/actions', () => ({
  createNextBillingCycle: (...args: any[]) => mockCreateNextBillingCycle(...args),
}));

describe('ClientBillingSchedule', () => {
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
      expect(screen.getByText('Save Schedule')).toBeTruthy();
    });

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

    fireEvent.click(screen.getByText('Save Schedule'));

    await waitFor(() => {
      expect(mockUpdateClientBillingSchedule).toHaveBeenCalledWith({
        clientId: 'client-1',
        billingCycle: 'monthly',
        anchor: {
          dayOfMonth: 10,
          monthOfYear: null,
          dayOfWeek: null,
          referenceDate: null
        }
      });
    });
  });
});
