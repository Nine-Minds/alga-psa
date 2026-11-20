/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskCommentForm } from './TaskCommentForm';
import TaskComment from './TaskComment';
import type { IProjectTaskCommentWithUser } from '@alga-psa/types';

const mocks = vi.hoisted(() => ({
  create: vi.fn(), update: vi.fn(), upload: vi.fn(), discard: vi.fn(),
}));

vi.mock('../actions/projectTaskCommentActions', () => ({ createTaskComment: mocks.create, updateTaskComment: mocks.update, deleteTaskComment: vi.fn() }));
vi.mock('../actions/projectTaskCommentAttachmentDraftActions', () => ({
  uploadProjectTaskCommentDocument: mocks.upload,
  discardProjectTaskCommentAttachmentDrafts: mocks.discard,
}));
vi.mock('@alga-psa/user-composition/actions', () => ({ searchUsersForMentions: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }) }));
vi.mock('@alga-psa/ui/keyboard-shortcuts', async importOriginal => ({
  ...await importOriginal<typeof import('@alga-psa/ui/keyboard-shortcuts')>(),
  useDialogSubmitShortcut: () => undefined,
}));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@alga-psa/ui/editor', async importOriginal => {
  const actual = await importOriginal<typeof import('@alga-psa/ui/editor')>();
  return {
    ...actual,
    RichTextViewer: () => <div data-testid="comment-viewer" />,
    TextEditor: ({ editorRef, initialContent, uploadFile, onContentChange }: any) => {
      const [content, setContent] = useState(initialContent ?? [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft', styles: {} }] }]);
      if (editorRef) editorRef.current = {
        document: content,
        replaceBlocks: (_old: unknown, next: unknown) => setContent(next),
      };
      return <div
        data-testid="paste-editor"
        data-content-count={content.length}
        onPaste={async event => {
          const file = event.clipboardData.files[0];
          if (!file || !uploadFile) return;
          const url = await uploadFile(file);
          const next = [...content, { type: 'image', props: { url } }];
          setContent(next);
          onContentChange?.(next);
        }}
      />;
    },
  };
});

afterEach(() => vi.clearAllMocks());

function comment(overrides: Partial<IProjectTaskCommentWithUser> = {}): IProjectTaskCommentWithUser {
  return {
    taskCommentId: 'comment-1', taskId: 'task-1', userId: 'user-1',
    note: JSON.stringify([{ type: 'image', props: { url: '/api/documents/view/saved-file' } }]),
    createdAt: new Date().toISOString(), updatedAt: null, editedAt: null,
    firstName: 'Test', lastName: 'User', email: 'test@example.com', avatarUrl: null,
    author_type: 'internal', ...overrides,
  } as IProjectTaskCommentWithUser;
}

function pasteImage() {
  const file = new File(['pixels'], 'clipboard.png', { type: 'image/png' });
  fireEvent.paste(screen.getByTestId('paste-editor'), { clipboardData: { files: [file] } });
}

describe('Project Task comment image paste', () => {
  it('inserts and saves a pasted image in a new comment', async () => {
    mocks.upload.mockResolvedValue({ success: true, document: { document_id: 'draft-1', file_id: 'file-1', document_name: 'clipboard.png', mime_type: 'image/png' } });
    mocks.create.mockResolvedValue('comment-2');
    const onAdded = vi.fn();
    render(<TaskCommentForm taskId="task-1" projectId="project-1" userId="user-1" onCommentAdded={onAdded} />);

    pasteImage();
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith(expect.any(FormData), { userId: 'user-1', projectTaskId: 'task-1' }));
    await waitFor(() => expect(screen.getByTestId('paste-editor')).toHaveAttribute('data-content-count', '2'));
    fireEvent.click(screen.getByRole('button', { name: /add comment/i }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(JSON.parse(mocks.create.mock.calls[0][0].note)).toContainEqual({ type: 'image', props: { url: '/api/documents/view/file-1' } });
    expect(onAdded).toHaveBeenCalledOnce();
  });

  it('cancels an edit by discarding only the new upload and leaving the saved image in the comment', async () => {
    mocks.upload.mockResolvedValue({ success: true, document: { document_id: 'draft-2', file_id: 'file-2', document_name: 'clipboard.png', mime_type: 'image/png' } });
    mocks.discard.mockResolvedValue({ deletedDocumentIds: ['draft-2'], failures: [] });
    render(<TaskComment comment={comment()} onUpdate={vi.fn()} onDelete={vi.fn()} currentUserId="user-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit comment' }));
    pasteImage();
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('paste-editor')).toHaveAttribute('data-content-count', '2'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(mocks.discard).toHaveBeenCalledWith({ projectTaskId: 'task-1', documentIds: ['draft-2'] }));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.getByTestId('comment-viewer')).toBeInTheDocument();
  });

  it('keeps the draft after a failed new-comment save so the user can retry or discard it', async () => {
    mocks.upload.mockResolvedValue({ success: true, document: { document_id: 'draft-3', file_id: 'file-3', document_name: 'clipboard.png', mime_type: 'image/png' } });
    mocks.create.mockRejectedValue(new Error('temporary save failure'));
    mocks.discard.mockResolvedValue({ deletedDocumentIds: ['draft-3'], failures: [] });
    render(<TaskCommentForm taskId="task-1" projectId="project-1" userId="user-1" onCommentAdded={vi.fn()} onCancel={vi.fn()} />);
    pasteImage();
    await waitFor(() => expect(screen.getByTestId('paste-editor')).toHaveAttribute('data-content-count', '2'));

    fireEvent.click(screen.getByRole('button', { name: /add comment/i }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.discard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(mocks.discard).toHaveBeenCalledWith({ projectTaskId: 'task-1', documentIds: ['draft-3'] }));
  });

  it('saves both the previously saved image and the newly pasted edit image', async () => {
    mocks.upload.mockResolvedValue({ success: true, document: { document_id: 'draft-4', file_id: 'file-4', document_name: 'clipboard.png', mime_type: 'image/png' } });
    mocks.update.mockResolvedValue(undefined);
    const originalImage = { type: 'image', props: { url: '/api/documents/view/saved-file' } };
    render(<TaskComment comment={comment({ note: JSON.stringify([originalImage]) })} onUpdate={vi.fn()} onDelete={vi.fn()} currentUserId="user-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit comment' }));
    pasteImage();
    await waitFor(() => expect(screen.getByTestId('paste-editor')).toHaveAttribute('data-content-count', '2'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    const saved = JSON.parse(mocks.update.mock.calls[0][1].note);
    expect(saved).toContainEqual(originalImage);
    expect(saved).toContainEqual({ type: 'image', props: { url: '/api/documents/view/file-4' } });
  });
});
