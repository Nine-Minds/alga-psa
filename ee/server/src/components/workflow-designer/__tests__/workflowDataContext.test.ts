import { describe, expect, it } from 'vitest';

import { buildDataContext } from '../workflowDataContext';
import { applyCatalogActionChoiceToStep } from '../groupedActionSelection';
import type { NodeStep, WorkflowDefinition } from '@alga-psa/workflows/runtime/client';
import type { WorkflowDesignerCatalogAction } from '@alga-psa/workflows/runtime/designer/actionCatalog';

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
    id: 'ai.infer',
    version: 1,
    ui: {
      label: 'Infer Structured Output',
      description: 'Generate structured workflow data from a prompt.',
    },
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
      },
      required: ['prompt'],
    },
    outputSchema: {
      type: 'object',
      properties: {},
    },
  },
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
  {
    id: 'transform.truncate_text',
    version: 1,
    ui: {
      label: 'Truncate Text',
      description: 'Shorten text using explicit truncation settings.',
    },
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        maxLength: { type: 'number' },
      },
      required: ['text', 'maxLength'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
      },
    },
  },
  {
    id: 'transform.compose_text',
    version: 1,
    ui: {
      label: 'Compose Text',
      description: 'Compose markdown text outputs.',
    },
    inputSchema: {
      type: 'object',
      properties: {},
    },
    outputSchema: {
      type: 'object',
      additionalProperties: {
        type: 'string',
      },
    },
  },
  {
    id: 'transform.build_object',
    version: 1,
    ui: {
      label: 'Build Object',
      description: 'Construct an object from explicit named inputs.',
    },
    inputSchema: {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
        },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        object: {
          type: 'object',
          additionalProperties: true,
        },
      },
    },
  },
  {
    id: 'transform.pick_fields',
    version: 1,
    ui: {
      label: 'Pick Fields',
      description: 'Select a fixed subset of fields from an object.',
    },
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'object' },
        fields: { type: 'array' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        object: {
          type: 'object',
          additionalProperties: true,
        },
      },
    },
  },
  {
    id: 'transform.rename_fields',
    version: 1,
    ui: {
      label: 'Rename Fields',
      description: 'Rename object fields with explicit mapping entries.',
    },
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'object' },
        renames: { type: 'array' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        object: {
          type: 'object',
          additionalProperties: true,
        },
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

  it('tracks catch-block context so Reference mode can expose error sources only where they are valid', () => {
    const definition: WorkflowDefinition = {
      id: 'workflow-catch',
      version: 1,
      name: 'Catch workflow',
      payloadSchemaRef: 'system:default',
      trigger: { type: 'event', eventName: 'ticket.created' },
      steps: [
        {
          id: 'try-catch-1',
          type: 'control.tryCatch',
          try: [],
          catch: [
            {
              id: 'catch-step',
              type: 'action.call',
              config: {
                actionId: 'tickets.create',
                version: 1,
              },
            },
          ],
        },
      ],
    };

    const context = buildDataContext(definition, 'catch-step', actionRegistry, null);

    expect(context.inCatchBlock).toBe(true);
  });

  it('tracks forEach item and index variables so Reference mode can expose loop sources', () => {
    const definition: WorkflowDefinition = {
      id: 'workflow-loop',
      version: 1,
      name: 'Loop workflow',
      payloadSchemaRef: 'system:default',
      trigger: { type: 'event', eventName: 'ticket.created' },
      steps: [
        {
          id: 'foreach-1',
          type: 'control.forEach',
          items: { $expr: 'payload.items' },
          itemVar: 'ticketItem',
          concurrency: 1,
          body: [
            {
              id: 'loop-step',
              type: 'action.call',
              config: {
                actionId: 'tickets.create',
                version: 1,
              },
            },
          ],
        },
      ],
    };

    const context = buildDataContext(definition, 'loop-step', actionRegistry, null);

    expect(context.forEach).toEqual({
      itemVar: 'ticketItem',
      indexVar: '$index',
      itemType: 'any',
    });
  });

  it('T160: preserves catch and loop context when grouped steps move within the same block', () => {
    const forEachDefinition = (stepOrder: Array<'sibling' | 'target'>): WorkflowDefinition => ({
      id: 'workflow-loop-move',
      version: 1,
      name: 'Loop workflow move',
      payloadSchemaRef: 'system:default',
      trigger: { type: 'event', eventName: 'ticket.created' },
      steps: [
        {
          id: 'foreach-1',
          type: 'control.forEach',
          items: { $expr: 'payload.items' },
          itemVar: 'ticketItem',
          concurrency: 1,
          body: stepOrder.map((kind) =>
            kind === 'target'
              ? {
                  id: 'loop-step',
                  type: 'action.call',
                  config: {
                    actionId: 'tickets.create',
                    version: 1,
                  },
                }
              : {
                  id: 'sibling-step',
                  type: 'action.call',
                  config: {
                    actionId: 'tickets.update_fields',
                    version: 2,
                  },
                }
          ),
        },
      ],
    });

    const catchDefinition = (stepOrder: Array<'sibling' | 'target'>): WorkflowDefinition => ({
      id: 'workflow-catch-move',
      version: 1,
      name: 'Catch workflow move',
      payloadSchemaRef: 'system:default',
      trigger: { type: 'event', eventName: 'ticket.created' },
      steps: [
        {
          id: 'try-catch-1',
          type: 'control.tryCatch',
          try: [],
          catch: stepOrder.map((kind) =>
            kind === 'target'
              ? {
                  id: 'catch-step',
                  type: 'action.call',
                  config: {
                    actionId: 'tickets.create',
                    version: 1,
                  },
                }
              : {
                  id: 'catch-sibling-step',
                  type: 'action.call',
                  config: {
                    actionId: 'tickets.update_fields',
                    version: 2,
                  },
                }
          ),
        },
      ],
    });

    const initialLoopContext = buildDataContext(forEachDefinition(['target', 'sibling']), 'loop-step', actionRegistry, null);
    const movedLoopContext = buildDataContext(forEachDefinition(['sibling', 'target']), 'loop-step', actionRegistry, null);
    expect(movedLoopContext.forEach).toEqual(initialLoopContext.forEach);

    const initialCatchContext = buildDataContext(catchDefinition(['target', 'sibling']), 'catch-step', actionRegistry, null);
    const movedCatchContext = buildDataContext(catchDefinition(['sibling', 'target']), 'catch-step', actionRegistry, null);
    expect(initialCatchContext.inCatchBlock).toBe(true);
    expect(movedCatchContext.inCatchBlock).toBe(true);
  });

  it('T224/T232: transform grouped steps expose saveAs-backed output schemas to downstream steps like business actions', () => {
    const definition: WorkflowDefinition = {
      id: 'workflow-transform',
      version: 1,
      name: 'Transform workflow',
      payloadSchemaRef: 'system:default',
      trigger: { type: 'event', eventName: 'ticket.created' },
      steps: [
        {
          id: 'transform-step',
          type: 'action.call',
          name: 'Truncate Text',
          config: {
            designerGroupKey: 'transform',
            designerTileKind: 'transform',
            actionId: 'transform.truncate_text',
            version: 1,
            saveAs: 'trimmedText',
          },
        },
        {
          id: 'ticket-step',
          type: 'action.call',
          name: 'Create Ticket',
          config: {
            actionId: 'tickets.create',
            version: 1,
          },
        },
      ],
    };

    const context = buildDataContext(definition, 'ticket-step', actionRegistry, null);

    expect(context.steps).toHaveLength(1);
    expect(context.steps[0]).toMatchObject({
      stepId: 'transform-step',
      stepName: 'Truncate Text',
      saveAs: 'trimmedText',
      fields: [{ name: 'text' }],
    });
    expect(context.steps[0]?.outputSchema).toMatchObject({
      type: 'object',
      properties: {
        text: { type: 'string' },
      },
    });
  });

  it('T025: compose-text exposes configured stable keys under vars.<saveAs> with string field types', () => {
    const definition: WorkflowDefinition = {
      id: 'workflow-compose-text',
      version: 1,
      name: 'Compose text workflow',
      payloadSchemaRef: 'system:default',
      trigger: { type: 'event', eventName: 'ticket.created' },
      steps: [
        {
          id: 'compose-step',
          type: 'action.call',
          name: 'Compose Text',
          config: {
            designerGroupKey: 'transform',
            designerTileKind: 'transform',
            actionId: 'transform.compose_text',
            version: 1,
            saveAs: 'composed',
            outputs: [
              {
                id: 'out-1',
                label: 'Prompt',
                stableKey: 'prompt',
                document: { version: 1, blocks: [] },
              },
              {
                id: 'out-2',
                label: 'Email Body',
                stableKey: 'email_body',
                document: { version: 1, blocks: [] },
              },
            ],
          },
        },
        {
          id: 'downstream-step',
          type: 'action.call',
          config: {
            actionId: 'tickets.create',
            version: 1,
          },
        },
      ],
    };

    const context = buildDataContext(definition, 'downstream-step', actionRegistry, null);

    expect(context.steps[0]).toMatchObject({
      stepId: 'compose-step',
      saveAs: 'composed',
      outputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Prompt' },
          email_body: { type: 'string', description: 'Email Body' },
        },
      },
    });
    expect(context.steps[0]?.fields).toEqual([
      {
        name: 'prompt',
        type: 'string',
        required: true,
        nullable: false,
        description: 'Prompt',
        defaultValue: undefined,
        children: undefined,
        constraints: undefined,
      },
      {
        name: 'email_body',
        type: 'string',
        required: true,
        nullable: false,
        description: 'Email Body',
        defaultValue: undefined,
        children: undefined,
        constraints: undefined,
      },
    ]);
  });

  it('T269: build-object exposes named object fields to downstream references', () => {
    const definition: WorkflowDefinition = {
      id: 'workflow-build-object',
      version: 1,
      name: 'Build object workflow',
      payloadSchemaRef: 'system:default',
      trigger: { type: 'event', eventName: 'ticket.created' },
      steps: [
        {
          id: 'transform-step',
          type: 'action.call',
          name: 'Build Object',
          config: {
            designerGroupKey: 'transform',
            designerTileKind: 'transform',
            actionId: 'transform.build_object',
            version: 1,
            saveAs: 'ticketSummary',
            inputMapping: {
              fields: [
                { key: 'ticketId', value: { $expr: 'payload.ticket.id' } },
                { key: 'urgent', value: true },
              ],
            },
          },
        },
        {
          id: 'downstream-step',
          type: 'action.call',
          config: {
            actionId: 'tickets.create',
            version: 1,
          },
        },
      ],
    };

    const context = buildDataContext(
      definition,
      'downstream-step',
      actionRegistry,
      {
        type: 'object',
        properties: {
          ticket: {
            type: 'object',
            properties: {
              id: { type: 'string' },
            },
          },
        },
      }
    );

    expect(context.steps[0]?.outputSchema).toMatchObject({
      type: 'object',
      properties: {
        object: {
          type: 'object',
          properties: {
            ticketId: { type: 'string' },
            urgent: { type: 'boolean' },
          },
        },
      },
    });
    expect(context.steps[0]?.fields[0]).toMatchObject({
      name: 'object',
      children: [{ name: 'ticketId' }, { name: 'urgent' }],
    });
  });

  it('T270: pick-fields exposes only the selected source fields to downstream references', () => {
    const definition: WorkflowDefinition = {
      id: 'workflow-pick-fields',
      version: 1,
      name: 'Pick fields workflow',
      payloadSchemaRef: 'system:default',
      trigger: { type: 'event', eventName: 'ticket.created' },
      steps: [
        {
          id: 'source-step',
          type: 'action.call',
          name: 'Update Ticket',
          config: {
            actionId: 'tickets.update_fields',
            version: 2,
            saveAs: 'ticketResult',
          },
        },
        {
          id: 'transform-step',
          type: 'action.call',
          name: 'Pick Fields',
          config: {
            designerGroupKey: 'transform',
            designerTileKind: 'transform',
            actionId: 'transform.pick_fields',
            version: 1,
            saveAs: 'pickedTicket',
            inputMapping: {
              source: { $expr: 'vars.ticketResult' },
              fields: ['updated', 'ticket_id'],
            },
          },
        },
        {
          id: 'downstream-step',
          type: 'action.call',
          config: {
            actionId: 'tickets.create',
            version: 1,
          },
        },
      ],
    };

    const context = buildDataContext(definition, 'downstream-step', actionRegistry, null);

    expect(context.steps[1]?.outputSchema).toMatchObject({
      type: 'object',
      properties: {
        object: {
          type: 'object',
          properties: {
            updated: { type: 'boolean' },
            ticket_id: { type: 'string' },
          },
        },
      },
    });
    expect(context.steps[1]?.fields[0]).toMatchObject({
      name: 'object',
      children: [{ name: 'updated' }, { name: 'ticket_id' }],
    });
  });

  it('T271: rename-fields exposes renamed output keys to downstream references', () => {
    const definition: WorkflowDefinition = {
      id: 'workflow-rename-fields',
      version: 1,
      name: 'Rename fields workflow',
      payloadSchemaRef: 'system:default',
      trigger: { type: 'event', eventName: 'ticket.created' },
      steps: [
        {
          id: 'source-step',
          type: 'action.call',
          name: 'Update Ticket',
          config: {
            actionId: 'tickets.update_fields',
            version: 2,
            saveAs: 'ticketResult',
          },
        },
        {
          id: 'transform-step',
          type: 'action.call',
          name: 'Rename Fields',
          config: {
            designerGroupKey: 'transform',
            designerTileKind: 'transform',
            actionId: 'transform.rename_fields',
            version: 1,
            saveAs: 'renamedTicket',
            inputMapping: {
              source: { $expr: 'vars.ticketResult' },
              renames: [{ from: 'ticket_id', to: 'ticketId' }],
            },
          },
        },
        {
          id: 'downstream-step',
          type: 'action.call',
          config: {
            actionId: 'tickets.create',
            version: 1,
          },
        },
      ],
    };

    const context = buildDataContext(definition, 'downstream-step', actionRegistry, null);

    expect(context.steps[1]?.outputSchema).toMatchObject({
      type: 'object',
      properties: {
        object: {
          type: 'object',
          properties: {
            ticketId: { type: 'string' },
            updated: { type: 'boolean' },
          },
        },
      },
    });
    expect(context.steps[1]?.fields[0]).toMatchObject({
      name: 'object',
      children: [{ name: 'updated' }, { name: 'ticketId' }],
    });
  });

  it('T023/T024/T025/T026: AI steps contribute resolved inline output schemas to downstream vars context immediately', () => {
    const definition: WorkflowDefinition = {
      id: 'workflow-ai',
      version: 1,
      name: 'AI workflow',
      payloadSchemaRef: 'system:default',
      trigger: { type: 'event', eventName: 'ticket.created' },
      steps: [
        {
          id: 'ai-step',
          type: 'action.call',
          name: 'Infer',
          config: {
            designerGroupKey: 'ai',
            designerTileKind: 'ai',
            actionId: 'ai.infer',
            version: 1,
            saveAs: 'classificationResult',
            aiOutputSchemaMode: 'simple',
            aiOutputSchema: {
              type: 'object',
              properties: {
                category: { type: 'string' },
                confidence: { type: 'number' },
                next_action: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                  },
                  required: ['label'],
                  additionalProperties: false,
                },
              },
              required: ['category'],
              additionalProperties: false,
            },
          },
        },
        {
          id: 'downstream-step',
          type: 'action.call',
          config: {
            actionId: 'tickets.create',
            version: 1,
          },
        },
      ],
    };

    const context = buildDataContext(definition, 'downstream-step', actionRegistry, null);

    expect(context.steps[0]).toMatchObject({
      stepId: 'ai-step',
      saveAs: 'classificationResult',
      outputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          confidence: { type: 'number' },
        },
      },
    });
    expect(context.steps[0]?.fields).toEqual([
      { name: 'category', type: 'string', required: true, nullable: false, description: undefined, defaultValue: undefined, children: undefined, constraints: undefined },
      { name: 'confidence', type: 'number', required: false, nullable: false, description: undefined, defaultValue: undefined, children: undefined, constraints: undefined },
      {
        name: 'next_action',
        type: 'object',
        required: false,
        nullable: false,
        description: undefined,
        defaultValue: undefined,
        children: [
          {
            name: 'label',
            type: 'string',
            required: true,
            nullable: false,
            description: undefined,
            defaultValue: undefined,
            children: undefined,
            constraints: undefined,
          },
        ],
        constraints: undefined,
      },
    ]);
  });
});
