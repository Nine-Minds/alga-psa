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
});
