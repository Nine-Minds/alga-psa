/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConversationReadAcknowledgment } from '../../../../../packages/tickets/src/components/ticket/conversations/ConversationReadAcknowledgment';
const mocks = vi.hoisted(() => ({ acknowledge: vi.fn(), focus: true, visible: 'visible', session: 'first' }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { session_id: mocks.session, user: { tenant: 'home', id: mocks.session } } }) }));
vi.mock('../../../../../packages/tickets/src/actions/namedTicketConversationActions', () => ({ acknowledgeNamedConversationMessagesAction: mocks.acknowledge }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, variant, size, ...props }: any) => <button {...props}>{children}</button> }));
const ticket = { tenant: 'owner', ticketId: 'ticket' }, conversation = { storeTenant: 'home', conversationId: 'private' };
const message = (id: string) => ({ commentId: id, threadId: `thread-${id}` });
const view = (messages = [message('one')], onChanged = vi.fn()) => <ConversationReadAcknowledgment id="read" ticket={ticket} conversation={conversation} messages={messages} onChanged={onChanged} />;
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => {
  vi.clearAllMocks(); mocks.focus = true; mocks.visible = 'visible'; mocks.session = 'first';
  mocks.acknowledge.mockResolvedValue({ changed: false });
  vi.spyOn(document, 'hasFocus').mockImplementation(() => mocks.focus);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => mocks.visible as DocumentVisibilityState);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('waits for a visible focused tab and acknowledges only the displayed message snapshot', async () => {
  mocks.focus = false; mocks.visible = 'hidden';
  const changed = vi.fn(), pending = deferred(); mocks.acknowledge.mockReturnValueOnce(pending.promise);
  const rendered = render(view([message('one')], changed));
  expect(mocks.acknowledge).not.toHaveBeenCalled();
  mocks.visible = 'visible'; fireEvent(document, new Event('visibilitychange'));
  expect(mocks.acknowledge).not.toHaveBeenCalled();
  mocks.focus = true; fireEvent(window, new Event('focus'));
  await waitFor(() => expect(mocks.acknowledge).toHaveBeenCalledOnce());
  expect(mocks.acknowledge).toHaveBeenCalledWith(ticket, conversation, [message('one')]);
  await act(async () => pending.resolve({ changed: true })); expect(changed).toHaveBeenCalledOnce();
  rendered.rerender(view([message('one')], changed)); fireEvent(window, new Event('focus'));
  expect(mocks.acknowledge).toHaveBeenCalledOnce();
  rendered.rerender(view([message('one'), message('later')], changed));
  await waitFor(() => expect(mocks.acknowledge).toHaveBeenCalledTimes(2));
  expect(mocks.acknowledge).toHaveBeenLastCalledWith(ticket, conversation, [message('one'), message('later')]);
});

it('keeps failed read state retryable without acknowledging new messages or changing a draft', async () => {
  const changed = vi.fn(); mocks.acknowledge.mockRejectedValueOnce(new Error('Temporary failure'));
  render(view([message('one')], changed));
  await screen.findByText('Could not mark these messages as read.');
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(mocks.acknowledge.mock.calls).toEqual([[ticket, conversation, [message('one')]], [ticket, conversation, [message('one')]]]);
});

it('stops an old session batch and drops its completion after the viewer changes', async () => {
  const changed = vi.fn(), pending = deferred(); mocks.acknowledge.mockReturnValueOnce(pending.promise);
  const many = Array.from({ length: 101 }, (_, index) => message(String(index)));
  const rendered = render(view(many, changed));
  await waitFor(() => expect(mocks.acknowledge).toHaveBeenCalledOnce());
  expect(mocks.acknowledge.mock.calls[0][2]).toHaveLength(100);
  mocks.session = 'second'; rendered.rerender(view([message('new-viewer')], changed));
  await waitFor(() => expect(mocks.acknowledge).toHaveBeenCalledTimes(2));
  await act(async () => pending.resolve({ changed: true }));
  expect(changed).not.toHaveBeenCalled();
  expect(mocks.acknowledge).toHaveBeenCalledTimes(2);
  expect(mocks.acknowledge).toHaveBeenLastCalledWith(ticket, conversation, [message('new-viewer')]);
});
