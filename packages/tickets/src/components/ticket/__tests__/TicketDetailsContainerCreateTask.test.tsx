/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import TicketDetailsContainer from '../TicketDetailsContainer';
import { TicketDataSourceProvider } from '../TicketDataSourceContext';
import { nativeTicketDataSource } from '../../../lib/nativeTicketDataSource';
import { composeTicketDataSource } from '../../../lib/ticketDataSource';

let lastTicketDetailsProps: any = null;

vi.mock('next/server', () => ({
  NextRequest: class NextRequest {},
  NextResponse: {
    next: vi.fn(),
    json: vi.fn(),
  },
}));

vi.mock('next-auth', () => ({
  __esModule: true,
  default: vi.fn(() => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } } }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@alga-psa/ui/context', () => ({
  UnsavedChangesProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../TicketLiveProvider', () => ({
  TicketLiveProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="ticket-live-provider">{children}</div>
  ),
}));

vi.mock('../TicketDetails', () => ({
  __esModule: true,
  default: (props: any) => {
    lastTicketDetailsProps = props;
    return <div data-testid="ticket-details" />;
  }
}));

describe('TicketDetailsContainer renderCreateProjectTask passthrough', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    lastTicketDetailsProps = null;
  });

  it('passes renderCreateProjectTask to TicketDetails', () => {
    const renderCreateProjectTask = vi.fn();

    render(
      <TicketDetailsContainer
        ticketData={{
          ticket: { ticket_id: 'ticket-1' },
          comments: [],
          documents: [],
          client: null,
          contacts: [],
          contactInfo: null,
          createdByUser: null,
          board: null,
          additionalAgents: [],
          availableAgents: [],
          userMap: {},
          options: { status: [], agent: [], board: [], priority: [] },
          categories: [],
          locations: [],
          agentSchedules: []
        }}
        renderCreateProjectTask={renderCreateProjectTask}
      />
    );

    expect(lastTicketDetailsProps.renderCreateProjectTask).toBe(renderCreateProjectTask);
    expect(lastTicketDetailsProps.liveUserMap).toBeUndefined();
    expect(lastTicketDetailsProps.liveContactMap).toBeUndefined();
  });

  it('T045: mounts the live provider for a ticket with tenant + ticket id', () => {
    render(
      <TicketDetailsContainer
        ticketData={{
          ticket: { ticket_id: 'ticket-1', tenant: 'tenant-1' },
          comments: [],
          documents: [],
          client: null,
          contacts: [],
          contactInfo: null,
          createdByUser: null,
          board: null,
          additionalAgents: [],
          availableAgents: [],
          userMap: {},
          options: { status: [], agent: [], board: [], priority: [] },
          categories: [],
          locations: [],
          agentSchedules: []
        }}
      />
    );

    expect(screen.getByTestId('ticket-live-provider')).toBeTruthy();
    expect(screen.getByTestId('ticket-details')).toBeTruthy();
  });

  it('forwards conversation author maps live only when the data source opts in', () => {
    const userMap = { 'posting-user': { user_id: 'posting-user', first_name: 'Ada', last_name: 'Technician', user_type: 'internal', avatarUrl: null } };
    const contactMap = { 'contact-1': { contact_id: 'contact-1', full_name: 'Casey Contact', avatarUrl: null } };
    const ticketData = {
      ticket: { ticket_id: 'ticket-1' }, comments: [], documents: [], client: null, contacts: [], contactInfo: null,
      createdByUser: null, board: null, additionalAgents: [], availableAgents: [], userMap, contactMap,
      options: { status: [], agent: [], board: [], priority: [] }, categories: [], clients: [], locations: [], agentSchedules: [],
    };
    const dataSource = composeTicketDataSource(nativeTicketDataSource, { screen: { liveConversationAuthors: true } });

    render(
      <TicketDataSourceProvider dataSource={dataSource}>
        <TicketDetailsContainer ticketData={ticketData} />
      </TicketDataSourceProvider>,
    );

    expect(lastTicketDetailsProps.initialUserMap).toBe(userMap);
    expect(lastTicketDetailsProps.initialContactMap).toBe(contactMap);
    expect(lastTicketDetailsProps.liveUserMap).toBe(userMap);
    expect(lastTicketDetailsProps.liveContactMap).toBe(contactMap);
  });
});
