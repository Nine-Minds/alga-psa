import { describe, expect, it } from 'vitest';

import { buildDataContext } from '../workflowDataContext';
import { applyCatalogActionChoiceToStep } from '../groupedActionSelection';
import type { NodeStep, WorkflowDefinition } from '@shared/workflow/runtime/client';
import type { WorkflowDesignerCatalogAction } from '@shared/workflow/runtime/designer/actionCatalog';

const generateSaveAsName = (actionId: string) => actionId.replace(/\./g, '_');

const updateAction: WorkflowDesignerCatalogAction = {
  id: 'tickets.update_fields',
  version: 2,
  label: 'Update Ticket',
  description: 'Update a ticket.',
  inputFieldNames: ['ticket_id', 'summary'],
  outputFieldNames: ['ticket_id', 'updated'],
};

const actionRegistry = [
  {
    id: 'tickets.create',
    version: 1,
    ui: {
      label: 'Create Ticket',
      description: 'Create a ticket.',
    },
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        board_id: { type: 'string' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string' },
      },
    },
  },
  {
    id: 'tickets.update_fields',
    version: 2,
    ui: {
      label: 'Update Ticket',
      description: 'Update a ticket.',
    },
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string' },
        summary: { type: 'string' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string' },
        updated: { type: 'boolean' },
      },
    },
  },
];

const buildDefinition = (upstreamStep: NodeStep): WorkflowDefinition => ({
  id: 'workflow-1',
  version: 1,
  name: 'Grouped workflow',
  payloadSchemaRef: 'system:default',
  trigger: { type: 'event', eventName: 'ticket.created' },
  steps: [
    upstreamStep,
    {
      id: 'step-2',
      type: 'action.call',
      name: 'Downstream step',
      config: {
        designerGroupKey: 'ticket',
        designerTileKind: 'core-object',
      },
    },
  ],
});

describe('workflow data context', () => {
  it('T089/T095: changing an action recalculates the output schema exposed to downstream steps immediately', () => {
    const upstreamStep: NodeStep = {
      id: 'step-1',
      type: 'action.call',
      name: 'Ticket',
      config: {
        designerGroupKey: 'ticket',
        designerTileKind: 'core-object',
        actionId: 'tickets.create',
        version: 1,
        saveAs: 'ticketResult',
      },
    };

    const initialContext = buildDataContext(
      buildDefinition(upstreamStep),
      'step-2',
      actionRegistry,
      null
    );

    expect(initialContext.steps).toHaveLength(1);
    expect(initialContext.steps[0]).toMatchObject({
      stepId: 'step-1',
      saveAs: 'ticketResult',
      fields: [{ name: 'ticket_id' }],
    });
    expect(initialContext.steps[0]?.outputSchema).toMatchObject({
      type: 'object',
      properties: {
        ticket_id: { type: 'string' },
      },
    });

    const switchedStep = applyCatalogActionChoiceToStep(upstreamStep, updateAction, {
      generateSaveAsName,
      currentGroupLabel: 'Ticket',
      currentActionLabel: 'Create Ticket',
      nextGroupLabel: 'Ticket',
    });
    const nextContext = buildDataContext(
      buildDefinition(switchedStep),
      'step-2',
      actionRegistry,
      null
    );

    expect(nextContext.steps).toHaveLength(1);
    expect(nextContext.steps[0]).toMatchObject({
      stepId: 'step-1',
      saveAs: 'ticketResult',
      fields: [{ name: 'ticket_id' }, { name: 'updated' }],
    });
    expect(nextContext.steps[0]?.outputSchema).toMatchObject({
      type: 'object',
      properties: {
        ticket_id: { type: 'string' },
        updated: { type: 'boolean' },
      },
    });
  });
});
