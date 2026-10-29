/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({
  load: vi.fn(), snapshot: vi.fn(), comments: vi.fn(), writeAudiences: vi.fn(), write: vi.fn(), audienceOf: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));
vi.mock('@/components/co-managed/sharedConversationSession', () => ({ createSharedConversationSession: () => session }));
vi.mock('@alga-psa/tickets/components/ticket/TicketDetailsContainer', async () => {
  const { useTicketDataSource } = await import('@alga-psa/tickets/components/ticket/TicketDataSourceContext');
  return {
    default: ({ ticketData }: any) => {
      const source = useTicketDataSource();
      return <div>
        <ul>{ticketData.comments.map((c: any) => <li key={c.comment_id}>{c.note}</li>)}</ul>
        <span data-testid="read-only">{String(source.screen.readOnly)}</span>
        <span data-testid="audiences">{(source.conversation.audiences ?? []).join(',')}</span>
      </div>;
    },
  };
});

import CoManagedSharedTicket from '@/components/co-managed/CoManagedSharedTicket';

const summary = { revision: 1, resource: { tenant: 't1', relationshipId: 'r1', kind: 'ticket' as const, id: 'tk1' }, fields: { title: 'Printer' } } as any;

describe('CoManagedSharedTicket', () => {
  it('renders the loaded conversation and a writable conversation instead of an empty read-only one', async () => {
    session.load.mockResolvedValue(undefined);
    session.snapshot.mockReturnValue({ items: [], actor: { tenant: 'msp', userId: 'u' } });
    session.comments.mockReturnValue([{ comment_id: 'c1', note: 'Printer is down' }, { comment_id: 'c2', note: 'Private note' }]);
    session.writeAudiences.mockReturnValue(['requester', 'shared_it', 'organization_private']);
    render(<CoManagedSharedTicket summary={summary} backHref="/back" />);
    expect(await screen.findByText('Printer is down')).toBeInTheDocument();
    expect(screen.getByText('Private note')).toBeInTheDocument();
    expect(screen.getByTestId('read-only')).toHaveTextContent('false');
    expect(screen.getByTestId('audiences')).toHaveTextContent('requester,shared_it,organization_private');
  });

  it('falls back to read-only with a reload affordance when the conversation cannot be loaded', async () => {
    session.load.mockRejectedValue(new Error('nope'));
    session.snapshot.mockReturnValue(null);
    session.comments.mockReturnValue([]);
    session.writeAudiences.mockReturnValue([]);
    render(<CoManagedSharedTicket summary={summary} backHref="/back" />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByTestId('read-only')).toHaveTextContent('true');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});
