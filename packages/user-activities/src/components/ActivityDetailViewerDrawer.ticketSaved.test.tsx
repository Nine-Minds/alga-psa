/* @vitest-environment jsdom */
/**
 * Ticket edits made in the activity drawer must refresh the activities list. The drawer hands
 * renderTicketDetails an `onSaved` callback (on both the main path and the notification
 * back-nav path) that invalidates the shared cache and bumps the shared invalidation version
 * the list subscribes to.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  ticketProps: [] as any[],
  navigateToTicket: null as null | ((id: string) => Promise<void>),
  fetchActivities: vi.fn(),
}));

const stableT = (_k: string, o: any) => o?.defaultValue ?? _k;
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: stableT }) }));
vi.mock('@alga-psa/ui', () => ({ useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn() }) }));
vi.mock('@alga-psa/ui/components/providers/TenantProvider', () => ({ useTenant: () => 'tenant-1' }));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...p }: any) => <button {...p}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Spinner', () => ({ default: () => <div /> }));
vi.mock('@alga-psa/ui/editor', () => ({ RichTextViewer: () => null, TextEditor: () => null }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  getErrorMessage: () => 'err',
  handleError: vi.fn(),
  isActionMessageError: () => false,
  isActionPermissionError: () => false,
  isReturnedActionError: () => false,
}));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getCurrentUser: vi.fn(async () => ({ user_id: 'u1' })),
  getAllUsersBasic: vi.fn(async () => []),
}));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@alga-psa/notifications/components', () => ({
  NotificationDetailView: ({ onNavigateToTicket }: any) => {
    mocks.navigateToTicket = onNavigateToTicket;
    return <div data-testid="notification" />;
  },
}));
vi.mock('@alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions', () => ({
  getNotificationByIdAction: vi.fn(async () => ({
    internal_notification_id: 'n1',
    title: 'N',
    message: 'M',
    type: 'info',
    is_read: false,
    user_id: 'u1',
    created_at: new Date().toISOString(),
  })),
}));
vi.mock('../actions/activityServerActions', () => ({ fetchActivities: mocks.fetchActivities }));
vi.mock('./AdHocDetailPanel', () => ({ AdHocDetailPanel: () => null }));
vi.mock('./OpportunityActivityPanel', () => ({ OpportunityActivityPanel: () => null }));

const crossFeature = {
  getConsolidatedTicketData: vi.fn(async () => ({ ticket: { ticket_id: 't1' } })),
  renderTicketDetails: (props: any) => {
    mocks.ticketProps.push(props);
    return <div data-testid="ticket-details" />;
  },
};
vi.mock('@alga-psa/ui/context', () => ({ useActivityCrossFeature: () => crossFeature }));

import { ActivityDetailViewerDrawer } from './ActivityDetailViewerDrawer';
import { ActivitiesCacheProvider, useActivitiesInvalidationSignal } from '../hooks/ActivitiesCacheProvider';
import { useActivitiesCache } from '../hooks/useActivitiesCache';

/** Stands in for the list: reads from the shared cache and watches the shared version. */
let listApi: { getActivities: any; version: number } | null = null;
function ListProbe() {
  const { getActivities } = useActivitiesCache();
  const { version } = useActivitiesInvalidationSignal();
  listApi = { getActivities, version };
  return null;
}

const listFilters = { types: ['ticket'] } as any;

function renderDrawer(activityType: string, onActionComplete = vi.fn()) {
  render(
    <ActivitiesCacheProvider>
      <ListProbe />
      <ActivityDetailViewerDrawer
        activityType={activityType as any}
        activityId="a1"
        onClose={vi.fn()}
        onActionComplete={onActionComplete}
      />
    </ActivitiesCacheProvider>
  );
  return onActionComplete;
}

async function expectSavedCallbackRefreshes(props: any, onActionComplete: any) {
  expect(typeof props.onSaved).toBe('function');
  // Populate the shared cache as the list would.
  await act(async () => { await listApi!.getActivities(listFilters, 1, 10); });
  expect(mocks.fetchActivities).toHaveBeenCalledTimes(1);
  const versionBefore = listApi!.version;

  act(() => { props.onSaved(); });

  expect(listApi!.version).toBe(versionBefore + 1); // the list's refetch trigger
  await act(async () => { await listApi!.getActivities(listFilters, 1, 10); });
  expect(mocks.fetchActivities).toHaveBeenCalledTimes(2); // shared cache entry was invalidated
  expect(onActionComplete).not.toHaveBeenCalled(); // saving a ticket keeps the drawer open
}

beforeEach(() => {
  mocks.ticketProps.length = 0;
  mocks.navigateToTicket = null;
  mocks.fetchActivities.mockReset().mockResolvedValue({ activities: [], totalCount: 0 });
});
afterEach(cleanup);

describe('ActivityDetailViewerDrawer ticket save signal', () => {
  it('main path: passes onSaved that refreshes the list', async () => {
    const onActionComplete = renderDrawer('ticket');
    await waitFor(() => expect(mocks.ticketProps.length).toBeGreaterThan(0));
    await expectSavedCallbackRefreshes(mocks.ticketProps.at(-1), onActionComplete);
  });

  it('notification back-nav path: passes onSaved that refreshes the list', async () => {
    const onActionComplete = renderDrawer('notification');
    await waitFor(() => expect(mocks.navigateToTicket).toBeTruthy());
    await act(async () => { await mocks.navigateToTicket!('t1'); });
    await waitFor(() => expect(mocks.ticketProps.length).toBeGreaterThan(0));
    await expectSavedCallbackRefreshes(mocks.ticketProps.at(-1), onActionComplete);
  });
});
