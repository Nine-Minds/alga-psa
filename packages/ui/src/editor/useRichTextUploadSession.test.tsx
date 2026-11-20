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
});
