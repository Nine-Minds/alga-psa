/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedLocalTicketDataSourceProvider from '../../../components/co-managed/CoManagedLocalTicketDataSourceProvider';
import { useTicketDataSource } from '@alga-psa/tickets/components/ticket/TicketDataSourceContext';

// Real provider AND real disclosure dialog: only the server actions, i18n and the Radix select are stand-ins.
const mocks = vi.hoisted(() => ({ flag: vi.fn(), screen: vi.fn(), conversation: vi.fn(), preview: vi.fn(), disclose: vi.fn() }));
vi.mock('@alga-psa/tickets/lib/nativeTicketDataSource', () => ({ nativeTicketDataSource: { comments: {}, conversation: {}, slots: {} } }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata: () => {}, updateActions: () => {} }) }));
vi.mock('../../../components/co-managed/CoManagedTicketSection', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, title, children, footer }: any) => isOpen ? <div role="dialog" aria-label={title}>{children}{footer}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, variant, ...props }: any) => <button type="button" {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ id, value, options, onValueChange }: any) => (
  <select data-testid={id} value={value} onChange={event => onValueChange(event.target.value)}>
    <option value="" />{options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>) }));
vi.mock('../../../lib/actions/coManagedSharedWorkActions', () => ({ getCoManagedTicketScreenAction: mocks.screen }));
vi.mock('../../../lib/actions/coManagedTicketConversationActions', () => ({ getCoManagedTicketConversationScreenAction: mocks.conversation }));
vi.mock('../../../lib/actions/coManagedTicketCommentActions', () => ({ createCoManagedTicketCommentAction: vi.fn() }));
vi.mock('../../../lib/actions/coManagedThreadDisclosureActions', () => ({
  previewCoManagedThreadDisclosureAction: mocks.preview, discloseCoManagedThreadAction: mocks.disclose }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string, options?: any) => options?.organization ? `${key}: ${options.organization}` : key }),
  useOptionalI18n: () => null, useFormatters: () => ({ formatDate: (date: Date) => date.toISOString() }) }));

const resource = { tenant: 'customer-a', relationshipId: 'relationship-a', kind: 'ticket' as const, id: 'ticket-a' };
const actor = { tenant: 'customer-a', userId: 'user-1' };
let source: any = null;
function Probe() { source = useTicketDataSource(); return null; }

beforeEach(() => {
  vi.resetAllMocks(); source = null;
  mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null });
  mocks.screen.mockResolvedValue({ summary: { resource }, customerName: 'Customer A' });
  mocks.conversation.mockResolvedValue({ actor, nextBefore: null, writeAudiences: ['requester', 'shared_it', 'organization_private'], items: [
    { commentId: 'mine', audience: 'shared_it', storeTenant: 'customer-a', threadId: 'thread-1', parentCommentId: null, author: { kind: 'user', tenant: 'customer-a', id: 'user-1' } },
    { commentId: 'theirs', audience: 'shared_it', storeTenant: 'customer-a', threadId: 'thread-2', parentCommentId: null, author: { kind: 'user', tenant: 'msp', id: 'user-9' } },
  ] });
  mocks.preview.mockResolvedValue({ actor, preview: { storeTenant: 'customer-a', threadId: 'thread-1', audience: 'shared_it', comments: 1, attachments: 0, pendingAttachments: 0, snapshot: 'snap-1' } });
  mocks.disclose.mockImplementation(async (_resource: any, request: any) => ({ ok: true, receipt: {
    storeTenant: request.storeTenant, threadId: request.threadId, operationId: request.operationId, audience: request.audience, appliedAt: new Date().toISOString() } }));
});
afterEach(cleanup);

const mount = () => render(<CoManagedLocalTicketDataSourceProvider ticketId="ticket-a"><Probe /></CoManagedLocalTicketDataSourceProvider>);

it('lets the author change a top-level comment audience only through the disclosure dialog, then reloads', async () => {
  mount();
  await waitFor(() => expect(source.conversation.audiences).toBeDefined());
  const audiences = source.conversation.audiences;
  expect(audiences.canChangeCommentAudience({ comment_id: 'mine' })).toBe(true);
  expect(audiences.canChangeCommentAudience({ comment_id: 'theirs' })).toBe(false);

  let settled = false;
  let change!: Promise<void>;
  act(() => { change = audiences.changeCommentAudience({ comment_id: 'mine' }, 'organization_private').then(() => { settled = true; }); });
  const select = await screen.findByTestId('co-thread-thread-1-disclosure-audience');
  // Nothing is written until the dialog confirms; the current audience is not offered.
  expect(mocks.disclose).not.toHaveBeenCalled();
  expect(Array.from(select.querySelectorAll('option')).map(option => option.getAttribute('value'))).toEqual(['', 'requester', 'organization_private']);
  expect((screen.getByText('coManaged.disclosure.confirm') as HTMLButtonElement).disabled).toBe(true);

  fireEvent.change(select, { target: { value: 'organization_private' } });
  await act(async () => { fireEvent.click(screen.getByText('coManaged.disclosure.confirm')); });
  await waitFor(() => expect(mocks.disclose).toHaveBeenCalledTimes(1));
  expect(mocks.disclose.mock.calls[0][0]).toEqual(resource);
  expect(mocks.disclose.mock.calls[0][1]).toMatchObject({ storeTenant: 'customer-a', threadId: 'thread-1', audience: 'organization_private', expectedSnapshot: 'snap-1', confirmed: true });
  await act(async () => { await change; });
  expect(settled).toBe(true);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('does not reload when the dialog is cancelled', async () => {
  mount();
  await waitFor(() => expect(source.conversation.audiences).toBeDefined());
  let settled = false;
  act(() => { void source.conversation.audiences.changeCommentAudience({ comment_id: 'mine' }, 'requester').then(() => { settled = true; }); });
  await screen.findByRole('dialog');
  await act(async () => { fireEvent.click(screen.getByText('coManaged.ticket.cancel')); });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mocks.disclose).not.toHaveBeenCalled();
  expect(settled).toBe(false);
});
