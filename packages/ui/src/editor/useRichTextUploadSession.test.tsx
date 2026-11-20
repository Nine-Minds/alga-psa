import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRichTextUploadSession } from './useRichTextUploadSession';

describe('useRichTextUploadSession', () => {
  it('uploads and discards only the owned draft for its Project Task scope', async () => {
    const upload = vi.fn(async (formData: FormData, params: { userId: string; projectTaskId?: string }) => {
      expect(formData.get('commentAttachmentDraft')).toBe('true');
      return { success: true, document: { document_id: 'doc-1', file_id: 'file-1', document_name: 'image.png', mime_type: 'image/png' } };
    });
    const discard = vi.fn(async () => ({ deletedDocumentIds: ['doc-1'], failures: [] }));
    const onDiscard = vi.fn();
    const { result } = renderHook(() => useRichTextUploadSession({
      componentLabel: 'test',
      commentAttachments: true,
      scope: { entityType: 'project_task', entityId: 'task-1' },
      userId: 'user-1',
      trackDraftUploads: true,
      uploadDocumentAction: upload,
      deleteDraftUploadsAction: discard,
      onDiscard,
    }));

    await act(async () => {
      await result.current.uploadFile(new File(['image'], 'pasted.png', { type: 'image/png' }));
    });

    expect(upload).toHaveBeenCalledWith(expect.any(FormData), { userId: 'user-1', projectTaskId: 'task-1' });
    expect(result.current.draftClipboardImages).toHaveLength(1);
    await act(async () => { await result.current.requestDiscard(); });
    expect(discard).toHaveBeenCalledWith({ scope: { entityType: 'project_task', entityId: 'task-1' }, documentIds: ['doc-1'] });
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it('does not track a draft unless the upload action succeeds', async () => {
    const { result } = renderHook(() => useRichTextUploadSession({
      componentLabel: 'test',
      commentAttachments: true,
      scope: { entityType: 'project_task', entityId: 'task-1' },
      userId: 'user-1',
      trackDraftUploads: true,
      uploadDocumentAction: vi.fn(async () => ({ success: false, error: 'upload failed' })),
      deleteDraftUploadsAction: vi.fn(async () => ({ deletedDocumentIds: [], failures: [] })),
      onDiscard: vi.fn(),
      toastApi: { error: vi.fn(), success: vi.fn() },
    }));
    let failure: unknown;
    await act(async () => {
      try { await result.current.uploadFile(new File(['image'], 'pasted.png', { type: 'image/png' })); }
      catch (error) { failure = error; }
    });
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('upload failed');
    expect(result.current.draftClipboardImages).toEqual([]);
  });

  it('cleans uploads removed from the saved content while preserving referenced uploads', async () => {
    const discard = vi.fn(async () => ({ deletedDocumentIds: ['doc-1'], failures: [] }));
    const { result } = renderHook(() => useRichTextUploadSession({
      componentLabel: 'test', commentAttachments: true,
      scope: { entityType: 'project_task', entityId: 'task-1' }, userId: 'user-1',
      trackDraftUploads: true,
      uploadDocumentAction: vi.fn(async () => ({ success: true, document: {
        document_id: 'doc-1', file_id: '00000000-0000-4000-8000-000000000001', document_name: 'image.png', mime_type: 'image/png',
      } })),
      deleteDraftUploadsAction: discard,
      onDiscard: vi.fn(),
      toastApi: { error: vi.fn(), success: vi.fn() },
    }));

    await act(async () => { await result.current.uploadFile(new File(['image'], 'pasted.png', { type: 'image/png' })); });
    await act(async () => { await result.current.reconcileDraftUploads('[]'); });
    expect(discard).toHaveBeenCalledWith({ scope: { entityType: 'project_task', entityId: 'task-1' }, documentIds: ['doc-1'] });
    expect(result.current.draftClipboardImages).toEqual([]);

    discard.mockClear();
    await act(async () => { await result.current.uploadFile(new File(['image'], 'pasted.png', { type: 'image/png' })); });
    await act(async () => {
      await result.current.reconcileDraftUploads('[{"type":"image","props":{"url":"/api/documents/view/00000000-0000-4000-8000-000000000001"}}]');
    });
    expect(discard).not.toHaveBeenCalled();
  });

  it('waits for an upload finishing during dismissal and then removes its draft', async () => {
    let finishUpload!: (value: unknown) => void;
    const discard = vi.fn(async () => ({ deletedDocumentIds: ['doc-late'], failures: [] }));
    const { result, unmount } = renderHook(() => useRichTextUploadSession({
      componentLabel: 'test', commentAttachments: true,
      scope: { entityType: 'project_task', entityId: 'task-1' }, userId: 'user-1',
      trackDraftUploads: true,
      uploadDocumentAction: vi.fn(() => new Promise(resolve => { finishUpload = resolve; })),
      deleteDraftUploadsAction: discard,
      onDiscard: vi.fn(),
      toastApi: { error: vi.fn(), success: vi.fn() },
    }));

    let upload!: Promise<string>;
    await act(async () => { upload = result.current.uploadFile(new File(['image'], 'pasted.png', { type: 'image/png' })); });
    unmount();
    finishUpload({ success: true, document: {
      document_id: 'doc-late', file_id: '00000000-0000-4000-8000-000000000002', document_name: 'image.png', mime_type: 'image/png',
    } });
    await expect(upload).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(discard).toHaveBeenCalledWith({
      scope: { entityType: 'project_task', entityId: 'task-1' }, documentIds: ['doc-late'],
    }));
  });

  it('cleans the outgoing task scope when the editor is reused for a different task', async () => {
    const discard = vi.fn(async ({ documentIds }: { documentIds: string[] }) => ({ deletedDocumentIds: documentIds, failures: [] }));
    const upload = vi.fn(async (_formData: FormData, params: { projectTaskId?: string }) => ({
      success: true,
      document: {
        document_id: `doc-${params.projectTaskId}`,
        file_id: params.projectTaskId === 'task-1'
          ? '00000000-0000-4000-8000-000000000011'
          : '00000000-0000-4000-8000-000000000022',
        document_name: 'image.png', mime_type: 'image/png',
      },
    }));
    const { result, rerender } = renderHook(({ taskId }) => useRichTextUploadSession({
      componentLabel: 'test', commentAttachments: true,
      scope: { entityType: 'project_task', entityId: taskId }, userId: 'user-1', trackDraftUploads: true,
      uploadDocumentAction: upload, deleteDraftUploadsAction: discard, onDiscard: vi.fn(),
      toastApi: { error: vi.fn(), success: vi.fn() },
    }), { initialProps: { taskId: 'task-1' } });

    await act(async () => { await result.current.uploadFile(new File(['image'], 'old.png', { type: 'image/png' })); });
    rerender({ taskId: 'task-2' });
    await vi.waitFor(() => expect(discard).toHaveBeenCalledWith({
      scope: { entityType: 'project_task', entityId: 'task-1' }, documentIds: ['doc-task-1'],
    }));
    await act(async () => { await result.current.uploadFile(new File(['image'], 'new.png', { type: 'image/png' })); });
    expect(upload).toHaveBeenLastCalledWith(expect.any(FormData), { userId: 'user-1', projectTaskId: 'task-2' });
  });
});
