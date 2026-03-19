/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

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

const transformAction = {
  id: 'transform.split_text',
  version: 1,
  ui: {
    label: 'Split Text',
    description: 'Split source text into an ordered string array.',
  },
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Source text',
      },
      delimiter: {
        type: 'string',
        description: 'Delimiter used to split the text',
      },
    },
    required: ['text', 'delimiter'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: { type: 'string' },
        description: 'Split text items',
      },
    },
  },
};

describe('ActionSchemaReference', () => {
  afterEach(() => {
    cleanup();
  });

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

  it('T239: transform action descriptions explain the resulting output shape', () => {
    render(
      <ActionSchemaReference
        action={transformAction}
        saveAs="splitText"
      />
    );

    expect(screen.getByText('Split source text into an ordered string array.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View schema details' }));
    fireEvent.click(screen.getByRole('button', { name: /Output Schema/i }));

    expect(screen.getByText('items')).toBeInTheDocument();
    expect(screen.getAllByText(/vars\.splitText/)).toHaveLength(2);
  });

  it('T022: output schema previews prefer an AI step override over the static registry schema', () => {
    render(
      <ActionSchemaReference
        action={action}
        saveAs="classificationResult"
        outputSchemaOverride={{
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Predicted category',
            },
          },
          required: ['category'],
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'View schema details' }));
    fireEvent.click(screen.getByRole('button', { name: /Output Schema/i }));

    expect(screen.getByText('category')).toBeInTheDocument();
    expect(screen.queryByText('ticket_id')).not.toBeInTheDocument();
    expect(screen.getAllByText(/vars\.classificationResult/)).toHaveLength(2);
  });
});
