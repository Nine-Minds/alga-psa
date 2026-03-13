/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ActionSchemaReference } from '../ActionSchemaReference';

const action = {
  id: 'tickets.create',
  version: 1,
  ui: {
    label: 'Create Ticket',
    description: 'Create a ticket.',
  },
  inputSchema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'Ticket summary',
      },
    },
    required: ['summary'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      ticket_id: {
        type: 'string',
        description: 'Created ticket id',
      },
    },
  },
};

describe('ActionSchemaReference', () => {
  it('T098: surfaces schema-reference details for the chosen action when available', () => {
    render(
      <ActionSchemaReference
        action={action}
        saveAs="ticketResult"
      />
    );

    expect(screen.getByText('Create a ticket.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View schema details' }));
    fireEvent.click(screen.getByRole('button', { name: /Input Schema/i }));
    fireEvent.click(screen.getByRole('button', { name: /Output Schema/i }));

    expect(screen.getByText('Input Schema')).toBeInTheDocument();
    expect(screen.getByText('Output Schema')).toBeInTheDocument();
    expect(screen.getByText('summary')).toBeInTheDocument();
    expect(screen.getByText('ticket_id')).toBeInTheDocument();
    expect(screen.getAllByText(/vars\.ticketResult/)).toHaveLength(2);
  });
});
