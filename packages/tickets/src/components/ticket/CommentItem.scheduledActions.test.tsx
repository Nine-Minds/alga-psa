/* @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IComment } from '@alga-psa/types';
import CommentItem from './CommentItem';

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  reschedule: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('./TicketDataSourceContext', () => ({
  useTicketDataSource: () => ({
    comments: { cancelScheduledComment: mocks.cancel, rescheduleScheduledComment: mocks.reschedule },
    viewer: { searchUsersForMentions: vi.fn() },
    screen: {},
  }),
  runTicketRefresh: (...args: any[]) => mocks.refresh(...args),
}));
vi.mock('@alga-psa/ui/editor', () => ({
  RichTextViewer: () => <div data-testid="rich-text-viewer" />,
  TextEditor: () => <div data-testid="text-editor" />,
}));
vi.mock('@alga-psa/ui/components/ReactionDisplay', () => ({ ReactionDisplay: () => <div data-testid="reactions" /> }));
vi.mock('@alga-psa/ui/components/DateTimePicker', () => ({
  DateTimePicker: ({ id, label, onChange }: any) => (
    <label htmlFor={id}>{label}<input id={id} type="datetime-local" onChange={(event) => onChange(new Date(event.target.value))} /></label>
  ),
}));
vi.mock('@alga-psa/user-composition/actions', () => ({ searchUsersForMentions: vi.fn() }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({
    locale: 'en',
    formatDate: (date: Date | string) => String(date),
    formatNumber: (value: number) => String(value),
    formatCurrency: (value: number) => String(value),
    formatRelativeTime: (date: Date | string) => String(date),
  }),
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const note = JSON.stringify([{
  type: 'paragraph',
  props: { textAlignment: 'left', backgroundColor: 'default', textColor: 'default' },
  content: [{ type: 'text', text: 'Scheduled note', styles: {} }],
}]);
const author = {
  user_id: 'user-1', first_name: 'Test', last_name: 'Agent', email: 'agent@example.com', user_type: 'internal', avatarUrl: null,
};
const scheduledComment: IComment = {
  tenant: 'tenant-1',
  author_type: 'internal',
  comment_id: 'comment-1',
  ticket_id: 'ticket-1',
  user_id: 'user-1',
  note,
  created_at: new Date().toISOString(),
  publish_state: 'scheduled',
  scheduled_publish_at: '2030-01-01T12:00:00.000Z',
  scheduled_publish_tz: 'UTC',
} as IComment;

function renderScheduledComment() {
  return render(
    <CommentItem
      conversation={scheduledComment}
      currentUserId="user-1"
      isEditing={false}
      currentComment={null}
      ticketId="ticket-1"
      userMap={{ 'user-1': author }}
      contactMap={{}}
      onContentChange={() => {}}
      onSave={() => {}}
      onClose={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
    />
  );
}

describe('CommentItem scheduled-action failures', () => {
  beforeEach(() => {
    mocks.cancel.mockReset().mockRejectedValue(new Error('Permission denied'));
    mocks.reschedule.mockReset().mockRejectedValue(new Error('Permission denied'));
    mocks.refresh.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => vi.restoreAllMocks());

  it('shows a translated inline error when cancellation is rejected', async () => {
    const user = userEvent.setup();
    renderScheduledComment();

    await user.click(screen.getByRole('button', { name: 'Cancel scheduled comment' }));

    expect(mocks.cancel).toHaveBeenCalledWith('comment-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to change this scheduled comment. Refresh and try again.');
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('keeps the reschedule dialog open and clears pending state when rejected', async () => {
    const user = userEvent.setup();
    renderScheduledComment();

    await user.click(screen.getByRole('button', { name: 'Reschedule comment' }));
    fireEvent.change(screen.getByLabelText('Publish at (UTC)'), { target: { value: '2030-02-01T12:00' } });
    const save = screen.getByRole('button', { name: 'Reschedule' });
    await user.click(save);

    expect(mocks.reschedule).toHaveBeenCalledWith('comment-1', expect.any(String), 'UTC');
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to change this scheduled comment. Refresh and try again.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(save).not.toBeDisabled());
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
