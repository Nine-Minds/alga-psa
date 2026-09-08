/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedArchive from '../../../components/co-managed/CoManagedArchive';
const mocks = vi.hoisted(() => ({ flag: vi.fn(), list: vi.fn(), history: vi.fn(), files: vi.fn(), session: vi.fn() }));
vi.mock('next-auth/react', () => ({ useSession: mocks.session }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('../../../lib/actions/coManagedArchiveActions', () => ({ listArchiveWorkAction: mocks.list, getArchiveHistoryAction: mocks.history, listArchiveFilesAction: mocks.files }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata: () => {}, updateActions: () => {} }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }), useOptionalI18n: () => null,
  useFormatters: () => ({ formatDate: (value: Date) => value.toISOString(), formatNumber: String }) }));
const resource = { tenant: 'customer-a', relationshipId: 'relationship-a', kind: 'ticket' as const, id: 'ticket-a' };
const work = { resource, clientId: 'client-a', clientName: 'Client A', title: 'Retained issue', ticketNumber: 'T-1' };
const history = { work, entries: [{ id: 'evidence-a', kind: 'conversation', event: 'TICKET_COMMENT_ADDED', occurredAt: '2026-09-08T10:00:00Z', audience: 'shared_it',
  deleted: false, note: 'Retained shared reply', markdown: null, author: { tenant: 'msp-a', kind: 'user', id: 'u1', name: 'MSP technician', organization: 'MSP' } }], nextPage: null };
beforeEach(() => {
  vi.resetAllMocks(); mocks.flag.mockReturnValue({ enabled: true }); mocks.session.mockReturnValue({ status: 'authenticated', data: { user: { id: 'u1', tenant: 'msp-a' } } });
  mocks.list.mockResolvedValue({ items: [work], nextPage: null }); mocks.history.mockResolvedValue(history);
  mocks.files.mockResolvedValue({ items: [{ archiveFileId: 'file-a', commentId: 'comment-a', fileName: 'Evidence.txt', mimeType: 'text/plain', size: 8 }], nextPage: null });
});
afterEach(cleanup);
it.each([{ enabled: false }, { enabled: true, loading: true }, { enabled: true, error: new Error('flag') }])('does not load the archive behind an unavailable UI flag: %j', flag => {
  mocks.flag.mockReturnValue(flag); render(<CoManagedArchive />); expect(mocks.list).not.toHaveBeenCalled(); expect(screen.queryByRole('heading')).toBeNull();
});
it('shows retained history with a qualified archive download and clears it on a denied reload', async () => {
  render(<CoManagedArchive />); fireEvent.click(await screen.findByRole('button', { name: /Retained issue/ }));
  await screen.findByText('Retained shared reply'); expect(screen.getByText('MSP technician · MSP')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Evidence.txt' })).toHaveAttribute('href', '/api/co-management/archive-files/file-a?customerTenant=customer-a&relationshipId=relationship-a&ticketId=ticket-a');
  mocks.list.mockRejectedValue(new Error('revoked')); fireEvent.click(screen.getByRole('button', { name: 'coManaged.policy.reload' }));
  await screen.findByRole('alert'); expect(screen.queryByText('Retained shared reply')).toBeNull(); expect(screen.queryByRole('link')).toBeNull();
});
it('discards delayed history after a home-session change and removes downloads when the flag is disabled', async () => {
  let complete!: (value: any) => void; mocks.history.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
  const view = render(<CoManagedArchive />); fireEvent.click(await screen.findByRole('button', { name: /Retained issue/ }));
  mocks.session.mockReturnValue({ status: 'authenticated', data: { user: { id: 'u2', tenant: 'msp-b' } } }); mocks.list.mockResolvedValue({ items: [], nextPage: null });
  view.rerender(<CoManagedArchive />); await screen.findByText('coManaged.archive.empty');
  await act(async () => complete(history)); expect(screen.queryByText('Retained shared reply')).toBeNull(); expect(screen.queryByRole('link')).toBeNull();
  mocks.flag.mockReturnValue({ enabled: false }); view.rerender(<CoManagedArchive />); expect(screen.queryByRole('heading')).toBeNull();
});
it('clears the selected archive when moving between work pages', async () => {
  mocks.list.mockResolvedValueOnce({ items: [work], nextPage: 1 }).mockResolvedValue({ items: [], nextPage: null });
  render(<CoManagedArchive />); fireEvent.click(await screen.findByRole('button', { name: /Retained issue/ })); await screen.findByText('Retained shared reply');
  fireEvent.click(document.getElementById('co-archive-work-next')!); await screen.findByText('coManaged.archive.empty');
  expect(screen.queryByText('Retained shared reply')).toBeNull(); expect(mocks.list).toHaveBeenLastCalledWith(1);
});
