/* @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import TicketDetailsContainer from '../TicketDetailsContainer';

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

vi.mock('next-auth/lib/env', () => ({
  setEnvDefaults: vi.fn(),
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

vi.mock('../TicketDetails', () => ({
  __esModule: true,
  default: (props: any) => {
    lastTicketDetailsProps = props;
    return <div data-testid="ticket-details" />;
  }
}));

describe('TicketDetailsContainer renderCreateProjectTask passthrough', () => {
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
          clients: [],
          locations: [],
          agentSchedules: []
        }}
        renderCreateProjectTask={renderCreateProjectTask}
      />
    );

    expect(lastTicketDetailsProps.renderCreateProjectTask).toBe(renderCreateProjectTask);
  });
});
