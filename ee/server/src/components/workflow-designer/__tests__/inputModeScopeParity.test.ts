import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_CAUGHT_ERROR_FIELDS,
  evaluateExpressionSource,
  validateExpressionSource,
} from '@alga-psa/workflows/authoring';
import type { WorkflowDefinition } from '@alga-psa/workflows/runtime/client';
import { buildDataContext } from '../workflowDataContext';

import { buildWorkflowReferenceFieldOptions } from '../workflowReferenceOptions';
import { buildReferenceSourceModel } from '../workflowReferenceSelector';
import type { DataContext, JsonSchema } from '../workflowDataContext';
import type { DataTreeContext } from '../mapping/SourceDataTree';
import {
  compileTextTemplate,
  getTextTemplateScope,
  isTextTemplateFieldPath,
  textTemplateFromValue,
} from '../mapping/textTemplate';
import { isSimpleFieldReferenceExpression } from '../WorkflowActionInputSourceMode';

/**
 * Every root an input can read must be reachable, and resolve the same way, in Reference, Text and
 * Expression mode: trigger payload, saved step results, meta, the caught error inside a Catch, and
 * the loop item and index inside a For Each.
 */
const payloadSchema: JsonSchema = {
  type: 'object',
  properties: { clientName: { type: 'string' } },
};

const forEach = { itemVar: 'checklistItem', indexVar: 'index', itemType: 'any' };

const dataContext = {
  payload: [{ name: 'clientName', type: 'string', required: false, nullable: false }],
  payloadSchema,
  steps: [{
    stepId: 'create',
    stepName: 'Create Ticket',
    saveAs: 'ticket',
    outputSchema: { type: 'object', properties: { ticket_number: { type: 'string' } } },
    fields: [{ name: 'ticket_number', type: 'string', required: false, nullable: false }],
  }],
  globals: { env: [], secrets: [], meta: [], error: [] },
  forEach,
  inCatchBlock: true,
} as unknown as DataContext;

const treeContext: DataTreeContext = {
  payload: [{ name: 'clientName', path: 'payload.clientName', type: 'string', source: 'payload' }],
  vars: [{
    stepId: 'create',
    stepName: 'Create Ticket',
    saveAs: 'ticket',
    fields: [{ name: 'ticket_number', path: 'vars.ticket.ticket_number', type: 'string', source: 'vars' }],
  }],
  meta: [{ name: 'traceId', path: 'meta.traceId', type: 'string', source: 'meta' }],
  error: [{ name: 'message', path: 'error.message', type: 'string', source: 'error' }],
  forEach,
};

// What the runtime binds while running a step inside the loop and the catch block.
const runtimeContext = {
  payload: { clientName: 'Acme' },
  vars: { ticket: { ticket_number: 'T-1' }, checklistItem: 'Set up portal' },
  meta: { traceId: 'trace-1' },
  error: { message: 'Boom' },
  local: { checklistItem: 'Set up portal', item: 'Set up portal', index: 2 },
  checklistItem: 'Set up portal',
  item: 'Set up portal',
  index: 2,
};

const ROOTS: Array<{ name: string; path: string; expected: unknown }> = [
  { name: 'trigger payload', path: 'payload.clientName', expected: 'Acme' },
  { name: 'step result', path: 'vars.ticket.ticket_number', expected: 'T-1' },
  { name: 'meta', path: 'meta.traceId', expected: 'trace-1' },
  { name: 'caught error', path: 'error.message', expected: 'Boom' },
  { name: 'loop item', path: 'checklistItem', expected: 'Set up portal' },
  { name: 'loop index', path: 'index', expected: 2 },
];

describe('input mode scope parity', () => {
  const fieldOptions = buildWorkflowReferenceFieldOptions(payloadSchema, dataContext);
  const optionValues = new Set(fieldOptions.map((option) => option.value));
  const referenceModel = buildReferenceSourceModel(treeContext, fieldOptions, payloadSchema);
  const referenceValues = new Set([
    ...referenceModel.payload,
    ...referenceModel.meta,
    ...referenceModel.error,
    ...referenceModel.forEach,
    ...referenceModel.vars.flatMap((step) => step.fields),
  ].map((option) => option.value));
  const textScope = getTextTemplateScope(forEach);

  for (const root of ROOTS) {
    describe(root.name, () => {
      it('is offered and readable in Reference mode', async () => {
        expect(referenceValues.has(root.path)).toBe(true);
        expect(isSimpleFieldReferenceExpression(root.path)).toBe(true);
        await expect(evaluateExpressionSource(root.path, runtimeContext)).resolves.toEqual(root.expected);
      });

      it('is offered by Insert field and valid in Expression mode', async () => {
        expect(optionValues.has(root.path)).toBe(true);
        expect(() => validateExpressionSource(root.path)).not.toThrow();
        await expect(evaluateExpressionSource(`"x" & ${root.path}`, runtimeContext)).resolves.toBe(`x${String(root.expected)}`);
      });

      it('is a field in Text mode and resolves the same way', async () => {
        expect(isTextTemplateFieldPath(root.path, textScope)).toBe(true);
        const compiled = compileTextTemplate(`Value: {{${root.path}}}`, textScope) as { $expr: string };
        expect(compiled.$expr).toBe(`"Value: " & ${root.path}`);
        await expect(evaluateExpressionSource(compiled.$expr, runtimeContext)).resolves.toBe(`Value: ${String(root.expected)}`);
        // Reading the value back gives the same text, so switching modes never loses it.
        expect(textTemplateFromValue(compiled, textScope)).toBe(`Value: {{${root.path}}}`);
      });
    });
  }

  it('keeps loop names as literal text outside a loop', () => {
    expect(isTextTemplateFieldPath('checklistItem', getTextTemplateScope(undefined))).toBe(false);
    expect(compileTextTemplate('Hi {{checklistItem}}', getTextTemplateScope(undefined))).toBe('Hi {{checklistItem}}');
  });
});

describe('caught error scope', () => {
  // The runtime's normalized error (workflow-runtime-v2-run-workflow.ts normalizeRuntimeError):
  // bound to `error` and, when the Try/Catch names one, to vars.<captureErrorAs>.
  const runtimeError = {
    category: 'ActionError',
    message: 'Contact not found',
    nodePath: 'root.steps[0].try.steps[1]',
    at: '2026-10-03T00:00:00.000Z',
    code: 'NOT_FOUND',
  };

  const definition = {
    id: 'wf',
    version: 1,
    name: 'Catch scope',
    payloadSchemaRef: 'system:default',
    trigger: { type: 'event', eventName: 'TICKET_ASSIGNED' },
    steps: [
      {
        id: 'try-1',
        type: 'control.tryCatch',
        captureErrorAs: 'notifyError',
        try: [{ id: 'in-try', type: 'action.call', config: { actionId: 'tickets.find', version: 1 } }],
        catch: [{ id: 'in-catch', type: 'action.call', config: { actionId: 'tickets.add_comment', version: 1 } }],
      },
      { id: 'after', type: 'action.call', config: { actionId: 'tickets.add_comment', version: 1 } },
    ],
  } as unknown as WorkflowDefinition;

  const insideCatch = buildDataContext(definition, 'in-catch', [], null);
  const options = buildWorkflowReferenceFieldOptions(null, insideCatch);
  const values = options.map((option) => option.value);

  it('offers the named error first among step results, and the error root, inside the Catch', () => {
    expect(insideCatch.inCatchBlock).toBe(true);
    expect(insideCatch.steps[0]).toMatchObject({ saveAs: 'notifyError' });
    expect(values).toContain('vars.notifyError.message');
    expect(values).toContain('error.message');
  });

  it('only offers error fields the runtime actually sets', async () => {
    const offeredErrorFields = values
      .filter((value) => value.startsWith('error.') || value.startsWith('vars.notifyError.'))
      .map((value) => value.split('.').pop());
    expect(offeredErrorFields).not.toContain('stack');
    expect(offeredErrorFields).not.toContain('name');
    for (const field of WORKFLOW_CAUGHT_ERROR_FIELDS.filter((entry) => entry.alwaysPresent)) {
      await expect(
        evaluateExpressionSource(`error.${field.name} & "|" & vars.notifyError.${field.name}`, {
          error: runtimeError,
          vars: { notifyError: runtimeError },
        })
      ).resolves.toBe(`${String(runtimeError[field.name as keyof typeof runtimeError])}|${String(runtimeError[field.name as keyof typeof runtimeError])}`);
    }
  });

  it('resolves the named error in Text mode and the data panel lists the same fields', () => {
    const compiled = compileTextTemplate('Failed: {{vars.notifyError.message}}') as { $expr: string };
    expect(compiled.$expr).toBe('"Failed: " & vars.notifyError.message');
    const panelErrorFields = insideCatch.globals.error.map((field) => field.name).sort();
    expect(panelErrorFields).toEqual(WORKFLOW_CAUGHT_ERROR_FIELDS.map((field) => field.name).sort());
    const insertErrorFields = values.filter((value) => value.startsWith('error.')).map((value) => value.slice('error.'.length)).sort();
    expect(insertErrorFields).toEqual(panelErrorFields);
  });

  it('does not offer the named error after the Try/Catch', () => {
    const after = buildDataContext(definition, 'after', [], null);
    expect(after.inCatchBlock).toBeFalsy();
    expect(after.steps.map((step) => step.saveAs)).not.toContain('notifyError');
  });
});
