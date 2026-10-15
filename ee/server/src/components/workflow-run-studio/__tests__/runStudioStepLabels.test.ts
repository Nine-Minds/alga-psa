import { describe, expect, it } from 'vitest';
import type { Step } from '@alga-psa/workflows/runtime/client';

import {
  collectRunStudioSteps,
  getRunStudioStepLabel,
  getRunStudioStepSubtitle,
  needsActionLabels,
} from '../runStudioStepLabels';

const t = (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? _key);

const named = { id: 'a', type: 'action.call', name: 'Find Ticket', config: { actionId: 'tickets.find' } } as Step;
const unnamed = { id: 'b', type: 'action.call', name: '', config: { actionId: 'transform.truncate_text' } } as Step;
const ifStep = { id: 'if', type: 'control.if', condition: { $expr: '' }, then: [unnamed], else: [] } as Step;

describe('run studio step labels', () => {
  it('uses the step name, then the action label, then the action id', () => {
    expect(getRunStudioStepLabel(named, t)).toBe('Find Ticket');
    expect(getRunStudioStepLabel(unnamed, t, new Map([['transform.truncate_text', 'Truncate Text']]))).toBe('Truncate Text');
    expect(getRunStudioStepLabel(unnamed, t)).toBe('transform.truncate_text');
    expect(getRunStudioStepLabel(ifStep, t)).toBe('If Condition');
  });

  it('shows the action id as the subtitle for actions and the type otherwise', () => {
    expect(getRunStudioStepSubtitle(named)).toBe('tickets.find');
    expect(getRunStudioStepSubtitle(ifStep)).toBe('control.if');
  });

  it('finds nested steps and only asks for action labels when an action step is unnamed', () => {
    expect(collectRunStudioSteps([named, ifStep]).map((step) => step.id)).toEqual(['a', 'if', 'b']);
    expect(needsActionLabels([named])).toBe(false);
    expect(needsActionLabels([named, ifStep])).toBe(true);
  });
});
