/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TimeEntryDialog from '../src/components/time-management/time-entry/time-sheet/TimeEntryDialog';

const { handleError, toastLoading, toastDismiss, toastSuccess, toastError, useTimeEntryMock } = vi.hoisted(() => ({
  handleError: vi.fn(),
  toastLoading: vi.fn(() => 'loading-toast'),
  toastDismiss: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  useTimeEntryMock: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    loading: toastLoading,
    dismiss: toastDismiss,
    success: toastSuccess,
    error: toastError,
    custom: vi.fn(),
  },
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError,
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  isActionMessageError: () => false,
  isActionPermissionError: () => false,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : _key),
  }),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../src/components/time-management/time-entry/time-sheet/TimeEntryProvider', () => ({
  TimeEntryProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useTimeEntry: useTimeEntryMock,
}));

vi.mock('../src/components/time-management/time-entry/time-sheet/SingleTimeEntryForm', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../src/components/time-management/time-entry/time-sheet/TimeEntrySkeletons', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../src/context/SchedulingCrossFeatureContext', () => ({
  useSchedulingCrossFeatureOptional: () => undefined,
}));

vi.mock('../src/actions/timeEntryActions', () => ({
  deleteTimeEntry: vi.fn(),
  fetchTimeEntriesForTimeSheet: vi.fn().mockResolvedValue([]),
}));

const dialogProps = () => ({
  isOpen: true,
  onClose: vi.fn(),
  onSave: vi.fn().mockRejectedValue(new Error('persist failed')),
  workItem: { work_item_id: 'ticket-1', type: 'ticket' as const, name: 'Ticket 1' },
  date: new Date('2026-01-15T09:00:00.000Z'),
  timePeriod: {
    period_id: 'period-1',
    start_date: '2026-01-01',
    end_date: '2026-01-31',
  } as any,
  isEditable: true,
  timeSheetId: 'sheet-1',
  inDrawer: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  toastLoading.mockReturnValue('loading-toast');
  useTimeEntryMock.mockReturnValue({
    entries: [
      {
        service_id: 'service-1',
        start_time: '2026-01-15T09:00:00.000Z',
        end_time: '2026-01-15T10:00:00.000Z',
        billable_duration: 60,
        notes: '',
        isNew: true,
        work_item_id: 'ticket-1',
        work_item_type: 'ticket',
        time_sheet_id: 'sheet-1',
      },
    ],
    services: [{ id: 'service-1', name: 'Service', type: 'time', tax_rate_id: null, tax_percentage: null }],
    taxRegions: [],
    timeInputs: {},
    totalDurations: [60],
    isLoading: false,
    initializeEntries: vi.fn(),
    updateEntry: vi.fn(),
    updateTimeInputs: vi.fn(),
  });
});

describe('TimeEntryDialog save behavior', () => {
  it('keeps the dialog open and skips the success toast when onSave rejects', async () => {
    const props = dialogProps();

    render(<TimeEntryDialog {...props} />);

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(props.onSave).toHaveBeenCalledTimes(1);
    });

    expect(props.onClose).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(handleError).toHaveBeenCalled();
  });

  it('shows the success toast and closes only after onSave resolves', async () => {
    const props = dialogProps();
    props.onSave.mockResolvedValue(undefined as never);

    render(<TimeEntryDialog {...props} />);

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledTimes(1);
    });

    expect(props.onClose).toHaveBeenCalled();
  });
});
