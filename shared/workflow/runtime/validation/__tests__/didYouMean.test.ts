import { beforeAll, describe, expect, it } from 'vitest';
import { didYouMean, findNearestName, levenshteinDistance } from '../didYouMean';
import { validateWorkflowDefinition } from '../publishValidation';
import { registerDefaultNodes } from '../../nodes/registerDefaultNodes';
import { getNodeTypeRegistry } from '../../registries/nodeTypeRegistry';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { z } from 'zod';
import type { WorkflowDefinition } from '../../types';

beforeAll(() => {
  if (!getNodeTypeRegistry().get('action.call')) {
    registerDefaultNodes();
  }
  const actions = getActionRegistryV2();
  if (!actions.get('suggest.echo', 1)) {
    actions.register({
      id: 'suggest.echo',
      version: 1,
      sideEffectful: false,
      idempotency: { mode: 'engineProvided' },
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      handler: async () => ({}),
    });
  }
});

const definitionWith = (steps: unknown[]): WorkflowDefinition => ({
  id: 'wf-suggest',
  version: 1,
  name: 'Suggestion test',
  payloadSchemaRef: 'payload.Test.v1',
  steps: steps as WorkflowDefinition['steps'],
});

describe('didYouMean helpers', () => {
  it('computes edit distance', () => {
    expect(levenshteinDistance('append', 'append')).toBe(0);
    expect(levenshteinDistance('apend', 'append')).toBe(1);
    expect(levenshteinDistance('abc', 'xyz')).toBe(3);
  });

  it('finds near matches within budget and rejects far ones', () => {
    expect(findNearestName('apend', ['append', 'len', 'coalesce'])).toBe('append');
    expect(findNearestName('zzzzzz', ['append', 'len'])).toBeNull();
    expect(didYouMean('ticket.updat_fields', ['tickets.update_fields', 'tickets.find'])).toBe(
      'Did you mean "tickets.update_fields"?'
    );
  });
});

describe('validation suggestions', () => {
  it('suggests the nearest action id for unknown actions', () => {
    const result = validateWorkflowDefinition(
      definitionWith([
        { id: 's1', type: 'action.call', config: { actionId: 'sugest.echo', version: 1 } },
      ])
    );
    const unknown = result.errors.find((error) => error.code === 'UNKNOWN_ACTION');
    expect(unknown?.suggestion).toBe('Did you mean "suggest.echo"?');
  });

  it('points at existing versions when only the version is wrong', () => {
    const result = validateWorkflowDefinition(
      definitionWith([
        { id: 's1', type: 'action.call', config: { actionId: 'suggest.echo', version: 9 } },
      ])
    );
    const unknown = result.errors.find((error) => error.code === 'UNKNOWN_ACTION');
    expect(unknown?.suggestion).toContain('exists at version');
  });

  it('suggests the nearest expression function for disallowed calls', () => {
    const result = validateWorkflowDefinition(
      definitionWith([
        {
          id: 's1',
          type: 'control.if',
          condition: { $expr: 'apend(vars.list, 1)' },
          then: [],
        },
      ])
    );
    const invalidExpr = result.errors.find((error) => error.code === 'INVALID_EXPR');
    expect(invalidExpr?.suggestion).toBe('Did you mean "append"?');
  });

  it('suggests the nearest node type for typos', () => {
    const result = validateWorkflowDefinition(
      definitionWith([
        { id: 's1', type: 'transform.asign', config: { assign: {} } },
      ])
    );
    const unknown = result.errors.find((error) => error.code === 'UNKNOWN_NODE_TYPE');
    expect(unknown?.suggestion).toBe('Did you mean "transform.assign"?');
  });
});
