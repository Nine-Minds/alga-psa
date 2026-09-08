/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Attachments from '../../../components/co-managed/CoManagedCommentAttachments';
import { CoManagedFeatureBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';
const mocks = vi.hoisted(() => ({ load: vi.fn(), upload: vi.fn(), remove: vi.fn(), flag: vi.fn(), session: { user: { tenant: 'home', id: 'user' } } }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: mocks.session }) }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('../../../lib/actions/coManagedAttachmentActions', () => ({ getCoManagedAttachmentsScreenAction: mocks.load, uploadCoManagedAttachmentAction: mocks.upload, removeCoManagedAttachmentAction: mocks.remove }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }), useOptionalI18n: () => null, useFormatters: () => ({ formatNumber: (value: number) => String(value) }) }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata() {}, updateActions() {} }) }));
const resource = { tenant: 'customer', relationshipId: 'relationship', id: 'ticket', kind: 'ticket' as const };
const comment = { storeTenant: 'customer', threadId: 'thread', commentId: 'comment' };
const attachment = { ...comment, attachmentId: 'file', fileName: 'Report <private>.txt', mimeType: 'text/plain', size: 5, audience: 'shared_it' };
const data = () => ({ attachments: [attachment], actor: { tenant: 'home', userId: 'user' }, canUpload: true, canRemove: true, maxBytes: 1000 });
const mount = () => render(<CoManagedFeatureBoundary><Attachments resource={resource} comment={comment} /></CoManagedFeatureBoundary>);
const button = (key: string) => screen.getByRole('button', { name: key });
const add = () => button('coManaged.attachments.add');
const picker = () => screen.getByLabelText('coManaged.attachments.choose');
const choose = (file = new File(['Bytes'], 'Upload.txt', { type: 'text/plain' })) => { fireEvent.click(add()); fireEvent.change(picker(), { target: { files: [file] } }); return file; };
const pending = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => { vi.resetAllMocks(); mocks.session = { user: { tenant: 'home', id: 'user' } }; mocks.flag.mockReturnValue({ enabled: true }); mocks.load.mockResolvedValue(data()); mocks.upload.mockResolvedValue({ ok: true }); mocks.remove.mockResolvedValue({ ok: true, receipt: { ...comment, attachmentId: 'file', removedAt: '2026-09-07T00:00:00.000Z' } }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('keeps reads behind the UI release boundary', () => { mocks.flag.mockReturnValue({ enabled: false }); mount(); expect(mocks.load).not.toHaveBeenCalled(); });
it('renders literal filenames and fully qualified download links while retaining reads without upload authority', async () => {
  mocks.load.mockResolvedValue({ ...data(), canUpload: false }); mount();
  const link = await screen.findByRole('link', { name: attachment.fileName });
  const url = new URL(link.getAttribute('href')!, 'https://alga.test');
  expect(url.pathname).toBe('/api/co-management/attachments/file');
  expect(Object.fromEntries(url.searchParams)).toEqual({ customerTenant: 'customer', relationshipId: 'relationship', ticketId: 'ticket', ...comment });
  expect(screen.queryByRole('button', { name: 'coManaged.attachments.add' })).toBeNull(); expect(document.querySelector('private')).toBeNull();
});
it('uploads the selected file to its qualified comment and freezes an uncertain upload for an exact retry', async () => {
  mocks.upload.mockRejectedValueOnce(new Error('Transport ended')); mount(); await screen.findByText(attachment.fileName);
  const file = choose(); fireEvent.click(button('coManaged.attachments.upload'));
  await screen.findByText('coManaged.attachments.unknownOutcome'); expect(picker()).toBeDisabled(); expect(button('coManaged.ticket.cancel')).toBeDisabled();
  const original = mocks.upload.mock.calls[0]; expect(original.slice(0, 2)).toEqual([resource, comment]); expect(original[3].get('file')).toBe(file);
  fireEvent.click(button('coManaged.ticket.retry')); await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2));
  expect(mocks.upload.mock.calls[1][2]).toBe(original[2]); expect(mocks.upload.mock.calls[1][3].get('file')).toBe(file);
  await waitFor(() => expect(screen.queryByLabelText('coManaged.attachments.choose')).toBeNull());
});
it('rejects oversized selections before submitting an action and permits choosing another file', async () => {
  mount(); await screen.findByText(attachment.fileName); choose(new File(['x'.repeat(1001)], 'Large.txt'));
  fireEvent.click(button('coManaged.attachments.upload')); await screen.findByText('coManaged.attachments.invalid'); expect(mocks.upload).not.toHaveBeenCalled(); expect(picker()).not.toBeDisabled();
});
it('clears cached filenames and a selected file after failed periodic access reads', async () => {
  vi.useFakeTimers(); await act(async () => { mount(); }); choose(); mocks.load.mockRejectedValue(new Error('Access revoked'));
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(screen.queryByText(attachment.fileName)).toBeNull(); expect(screen.queryByLabelText('coManaged.attachments.choose')).toBeNull();
});
it('ignores old-identity attachment reads and upload outcomes', async () => {
  const late = pending(); mocks.load.mockReturnValueOnce(late.promise); const view = mount();
  mocks.session = { user: { tenant: 'other', id: 'other-user' } }; mocks.load.mockResolvedValue({ ...data(), actor: { tenant: 'other', userId: 'other-user' }, attachments: [] });
  view.rerender(<Attachments resource={resource} comment={comment} />); await screen.findByRole('button', { name: 'coManaged.attachments.add' });
  await act(async () => late.resolve(data())); expect(screen.queryByText(attachment.fileName)).toBeNull();
});
it('does not restore an uncertain draft after revocation clears it while upload is in flight', async () => {
  vi.useFakeTimers(); const late = pending(); mocks.upload.mockReturnValue(late.promise); await act(async () => { mount(); }); choose(); fireEvent.click(button('coManaged.attachments.upload'));
  mocks.load.mockRejectedValueOnce(new Error('Revoked')); await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  mocks.load.mockResolvedValue(data()); await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  await act(async () => late.resolve({ ok: false, code: 'unknownOutcome' }));
  expect(screen.queryByText('coManaged.attachments.unknownOutcome')).toBeNull(); fireEvent.click(add()); expect(picker()).not.toBeDisabled();
});
it('survives development StrictMode effect remounts without stranding a pending read', async () => {
  render(<React.StrictMode><Attachments resource={resource} comment={comment} /></React.StrictMode>); await screen.findByText(attachment.fileName);
});

const requestRemoval = () => fireEvent.click(button('coManaged.attachments.removeNamed'));
it('requires confirmation before removing the qualified file and allows closing without a mutation', async () => {
  mount(); await screen.findByText(attachment.fileName); requestRemoval();
  expect(screen.getByRole('dialog')).toBeInTheDocument(); expect(mocks.remove).not.toHaveBeenCalled();
  fireEvent.click(button('coManaged.ticket.cancel')); expect(mocks.remove).not.toHaveBeenCalled();
  requestRemoval(); fireEvent.click(button('coManaged.attachments.remove'));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
  expect(mocks.remove).toHaveBeenCalledWith(resource, { ...comment, attachmentId: 'file' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('freezes an uncertain removal and retries the exact qualified file without another upload', async () => {
  mocks.remove.mockRejectedValueOnce(new Error('Lost acknowledgement'));
  mount(); await screen.findByText(attachment.fileName); requestRemoval(); fireEvent.click(button('coManaged.attachments.remove'));
  await screen.findByText('coManaged.attachments.removeUnknownOutcome'); expect(button('coManaged.ticket.cancel')).toBeDisabled();
  fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(button('coManaged.ticket.retry')); await waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(2));
  expect(mocks.remove.mock.calls[1]).toEqual(mocks.remove.mock.calls[0]); expect(mocks.upload).not.toHaveBeenCalled();
});
it('permits removal with uploads disabled and hides removal when current write authority is absent', async () => {
  mocks.load.mockResolvedValue({ ...data(), canUpload: false }); const view = mount(); await screen.findByText(attachment.fileName);
  expect(button('coManaged.attachments.removeNamed')).toBeEnabled(); view.unmount();
  mocks.load.mockResolvedValue({ ...data(), canUpload: false, canRemove: false }); mount(); await screen.findByText(attachment.fileName);
  expect(screen.queryByRole('button', { name: 'coManaged.attachments.removeNamed' })).toBeNull();
});
it('clears an open removal when periodic access fails and ignores the late mutation result', async () => {
  vi.useFakeTimers(); const response = pending(); mocks.remove.mockReturnValue(response.promise);
  await act(async () => { mount(); }); requestRemoval(); fireEvent.click(button('coManaged.attachments.remove'));
  mocks.load.mockRejectedValue(new Error('Revoked')); await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByText(attachment.fileName)).toBeNull();
  await act(async () => { response.resolve({ ok: false, code: 'unknownOutcome' }); });
  expect(screen.queryByText('coManaged.attachments.removeUnknownOutcome')).toBeNull();
});
it('treats a current list without the removed file as confirmation and ignores a late unknown outcome', async () => {
  vi.useFakeTimers(); const response = pending(); mocks.remove.mockReturnValue(response.promise);
  await act(async () => { mount(); }); requestRemoval(); fireEvent.click(button('coManaged.attachments.remove'));
  mocks.load.mockResolvedValue({ ...data(), attachments: [] }); await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(screen.queryByRole('dialog')).toBeNull(); await act(async () => { response.resolve({ ok: false, code: 'unknownOutcome' }); });
  expect(screen.queryByText('coManaged.attachments.removeUnknownOutcome')).toBeNull();
});
it('rejects an inconsistent removal receipt and keeps the selected file frozen for reconciliation', async () => {
  mocks.remove.mockResolvedValue({ ok: true, receipt: { ...comment, attachmentId: 'other', removedAt: '2026-09-07T00:00:00Z' } });
  mount(); await screen.findByText(attachment.fileName); requestRemoval(); fireEvent.click(button('coManaged.attachments.remove'));
  await screen.findByText('coManaged.attachments.removeUnknownOutcome'); expect(button('coManaged.ticket.cancel')).toBeDisabled();
});
it('drops a selected file when the tracked session changes for the same home user', async () => {
  const view = mount(); await screen.findByText(attachment.fileName); requestRemoval();
  (mocks.session as any).session_id = 'new-session'; mocks.load.mockResolvedValue({ ...data(), attachments: [] });
  await act(async () => { view.rerender(<CoManagedFeatureBoundary><Attachments resource={resource} comment={comment} /></CoManagedFeatureBoundary>); });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByText(attachment.fileName)).toBeNull();
});

it('shows owner-received requester files once through named downloads and clears them after access revocation', async () => {
  vi.useFakeTimers();
  const received = { ...attachment, attachmentId: 'received', fileName: 'Requester reply.txt' };
  const conversation = { storeTenant: 'customer', conversationId: 'requester' };
  mocks.load.mockResolvedValue({ ...data(), attachments: [attachment, received], removableAttachmentIds: ['file'] });
  await act(async () => { render(<Attachments resource={resource} comment={comment} conversation={conversation} />); });
  expect(mocks.load).toHaveBeenCalledWith(resource, comment, conversation);
  expect(screen.getAllByRole('link')).toHaveLength(2);
  const url = new URL(screen.getByRole('link', { name: received.fileName }).getAttribute('href')!, 'https://alga.test');
  expect(url.pathname).toBe('/api/tickets/conversation-attachments/received');
  expect(Object.fromEntries(url.searchParams)).toEqual({ ticketTenant: 'customer', relationshipId: 'relationship', ticketId: 'ticket', conversationId: 'requester', ...comment });
  expect(screen.getAllByRole('button', { name: 'coManaged.attachments.removeNamed' })).toHaveLength(1);
  expect(add()).toBeEnabled();
  mocks.load.mockRejectedValue(new Error('Access revoked'));
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(screen.queryByRole('link')).toBeNull(); expect(screen.queryByRole('button', { name: 'coManaged.attachments.add' })).toBeNull();
});
