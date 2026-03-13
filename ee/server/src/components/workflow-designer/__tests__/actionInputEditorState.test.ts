import { describe, expect, it } from 'vitest';

import { applyCatalogActionChoiceToStep } from '../groupedActionSelection';
import {
  buildActionInputEditorState,
  type WorkflowDesignerActionRegistryItem,
} from '../actionInputEditorState';
import type { NodeStep } from '@shared/workflow/runtime/client';
import type { WorkflowDesignerCatalogAction } from '@shared/workflow/runtime/designer/actionCatalog';

const generateSaveAsName = (actionId: string) => actionId.replace(/\./g, '_');

const updateAction: WorkflowDesignerCatalogAction = {
  id: 'tickets.update_fields',
  version: 2,
  label: 'Update Ticket',
  description: 'Update a ticket.',
  inputFieldNames: ['ticket_id', 'summary'],
  outputFieldNames: ['ticket_id'],
};

const registry: WorkflowDesignerActionRegistryItem[] = [
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
        summary: {
          type: 'string',
          default: 'Default ticket summary',
          examples: ['Escalate printer issue'],
        },
        board_id: { type: 'string' },
      },
      required: ['summary', 'board_id'],
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
        ticket_id: {
          type: 'integer',
          'x-workflow-picker-kind': 'ticket',
          'x-workflow-picker-dependencies': ['board_id'],
          'x-workflow-picker-fixed-value-hint': 'search',
          'x-workflow-picker-allow-dynamic-reference': true,
        },
        summary: { type: 'string' },
      },
      required: ['ticket_id'],
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
    id: 'tickets.create_nested',
    version: 1,
    ui: {
      label: 'Create Nested Ticket',
      description: 'Create a ticket with nested inputs.',
    },
    inputSchema: {
      type: 'object',
      properties: {
        requester: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: 'string' },
          },
          required: ['name', 'email'],
        },
        notes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              line1: { type: 'string' },
              line2: { type: 'string' },
            },
            required: ['line1'],
          },
        },
      },
      required: ['requester'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string' },
      },
    },
  },
];

describe('action input editor state', () => {
  it('T088: choosing an action updates the input fields used by the grouped action editor', () => {
    const step: NodeStep = {
      id: 'step-1',
      type: 'action.call',
      name: 'Ticket',
      config: {
        designerGroupKey: 'ticket',
        designerTileKind: 'core-object',
        actionId: 'tickets.create',
        version: 1,
        inputMapping: {
          summary: 'Keep me',
          board_id: '123',
        },
      },
    };

    const initialState = buildActionInputEditorState(step, registry);
    expect(initialState.actionInputFields.map((field) => field.name)).toEqual(['summary', 'board_id']);

    const nextStep = applyCatalogActionChoiceToStep(step, updateAction, {
      generateSaveAsName,
      currentGroupLabel: 'Ticket',
      currentActionLabel: 'Create Ticket',
      nextGroupLabel: 'Ticket',
    });

    const nextState = buildActionInputEditorState(nextStep, registry);
    expect(nextState.actionInputFields.map((field) => field.name)).toEqual(['ticket_id', 'summary']);
  });

  it('T091/T092: choosing an action updates picker metadata and field types used by the grouped editor', () => {
    const step: NodeStep = {
      id: 'step-3',
      type: 'action.call',
      name: 'Ticket',
      config: {
        designerGroupKey: 'ticket',
        designerTileKind: 'core-object',
        actionId: 'tickets.create',
        version: 1,
      },
    };

    const initialState = buildActionInputEditorState(step, registry);
    expect(initialState.actionInputFields.find((field) => field.name === 'summary')).toMatchObject({
      type: 'string',
      picker: undefined,
    });

    const nextStep = applyCatalogActionChoiceToStep(step, updateAction, {
      generateSaveAsName,
      currentGroupLabel: 'Ticket',
      currentActionLabel: 'Create Ticket',
      nextGroupLabel: 'Ticket',
    });

    const nextState = buildActionInputEditorState(nextStep, registry);
    expect(nextState.actionInputFields.find((field) => field.name === 'ticket_id')).toMatchObject({
      type: 'integer',
      picker: {
        kind: 'ticket',
        dependencies: ['board_id'],
        fixedValueHint: 'search',
        allowsDynamicReference: true,
      },
    });
  });

  it('T165: ActionInputField extraction preserves picker annotations from designer JSON schema fields', () => {
    const step: NodeStep = {
      id: 'step-picker',
      type: 'action.call',
      name: 'Update Ticket',
      config: {
        actionId: 'tickets.update_fields',
        version: 2,
      },
    };

    const state = buildActionInputEditorState(step, registry);
    expect(state.actionInputFields.find((field) => field.name === 'ticket_id')?.picker).toEqual({
      kind: 'ticket',
      dependencies: ['board_id'],
      fixedValueHint: 'search',
      allowsDynamicReference: true,
    });
  });

  it('T090: choosing an action updates the required-field completion counts for the grouped editor summary', () => {
    const step: NodeStep = {
      id: 'step-2',
      type: 'action.call',
      name: 'Ticket',
      config: {
        designerGroupKey: 'ticket',
        designerTileKind: 'core-object',
        actionId: 'tickets.create',
        version: 1,
        inputMapping: {
          summary: 'Keep me',
          board_id: '123',
        },
      },
    };

    const initialState = buildActionInputEditorState(step, registry);
    expect(initialState.requiredActionInputFields).toHaveLength(2);
    expect(initialState.mappedRequiredInputFieldCount).toBe(2);
    expect(initialState.unmappedRequiredInputFieldCount).toBe(0);

    const nextStep = applyCatalogActionChoiceToStep(step, updateAction, {
      generateSaveAsName,
      currentGroupLabel: 'Ticket',
      currentActionLabel: 'Create Ticket',
      nextGroupLabel: 'Ticket',
    });

    const nextState = buildActionInputEditorState(nextStep, registry);
    expect(nextState.requiredActionInputFields.map((field) => field.name)).toEqual(['ticket_id']);
    expect(nextState.mappedRequiredInputFieldCount).toBe(0);
    expect(nextState.unmappedRequiredInputFieldCount).toBe(1);
  });

  it('T119: action input fields preserve schema defaults and examples for inline help', () => {
    const step: NodeStep = {
      id: 'step-4',
      type: 'action.call',
      name: 'Ticket',
      config: {
        designerGroupKey: 'ticket',
        designerTileKind: 'core-object',
        actionId: 'tickets.create',
        version: 1,
      },
    };

    const state = buildActionInputEditorState(step, registry);
    expect(state.actionInputFields.find((field) => field.name === 'summary')).toMatchObject({
      default: 'Default ticket summary',
      examples: ['Escalate printer issue'],
    });
  });

  it('T127: required-field completion counts nested required object fields correctly', () => {
    const step: NodeStep = {
      id: 'step-5',
      type: 'action.call',
      name: 'Nested Ticket',
      config: {
        designerGroupKey: 'ticket',
        designerTileKind: 'core-object',
        actionId: 'tickets.create_nested',
        version: 1,
        inputMapping: {
          requester: {
            name: 'Alex',
          },
        },
      },
    };

    const state = buildActionInputEditorState(step, registry);
    expect(state.requiredActionInputFields.map((field) => field.name)).toEqual([
      'requester.name',
      'requester.email',
    ]);
    expect(state.mappedRequiredInputFieldCount).toBe(1);
    expect(state.unmappedRequiredInputFieldCount).toBe(1);
  });

  it('T128: required-field completion counts nested required array item fields correctly', () => {
    const step: NodeStep = {
      id: 'step-6',
      type: 'action.call',
      name: 'Nested Ticket',
      config: {
        designerGroupKey: 'ticket',
        designerTileKind: 'core-object',
        actionId: 'tickets.create_nested',
        version: 1,
        inputMapping: {
          requester: {
            name: 'Alex',
            email: 'alex@example.com',
          },
          notes: [
            {
              line1: 'First note',
            },
            {},
          ],
        },
      },
    };

    const state = buildActionInputEditorState(step, registry);
    expect(state.requiredActionInputFields.map((field) => field.name)).toEqual([
      'requester.name',
      'requester.email',
      'notes[0].line1',
      'notes[1].line1',
    ]);
    expect(state.mappedRequiredInputFieldCount).toBe(3);
    expect(state.unmappedRequiredInputFieldCount).toBe(1);
  });
});
