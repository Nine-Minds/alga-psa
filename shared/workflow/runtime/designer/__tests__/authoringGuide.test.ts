import { beforeAll, describe, expect, it } from 'vitest';
import { getNodeTypeRegistry } from '../../registries/nodeTypeRegistry';
import { registerDefaultNodes } from '../../nodes/registerDefaultNodes';
import { buildWorkflowAuthoringGuide } from '../authoringGuide';
import { workflowDefinitionSchema } from '../../types';

beforeAll(() => {
  if (!getNodeTypeRegistry().get('action.call')) {
    registerDefaultNodes();
  }
});

describe('buildWorkflowAuthoringGuide', () => {
  it('assembles live schemas, node types, and the expression catalog', () => {
    const guide = buildWorkflowAuthoringGuide();

    const definitions = (guide.definitionSchema as { definitions?: Record<string, unknown> }).definitions;
    expect(definitions).toHaveProperty('WorkflowDefinition');

    expect(Object.keys(guide.stepSchemas)).toEqual(
      expect.arrayContaining(['control.if', 'control.forEach', 'control.tryCatch', 'control.return'])
    );
    // Recursive step arrays are patched with a self-reference, not left empty.
    const ifSchema = JSON.stringify(guide.stepSchemas['control.if']);
    expect(ifSchema).toContain('#/stepSchemas');

    const nodeIds = guide.nodeTypes.map((node) => node.id);
    expect(nodeIds).toEqual(expect.arrayContaining(['action.call', 'transform.assign', 'state.set', 'event.wait']));
    for (const node of guide.nodeTypes) {
      expect(node.configSchema).toBeTruthy();
    }

    const fnNames = guide.expressionLanguage.functions.map((fn) => fn.name);
    expect(fnNames).toEqual(expect.arrayContaining(['nowIso', 'coalesce', 'len', 'toString', 'append']));
    for (const fn of guide.expressionLanguage.functions) {
      expect(fn.description.length).toBeGreaterThan(0);
      expect(fn.signature.length).toBeGreaterThan(0);
    }
  });

  it('ships a worked example that parses as a valid WorkflowDefinition', () => {
    const guide = buildWorkflowAuthoringGuide();
    expect(() => workflowDefinitionSchema.parse(guide.workedExample.definition)).not.toThrow();
  });
});
