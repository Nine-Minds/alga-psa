/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Attachments from '../../../components/co-managed/CoManagedCommentAttachments';
import { CoManagedFeatureBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';
const mocks = vi.hoisted(() => ({ load: vi.fn(), upload: vi.fn(), flag: vi.fn(), session: { user: { tenant: 'home', id: 'user' } } }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: mocks.session }) }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('../../../lib/actions/coManagedAttachmentActions', () => ({ getCoManagedAttachmentsScreenAction: mocks.load, uploadCoManagedAttachmentAction: mocks.upload }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }), useOptionalI18n: () => null, useFormatters: () => ({ formatNumber: (value: number) => String(value) }) }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata() {}, updateActions() {} }) }));
const resource = { tenant: 'customer', relationshipId: 'relationship', id: 'ticket', kind: 'ticket' as const };
const comment = { storeTenant: 'customer', threadId: 'thread', commentId: 'comment' };
const attachment = { ...comment, attachmentId: 'file', fileName: 'Report <private>.txt', mimeType: 'text/plain', size: 5, audience: 'shared_it' };
const data = () => ({ attachments: [attachment], actor: { tenant: 'home', userId: 'user' }, canUpload: true, maxBytes: 1000 });
const mount = () => render(<CoManagedFeatureBoundary><Attachments resource={resource} comment={comment} /></CoManagedFeatureBoundary>);
const button = (key: string) => screen.getByRole('button', { name: key });
const add = () => button('coManaged.attachments.add');
const picker = () => screen.getByLabelText('coManaged.attachments.choose');
const choose = (file = new File(['Bytes'], 'Upload.txt', { type: 'text/plain' })) => { fireEvent.click(add()); fireEvent.change(picker(), { target: { files: [file] } }); return file; };
const pending = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => { vi.resetAllMocks(); mocks.session = { user: { tenant: 'home', id: 'user' } }; mocks.flag.mockReturnValue({ enabled: true }); mocks.load.mockResolvedValue(data()); mocks.upload.mockResolvedValue({ ok: true }); });
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
