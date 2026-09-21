/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ load: vi.fn(), flag: vi.fn(), session: { user: { tenant: 'customer', id: 'requester', user_type: 'client' } } }));
vi.mock('@alga-psa/tickets/components', async () => import('../../../../../packages/tickets/src/components/ticket/TicketConversationAttachments'));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: mocks.session }) }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('../../../lib/actions/coManagedPortalAttachmentActions', () => ({ getPortalConversationAttachmentsAction: mocks.load }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }), useOptionalI18n: () => null }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata() {}, updateActions() {} }) }));
import { CoManagedPortalAttachmentsProvider } from '../../../components/co-managed/CoManagedPortalAttachments';
import { TicketConversationAttachments } from '../../../../../packages/tickets/src/components/ticket/TicketConversationAttachments';
const comment = { comment_id: 'comment', thread_id: 'thread', deleted_at: null } as any;
const attachment = { storeTenant: 'customer', threadId: 'thread', commentId: 'comment', attachmentId: 'file', fileName: '<Report>.txt', audience: 'requester' };
const data = () => ({ actor: { tenant: 'customer', userId: 'requester' }, attachments: [attachment] });
const view = (current = comment) => <CoManagedPortalAttachmentsProvider><TicketConversationAttachments ticketId="ticket" comment={current} /></CoManagedPortalAttachmentsProvider>;
const pending = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => { vi.resetAllMocks(); mocks.session = { user: { tenant: 'customer', id: 'requester', user_type: 'client' } }; mocks.flag.mockReturnValue({ enabled: true }); mocks.load.mockResolvedValue(data()); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('renders literal requester filenames with owner-local URLs through the actual composition slot', async () => {
  render(view()); const link = await screen.findByRole('link', { name: '<Report>.txt' });
  const url = new URL(link.getAttribute('href')!, 'https://alga.test'); expect(url.pathname).toBe('/api/client-portal/conversation-attachments/file');
  expect(Object.fromEntries(url.searchParams)).toEqual({ ticketId: 'ticket', threadId: 'thread', commentId: 'comment' }); expect(document.querySelector('report')).toBeNull();
  expect(mocks.load).toHaveBeenCalledWith({ ticketId: 'ticket', threadId: 'thread', commentId: 'comment' });
});
it.each(['disabled', 'loading', 'error'])('does not load feature attachments when the release flag is %s', kind => {
  mocks.flag.mockReturnValue({ enabled: kind !== 'disabled', loading: kind === 'loading', error: kind === 'error' }); render(view()); expect(mocks.load).not.toHaveBeenCalled();
});
it('keeps native conversations unchanged without a provider and skips deleted or unqualified comments', () => {
  render(<TicketConversationAttachments ticketId="ticket" comment={comment} />); expect(mocks.load).not.toHaveBeenCalled(); cleanup();
  render(view({ ...comment, deleted_at: '2026-09-07T00:00:00Z' })); expect(mocks.load).not.toHaveBeenCalled(); cleanup();
  render(view({ ...comment, thread_id: null })); expect(mocks.load).not.toHaveBeenCalled();
});
it('clears filenames when periodic access revalidation fails and reloads only through the authorized action', async () => {
  vi.useFakeTimers(); await act(async () => { render(view()); }); expect(screen.getByRole('link')).toBeInTheDocument();
  mocks.load.mockRejectedValue(new Error('Revoked')); await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(screen.queryByRole('link')).toBeNull(); expect(screen.getByText('coManaged.attachments.loadError')).toBeInTheDocument();
  mocks.load.mockResolvedValue(data()); await act(async () => { fireEvent.click(screen.getByRole('button')); }); expect(screen.getByRole('link')).toBeInTheDocument();
});
it('ignores late filenames from a previous requester session', async () => {
  const first = pending(); mocks.load.mockReturnValueOnce(first.promise); const rendered = render(view());
  mocks.session = { user: { tenant: 'customer', id: 'other', user_type: 'client' } }; mocks.load.mockResolvedValue({ actor: { tenant: 'customer', userId: 'other' }, attachments: [] });
  await act(async () => { rendered.rerender(view()); }); await act(async () => { first.resolve(data()); }); expect(screen.queryByRole('link')).toBeNull();
});
it.each(['actor', 'store', 'audience', 'comment'])('rejects a mismatched %s response without rendering filenames', async kind => {
  const value = data();
  if (kind === 'actor') value.actor.userId = 'other';
  if (kind === 'store') value.attachments[0] = { ...attachment, storeTenant: 'other' };
  if (kind === 'audience') value.attachments[0] = { ...attachment, audience: 'shared_it' };
  if (kind === 'comment') value.attachments[0] = { ...attachment, commentId: 'other' };
  mocks.load.mockResolvedValue(value); render(view()); await screen.findByText('coManaged.attachments.loadError'); expect(screen.queryByRole('link')).toBeNull();
});
it('loads correctly through development StrictMode effect remounts', async () => {
  render(<React.StrictMode>{view()}</React.StrictMode>); await screen.findByRole('link');
});
it('discards in-flight filenames when the same requester receives a new tracked session', async () => {
  const first = pending(); mocks.load.mockReturnValueOnce(first.promise); const rendered = render(view());
  (mocks.session as any).session_id = 'renewed-session'; mocks.load.mockResolvedValue({ ...data(), attachments: [] });
  await act(async () => { rendered.rerender(view()); }); await act(async () => { first.resolve(data()); }); expect(screen.queryByRole('link')).toBeNull();
});
