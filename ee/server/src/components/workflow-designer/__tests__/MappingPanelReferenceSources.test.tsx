/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/tenancy/actions', () => ({
  listTenantSecrets: vi.fn().mockResolvedValue([]),
}));

vi.mock('../mapping/InputMappingEditor', () => ({
  InputMappingEditor: () => <div data-testid="mapping-panel-editor" />,
}));

import { MappingPanel } from '../mapping/MappingPanel';
import type { WorkflowDataContext } from '../mapping/MappingPanel';

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
  }

  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

const payloadField: WorkflowDataContext['payload'][number] = {
  name: 'ticket',
  type: 'object',
  required: false,
  nullable: false,
  children: [
    {
      name: 'id',
      type: 'string',
      required: false,
      nullable: false,
    },
  ],
};

const stepOutput: WorkflowDataContext['steps'][number] = {
  stepId: 'step-1',
  stepName: 'Create Ticket',
  saveAs: 'ticketResult',
  outputSchema: {
    type: 'object',
    properties: {
      ticket_id: { type: 'string' },
    },
  },
  fields: [
    {
      name: 'ticket_id',
      type: 'string',
      required: false,
      nullable: false,
    },
  ],
};

const globals: WorkflowDataContext['globals'] = {
  env: [],
  secrets: [],
  meta: [
    {
      name: 'traceId',
      type: 'string',
      required: false,
      nullable: true,
      description: 'Trace ID',
    },
  ],
  error: [
    {
      name: 'message',
      type: 'string',
      required: false,
      nullable: true,
      description: 'Error message',
    },
  ],
};

describe('MappingPanel reference sources', () => {
  it('shows payload, previous-step outputs, and workflow metadata in Reference mode', async () => {
    render(
      <MappingPanel
        value={{}}
        onChange={vi.fn()}
        targetFields={[
          {
            name: 'summary',
            type: 'string',
            required: true,
          },
        ]}
        dataContext={{
          payload: [payloadField],
          payloadSchema: {
            type: 'object',
            properties: {
              ticket: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                },
              },
            },
          },
          steps: [stepOutput],
          globals,
        }}
        fieldOptions={[
          { value: 'payload.ticket.id', label: 'payload.ticket.id' },
          { value: 'vars.ticketResult.ticket_id', label: 'vars.ticketResult.ticket_id' },
          { value: 'meta.traceId', label: 'meta.traceId' },
        ]}
        stepId="step-1"
      />
    );

    expect(screen.getAllByText('Payload')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Step Outputs (vars)')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Workflow Meta')[0]).toBeInTheDocument();
    expect(screen.getByText('vars.ticketResult')).toBeInTheDocument();
    expect(screen.getByText('(Create Ticket)')).toBeInTheDocument();
    expect(screen.getByTestId('mapping-panel-editor')).toBeInTheDocument();
  });

  it('only shows catch and loop sources when the current step context allows them', () => {
    const { rerender } = render(
      <MappingPanel
        value={{}}
        onChange={vi.fn()}
        targetFields={[
          {
            name: 'summary',
            type: 'string',
            required: true,
          },
        ]}
        dataContext={{
          payload: [payloadField],
          payloadSchema: null,
          steps: [],
          globals,
        }}
        fieldOptions={[{ value: 'payload.ticket.id', label: 'payload.ticket.id' }]}
        stepId="step-1"
      />
    );

    expect(screen.queryByText('Error Context')).not.toBeInTheDocument();
    expect(screen.queryByText('Loop Context')).not.toBeInTheDocument();
    expect(screen.getByText(/No vars yet\./)).toBeInTheDocument();

    rerender(
      <MappingPanel
        value={{}}
        onChange={vi.fn()}
        targetFields={[
          {
            name: 'summary',
            type: 'string',
            required: true,
          },
        ]}
        dataContext={{
          payload: [payloadField],
          payloadSchema: null,
          steps: [],
          globals,
          inCatchBlock: true,
          forEach: {
            itemVar: 'ticketItem',
            indexVar: '$index',
            itemType: 'object',
          },
        }}
        fieldOptions={[
          { value: 'payload.ticket.id', label: 'payload.ticket.id' },
          { value: 'error.message', label: 'error.message' },
          { value: 'ticketItem', label: 'ticketItem' },
          { value: '$index', label: '$index' },
        ]}
        stepId="step-2"
      />
    );

    expect(screen.getByText('Error Context')).toBeInTheDocument();
    expect(screen.getByText('Loop Context')).toBeInTheDocument();
    expect(screen.getByText('ticketItem')).toBeInTheDocument();
    expect(screen.getByText('$index')).toBeInTheDocument();
  });
});
