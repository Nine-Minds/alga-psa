'use client';

import React from 'react';
import { Flex, Heading, Text } from '@radix-ui/themes';
import type { SchedulingTicketDetailsRecord } from '../../actions/ticketLookupActions';

interface SchedulingTicketDetailsProps {
  ticket: SchedulingTicketDetailsRecord;
}

function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return 'N/A';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export function SchedulingTicketDetails({
  ticket,
}: SchedulingTicketDetailsProps): React.JSX.Element {
  return (
    <div className="h-full bg-white p-6 rounded-lg shadow-sm">
      <Flex direction="column" gap="4">
        <Heading size="6">
          {ticket.ticket_number ? `Ticket #${ticket.ticket_number}` : 'Ticket Details'}
        </Heading>

        <div>
          <Text size="2" weight="bold">Title</Text>
          <Text size="2" className="block mt-1">{ticket.title || 'Untitled ticket'}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">Description</Text>
          <Text size="2" className="block mt-1 whitespace-pre-wrap">
            {ticket.description || 'No description'}
          </Text>
        </div>

        <div>
          <Text size="2" weight="bold">Status</Text>
          <Text size="2" className="block mt-1">{ticket.status || 'N/A'}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">Priority</Text>
          <Text size="2" className="block mt-1">{ticket.priority || 'N/A'}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">Board</Text>
          <Text size="2" className="block mt-1">{ticket.board_name || 'N/A'}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">Client</Text>
          <Text size="2" className="block mt-1">{ticket.client_name || 'N/A'}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">Contact</Text>
          <Text size="2" className="block mt-1">{ticket.contact_name || 'N/A'}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">Assigned User</Text>
          <Text size="2" className="block mt-1">{ticket.assigned_user_name || 'Unassigned'}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">Entered</Text>
          <Text size="2" className="block mt-1">{formatDateTime(ticket.entered_at)}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">Updated</Text>
          <Text size="2" className="block mt-1">{formatDateTime(ticket.updated_at)}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">Closed</Text>
          <Text size="2" className="block mt-1">{formatDateTime(ticket.closed_at)}</Text>
        </div>
      </Flex>
    </div>
  );
}
