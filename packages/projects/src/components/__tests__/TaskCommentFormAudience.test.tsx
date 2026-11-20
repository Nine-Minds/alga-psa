/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskCommentForm } from '../TaskCommentForm';
import { TaskCommentAudienceProvider, type TaskCommentAudienceSlot } from '../../context/TaskCommentAudienceContext';

const createTaskComment = vi.fn();
vi.mock('../../actions/projectTaskCommentActions', () => ({ createTaskComment: (...args: unknown[]) => createTaskComment(...args) }));
vi.mock('@alga-psa/user-composition/actions', () => ({ searchUsersForMentions: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, defaultValue?: string | { defaultValue?: string }) => (typeof defaultValue === 'string' ? defaultValue : defaultValue?.defaultValue ?? _key) }),
}));
vi.mock('@alga-psa/ui/keyboard-shortcuts', () => ({ useDialogSubmitShortcut: () => undefined }));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn() } }));
vi.mock('@alga-psa/ui/editor', () => ({
  DEFAULT_BLOCK: [{ type: 'paragraph', content: [] }],
  hasEditorContent: (blocks: any[]) => blocks.some(block => block.type === 'image' || block.content?.some((item: any) => item.type !== 'text' || item.text?.trim())),
  useRichTextUploadSession: () => ({ uploadFile: vi.fn(), resetDraftTracking: vi.fn(), reconcileDraftUploads: vi.fn(), requestDiscard: vi.fn(), isUploading: false, isDeletingDraftImages: false }),
  TextEditor: ({ editorRef }: { editorRef: { current: unknown } }) => {
    editorRef.current = {
      document: [{ type: 'paragraph', content: [{ type: 'text', text: 'A note', styles: {} }] }],
      replaceBlocks: vi.fn(),
    };
    return <div data-testid="text-editor" />;
  },
}));

const slot: TaskCommentAudienceSlot = {
  audiences: ['shared_it', 'requester'],
  renderSelect: ({ id, audiences, value, onChange }) => (
    <select id={id} aria-label="audience" value={value ?? ''} onChange={(e) => onChange(e.target.value as never)}>
      <option value="">Who can see this?</option>
      {audiences.map((audience) => <option key={audience} value={audience}>{audience}</option>)}
    </select>
  ),
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

/**
 * Slice S29 (F073): a seat technician's task comment names who can read it, with the existing audience select injected
 * by the composition layer. Without that slot (every MSP screen) the form is the form it always was.
 */
describe('TaskCommentForm audience', () => {
  it('shows no audience control and posts no audience for an ordinary user', async () => {
    createTaskComment.mockResolvedValue('comment-1');
    render(<TaskCommentForm taskId="task-1" projectId="project-1" onCommentAdded={() => undefined} />);
    expect(screen.queryByLabelText('audience')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add comment/i }));
    await waitFor(() => expect(createTaskComment).toHaveBeenCalledTimes(1));
    expect(createTaskComment.mock.calls[0][0]).not.toHaveProperty('audience');
  });

  it('requires a choice before a seat technician can post, and posts the chosen audience', async () => {
    createTaskComment.mockResolvedValue('comment-1');
    render(<TaskCommentAudienceProvider value={slot}><TaskCommentForm taskId="task-1" projectId="project-1" onCommentAdded={() => undefined} /></TaskCommentAudienceProvider>);
    const post = screen.getByRole('button', { name: /add comment/i });
    expect(post).toBeDisabled();
    fireEvent.click(post);
    expect(createTaskComment).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('audience'), { target: { value: 'shared_it' } });
    expect(post).not.toBeDisabled();
    fireEvent.click(post);
    await waitFor(() => expect(createTaskComment).toHaveBeenCalledTimes(1));
    expect(createTaskComment.mock.calls[0][0]).toMatchObject({ taskId: 'task-1', audience: 'shared_it' });
  });

  it('asks nothing of a reply, which takes its thread\'s audience', () => {
    render(<TaskCommentAudienceProvider value={slot}><TaskCommentForm taskId="task-1" projectId="project-1" parentCommentId="c-1" onCommentAdded={() => undefined} /></TaskCommentAudienceProvider>);
    expect(screen.queryByLabelText('audience')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reply/i })).not.toBeDisabled();
  });
});
