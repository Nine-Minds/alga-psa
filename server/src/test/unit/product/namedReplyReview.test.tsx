/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NamedReplyReviewManager } from '../../../../../packages/integrations/src/components/email/admin/NamedReplyReviewManager';
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { session_id: 'session', user: { tenant: 'home', id: 'admin' } } }) }));
const api = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), resolve: vi.fn() }));
vi.mock('../../../../../packages/integrations/src/actions/email-actions/namedReplyReviewActions', () => ({
  listNamedReplyReviewsAction: api.list, getNamedReplyReviewAction: api.get, resolveNamedReplyReviewAction: api.resolve,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, variant, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Card', () => ({ Card: ({ children }: any) => <div>{children}</div>, CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>, CardTitle: ({ children }: any) => <h2>{children}</h2> }));
vi.mock('@alga-psa/ui/components/Alert', () => ({ Alert: ({ children }: any) => <div role="alert">{children}</div>, AlertDescription: ({ children }: any) => <div>{children}</div> }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ label, options, onValueChange, value, placeholder, ...props }: any) =>
  <label>{label}<select {...props} value={value} onChange={event => onValueChange(event.target.value)}><option value="">{placeholder}</option>{options.map((item: any) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (_key: string, options: any) => options.defaultValue }) }));
const destination = { name: 'Carrier exchange', audience: 'organization_private', ticketNumber: '1042', ticket: { tenant: 'owner', ticketId: 'ticket' },
  conversation: { storeTenant: 'home', conversationId: 'side' }, revision: 3 };
beforeEach(() => {
  vi.resetAllMocks();
  api.list.mockResolvedValue({ items: [{ inboxId: 'inbox', subject: 'Carrier update', from: 'vendor@example.test', mailbox: 'support@example.test', receivedAt: '2026-09-08T00:00:00Z' }], hasMore: false });
  api.get.mockResolvedValue({ inboxId: 'inbox', sourceSha256: 'a'.repeat(64), subject: 'Carrier update', from: { email: 'vendor@example.test' },
    to: [{ email: 'support@example.test' }], cc: [], text: 'Service restored.', attachments: [], canResolve: true, destinations: [destination] });
});
afterEach(cleanup);
it('requires an explicit destination and reuses the same resolution after an uncertain response', async () => {
  api.resolve.mockRejectedValueOnce(new Error('Lost acknowledgement')).mockResolvedValueOnce({ commentId: 'published' });
  render(<NamedReplyReviewManager />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
  expect(await screen.findByText('Service restored.')).toBeTruthy();
  const select = screen.getByLabelText('Destination conversation');
  expect(screen.getByRole('button', { name: 'Add reply to conversation' }).hasAttribute('disabled')).toBe(true);
  fireEvent.change(select, { target: { value: '0' } });
  expect(api.resolve).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Add reply to conversation' }));
  await screen.findByText(/Resolution could not be confirmed/);
  expect(select.hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Retry resolution' }));
  await screen.findByText('Reply added to the selected conversation.');
  expect(api.resolve).toHaveBeenCalledTimes(2);
  expect(api.resolve.mock.calls[0][0]).toEqual(api.resolve.mock.calls[1][0]);
  expect(api.resolve.mock.calls[0][0]).toMatchObject({ inboxId: 'inbox', ticket: destination.ticket, conversation: destination.conversation, expectedConversationRevision: 3 });
});
it('keeps unverified source visible for review but disables resolution', async () => {
  api.get.mockResolvedValue({ ...(await api.get()), canResolve: false, destinations: [] });
  render(<NamedReplyReviewManager />); fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
  await screen.findByText(/Sender authentication could not be verified/);
  expect(screen.getByRole('button', { name: 'Add reply to conversation' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByLabelText('Destination conversation').hasAttribute('disabled')).toBe(true);
  await waitFor(() => expect(api.resolve).not.toHaveBeenCalled());
});
