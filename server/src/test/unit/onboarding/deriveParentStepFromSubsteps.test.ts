import { describe, it, expect } from 'vitest';
import { deriveParentStepFromSubsteps } from '@alga-psa/onboarding/lib/deriveParentStepFromSubsteps';

describe('deriveParentStepFromSubsteps', () => {
  it('marks complete only when all sub-steps complete', () => {
    const derived = deriveParentStepFromSubsteps([
      { id: 'a', title: 'A', status: 'complete', lastUpdated: '2026-01-01T00:00:00.000Z' },
      { id: 'b', title: 'B', status: 'complete', lastUpdated: '2026-01-02T00:00:00.000Z' },
    ]);

    expect(derived.status).toBe('complete');
    expect(derived.progressValue).toBe(100);
    expect(derived.blocker).toBeNull();
    expect(derived.lastUpdated).toBe('2026-01-02T00:00:00.000Z');
  });

  it('marks blocked when any sub-step is blocked and surfaces the blocker', () => {
    const derived = deriveParentStepFromSubsteps([
      { id: 'a', title: 'A', status: 'complete', lastUpdated: '2026-01-01T00:00:00.000Z' },
      { id: 'b', title: 'B', status: 'blocked', lastUpdated: '2026-01-03T00:00:00.000Z', blocker: 'Fix me' },
      { id: 'c', title: 'C', status: 'not_started', lastUpdated: null },
    ]);

    expect(derived.status).toBe('blocked');
    expect(derived.blocker).toBe('Fix me');
    expect(derived.lastUpdated).toBe('2026-01-03T00:00:00.000Z');
    expect(derived.progressValue).toBe(33);
  });

  it('marks not_started when all sub-steps not started', () => {
    const derived = deriveParentStepFromSubsteps([
      { id: 'a', title: 'A', status: 'not_started', lastUpdated: null },
      { id: 'b', title: 'B', status: 'not_started', lastUpdated: null },
    ]);

    expect(derived.status).toBe('not_started');
    expect(derived.progressValue).toBe(0);
  });

  it('marks in_progress when started but not complete', () => {
    const derived = deriveParentStepFromSubsteps([
      { id: 'a', title: 'A', status: 'complete', lastUpdated: '2026-01-01T00:00:00.000Z' },
      { id: 'b', title: 'B', status: 'not_started', lastUpdated: null },
      { id: 'c', title: 'C', status: 'in_progress', lastUpdated: '2026-01-04T00:00:00.000Z' },
    ]);

    expect(derived.status).toBe('in_progress');
    expect(derived.progressValue).toBe(33);
    expect(derived.lastUpdated).toBe('2026-01-04T00:00:00.000Z');
  });
});
