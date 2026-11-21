/* @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  getScheduleEntries: vi.fn(),
  checkCurrentUserPermissions: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { user_id: 'readonly-tech' } } }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const translation = { t: (_key: string, options?: any) => options?.defaultValue ?? _key };
  return { useTranslation: () => translation };
});
vi.mock('react-hot-toast', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({ handleError: vi.fn(), getErrorMessage: (error: any) => String(error), isActionMessageError: () => false, isActionPermissionError: () => false }));
vi.mock('@alga-psa/auth/actions', () => ({
  checkCurrentUserPermission: vi.fn(async () => true),
  checkCurrentUserPermissions: mocks.checkCurrentUserPermissions,
}));
vi.mock('@alga-psa/user-composition/actions', () => ({ getAllUsersBasic: vi.fn(async () => [{ user_id: 'readonly-tech', first_name: 'Read', last_name: 'Only', is_inactive: false, user_type: 'internal' }]), getCurrentUser: mocks.getCurrentUser }));
vi.mock('@alga-psa/user-composition/hooks', () => ({ useUserPreference: () => ({ value: 'day', setValue: vi.fn(), isLoading: false }) }));
vi.mock('@alga-psa/reference-data/actions', () => ({ getWorkItemStatusOptions: vi.fn(async () => []), isStatusActionError: () => false, statusActionErrorMessage: () => '' }));
vi.mock('@alga-psa/scheduling/actions', () => ({
  searchDispatchWorkItems: vi.fn(async () => ({ items: [], total: 0 })),
  getWorkItemById: vi.fn(async () => null),
  addScheduleEntry: vi.fn(), updateScheduleEntry: vi.fn(), deleteScheduleEntry: vi.fn(),
  getScheduleEntries: mocks.getScheduleEntries,
}));
vi.mock('@alga-psa/ui', () => ({ useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn() }) }));
vi.mock('@alga-psa/ui/components/Alert', () => ({ Alert: ({ children }: any) => <div>{children}</div>, AlertDescription: ({ children }: any) => <div>{children}</div> }));
vi.mock('@alga-psa/ui/components/Spinner', () => ({ default: () => <div /> }));
vi.mock('../src/components/technician-dispatch/WorkItemListPanel', () => ({ default: () => <div /> }));
vi.mock('../src/components/technician-dispatch/ScheduleViewPanel', () => ({ default: () => <div data-testid="dispatch-schedule-view" /> }));
vi.mock('../src/components/technician-dispatch/WorkItemCard', () => ({ default: () => <div /> }));
vi.mock('../src/components/technician-dispatch/WorkItemDetailsDrawer', () => ({ WorkItemDetailsDrawer: () => null }));
vi.mock('@alga-psa/scheduling/components/schedule/EntryPopup', () => ({ default: () => null }));

import TechnicianDispatchDashboard from '../src/components/technician-dispatch/TechnicianDispatchDashboard';

describe('dispatch behavior for bounded schedule reads', () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockResolvedValue({ user_id: 'readonly-tech', roles: [] });
    mocks.checkCurrentUserPermissions.mockResolvedValue([
      { resource: 'technician_dispatch', action: 'read', granted: true },
      { resource: 'technician_dispatch', action: 'update', granted: false },
    ]);
    mocks.getScheduleEntries.mockResolvedValue({ success: true, entries: [], hasMore: true, nextCursor: 'cursor-500' });
  });
  afterEach(cleanup);

  it('marks the schedule view incomplete when the bounded page has a continuation', async () => {
    render(<TechnicianDispatchDashboard />);
    expect(await screen.findByRole('status')).toHaveTextContent('Schedule results are incomplete. Narrow the date range to see fewer entries.');
  });

  it('clears the incomplete notice for a complete page', async () => {
    mocks.getScheduleEntries.mockResolvedValueOnce({ success: true, entries: [], hasMore: false, nextCursor: null });
    const { rerender } = render(<TechnicianDispatchDashboard />);
    await waitFor(() => expect(mocks.getScheduleEntries).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('reports a rejected schedule read without exposing provider details', async () => {
    mocks.getScheduleEntries.mockResolvedValue({ success: false, error: 'Schedule results exceeded the work limit.' });
    render(<TechnicianDispatchDashboard />);
    await waitFor(() => expect(document.body.textContent).toContain('Failed to fetch schedule entries'));
    expect(document.body.textContent).not.toContain('work limit');
  });
});
