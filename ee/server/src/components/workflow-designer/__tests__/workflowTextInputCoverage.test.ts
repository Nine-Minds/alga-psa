import { beforeAll, describe, expect, it } from 'vitest';

import { getActionRegistryV2 } from '@alga-psa/shared/workflow/runtime/registries/actionRegistry';
import { zodToWorkflowJsonSchema } from '@alga-psa/shared/workflow/runtime/jsonSchemaMetadata';
import { registerBusinessOperationsActionsV2 } from '@alga-psa/shared/workflow/runtime/actions/registerBusinessOperationsActions';
import { registerTransformActionsV2 } from '@alga-psa/shared/workflow/runtime/actions/registerTransformActions';
import { registerAiActionsV2 } from '@alga-psa/shared/workflow/runtime/actions/registerAiActions';
import { registerEmailWorkflowActionsV2 } from '@alga-psa/shared/workflow/runtime/actions/registerEmailWorkflowActions';

import { buildActionInputEditorState, type WorkflowDesignerActionRegistryItem } from '../actionInputEditorState';
import { isWorkflowFreeTextInput, isWorkflowMultilineTextInput } from '../mapping/workflowTextInput';
import type { ActionInputField } from '../mapping';

const register = (fn: () => void) => {
  try {
    fn();
  } catch (error) {
    // Already registered by another test in this worker.
    if (!/already registered/i.test(String(error))) throw error;
  }
};

const designerFieldsFor = (action: WorkflowDesignerActionRegistryItem): ActionInputField[] =>
  buildActionInputEditorState(
    { type: 'action.call', config: { actionId: action.id, version: action.version, inputMapping: {} } },
    [action]
  ).actionInputFields;

const walk = (fields: ActionInputField[], prefix: string, visit: (field: ActionInputField, path: string) => void) => {
  for (const field of fields) {
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    visit(field, path);
    if (field.children?.length) walk(field.children, path, visit);
  }
};

// Text that isn't free text on purpose: it has a fixed shape or its own editor.
const isStructuredString = (field: ActionInputField): boolean =>
  Boolean(
    field.enum?.length ||
    field.picker?.kind ||
    (field.editor && field.editor.kind !== 'text') ||
    field.editor?.softEnum ||
    ['email', 'date', 'date-time', 'time', 'uuid'].includes(field.constraints?.format ?? '')
  );

describe('every free-text action input gets Text mode', () => {
  let actions: WorkflowDesignerActionRegistryItem[] = [];

  beforeAll(() => {
    register(registerBusinessOperationsActionsV2);
    register(registerTransformActionsV2);
    register(registerAiActionsV2);
    register(registerEmailWorkflowActionsV2);
    actions = getActionRegistryV2().list().map((action) => ({
      id: action.id,
      version: action.version,
      inputSchema: zodToWorkflowJsonSchema(action.inputSchema) as WorkflowDesignerActionRegistryItem['inputSchema'],
      outputSchema: {},
    }));
  });

  it('covers the whole catalog', () => {
    expect(actions.length).toBeGreaterThan(50);
  });

  it('resolves every plain string input (top-level and nested) to the Text editor', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const action of actions) {
      walk(designerFieldsFor(action), '', (field, path) => {
        if (field.type !== 'string' || isStructuredString(field)) return;
        checked += 1;
        if (!isWorkflowFreeTextInput(field)) missing.push(`${action.id}.${path}`);
      });
    }
    expect(checked).toBeGreaterThan(100);
    expect(missing).toEqual([]);
  });

  it('edits email bodies, comments and descriptions over several lines', () => {
    const byId = new Map(actions.map((action) => [action.id, action]));
    const field = (actionId: string, name: string) =>
      designerFieldsFor(byId.get(actionId)!).find((candidate) => candidate.name === name)!;
    for (const [actionId, name] of [['email.send', 'text'], ['email.send', 'html'], ['tickets.add_comment', 'body'], ['tickets.create', 'description']]) {
      const input = field(actionId, name);
      expect(input, `${actionId}.${name}`).toBeDefined();
      expect(isWorkflowFreeTextInput(input), `${actionId}.${name} is free text`).toBe(true);
      expect(isWorkflowMultilineTextInput(input), `${actionId}.${name} is multi-line`).toBe(true);
    }
    expect(isWorkflowMultilineTextInput(field('tickets.create', 'title'))).toBe(false);
  });
});
