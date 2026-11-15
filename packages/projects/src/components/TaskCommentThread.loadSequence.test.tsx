/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';

import React from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, configure, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TaskCommentThread from './TaskCommentThread';
import type { IProjectTaskCommentWithUser } from '@alga-psa/types';

beforeEach(() => {
  configure({ testIdAttribute: 'data-automation-id' });
});
afterAll(() => {
  configure({ testIdAttribute: 'data-testid' });
});

const NOTE = JSON.stringify([
  { type: 'paragraph', content: [{ type: 'text', text: 'Task comment', styles: {} }] },
]);

const mocks = vi.hoisted(() => ({
  getTaskComments: vi.fn(),
  createTaskComment: vi.fn(),
  getTaskCommentsReactionsBatch: vi.fn(),
  toastError: vi.fn(),
  pageCreateShortcut: { enabled: undefined as boolean | undefined },
}));

vi.mock('@alga-psa/ui/keyboard-shortcuts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/ui/keyboard-shortcuts')>()),
  usePageCreateShortcut: (_handler: unknown, options: { enabled?: boolean } = {}) => {
    mocks.pageCreateShortcut.enabled = options.enabled;
  },
}));

vi.mock('@alga-psa/ui/editor', () => ({
  DEFAULT_BLOCK: [{ type: 'paragraph', content: [{ type: 'text', text: '', styles: {} }] }],
  RichTextViewer: () => <div data-automation-id="rich-text-viewer" />,
  // A stateful stand-in for the rich-text editor: its text lives in this instance's
  // state, so a remount loses it exactly as the real editor's draft would.
  TextEditor: ({ editorRef }: any) => {
    const [text, setText] = React.useState('Reply body');
    const textRef = React.useRef(text);
    textRef.current = text;
    if (editorRef) {
      editorRef.current = {
        get document() {
          return [{ type: 'paragraph', content: [{ type: 'text', text: textRef.current, styles: {} }] }];
        },
        replaceBlocks: () => setText(''),
      };
    }
    return (
      <textarea
        data-automation-id="task-comment-editor"
        aria-label="Comment editor"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    );
  },
}));

const translate = (key: string, arg2?: unknown): string => {
  if (typeof arg2 === 'string') return arg2;
  if (arg2 && typeof arg2 === 'object') {
    const opts = arg2 as Record<string, unknown>;
    const template = typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
    return template.replace(/{{\s*(\w+)\s*}}/g, (_m, name: string) => String(opts[name] ?? ''));
  }
  return key;
};

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock('react-hot-toast', () => ({ toast: { error: mocks.toastError } }));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/UserAvatar', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('@alga-psa/ui/components/ReactionDisplay', () => ({
  ReactionDisplay: ({ id, reactions }: { id: string; reactions: Array<{ emoji: string }> }) => (
    <div data-automation-id={id}>{reactions.map((r) => r.emoji).join(',')}</div>
  ),
}));
vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: ({ id }: { id: string }) => ({ 'data-automation-id': id }),
  withUIReflectionId: ({ id }: { id: string }) => ({ 'data-automation-id': id }),
}));
vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ user_id: 'user-1', first_name: 'A', last_name: 'User' }),
  getCurrentUserAvatarUrl: vi.fn().mockResolvedValue(null),
  searchUsersForMentions: vi.fn(),
}));
vi.mock('../actions/projectTaskCommentReactionActions', () => ({
  getTaskCommentsReactionsBatch: (...args: any[]) => mocks.getTaskCommentsReactionsBatch(...args),
  toggleTaskCommentReaction: vi.fn(),
}));
vi.mock('../actions/projectTaskCommentActions', () => ({
  getTaskComments: (...args: any[]) => mocks.getTaskComments(...args),
  createTaskComment: (...args: any[]) => mocks.createTaskComment(...args),
  updateTaskComment: vi.fn(),
  deleteTaskComment: vi.fn(),
}));

function comment(overrides: Partial<IProjectTaskCommentWithUser> = {}): IProjectTaskCommentWithUser {
  return {
    taskCommentId: 'root',
    taskId: 'task-a',
    userId: 'user-1',
    note: NOTE,
    createdAt: '2026-05-13T09:00:00.000Z',
    updatedAt: null,
    editedAt: null,
    firstName: 'A',
    lastName: 'User',
    email: 'a@example.com',
    avatarUrl: null,
    author_type: 'internal',
    threadId: 'thread-1',
    parentCommentId: null,
    deletedAt: null,
    ...overrides,
  } as IProjectTaskCommentWithUser;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const settle = async (d: { resolve: (v: any) => void }, value: unknown) => {
  await act(async () => {
    d.resolve(value);
  });
};

describe('TaskCommentThread load sequencing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset (not just clear) the hand-controlled mocks so an unconsumed
    // mockReturnValueOnce from a failing test cannot leak into the next one.
    mocks.getTaskComments.mockReset();
    mocks.getTaskCommentsReactionsBatch.mockReset();
    mocks.createTaskComment.mockResolvedValue(undefined);
    mocks.getTaskCommentsReactionsBatch.mockResolvedValue({ reactions: {}, userNames: {} });
    mocks.pageCreateShortcut.enabled = undefined;
  });
  afterEach(() => cleanup());

  it('A1: a stale same-task reload does not erase a just-posted reply', async () => {
    const user = userEvent.setup();
    const d1 = deferred<any>();
    const d2 = deferred<any>();
    mocks.getTaskComments.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);

    render(<TaskCommentThread taskId="task-a" projectId="project-1" />);

    await user.click(screen.getByRole('button', { name: 'Add Comment' }));
    await user.click(screen.getByRole('button', { name: 'Add Comment' }));
    expect(mocks.getTaskComments).toHaveBeenCalledTimes(2);

    const root = comment();
    const reply = comment({
      taskCommentId: 'reply-1',
      parentCommentId: 'root',
      createdAt: '2026-05-13T09:05:00.000Z',
    });
    await settle(d2, [root, reply]);
    await settle(d1, [root]);

    expect(screen.getByTestId('task-comment-reply-1')).toBeInTheDocument();
    expect(screen.getByText('1 reply')).toBeInTheDocument();
  });

  it('A2: task A late response never renders in task B or reports its count', async () => {
    const dA = deferred<any>();
    const dB = deferred<any>();
    mocks.getTaskComments.mockReturnValueOnce(dA.promise).mockReturnValueOnce(dB.promise);
    const onCount = vi.fn();

    const { rerender } = render(<TaskCommentThread taskId="task-a" projectId="p" onCommentCountChange={onCount} />);
    rerender(<TaskCommentThread taskId="task-b" projectId="p" onCommentCountChange={onCount} />);

    await settle(dB, [comment({ taskCommentId: 'b-root', taskId: 'task-b' })]);
    await settle(dA, [comment({ taskCommentId: 'a-root' }), comment({ taskCommentId: 'a-2', createdAt: '2026-05-13T09:01:00.000Z' })]);

    expect(screen.getByTestId('task-comment-b-root')).toBeInTheDocument();
    expect(screen.queryByTestId('task-comment-a-root')).not.toBeInTheDocument();
    expect(onCount).toHaveBeenCalledWith('task-b', 1);
    expect(onCount.mock.calls.some(([id]) => id === 'task-a')).toBe(false);
  });

  it('A3: a superseded failure leaves no alert and no lost comments', async () => {
    const dOld = deferred<any>();
    const dNew = deferred<any>();
    mocks.getTaskComments.mockReturnValueOnce(dOld.promise).mockReturnValueOnce(dNew.promise);

    const { rerender } = render(<TaskCommentThread taskId="task-a" projectId="p" />);
    rerender(<TaskCommentThread taskId="task-b" projectId="p" />);

    await settle(dNew, [comment({ taskCommentId: 'b-root', taskId: 'task-b' })]);
    await settle(dOld, { actionError: 'nope' });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('task-comment-b-root')).toBeInTheDocument();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('A4: a current load error renders an alert and fails the composer closed', async () => {
    const d = deferred<any>();
    mocks.getTaskComments.mockReturnValueOnce(d.promise);

    render(<TaskCommentThread taskId="task-a" projectId="p" />);
    await settle(d, { actionError: 'denied' });

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load comments.');
    expect(screen.queryByRole('button', { name: 'Add Comment' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-comments-empty')).not.toBeInTheDocument();
    expect(mocks.pageCreateShortcut.enabled).toBe(false);
  });

  it('A4: retry re-runs the load and a successful retry clears the error state', async () => {
    const user = userEvent.setup();
    const dFail = deferred<any>();
    const dRetry = deferred<any>();
    mocks.getTaskComments.mockReturnValueOnce(dFail.promise).mockReturnValueOnce(dRetry.promise);

    render(<TaskCommentThread taskId="task-a" projectId="p" />);
    await settle(dFail, { actionError: 'transient' });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.getTaskComments).toHaveBeenCalledTimes(2);
    await settle(dRetry, [comment()]);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByTestId('task-comment-root')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Comment' })).toBeInTheDocument();
    expect(mocks.pageCreateShortcut.enabled).toBe(true);
  });

  it('A4: a failed refresh keeps the open composer mounted until a load succeeds', async () => {
    const user = userEvent.setup();
    const dRefresh = deferred<any>();
    const dRetry = deferred<any>();
    mocks.getTaskComments
      .mockResolvedValueOnce([comment()])
      .mockReturnValueOnce(dRefresh.promise)
      .mockReturnValueOnce(dRetry.promise);

    render(<TaskCommentThread taskId="task-a" projectId="p" />);
    expect(await screen.findByTestId('task-comment-root')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add Comment' }));
    await user.click(screen.getByRole('button', { name: 'Add Comment' }));
    expect(mocks.createTaskComment).toHaveBeenCalledTimes(1);
    await settle(dRefresh, { actionError: 'transient' });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('task-comment-form-container')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await settle(dRetry, [comment()]);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('task-comment-form-container')).toBeInTheDocument();
  });

  it('A4: a failed refresh keeps the loaded list visible behind a banner', async () => {
    const user = userEvent.setup();
    const dRefresh = deferred<any>();
    mocks.getTaskComments.mockResolvedValueOnce([comment()]).mockReturnValueOnce(dRefresh.promise);

    render(<TaskCommentThread taskId="task-a" projectId="p" />);
    expect(await screen.findByTestId('task-comment-root')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add Comment' }));
    await user.click(screen.getByRole('button', { name: 'Add Comment' }));
    await settle(dRefresh, { actionError: 'transient' });

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load comments.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByTestId('task-comment-root')).toBeInTheDocument();
    expect(screen.queryByTestId('task-comments-empty')).not.toBeInTheDocument();
  });

  it('A4: a draft being typed survives a failed refresh triggered elsewhere in the thread', async () => {
    const user = userEvent.setup();
    const dRefresh = deferred<any>();
    mocks.getTaskComments.mockResolvedValueOnce([comment()]).mockReturnValueOnce(dRefresh.promise);

    render(<TaskCommentThread taskId="task-a" projectId="p" />);
    expect(await screen.findByTestId('task-comment-root')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add Comment' }));
    const topEditor = () =>
      within(screen.getByTestId('task-comment-form-container')).getByRole('textbox', { name: 'Comment editor' });
    await user.clear(topEditor());
    await user.type(topEditor(), 'unsent draft');

    // An inline reply elsewhere in the thread posts and triggers the refresh that fails.
    await user.click(screen.getByRole('button', { name: 'Reply to comment' }));
    await user.click(screen.getByRole('button', { name: 'Reply' }));
    expect(mocks.createTaskComment).toHaveBeenCalledTimes(1);
    await settle(dRefresh, { actionError: 'transient' });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(topEditor()).toHaveValue('unsent draft');
  });

  it('A1: an older reaction batch resolving after a newer one is dropped', async () => {
    const user = userEvent.setup();
    const rOld = deferred<any>();
    const rNew = deferred<any>();
    mocks.getTaskComments.mockResolvedValue([comment()]);
    mocks.getTaskCommentsReactionsBatch.mockReturnValueOnce(rOld.promise).mockReturnValueOnce(rNew.promise);

    render(<TaskCommentThread taskId="task-a" projectId="p" />);
    await user.click(screen.getByRole('button', { name: 'Add Comment' }));
    await user.click(screen.getByRole('button', { name: 'Add Comment' }));
    expect(mocks.getTaskCommentsReactionsBatch).toHaveBeenCalledTimes(2);

    const reaction = (emoji: string) => ({ emoji, count: 1, userIds: ['user-1'], currentUserReacted: true });
    await settle(rNew, { reactions: { root: [reaction('new')] }, userNames: {} });
    await settle(rOld, { reactions: { root: [reaction('old')] }, userNames: {} });

    expect(screen.getByTestId('task-comment-root-reactions')).toHaveTextContent('new');
    expect(screen.getByTestId('task-comment-root-reactions')).not.toHaveTextContent('old');
  });
});
