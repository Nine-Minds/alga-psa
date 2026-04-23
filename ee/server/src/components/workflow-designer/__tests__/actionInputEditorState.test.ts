import { describe, expect, it } from 'vitest';

import { applyCatalogActionChoiceToStep } from '../groupedActionSelection';
import {
  buildActionInputEditorState,
  type WorkflowDesignerActionRegistryItem,
} from '../actionInputEditorState';
import type { NodeStep } from '@alga-psa/workflows/runtime/client';
import type { WorkflowDesignerCatalogAction } from '@alga-psa/workflows/runtime/designer/actionCatalog';

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
  {
    id: 'slack.send_message',
    version: 1,
    ui: {
      label: 'Send Slack Message',
      description: 'Send a Slack message.',
    },
    inputSchema: {
      type: 'object',
      properties: {
        channel_id: {
          type: 'string',
          'x-workflow-picker-kind': 'client',
          'x-workflow-picker-fixed-value-hint': 'select',
          'x-workflow-picker-allow-dynamic-reference': true,
        },
        message: { type: 'string' },
      },
      required: ['channel_id', 'message'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        ts: { type: 'string' },
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

  it('T006: nullable anyOf wrappers preserve picker metadata when action input fields are extracted', () => {
    const nullablePickerRegistry: WorkflowDesignerActionRegistryItem[] = [
      {
        id: 'tickets.assignment_test',
        version: 1,
        inputSchema: {
          type: 'object',
          properties: {
            assignment_target: {
              anyOf: [
                { type: 'string', format: 'uuid' },
                { type: 'null' },
              ],
              'x-workflow-picker-kind': 'user',
              'x-workflow-picker-dependencies': ['assignment.primary.type'],
              'x-workflow-picker-fixed-value-hint': 'Search users',
              'x-workflow-picker-allow-dynamic-reference': true,
            },
          },
        },
        outputSchema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
          },
        },
      },
    ];

    const step: NodeStep = {
      id: 'step-nullable-picker',
      type: 'action.call',
      name: 'Assignment Test',
      config: {
        actionId: 'tickets.assignment_test',
        version: 1,
      },
    };

    const state = buildActionInputEditorState(step, nullablePickerRegistry);
    expect(state.actionInputFields.find((field) => field.name === 'assignment_target')).toMatchObject({
      type: 'string',
      nullable: true,
      editor: {
        kind: 'picker',
        inline: { mode: 'picker-summary' },
        dependencies: ['assignment.primary.type'],
        fixedValueHint: 'Search users',
        allowsDynamicReference: true,
        picker: {
          resource: 'user',
        },
      },
    });
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
      editor: undefined,
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
      editor: {
        kind: 'picker',
        inline: { mode: 'picker-summary' },
        dependencies: ['board_id'],
        fixedValueHint: 'search',
        allowsDynamicReference: true,
        picker: {
          resource: 'ticket',
        },
      },
    });
  });

  it('T165/T002/T003: ActionInputField extraction adapts legacy picker annotations into the unified editor model', () => {
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
    expect(state.actionInputFields.find((field) => field.name === 'ticket_id')?.editor).toEqual({
      kind: 'picker',
      inline: { mode: 'picker-summary' },
      dependencies: ['board_id'],
      fixedValueHint: 'search',
      allowsDynamicReference: true,
      picker: {
        resource: 'ticket',
      },
    });
  });

  it('T001/T003: preserves unified editor metadata from designer JSON schema fields without changing ordinary strings', () => {
    const registryWithPrompt: WorkflowDesignerActionRegistryItem[] = [
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
            prompt: {
              type: 'string',
              description: 'Prompt text sent to the configured AI provider',
              'x-workflow-editor': {
                kind: 'text',
                inline: { mode: 'textarea' },
                dialog: { mode: 'large-text' },
              },
            },
            subject: {
              type: 'string',
              description: 'Short label used elsewhere',
            },
          },
          required: ['prompt'],
        },
        outputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ];

    const step: NodeStep = {
      id: 'step-ai-prompt',
      type: 'action.call',
      name: 'AI Prompt',
      config: {
        actionId: 'ai.infer',
        version: 1,
      },
    };

    const state = buildActionInputEditorState(step, registryWithPrompt);
    expect(state.actionInputFields.find((field) => field.name === 'prompt')?.editor).toEqual({
      kind: 'text',
      inline: { mode: 'textarea' },
      dialog: { mode: 'large-text' },
    });
    expect(state.actionInputFields.find((field) => field.name === 'subject')?.editor).toBeUndefined();
  });

  it('ignores unsupported unified dialog metadata from designer JSON schema fields', () => {
    const registryWithUnsupportedDialog: WorkflowDesignerActionRegistryItem[] = [
      {
        id: 'notes.compose',
        version: 1,
        ui: {
          label: 'Compose Notes',
          description: 'Compose notes.',
        },
        inputSchema: {
          type: 'object',
          properties: {
            notes: {
              type: 'string',
              description: 'Long-form notes',
              'x-workflow-editor': {
                kind: 'text',
                inline: { mode: 'textarea' },
                dialog: { mode: 'picker-browser' as never },
              },
            },
          },
        },
        outputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ];

    const step: NodeStep = {
      id: 'step-unsupported-dialog',
      type: 'action.call',
      name: 'Compose Notes',
      config: {
        actionId: 'notes.compose',
        version: 1,
      },
    };

    const state = buildActionInputEditorState(step, registryWithUnsupportedDialog);
    expect(state.actionInputFields.find((field) => field.name === 'notes')?.editor).toEqual({
      kind: 'text',
      inline: { mode: 'textarea' },
      dialog: undefined,
    });
  });

  it('T180: picker metadata reaches the chosen action field editor without changing the persisted inputMapping shape', () => {
    const step: NodeStep = {
      id: 'step-picker-persisted',
      type: 'action.call',
      name: 'Update Ticket',
      config: {
        actionId: 'tickets.update_fields',
        version: 2,
        inputMapping: {
          ticket_id: 'ticket-123',
        },
      },
    };

    const state = buildActionInputEditorState(step, registry);
    expect(state.actionInputFields.find((field) => field.name === 'ticket_id')?.editor).toEqual({
      kind: 'picker',
      inline: { mode: 'picker-summary' },
      dependencies: ['board_id'],
      fixedValueHint: 'search',
      allowsDynamicReference: true,
      picker: {
        resource: 'ticket',
      },
    });
    expect(state.inputMapping).toEqual({
      ticket_id: 'ticket-123',
    });
  });

  it('T294: app grouped steps preserve picker metadata when app schemas provide the same annotations', () => {
    const step: NodeStep = {
      id: 'step-app-picker',
      type: 'action.call',
      name: 'Slack',
      config: {
        designerGroupKey: 'app:slack',
        designerTileKind: 'app',
        designerAppKey: 'app:slack',
        actionId: 'slack.send_message',
        version: 1,
        inputMapping: {
          channel_id: 'client-123',
        },
      },
    };

    const state = buildActionInputEditorState(step, registry);
    expect(state.actionInputFields.find((field) => field.name === 'channel_id')).toMatchObject({
      type: 'string',
      editor: {
        kind: 'picker',
        inline: { mode: 'picker-summary' },
        fixedValueHint: 'select',
        allowsDynamicReference: true,
        picker: {
          resource: 'client',
        },
      },
    });
    expect(state.inputMapping).toEqual({
      channel_id: 'client-123',
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
