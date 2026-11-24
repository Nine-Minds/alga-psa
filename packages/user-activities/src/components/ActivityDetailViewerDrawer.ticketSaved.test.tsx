/* @vitest-environment jsdom */
/**
 * Ticket edits made in the activity drawer must refresh the activities list. The drawer hands
 * renderTicketDetails an `onSaved` callback (on both the main path and the notification
 * back-nav path) that invalidates the shared cache and bumps the shared invalidation version
 * the list subscribes to.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  ticketProps: [] as any[],
  navigateToTicket: null as null | ((id: string) => Promise<void>),
  navigateToDocument: null as null | ((id: string, name: string) => void),
  getBlockContent: vi.fn(),
  fetchActivities: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => ({
  useTranslation: (await import('react-i18next')).useTranslation,
}));
vi.mock('@alga-psa/ui', () => ({ useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn() }) }));
vi.mock('@alga-psa/ui/components/providers/TenantProvider', () => ({ useTenant: () => 'tenant-1' }));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...p }: any) => <button {...p}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Spinner', () => ({ default: () => <div /> }));
vi.mock('@alga-psa/ui/editor', () => ({ RichTextViewer: ({ content }: any) => <div>{JSON.stringify(content)}</div>, TextEditor: () => null }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  getErrorMessage: (value: any) => value.permissionError ?? value.actionError ?? 'err',
  handleError: vi.fn(),
  isActionMessageError: (value: any) => typeof value?.actionError === 'string',
  isActionPermissionError: (value: any) => typeof value?.permissionError === 'string',
  isReturnedActionError: () => false,
}));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getCurrentUser: vi.fn(async () => ({ user_id: 'u1' })),
  getAllUsersBasic: vi.fn(async () => []),
}));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@alga-psa/notifications/components', () => ({
  NotificationDetailView: ({ onNavigateToTicket, onNavigateToDocument }: any) => {
    mocks.navigateToTicket = onNavigateToTicket;
    mocks.navigateToDocument = onNavigateToDocument;
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
  getBlockContent: mocks.getBlockContent,
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

const retryLabels = [
  ['en', 'Try again'],
  ['de', 'Erneut versuchen'],
  ['es', 'Reintentar'],
  ['fr', 'Réessayer'],
  ['it', 'Riprova'],
  ['nl', 'Opnieuw proberen'],
  ['pl', 'Spróbuj ponownie'],
  ['pt', 'Tentar novamente'],
  ['sv', 'Försök igen'],
  ['xx', '⟦Ŧřẏ ȧɠȧīƞ⟧'],
  ['yy', '〖Ŧřẏ ȧɠȧīƞ ····〗'],
] as const;

beforeAll(async () => {
  // Read packs at runtime to avoid adding a workspace dependency on server.
  const resources = Object.fromEntries(retryLabels.map(([locale]) => [locale, {
    'msp/user-activities': JSON.parse(readFileSync(path.resolve(
      __dirname, `../../../../server/public/locales/${locale}/msp/user-activities.json`,
    ), 'utf8')),
  }]));
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

beforeEach(async () => {
  await i18n.changeLanguage('en');
  mocks.ticketProps.length = 0;
  mocks.navigateToTicket = null;
  mocks.navigateToDocument = null;
  mocks.getBlockContent.mockReset();
  mocks.fetchActivities.mockReset().mockResolvedValue({ activities: [], totalCount: 0 });
});

describe('ActivityDetailViewerDrawer document read failure', () => {
  it.each(retryLabels)('offers a localized retry in %s and reloads the document', async (locale, retryLabel) => {
    await i18n.changeLanguage(locale);
    mocks.getBlockContent.mockResolvedValueOnce({ permissionError: 'Cannot read this document' });
    renderDrawer('document');
    await screen.findByText('Cannot read this document');

    const retry = screen.getByRole('button', { name: retryLabel });
    mocks.getBlockContent.mockResolvedValue({
      block_data: [{ type: 'paragraph', content: 'Recovered document content' }],
    });
    fireEvent.click(retry);

    await screen.findByText(/Recovered document content/);
    expect(mocks.getBlockContent).toHaveBeenCalledTimes(2);
    expect(mocks.getBlockContent).toHaveBeenLastCalledWith('a1');
    expect(screen.queryByText('Cannot read this document')).toBeNull();
    expect(screen.queryByRole('button', { name: retryLabel })).toBeNull();
  });

  it('shows the permission error for a directly opened document', async () => {
    mocks.getBlockContent.mockResolvedValue({ permissionError: 'Cannot read this document' });
    renderDrawer('document');
    await screen.findByText('Cannot read this document');
    expect(screen.queryByText('Edit')).toBeNull();
  });
  it.each(['permissionError', 'actionError'])('shows a returned %s instead of stale document content and can recover', async (key) => {
    mocks.getBlockContent.mockResolvedValue({ block_data: [{ type: 'paragraph', content: 'Stored document content' }] });
    renderDrawer('notification');
    await waitFor(() => expect(mocks.navigateToDocument).toBeTruthy());
    await act(async () => { mocks.navigateToDocument!('doc-1', 'Review document'); });
    await screen.findByText(/Stored document content/);

    mocks.getBlockContent.mockResolvedValue({ [key]: 'Document access is denied' });
    await act(async () => { mocks.navigateToDocument!('doc-1', 'Review document'); });
    await screen.findByText('Document access is denied');
    expect(screen.queryByText(/Stored document content/)).toBeNull();

    mocks.getBlockContent.mockResolvedValue({ block_data: [{ type: 'paragraph', content: 'Recovered document content' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('notification');
    expect(screen.queryByText('Document access is denied')).toBeNull();
    await act(async () => { mocks.navigateToDocument!('doc-1', 'Review document'); });
    await screen.findByText(/Recovered document content/);
  });
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
