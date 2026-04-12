// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TimeSheetClient from '../src/components/time-management/time-entry/time-sheet/TimeSheetClient';

const { refresh, push, saveTimeEntry, fetchOrCreateTimeSheet, fetchEligibleTimeEntrySubjects, fetchTimeSheet, reverseTimeSheetApproval, toastSuccess, handleError } = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  saveTimeEntry: vi.fn(),
  fetchOrCreateTimeSheet: vi.fn(),
  fetchEligibleTimeEntrySubjects: vi.fn(),
  fetchTimeSheet: vi.fn(),
  reverseTimeSheetApproval: vi.fn(),
  toastSuccess: vi.fn(),
  handleError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: false, loading: false }),
}));

vi.mock('@alga-psa/scheduling/actions/timeEntryActions', () => ({
  saveTimeEntry,
  fetchOrCreateTimeSheet,
}));

vi.mock('@alga-psa/scheduling/actions/timeEntryDelegationActions', () => ({
  fetchEligibleTimeEntrySubjects,
}));

vi.mock('@alga-psa/scheduling/actions/timeSheetActions', () => ({
  fetchTimeSheet,
  reverseTimeSheetApproval,
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    success: toastSuccess,
  },
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError,
}));

vi.mock('../src/components/time-management/time-entry/time-sheet/TimeSheet', () => ({
  TimeSheet: ({ timeSheet, onReopenForEdits }: any) => (
    <div>
      <div data-testid="timesheet-status">{timeSheet.approval_status}</div>
      <button id="reopen-timesheet-button" onClick={() => void onReopenForEdits?.()}>
        Reopen for edits
      </button>
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ isOpen, onConfirm, onClose }: any) =>
    isOpen ? (
      <div data-testid="reopen-confirmation-dialog">
        <button id="confirm-reopen-button" onClick={() => void onConfirm()}>
          Confirm reopen
        </button>
        <button id="cancel-reopen-button" onClick={() => onClose(false)}>
          Cancel
        </button>
      </div>
    ) : null,
}));

describe('TimeSheetClient reopen flow', () => {
  const currentUser = {
    user_id: 'user-1',
    first_name: 'Test',
    last_name: 'User',
    email: 'test@example.com',
  };

  const approvedTimeSheet = {
    id: 'timesheet-1',
    user_id: 'user-1',
    period_id: 'period-1',
    approval_status: 'APPROVED',
  };

  const reopenedTimeSheet = {
    ...approvedTimeSheet,
    approval_status: 'CHANGES_REQUESTED',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    reverseTimeSheetApproval.mockResolvedValue(undefined);
    fetchTimeSheet.mockResolvedValue(reopenedTimeSheet);
    saveTimeEntry.mockResolvedValue(undefined);
    fetchOrCreateTimeSheet.mockResolvedValue(approvedTimeSheet);
    fetchEligibleTimeEntrySubjects.mockResolvedValue([]);
  });

  it('updates the rendered timesheet immediately after reopen without requiring a refresh', async () => {
    render(
      <TimeSheetClient
        timeSheet={approvedTimeSheet as any}
        currentUser={currentUser as any}
        isManager={false}
        canReopenForEdits={true}
        initialEntries={[] as any}
        initialWorkItems={[] as any}
        initialComments={[] as any}
      />
    );

    expect(screen.getByTestId('timesheet-status').textContent).toBe('APPROVED');

    fireEvent.click(screen.getByRole('button', { name: 'Reopen for edits' }));
    expect(screen.getByTestId('reopen-confirmation-dialog')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm reopen' }));

    await waitFor(() => {
      expect(reverseTimeSheetApproval).toHaveBeenCalledWith(
        'timesheet-1',
        'user-1',
        'Reopened for edits'
      );
    });

    await waitFor(() => {
      expect(fetchTimeSheet).toHaveBeenCalledWith('timesheet-1');
      expect(screen.getByTestId('timesheet-status').textContent).toBe('CHANGES_REQUESTED');
    });

    expect(toastSuccess).toHaveBeenCalledWith('Time sheet reopened for edits');
    expect(refresh).not.toHaveBeenCalled();
  });
});
