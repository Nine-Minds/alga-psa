/* @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import MspTicketDetailsContainerClient from '../MspTicketDetailsContainerClient';

let lastTicketDetailsContainerProps: any = null;

vi.mock('@alga-psa/tickets/components/ticket/TicketDetailsContainer', () => ({
  __esModule: true,
  default: (props: any) => {
    lastTicketDetailsContainerProps = props;
    return <div data-testid="ticket-details-container" />;
  }
}));

vi.mock('@alga-psa/projects/components/CreateTaskFromTicketDialog', () => ({
  __esModule: true,
  default: () => <div data-testid="create-task-dialog" />
}));

describe('MspTicketDetailsContainerClient', () => {
  it('injects CreateTaskFromTicketDialog via renderCreateProjectTask', () => {
    render(
      <MspTicketDetailsContainerClient
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
      />
    );

    const renderCreateProjectTask = lastTicketDetailsContainerProps.renderCreateProjectTask;
    const node = renderCreateProjectTask({ ticket: { ticket_id: 'ticket-1' } });
    expect(node.props['data-testid']).toBe('create-task-dialog');
  });
});
