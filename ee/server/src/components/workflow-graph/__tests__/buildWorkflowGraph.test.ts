import { describe, expect, it } from 'vitest';
import type { Step } from '@alga-psa/workflows/runtime';

import { buildWorkflowGraph } from '../buildWorkflowGraph';

const action = (id: string): Step => ({ id, type: 'action.call', name: id, config: { actionId: 'x.y' } } as Step);
const ifStep = (then: Step[], elseSteps: Step[]): Step =>
  ({ id: 'if', type: 'control.if', condition: { $expr: 'true' }, then, else: elseSteps } as Step);

const build = (steps: Step[]) => buildWorkflowGraph(steps, { getLabel: (step) => step.id });

const centerX = (nodes: Awaited<ReturnType<typeof build>>['nodes'], id: string) => {
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`missing node ${id}`);
  return node.position.x + ((node as { width?: number }).width ?? 260) / 2;
};

describe('buildWorkflowGraph If branches', () => {
  it('lays the Then branch out left of the Else branch', async () => {
    const { nodes } = await build([ifStep([action('then-a'), action('then-b')], [action('else-a')]), action('after')]);
    expect(centerX(nodes, 's:if:then:then-a')).toBeLessThan(centerX(nodes, 's:if:else:else-a'));
  });

  it('starts both branches on the row right below the If, even when one branch is shorter', async () => {
    const { nodes } = await build([
      ifStep([action('then-a')], [action('else-a'), action('else-b'), action('else-c')]),
      action('after'),
    ]);
    const y = (id: string) => nodes.find((node) => node.id === id)?.position.y;
    expect(y('s:if:then:then-a')).toBe(y('s:if:else:else-a'));
    expect(y('s:if:then:then-a')!).toBeGreaterThan(y('s:if')!);
  });

  it('routes an empty Else branch through a labelled edge into the join, not straight to the next step', async () => {
    const { edges } = await build([ifStep([action('then-a')], []), action('after')]);
    const joinId = 's:if::join';
    expect(edges.some((edge) => edge.source === 's:if' && edge.target === joinId && edge.label === 'else')).toBe(true);
    expect(edges.some((edge) => edge.source === 's:if:then:then-a' && edge.target === joinId)).toBe(true);
    expect(edges.some((edge) => edge.source === joinId && edge.target === 's:after')).toBe(true);
    expect(edges.some((edge) => edge.source === 's:if' && edge.target === 's:after')).toBe(false);
  });

  it('draws branch exits into the join down their own column', async () => {
    const { edges } = await build([ifStep([action('then-a')], [action('else-a'), action('else-b')]), action('after')]);
    const thenExit = edges.find((edge) => edge.source === 's:if:then:then-a' && edge.target === 's:if::join');
    expect(thenExit?.type).toBe('workflowMergeIntoJoin');
  });

  it('continues straight from the If when both branches are empty', async () => {
    const { edges } = await build([ifStep([], []), action('after')]);
    expect(edges.some((edge) => edge.source === 's:if' && edge.target === 's:after')).toBe(true);
  });
});
