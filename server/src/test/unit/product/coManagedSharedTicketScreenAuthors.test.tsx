/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SharedTicketScreen from '../../../components/co-managed/SharedTicketScreen';

const mocks = vi.hoisted(() => ({ readConversation: vi.fn(), writeComment: vi.fn() }));
vi.mock('@/lib/actions/coManagedTicketConversationActions', () => ({
  getCoManagedTicketConversationScreenAction: (...args: any[]) => mocks.readConversation(...args),
}));
vi.mock('@/lib/actions/coManagedTicketCommentActions', () => ({
  createCoManagedTicketCommentAction: (...args: any[]) => mocks.writeComment(...args),
}));
vi.mock('@alga-psa/tickets/components/ticket/TicketDetailsContainer', async () => {
  const React = await import('react');
  const { useTicketDataSource } = await import('@alga-psa/tickets/components/ticket/TicketDataSourceContext');
  return { default: function TicketDetailsContainer({ ticketData }: any) {
    const source = useTicketDataSource();
    const author = (comment: any) => comment.user_id
      ? ticketData.userMap[comment.user_id]?.first_name ?? 'Unknown User'
      : comment.actor_display_name ?? 'Unknown User';
    const comments = ticketData.comments.map((comment: any) => React.createElement('li', { key: comment.comment_id }, author(comment)));
    return React.createElement(React.Fragment, null,
      React.createElement('ul', { 'aria-label': 'Conversation data passed to ticket details' }, comments),
      React.createElement('button', { onClick: () => source.comments.addTicketCommentWithCacheForCurrentUser(
        ticketData.ticket.ticket_id, 'A Shared IT reply', false, undefined, undefined, undefined, undefined, undefined, 'shared_it',
      ) }, 'Post Shared IT reply'),
    );
  } };
});
vi.mock('../../../components/co-managed/CoManagedTicketSection', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (_key: string, options?: any) => options?.defaultValue ?? _key }) }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));

const resource = { kind: 'ticket', tenant: 'customer-tenant', id: 'ticket-1' } as any;
const oldComment = {
  commentId: 'comment-old', threadId: 'thread-1', parentCommentId: null, storeTenant: 'customer-tenant',
  note: 'Earlier message', audience: 'shared_it', createdAt: '2026-11-01T12:00:00.000Z',
  author: { kind: 'user', tenant: 'msp-tenant', id: 'other-user', displayName: 'Morgan Earlier' },
};
const postedComment = {
  commentId: 'comment-new', threadId: 'thread-1', parentCommentId: null, storeTenant: 'customer-tenant',
  note: 'A Shared IT reply', audience: 'shared_it', createdAt: '2026-11-02T12:00:00.000Z',
  author: { kind: 'user', tenant: 'msp-tenant', id: 'posting-user', displayName: 'Ada Technician' },
};
const conversationPage = (items: any[]) => ({
  items, nextBefore: null, actor: { tenant: 'msp-tenant', userId: 'posting-user' }, writeAudiences: ['shared_it'],
});
const initialDetails = {
  resource,
  ticketData: {
    ticket: { ticket_id: resource.id, tenant: resource.tenant, title: 'Shared ticket' },
    options: { board: [], status: [], priority: [] }, comments: [],
  },
  editor: { editableFields: [], baselines: {} }, screen: { revision: 1 },
} as any;

describe('shared ticket author refresh', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.readConversation
      .mockResolvedValueOnce(conversationPage([oldComment]))
      .mockResolvedValueOnce(conversationPage([oldComment, postedComment]));
    mocks.writeComment.mockResolvedValue({ ok: true, receipt: {
      commentId: postedComment.commentId, storeTenant: postedComment.storeTenant, threadId: postedComment.threadId,
    } });
  });
  afterEach(cleanup);

  it('refreshes the author map immediately after a Shared IT reply', async () => {
    render(<SharedTicketScreen resource={resource} initialDetails={initialDetails} backHref="/msp/tickets/customer" />);
    await screen.findAllByText('Morgan Earlier');
    expect(screen.queryByText('Ada Technician')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Post Shared IT reply' }));

    await waitFor(() => {
      expect(screen.getByRole('list', { name: 'Conversation data passed to ticket details' }).textContent).toContain('Ada Technician');
    });
    expect(mocks.writeComment).toHaveBeenCalledTimes(1);
    expect(mocks.readConversation).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Unknown User')).toBeNull();
  });
});
