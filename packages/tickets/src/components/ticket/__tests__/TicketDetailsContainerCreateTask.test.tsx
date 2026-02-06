/* @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import TicketDetailsContainer from '../TicketDetailsContainer';

let lastTicketDetailsProps: any = null;

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
