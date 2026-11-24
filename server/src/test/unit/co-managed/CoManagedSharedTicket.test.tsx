/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({
  load: vi.fn(), snapshot: vi.fn(), comments: vi.fn(), writeAudiences: vi.fn(), write: vi.fn(), audienceOf: vi.fn(),
  subscribe: vi.fn(), state: { snapshot: null as any, comments: [] as any[], listeners: new Set<() => void>() },
}));

vi.mock('@/components/co-managed/CoManagedConversationFiles', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));
vi.mock('@/components/co-managed/CoManagedTicketSlaStatus', () => ({ default: () => <div data-testid="sla-status" /> }));
vi.mock('@/components/co-managed/sharedConversationSession', () => ({ createSharedConversationSession: () => session }));
vi.mock('@alga-psa/tickets/components/ticket/TicketDetailsContainer', async () => {
  const { useTicketDataSource } = await import('@alga-psa/tickets/components/ticket/TicketDataSourceContext');
  const { resolveCommentAuthor } = await import('@alga-psa/tickets/lib/commentAuthorResolution');
  const TicketDetailsContainer = ({ ticketData }: any) => {
    const source = useTicketDataSource();
    return <div>
      <ul>{ticketData.comments.map((c: any) => <li key={c.comment_id}>{c.note} — {resolveCommentAuthor(c, { userMap: ticketData.userMap, contactMap: ticketData.contactMap }).displayName}</li>)}</ul>
      <button id="refresh-conversation" onClick={() => void source.comments.findCommentsByTicketId('tk1')}>Refresh conversation</button>
      <span data-testid="read-only">{String(source.screen.readOnly)}</span>
      <span data-testid="audiences">{(source.conversation.audiences ?? []).join(',')}</span>
    </div>;
  };
  return { default: TicketDetailsContainer };
});

import CoManagedSharedTicket from '@/components/co-managed/CoManagedSharedTicket';

const summary = { revision: 1, resource: { tenant: 't1', relationshipId: 'r1', kind: 'ticket' as const, id: 'tk1' }, fields: { title: 'Printer' } } as any;

describe('CoManagedSharedTicket', () => {
  beforeEach(() => {
    session.state.snapshot = null;
    session.state.comments = [];
    session.state.listeners.clear();
    session.subscribe.mockImplementation((listener: () => void) => {
      session.state.listeners.add(listener);
      return () => session.state.listeners.delete(listener);
    });
    session.snapshot.mockImplementation(() => session.state.snapshot);
    session.comments.mockImplementation(() => session.state.comments);
    session.load.mockImplementation(async () => undefined);
    session.writeAudiences.mockReturnValue(['requester', 'shared_it', 'organization_private']);
  });

  it('renders the loaded conversation and a writable conversation instead of an empty read-only one', async () => {
    session.load.mockImplementation(async () => undefined);
    session.snapshot.mockReturnValue({ items: [], actor: { tenant: 'msp', userId: 'u' } });
    session.comments.mockReturnValue([{ comment_id: 'c1', note: 'Printer is down' }, { comment_id: 'c2', note: 'Private note' }]);
    session.writeAudiences.mockReturnValue(['requester', 'shared_it', 'organization_private']);
    render(<CoManagedSharedTicket summary={summary} backHref="/back" />);
    expect(await screen.findByText(/Printer is down/)).toBeInTheDocument();
    expect(screen.getByText(/Private note/)).toBeInTheDocument();
    expect(screen.getByTestId('read-only')).toHaveTextContent('false');
    expect(screen.getByTestId('audiences')).toHaveTextContent('requester,shared_it,organization_private');
  });

  it('falls back to read-only with a reload affordance when the conversation cannot be loaded', async () => {
    session.load.mockImplementation(async () => { throw new Error('nope'); });
    session.snapshot.mockReturnValue(null);
    session.comments.mockReturnValue([]);
    session.writeAudiences.mockReturnValue([]);
    render(<CoManagedSharedTicket summary={summary} backHref="/back" />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByTestId('read-only')).toHaveTextContent('true');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('resolves the first newly admitted local author during the same conversation refresh', async () => {
    let initialLoad = true;
    session.load.mockImplementation(async () => {
      if (initialLoad) { initialLoad = false; return; }
      session.state.snapshot = {
        items: [{ author: { kind: 'user', tenant: 'msp', id: 'sponsor-user', displayName: 'Sponsor QA' } }],
        actor: { tenant: 'msp', userId: 'viewer' },
      };
      session.state.comments = [{ comment_id: 'first-reply', user_id: 'sponsor-user', note: 'First reply' }];
      for (const listener of session.state.listeners) listener();
    });
    session.state.snapshot = { items: [], actor: { tenant: 'msp', userId: 'viewer' } };
    session.state.comments = [];
    render(<CoManagedSharedTicket summary={summary} backHref="/back" />);

    expect(await screen.findByTestId('read-only')).toHaveTextContent('false');
    expect(screen.queryByText(/First reply/)).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh conversation' })); });

    expect(await screen.findByText('First reply — Sponsor QA')).toBeInTheDocument();
  });
});
