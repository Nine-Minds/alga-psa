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

  it('wires a composed ticket attachment upload action into ticket details', () => {
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

    expect(typeof lastTicketDetailsContainerProps.uploadTicketAttachmentAction).toBe('function');
    expect(typeof lastTicketDetailsContainerProps.deleteDraftTicketAttachmentImagesAction).toBe('function');
    expect(typeof lastTicketDetailsContainerProps.resolveTicketAttachmentViewUrl).toBe('function');
    expect(lastTicketDetailsContainerProps.disableAttachmentFolderSelection).toBe(false);
  });

  it('disables ticket attachment folder selection in Algadesk mode', () => {
    render(
      <MspTicketDetailsContainerClient
        isAlgadeskMode
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

    expect(lastTicketDetailsContainerProps.disableAttachmentFolderSelection).toBe(true);
    expect(lastTicketDetailsContainerProps.disableAttachmentSharing).toBe(true);
    expect(lastTicketDetailsContainerProps.disableAttachmentLinking).toBe(true);
  });
});
