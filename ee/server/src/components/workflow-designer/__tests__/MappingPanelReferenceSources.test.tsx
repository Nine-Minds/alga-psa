/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/tenancy/actions', () => ({
  listTenantSecrets: vi.fn().mockResolvedValue([]),
}));

vi.mock('../mapping/InputMappingEditor', () => ({
  InputMappingEditor: ({
    referenceBrowseContext,
  }: {
    referenceBrowseContext?: {
      payload: Array<unknown>;
      vars: Array<{ saveAs: string }>;
      meta: Array<unknown>;
      error: Array<unknown>;
      forEach?: { itemVar: string; indexVar: string };
    };
  }) => (
    <div data-testid="mapping-panel-editor">
      {JSON.stringify({
        payloadCount: referenceBrowseContext?.payload.length ?? 0,
        varNames: (referenceBrowseContext?.vars ?? []).map((entry) => entry.saveAs),
        metaCount: referenceBrowseContext?.meta.length ?? 0,
        errorCount: referenceBrowseContext?.error.length ?? 0,
        forEach: referenceBrowseContext?.forEach ?? null,
      })}
    </div>
  ),
}));

import { MappingPanel } from '../mapping/MappingPanel';
import type { WorkflowDataContext } from '../mapping/MappingPanel';

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
  afterEach(() => {
    cleanup();
  });

  it('T159: passes grouped payload, vars, and workflow metadata into the inline reference browser context without rendering the browser by default', async () => {
    render(
      <MappingPanel
        value={{ summary: { $expr: 'vars.ticketResult.ticket_id' } }}
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

    expect(screen.getByTestId('mapping-panel-editor')).toHaveTextContent('"payloadCount":1');
    expect(screen.getByTestId('mapping-panel-editor')).toHaveTextContent('"varNames":["ticketResult"]');
    expect(screen.getByTestId('mapping-panel-editor')).toHaveTextContent('"metaCount":1');
    expect(screen.queryByText('Payload')).not.toBeInTheDocument();
    expect(screen.queryByText('Step Outputs (vars)')).not.toBeInTheDocument();
    expect(screen.queryByText('Workflow Meta')).not.toBeInTheDocument();
    expect(screen.queryByTestId('source-data-tree-search')).not.toBeInTheDocument();
  });

  it('T158/T316/T317: only passes catch and loop sources into the inline reference browser context when the current step allows them', () => {
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

    expect(screen.getByTestId('mapping-panel-editor')).toHaveTextContent('"errorCount":0');
    expect(screen.getByTestId('mapping-panel-editor')).toHaveTextContent('"forEach":null');

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

    expect(screen.getByTestId('mapping-panel-editor')).toHaveTextContent('"errorCount":1');
    expect(screen.getByTestId('mapping-panel-editor')).toHaveTextContent('"itemVar":"ticketItem"');
    expect(screen.getByTestId('mapping-panel-editor')).toHaveTextContent('"indexVar":"$index"');
  });
});
