/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ list: vi.fn(), abandon: vi.fn(), begin: vi.fn(), upload: vi.fn(), publish: vi.fn() }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: (p: any) => <button id={p.id} disabled={p.disabled} onClick={p.onClick}>{p.children}</button> }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (p: any) => <input id={p.id} type="file" onChange={p.onChange} /> }));
vi.mock('@/lib/actions/coManagedConversationDraftActions', () => ({
  listCoManagedConversationDraftsAction: m.list, abandonCoManagedConversationDraftAction: m.abandon,
  beginCoManagedConversationDraftAction: m.begin, uploadCoManagedDraftAttachmentAction: m.upload, publishCoManagedConversationDraftAction: m.publish,
}));

import CoManagedDraftRestore from '@/components/co-managed/CoManagedDraftRestore';
import { restoreConversationDraft, missingDraftFiles } from '@/components/co-managed/conversationDraftSubmission';

const resource = { tenant: 't', relationshipId: 'r', kind: 'ticket', id: 'k' } as any;
const draft = (over: any = {}) => ({ storeTenant: 't', operationId: 'op1', status: 'draft', audience: 'shared_it', content: { text: 'hello draft' },
  files: [{ attachmentId: 'a1', fileName: 'one.txt', size: 3 }, { attachmentId: 'a2', fileName: 'two.txt', size: 4 }], uploadedAttachmentIds: ['a1'],
  createdAt: '', lastActivityAt: '', ...over }) as any;

describe('restoreConversationDraft', () => {
  it('reports the manifest files the server has no bytes for', () => {
    expect(missingDraftFiles(draft()).map(f => f.attachmentId)).toEqual(['a2']);
  });
  it('refuses a partial submission and names what is missing', () => {
    expect(restoreConversationDraft(resource, draft(), [])).toEqual({ ok: false, missing: ['two.txt'] });
    expect(restoreConversationDraft(resource, draft(), [new File(['abcd'], 'two.txt'), new File(['x'], 'other.txt')])).toMatchObject({ ok: true });
  });
  it('replays the stored request verbatim (same operation id, audience, manifest) with every manifest id', () => {
    const r = restoreConversationDraft(resource, draft(), [new File(['abcd'], 'two.txt')]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.prepared.request).toMatchObject({ operationId: 'op1', audience: 'shared_it', content: { text: 'hello draft' } });
    expect(r.prepared.files.map(f => f.attachmentId)).toEqual(['a1', 'a2']);
    expect(r.prepared.storeTenant).toBe('t');
  });
});

const document_ = () => document.getElementById('co-managed-draft-restore')!;

describe('CoManagedDraftRestore', () => {
  beforeEach(() => { Object.values(m).forEach(f => f.mockReset()); });
  it('renders nothing when there is no open draft', async () => {
    m.list.mockResolvedValue({ ok: true, drafts: [] });
    const { container } = render(<CoManagedDraftRestore resource={resource} version={0} onPublished={() => {}} />);
    await waitFor(() => expect(m.list).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
  });
  it('shows text, audience and per-file state, and discards through the action', async () => {
    m.list.mockResolvedValueOnce({ ok: true, drafts: [draft()] }).mockResolvedValue({ ok: true, drafts: [] });
    m.abandon.mockResolvedValue({ ok: true });
    render(<CoManagedDraftRestore resource={resource} version={0} onPublished={() => {}} />);
    expect(await screen.findByText('hello draft')).toBeInTheDocument();
    expect(screen.getByText('coManaged.conversation.audiences.shared_it', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('coManaged.conversation.drafts.fileReady')).toBeInTheDocument();
    expect(screen.getByText('coManaged.conversation.drafts.fileMissing')).toBeInTheDocument();
    screen.getByText('coManaged.conversation.drafts.discard').click();
    await waitFor(() => expect(m.abandon).toHaveBeenCalledWith(resource, { storeTenant: 't', operationId: 'op1' }));
    await waitFor(() => expect(document.getElementById('co-managed-draft-restore')).toBeNull());
  });
  it('previews plain text, never the escaped markdown the server derives', async () => {
    const blocks = [{ type: 'paragraph', content: [{ type: 'text', text: 'draft (0531).', styles: {} }, { type: 'text', text: ' a_b *c*', styles: { bold: true } }] }];
    m.list.mockResolvedValue({ ok: true, drafts: [draft({ operationId: 'op1', content: { text: 'plain (draft 0531).' } }), draft({ operationId: 'op2', content: { document: blocks } })] });
    render(<CoManagedDraftRestore resource={resource} version={0} onPublished={() => {}} />);
    expect(await screen.findByText('plain (draft 0531).')).toBeInTheDocument();
    expect(screen.getByText('draft (0531). a_b *c*')).toBeInTheDocument();
    expect(document_().textContent).not.toContain('\\');
  });
  it('will not send while a file is still missing', async () => {
    m.list.mockResolvedValue({ ok: true, drafts: [draft()] });
    render(<CoManagedDraftRestore resource={resource} version={0} onPublished={() => {}} />);
    await screen.findByText('hello draft');
    screen.getByText('coManaged.conversation.drafts.resume').click();
    expect(await screen.findByRole('alert')).toHaveTextContent('coManaged.conversation.drafts.missing');
    expect(m.begin).not.toHaveBeenCalled();
  });
});
