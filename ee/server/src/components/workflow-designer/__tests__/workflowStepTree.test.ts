import { describe, expect, it } from 'vitest';
import type { Step } from '@alga-psa/workflows/runtime/client';

import {
  clampInsertionTarget,
  describeInsertionTarget,
  findStepLocation,
  getEndOfPipeTarget,
  getInsertionTargetForSelectedStep,
  isPipePathValid,
} from '../workflowStepTree';

const action = (id: string, name = id): Step => ({ id, type: 'action.call', name, config: {} } as Step);

const steps: Step[] = [
  action('find', 'Find Ticket'),
  {
    id: 'if-1',
    type: 'control.if',
    condition: { $expr: '' },
    then: [action('assign', 'Assign Ticket')],
    else: [],
  } as Step,
  action('notify', 'Notify'),
];

const label = (step: Step) => ('name' in step && step.name ? String(step.name) : step.type);

describe('workflow step tree insertion targets', () => {
  it('finds steps at any depth with their pipe and index', () => {
    expect(findStepLocation(steps, 'notify')).toMatchObject({ pipePath: 'root', index: 2 });
    expect(findStepLocation(steps, 'assign')).toMatchObject({ pipePath: 'root.steps[1].then', index: 0 });
    expect(findStepLocation(steps, 'missing')).toBeNull();
  });

  it('inserts right after a selected plain step, in its own pipe', () => {
    expect(getInsertionTargetForSelectedStep(steps, 'find')).toEqual({ pipePath: 'root', index: 1 });
    expect(getInsertionTargetForSelectedStep(steps, 'assign')).toEqual({ pipePath: 'root.steps[1].then', index: 1 });
  });

  it('inserts at the end of the first branch of a selected container step', () => {
    expect(getInsertionTargetForSelectedStep(steps, 'if-1')).toEqual({ pipePath: 'root.steps[1].then', index: 1 });
  });

  it('targets the end of a pipe and falls back to the root for pipes that no longer exist', () => {
    expect(getEndOfPipeTarget(steps, 'root.steps[1].else')).toEqual({ pipePath: 'root.steps[1].else', index: 0 });
    expect(getEndOfPipeTarget(steps, 'root.steps[0].then')).toEqual({ pipePath: 'root', index: 3 });
    expect(isPipePathValid(steps, 'root.steps[1].then')).toBe(true);
    expect(isPipePathValid(steps, 'root.steps[2].body')).toBe(false);
  });

  it('clamps stale targets into range', () => {
    expect(clampInsertionTarget(steps, { pipePath: 'root.steps[1].then', index: 9 })).toEqual({ pipePath: 'root.steps[1].then', index: 1 });
    expect(clampInsertionTarget(steps, { pipePath: 'root.steps[7].then', index: 0 })).toEqual({ pipePath: 'root', index: 3 });
  });

  it('describes targets in plain language', () => {
    expect(describeInsertionTarget(steps, { pipePath: 'root', index: 1 }, label)).toEqual({
      kind: 'after',
      stepLabel: 'Find Ticket',
      containerLabel: null,
    });
    expect(describeInsertionTarget(steps, { pipePath: 'root', index: 0 }, label)).toEqual({ kind: 'start', containerLabel: null });
    expect(describeInsertionTarget(steps, { pipePath: 'root', index: 3 }, label)).toEqual({ kind: 'end', containerLabel: null });
    expect(describeInsertionTarget(steps, { pipePath: 'root.steps[1].else', index: 0 }, label)).toEqual({
      kind: 'end',
      containerLabel: 'control.if › Else',
    });
  });
});
