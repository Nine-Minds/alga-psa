import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EvaluationBudgetExceededError,
  EvaluationBusyError,
  compileExpression,
  evaluateWorkflowExpression,
  getExpressionAdmissionStats,
  resetExpressionAdmission,
  runWithAdmission,
  setExpressionAdmissionSink,
  type ExpressionAdmissionEvent,
} from '../expressionEngine';

const manyItems = (count: number) => Array.from({ length: count }, () => ({ value: 1 }));
// Legal and well under the 4096-step budget, but long enough for several hook checks.
const LONG_LEGAL = 'payload.items.(value + 1)';

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe('expression admission', () => {
  beforeEach(() => {
    resetExpressionAdmission({ maxConcurrency: 2, queueTimeoutMs: 40 });
  });
  afterEach(() => {
    setExpressionAdmissionSink(null);
    resetExpressionAdmission();
  });

  it('never runs more than N evaluations at once; the extra k queue and then fail with EvaluationBusyError', async () => {
    const events: ExpressionAdmissionEvent[] = [];
    setExpressionAdmissionSink((event) => events.push(event));
    const release = gate();
    let inside = 0;
    let maxInside = 0;
    const blocking = async () => {
      inside += 1;
      maxInside = Math.max(maxInside, inside);
      await release.promise;
      inside -= 1;
      return 'done';
    };

    const holders = [runWithAdmission({}, blocking), runWithAdmission({}, blocking)];
    await vi.waitFor(() => expect(getExpressionAdmissionStats().active).toBe(2));

    const extras = [1, 2, 3].map(() => runWithAdmission({}, blocking).then(() => 'ran', (error) => error));
    expect(getExpressionAdmissionStats().queueDepth).toBe(3);

    const outcomes = await Promise.all(extras);
    for (const outcome of outcomes) {
      expect(outcome).toBeInstanceOf(EvaluationBusyError);
      expect((outcome as EvaluationBusyError).status).toBe(429);
      expect((outcome as EvaluationBusyError).retryAfterSeconds).toBeGreaterThanOrEqual(1);
    }
    expect(maxInside).toBe(2);
    expect(getExpressionAdmissionStats().busyRejections).toBe(3);
    expect(events.filter((event) => event.type === 'busy')).toHaveLength(3);

    release.open();
    await Promise.all(holders);
    expect(getExpressionAdmissionStats()).toMatchObject({ active: 0, queueDepth: 0 });
  });

  it('hands a freed slot to the oldest waiter', async () => {
    resetExpressionAdmission({ maxConcurrency: 1, queueTimeoutMs: 1_000 });
    const first = gate();
    const order: string[] = [];
    const a = runWithAdmission({}, async () => {
      await first.promise;
      order.push('a');
    });
    await vi.waitFor(() => expect(getExpressionAdmissionStats().active).toBe(1));
    const b = runWithAdmission({}, async () => void order.push('b'));
    const c = runWithAdmission({}, async () => void order.push('c'));
    expect(getExpressionAdmissionStats().queueDepth).toBe(2);
    first.open();
    await Promise.all([a, b, c]);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(getExpressionAdmissionStats().active).toBe(0);
  });

  describe('slot release', () => {
    it('after a step-budget error', async () => {
      const looping = compileExpression({ $expr: LONG_LEGAL });
      await expect(
        evaluateWorkflowExpression(looping, { payload: { items: manyItems(2_000) } })
      ).rejects.toMatchObject({ name: 'EvaluationBudgetExceededError', kind: 'steps' });
      expect(getExpressionAdmissionStats().active).toBe(0);
    });

    it('after a parse error', async () => {
      await expect(evaluateWorkflowExpression('payload.(', {})).rejects.toBeDefined();
      expect(getExpressionAdmissionStats().active).toBe(0);
    });

    it('after a wall-deadline abort', async () => {
      let tick = 0;
      await expect(
        evaluateWorkflowExpression(LONG_LEGAL, { payload: { items: manyItems(200) } }, {
          limits: { wallBudgetMs: 5, now: () => (tick += 1) },
        })
      ).rejects.toMatchObject({ name: 'EvaluationBudgetExceededError', kind: 'wall' });
      expect(getExpressionAdmissionStats().active).toBe(0);
    });

    it('when the caller aborts mid-evaluation', async () => {
      const controller = new AbortController();
      controller.abort(new EvaluationBudgetExceededError('stop', 'aborted'));
      await expect(
        evaluateWorkflowExpression(LONG_LEGAL, { payload: { items: manyItems(50) } }, { signal: controller.signal })
      ).rejects.toBeInstanceOf(EvaluationBudgetExceededError);
      expect(getExpressionAdmissionStats().active).toBe(0);
    });

    it('lets queued waiters in after a failed holder', async () => {
      resetExpressionAdmission({ maxConcurrency: 1, queueTimeoutMs: 1_000 });
      const failing = runWithAdmission({}, async () => {
        throw new Error('boom');
      });
      const next = runWithAdmission({}, async () => 'ok');
      await expect(failing).rejects.toThrow('boom');
      await expect(next).resolves.toBe('ok');
      expect(getExpressionAdmissionStats().active).toBe(0);
    });
  });

  describe('reentrancy', () => {
    it('a nested evaluation reuses the outer slot instead of deadlocking at concurrency 1', async () => {
      resetExpressionAdmission({ maxConcurrency: 1, queueTimeoutMs: 30 });
      const result = await runWithAdmission({}, async () => {
        expect(getExpressionAdmissionStats().active).toBe(1);
        const inner = await evaluateWorkflowExpression('1 + 1', {});
        const deeper = await runWithAdmission({}, () => evaluateWorkflowExpression('2 + 2', {}));
        expect(getExpressionAdmissionStats().active).toBe(1);
        return [inner, deeper];
      });
      expect(result).toEqual([2, 4]);
      expect(getExpressionAdmissionStats()).toMatchObject({ active: 0, acquired: 1, busyRejections: 0 });
    });

    it('does not treat a released slot as held', async () => {
      resetExpressionAdmission({ maxConcurrency: 1, queueTimeoutMs: 30 });
      let escaped!: () => Promise<number>;
      await runWithAdmission({}, async () => {
        escaped = async () => (await evaluateWorkflowExpression('1 + 1', {})) as number;
      });
      // The outer slot is gone; the orphan must queue for its own slot.
      const blocker = gate();
      const holder = runWithAdmission({}, () => blocker.promise);
      await vi.waitFor(() => expect(getExpressionAdmissionStats().active).toBe(1));
      await expect(runWithAdmission({}, async () => escaped())).rejects.toBeInstanceOf(EvaluationBusyError);
      blocker.open();
      await holder;
    });
  });

  describe('deadline', () => {
    it('stops a legal, under-step-budget expression on the wall deadline with the budget error type', async () => {
      let clock = 0;
      const error: any = await evaluateWorkflowExpression(LONG_LEGAL, { payload: { items: manyItems(500) } }, {
        limits: { wallBudgetMs: 10, now: () => (clock += 1) },
      }).catch((e: any) => e);
      expect(error).toBeInstanceOf(EvaluationBudgetExceededError);
      expect(error.kind).toBe('wall');
      expect(error.message).toMatch(/budget exceeded/);
    });

    it('stops it on the CPU budget', async () => {
      let cpu = 0;
      const error: any = await evaluateWorkflowExpression(LONG_LEGAL, { payload: { items: manyItems(500) } }, {
        limits: { cpuBudgetMs: 250, cpuNow: () => (cpu += 100) },
      }).catch((e: any) => e);
      expect(error).toBeInstanceOf(EvaluationBudgetExceededError);
      expect(error.kind).toBe('cpu');
    });

    it('counts deadline overruns and lets in-budget evaluations through', async () => {
      let clock = 0;
      await evaluateWorkflowExpression(LONG_LEGAL, { payload: { items: manyItems(500) } }, {
        limits: { wallBudgetMs: 10, now: () => (clock += 1) },
      }).catch(() => undefined);
      expect(getExpressionAdmissionStats().deadlineExceeded).toBe(1);
      await expect(evaluateWorkflowExpression('1 + 1', {})).resolves.toBe(2);
    });
  });

  describe('parent guard regression', () => {
    it('a looping expression still ends through the step budget (default limits)', async () => {
      await expect(
        evaluateWorkflowExpression(LONG_LEGAL, { payload: { items: manyItems(4_000) } })
      ).rejects.toThrow(/execution budget exceeded/);
    });

    it('fails closed before admission when the evaluate hooks are silent', async () => {
      vi.resetModules();
      vi.doMock('jsonata', async () => {
        const real = (await vi.importActual<{ default: (...args: unknown[]) => any }>('jsonata')).default;
        const silent = (...args: unknown[]) => {
          const expression = real(...args);
          const assign = expression.assign.bind(expression);
          // drop the budget hooks, keep everything else
          expression.assign = (name: unknown, value: unknown) => (typeof name === 'symbol' ? undefined : assign(name, value));
          return expression;
        };
        return { default: silent };
      });
      try {
        const engine = await import('../expressionEngine');
        engine.resetExpressionAdmission({ maxConcurrency: 2, queueTimeoutMs: 40 });
        await expect(engine.evaluateWorkflowExpression('1 + 1', {})).rejects.toThrow(/budget enforcement is inactive/i);
        await expect(engine.compileExpression({ $expr: '1 + 1' }).evaluate({})).rejects.toThrow(/budget enforcement is inactive/i);
        expect(engine.getExpressionAdmissionStats()).toMatchObject({ active: 0, acquired: 0 });
      } finally {
        vi.doUnmock('jsonata');
        vi.resetModules();
      }
    });
  });
});
