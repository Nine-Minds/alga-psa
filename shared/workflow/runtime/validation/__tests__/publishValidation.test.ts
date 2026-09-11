import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validateWorkflowDefinition } from '../publishValidation';
import { registerDefaultNodes } from '../../nodes/registerDefaultNodes';
import { getNodeTypeRegistry } from '../../registries/nodeTypeRegistry';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import type { WorkflowDefinition } from '../../types';

beforeAll(() => {
  if (!getNodeTypeRegistry().get('action.call')) {
    registerDefaultNodes();
  }
  const actions = getActionRegistryV2();
  if (!actions.get('publish.email', 1)) {
    actions.register({
      id: 'publish.email',
      version: 1,
      sideEffectful: false,
      idempotency: { mode: 'engineProvided' },
      inputSchema: z.object({ subject: z.string(), html: z.string().optional() }),
      outputSchema: z.object({}),
      handler: async () => ({}),
    });
  }
});

const definitionWith = (steps: unknown[]): WorkflowDefinition => ({
  id: 'wf-publish',
  version: 1,
  name: 'Publish validation',
  payloadSchemaRef: 'payload.Test.v1',
  steps: steps as WorkflowDefinition['steps'],
});

const emailStep = (inputMapping: Record<string, unknown>) => ({
  id: 's1',
  type: 'action.call',
  config: { actionId: 'publish.email', version: 1, inputMapping },
});

describe('validateWorkflowDefinition expressions', () => {
  it('reports an empty action input expression exactly once, with guidance', () => {
    const result = validateWorkflowDefinition(definitionWith([emailStep({ subject: 'Hi', html: { $expr: '' } })]));
    const forHtml = result.errors.filter((error) => error.message.includes('inputMapping.html'));
    expect(result.errors).toHaveLength(1);
    expect(forHtml).toHaveLength(1);
    expect(forHtml[0].code).toBe('EMPTY_EXPRESSION');
    expect(forHtml[0].message).toContain('remove the mapping');
  });

  it('reports a broken action input expression once with the parser reason', () => {
    const result = validateWorkflowDefinition(definitionWith([emailStep({ subject: { $expr: 'bad(' } })]));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('INVALID_EXPRESSION');
    expect(result.errors[0].message).not.toContain('Unknown error');
  });

  it('still validates expressions outside the input mapping', () => {
    const result = validateWorkflowDefinition(
      definitionWith([{ id: 'if', type: 'control.if', condition: { $expr: '' }, then: [] }])
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('INVALID_EXPR');
    expect(result.errors[0].message).toContain('Expression is empty');
  });

  it('includes the parser reason for control expressions', () => {
    const result = validateWorkflowDefinition(
      definitionWith([{ id: 'if', type: 'control.if', condition: { $expr: 'payload..x' }, then: [] }])
    );
    expect(result.errors[0].code).toBe('INVALID_EXPR');
    expect(result.errors[0].message).toMatch(/^Invalid expression: .+/);
  });
});
