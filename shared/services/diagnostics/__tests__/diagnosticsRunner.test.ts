import { describe, it, expect, vi } from 'vitest';
import {
  assembleDiagnosticsReport,
  computeOverallStatus,
  defaultErrorMeta,
  runDiagnosticsSteps,
  type DiagnosticsStepDefinition,
} from '../diagnosticsRunner';

type Ctx = { calls: string[] };

function makeStep(
  id: string,
  status: 'pass' | 'warn' | 'fail' | 'skip',
  extra: Partial<Awaited<ReturnType<DiagnosticsStepDefinition<Ctx>['run']>>> = {},
  onRun?: (ctx: Ctx) => void,
): DiagnosticsStepDefinition<Ctx> {
  return {
    id,
    title: `Title ${id}`,
    run: async (ctx) => {
      ctx.calls.push(id);
      onRun?.(ctx);
      return { status, ...extra };
    },
  };
}

describe('runDiagnosticsSteps', () => {
  it('executes steps in order and records outcomes', async () => {
    const ctx: Ctx = { calls: [] };
    const outcome = await runDiagnosticsSteps({
      context: ctx,
      steps: [makeStep('a', 'pass'), makeStep('b', 'warn'), makeStep('c', 'fail')],
    });

    expect(ctx.calls).toEqual(['a', 'b', 'c']);
    expect(outcome.steps.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(outcome.steps.map((s) => s.status)).toEqual(['pass', 'warn', 'fail']);
    expect(outcome.overallStatus).toBe('fail');
    expect(outcome.steps[0].startedAt).toBeTypeOf('string');
    expect(outcome.steps[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('captures thrown errors through onError and marks the step failed', async () => {
    const ctx: Ctx = { calls: [] };
    const boom = new Error('kaboom');
    const step: DiagnosticsStepDefinition<Ctx> = {
      id: 'throwing',
      title: 'Throwing step',
      run: async () => {
        throw boom;
      },
    };
    const outcome = await runDiagnosticsSteps({
      context: ctx,
      steps: [step],
      onError: (error) => {
        expect(error).toBe(boom);
        return {
          error: { message: 'normalized', code: 'E_NORM', status: 500, requestId: 'req-1' },
          recommendations: ['retry later'],
        };
      },
    });

    expect(outcome.steps[0].status).toBe('fail');
    expect(outcome.steps[0].error).toEqual({
      message: 'normalized',
      code: 'E_NORM',
      status: 500,
      requestId: 'req-1',
    });
    expect(outcome.recommendations).toEqual(['retry later']);
  });

  it('falls back to defaultErrorMeta without an onError handler', async () => {
    const outcome = await runDiagnosticsSteps({
      context: { calls: [] },
      steps: [
        {
          id: 'x',
          title: 'x',
          run: async () => {
            throw 'plain string';
          },
        },
      ],
    });
    expect(outcome.steps[0].error).toEqual({ message: 'plain string' });
  });

  it('measures duration using the injected clock', async () => {
    vi.useFakeTimers();
    try {
      const outcome = await runDiagnosticsSteps({
        context: { calls: [] },
        steps: [
          {
            id: 'slow',
            title: 'slow',
            run: async () => {
              vi.advanceTimersByTime(250);
              return { status: 'pass' };
            },
          },
        ],
      });
      expect(outcome.steps[0].durationMs).toBe(250);
    } finally {
      vi.useRealTimers();
    }
  });

  it('accumulates recommendations in insertion order and deduplicates', async () => {
    const outcome = await runDiagnosticsSteps({
      context: { calls: [] },
      recommendations: ['seed', 'dup'],
      steps: [
        makeStep('a', 'warn', { recommendations: ['dup', 'one'] }),
        makeStep('b', 'warn', { recommendations: ['two', 'one', ''] }),
      ],
    });
    expect(outcome.recommendations).toEqual(['seed', 'dup', 'one', 'two']);
  });

  it('folds fail > warn > pass and treats empty/all-skip as pass', async () => {
    expect(computeOverallStatus([{ status: 'pass' }, { status: 'skip' }])).toBe('pass');
    expect(computeOverallStatus([{ status: 'warn' }, { status: 'pass' }])).toBe('warn');
    expect(computeOverallStatus([{ status: 'warn' }, { status: 'fail' }])).toBe('fail');
    expect(computeOverallStatus([])).toBe('pass');

    const allSkip = await runDiagnosticsSteps({
      context: { calls: [] },
      steps: [makeStep('a', 'skip'), makeStep('b', 'skip')],
    });
    expect(allSkip.overallStatus).toBe('pass');
  });

  it('honors shouldStop for early termination', async () => {
    const ctx: Ctx = { calls: [] };
    const outcome = await runDiagnosticsSteps({
      context: ctx,
      steps: [makeStep('a', 'fail'), makeStep('b', 'pass')],
      shouldStop: (step) => step.id === 'a',
    });
    expect(ctx.calls).toEqual(['a']);
    expect(outcome.steps.map((s) => s.id)).toEqual(['a']);
  });

  it('omits undefined optional fields and keeps structured data/http', async () => {
    const outcome = await runDiagnosticsSteps({
      context: { calls: [] },
      steps: [
        makeStep('a', 'pass', {
          http: { method: 'GET', path: '/me', status: 200, requestId: 'rid' },
          data: { foo: 'bar' },
        }),
      ],
    });
    expect(outcome.steps[0].http).toMatchObject({ status: 200, requestId: 'rid' });
    expect(outcome.steps[0].data).toEqual({ foo: 'bar' });
    expect('detail' in outcome.steps[0]).toBe(false);
    expect('error' in outcome.steps[0]).toBe(false);
  });
});

describe('assembleDiagnosticsReport', () => {
  it('builds summary and support bundle from the run outcome', async () => {
    const ctx: Ctx = { calls: [] };
    const run = await runDiagnosticsSteps({
      context: ctx,
      steps: [makeStep('a', 'warn', { recommendations: ['r1'] })],
    });
    const report = assembleDiagnosticsReport<Ctx, Record<string, unknown>, { count: number }>({
      run,
      context: ctx,
      buildSummary: ({ run: outcome }) => ({ count: outcome.steps.length }),
      buildSupportBundle: ({ summary }) => ({ summary }),
    });

    expect(report.createdAt).toBe(run.createdAt);
    expect(report.summary).toEqual({ count: 1 });
    expect(report.steps).toBe(run.steps);
    expect(report.recommendations).toEqual(['r1']);
    expect(report.supportBundle).toEqual({ summary: { count: 1 } });
  });
});

describe('defaultErrorMeta', () => {
  it('normalizes Error, string and unknown throws', () => {
    expect(defaultErrorMeta(new Error('boom'))).toEqual({ message: 'boom' });
    expect(defaultErrorMeta('oops')).toEqual({ message: 'oops' });
    expect(defaultErrorMeta({ weird: true })).toEqual({ message: 'Unknown error' });
  });
});
