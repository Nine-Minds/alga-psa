import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  inboundErrorMessage,
  recordInboundDiagnostic,
  summarizeInboundError,
} from '../../../../../shared/services/email/inboundErrorDiagnostics';
import {
  CoManagedSharedWorkError,
  isCoManagedSharedWorkError,
} from '../../../../../packages/co-managed/src/sharedWorkIdentity';

/**
 * CF002-CF004. CI run 35492001110, Integration shard 1, reported
 * `Failed to fully serialize error: Maximum call stack size exceeded` in place
 * of the exception that collapsed a `defer` into a `retry`. These cases pin the
 * two properties that failure needs: error reporting is finite, and lifecycle /
 * shared-work classification survives a separately compiled module boundary.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('inbound error diagnostics are finite', () => {
  it('does not recurse on a self-referential cause chain', () => {
    const error = new Error('outer') as Error & { cause?: unknown };
    error.cause = error;
    expect(() => summarizeInboundError(error)).not.toThrow();
    const summary = summarizeInboundError(error);
    expect(summary.name).toBe('Error');
    expect(summary.cause).toBe('Error||outer');
  });

  it('does not recurse on a long cause chain', () => {
    let error: Error & { cause?: unknown } = new Error('root');
    for (let i = 0; i < 20_000; i += 1) {
      const next = new Error(`level-${i}`) as Error & { cause?: unknown };
      next.cause = error;
      error = next;
    }
    const summary = summarizeInboundError(error);
    expect(summary.message).toBe('level-19999');
    // One level only: the summary of the direct cause, not a walk to the root.
    expect(summary.cause).toBe('Error||level-19998');
  });

  it('never carries a knex-style query client, sql or bindings into the summary', () => {
    // knex mutates the thrown error in place (execution/runner.js), so a pg
    // error arriving here can already hold `sql` and `bindings`, and bindings
    // can hold arbitrary values passed into the query.
    const secret = { password: 'hunter2', client: { pool: {} as unknown } };
    const error = Object.assign(new Error('insert into "comments" failed'), {
      code: '23505',
      sql: 'insert into "comments" ...',
      bindings: [secret],
      client: secret.client,
    });
    const summary = summarizeInboundError(error);
    // `frames` is the only non-scalar field, and it is a bounded string list
    // read from `error.stack` -- never from `sql`, `bindings` or `client`.
    // This is an exact-shape assertion on purpose: it is the guard that a new
    // field cannot be added to the summary without someone confirming it is a
    // primitive and cannot carry a query client or a credential.
    expect(summary).toEqual({
      name: 'Error',
      code: '23505',
      message: 'insert into "comments" failed',
      cause: null,
      frames: expect.any(Array),
      framesUnavailable: null,
    });
    expect(summary.frames.every(frame => typeof frame === 'string')).toBe(true);
    expect(JSON.stringify(summary)).not.toContain('hunter2');
    expect(JSON.stringify(summary)).not.toContain('bindings');
    expect(JSON.stringify(summary)).not.toContain('insert into \\"comments\\" ...');
  });

  it('bounds an enormous message instead of passing it through', () => {
    const summary = summarizeInboundError(new Error('x'.repeat(50_000)));
    expect(summary.message.length).toBeLessThanOrEqual(2001);
    expect(summary.message.endsWith('…')).toBe(true);
  });

  it('always yields a plain string message, whatever was thrown', () => {
    // A disposition carries this value and markRetryable persists it, so a
    // non-string `message` would put a walkable graph in both places.
    for (const thrown of [
      new Error('plain'),
      'a bare string',
      { message: { nested: { deeper: {} } } },
      { message: '' },
      null,
      undefined,
      42,
      Object.assign(new Error('x'), { message: undefined }),
    ]) {
      expect(typeof inboundErrorMessage(thrown)).toBe('string');
    }
    // Existing sentinel comparisons and persisted provenance are unchanged.
    expect(inboundErrorMessage(new Error('inbox_fence_superseded'))).toBe('inbox_fence_superseded');
  });

  it('survives a thrown value whose toString throws', () => {
    const hostile = { toString() { throw new Error('nope'); } };
    expect(inboundErrorMessage(hostile)).toBe('unserializable_error');
  });

  it('logs one line of primitives and nothing else', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    recordInboundDiagnostic('rollback', { tenant: 't1', inboxId: 'i1', claimed: true },
      Object.assign(new Error('boom'), { code: 'X1', bindings: [{ password: 'hunter2' }] }));

    expect(warn).toHaveBeenCalledTimes(1);
    const [prefix, line] = warn.mock.calls[0] as [string, string];
    expect(prefix).toBe('[inbound-email-diagnostic]');
    const parsed = JSON.parse(line);
    expect(parsed).toEqual({
      stage: 'rollback', tenant: 't1', inboxId: 'i1', claimed: true,
      errorName: 'Error', errorCode: 'X1', errorMessage: 'boom', errorCause: null,
      errorFrames: expect.any(Array),
    });
    expect(line).not.toContain('hunter2');
    // Scalars, null, or the one bounded list of frame strings. Nothing else may
    // reach a reporter from here.
    for (const [key, value] of Object.entries(parsed)) {
      if (key === 'errorFrames') {
        expect(Array.isArray(value)).toBe(true);
        expect((value as unknown[]).length).toBeLessThanOrEqual(14);
        expect((value as unknown[]).every(frame => typeof frame === 'string')).toBe(true);
        continue;
      }
      expect(['string', 'number', 'boolean', 'object']).toContain(typeof value);
      if (typeof value === 'object') expect(value).toBeNull();
    }
  });

  it('omits the error fields entirely when no error is supplied', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    recordInboundDiagnostic('disposition', { tenant: 't1', disposition: 'retry' });
    expect(JSON.parse((warn.mock.calls[0] as [string, string])[1]))
      .toEqual({ stage: 'disposition', tenant: 't1', disposition: 'retry' });
  });
});

describe('stack frames are captured, bounded, and name the recursion site', () => {
  it('captures the topmost frames of a real stack overflow', () => {
    // The exact shape CI reported at fb2e696645: the first exception inside the
    // commit transaction was a RangeError, and name/code/message alone cannot
    // say where it recursed.
    const overflow = (() => {
      const recurse = (): never => recurse();
      try { return recurse(); } catch (error) { return error; }
    })();

    const summary = summarizeInboundError(overflow);
    expect(summary.name).toBe('RangeError');
    expect(summary.message).toContain('Maximum call stack size exceeded');
    expect(summary.frames.length).toBeGreaterThan(0);
    expect(summary.frames.length).toBeLessThanOrEqual(14);
    expect(summary.frames.every(frame => frame.startsWith('at '))).toBe(true);
    // The repeating frame is what identifies the cycle.
    expect(summary.frames.some(frame => frame.includes('recurse'))).toBe(true);
  });

  it('keeps at most MAX_FRAMES even from a stack far deeper than V8 records by default', () => {
    // V8's default Error.stackTraceLimit is 10, so a real overflow never
    // reaches the ceiling. A stack assembled by hand (or a raised limit) does,
    // and the ceiling is what keeps an overflow stack out of the reporter.
    const error = new Error('deep');
    error.stack = ['Error: deep', ...Array.from({ length: 500 }, (_, i) => `    at frame${i} (/tmp/a.ts:${i}:1)`)].join('\n');
    const { frames } = summarizeInboundError(error);
    expect(frames).toHaveLength(14);
    expect(frames[0]).toBe('at frame0 (/tmp/a.ts:0:1)');
    expect(frames[13]).toBe('at frame13 (/tmp/a.ts:13:1)');
  });

  it('bounds an individual frame instead of passing it through', () => {
    const error = new Error('boom');
    error.stack = `Error: boom\n    at ${'x'.repeat(5000)} (/tmp/a.ts:1:1)`;
    const [frame] = summarizeInboundError(error).frames;
    expect(frame.length).toBeLessThanOrEqual(201);
  });

  it('never lets a hostile or absent stack throw or leak', () => {
    const hostile = { name: 'Weird', message: 'nope' };
    Object.defineProperty(hostile, 'stack', { get() { throw new Error('no stack for you'); } });
    expect(summarizeInboundError(hostile).frames).toEqual([]);
    expect(summarizeInboundError({ message: 'plain' }).frames).toEqual([]);
    expect(summarizeInboundError('a string').frames).toEqual([]);
  });

  it('omits the frame field entirely when there are no frames', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    recordInboundDiagnostic('rollback', { tenant: 't1' }, { message: 'no stack here' });
    const payload = JSON.parse((warn.mock.calls[0] as [string, string])[1]);
    expect(payload).not.toHaveProperty('errorFrames');
  });
});

describe('shared-work classification survives a separately compiled copy', () => {
  it('matches the error contract rather than the constructor', () => {
    // What a second compiled copy of packages/co-managed produces: identical
    // contract, different constructor. `instanceof` reports false for it.
    const fromOtherBundle = Object.assign(new Error('This shared resource is not available for the requested operation.'), {
      name: 'CoManagedSharedWorkError',
      code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN',
    });

    expect(fromOtherBundle instanceof CoManagedSharedWorkError).toBe(false);
    expect(isCoManagedSharedWorkError(fromOtherBundle)).toBe(true);
    expect(isCoManagedSharedWorkError(new CoManagedSharedWorkError())).toBe(true);
  });

  it('does not admit look-alikes that fail the contract', () => {
    expect(isCoManagedSharedWorkError(new Error('nope'))).toBe(false);
    expect(isCoManagedSharedWorkError(null)).toBe(false);
    expect(isCoManagedSharedWorkError('CoManagedSharedWorkError')).toBe(false);
    expect(isCoManagedSharedWorkError({ name: 'CoManagedSharedWorkError' })).toBe(false);
    expect(isCoManagedSharedWorkError({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' })).toBe(false);
    // An authorization rejection must not be confused with a lifecycle pause:
    // they have different dispositions (quarantine vs defer).
    expect(isCoManagedSharedWorkError({
      name: 'CoManagedLifecycleError', code: 'CO_MANAGED_READ_ONLY',
      lifecycle: { state: 'read_only', canWrite: false, graceEndsAt: null },
    })).toBe(false);
  });
});

describe('an empty frame list says why it is empty', () => {
  // Run 35524282543 emitted all three stages with `RangeError: Maximum call
  // stack size exceeded` and no `errorFrames` key at all. An absent key was
  // consistent with four different failures of `error.stack` that call for
  // four different next steps, so the round could not act on it. Each branch
  // now names itself.

  it('distinguishes a stack getter that throws from a stack that is merely absent', () => {
    const hostile = { name: 'Weird', message: 'nope' };
    Object.defineProperty(hostile, 'stack', { get() { throw new RangeError('Maximum call stack size exceeded'); } });
    // The branch that matters: reading `.stack` is itself what failed.
    expect(summarizeInboundError(hostile).framesUnavailable).toBe('stack_getter_threw:RangeError');
    // ...which is a different fact from there being no stack to read.
    expect(summarizeInboundError({ message: 'plain' }).framesUnavailable).toBe('stack_absent:undefined');
    expect(summarizeInboundError('a string').framesUnavailable).toBe('stack_absent:undefined');
  });

  it('distinguishes an empty stack from a stack that carried no frame lines', () => {
    const empty = new Error('boom'); empty.stack = '';
    expect(summarizeInboundError(empty).framesUnavailable).toBe('stack_empty');
    const messageOnly = new Error('boom'); messageOnly.stack = 'Error: boom';
    // Length is reported so the next reader knows text existed without the
    // text itself reaching a reporter.
    expect(summarizeInboundError(messageOnly).framesUnavailable).toBe('no_frame_lines:11');
  });

  it('reports null when frames were actually read', () => {
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at frame0 (/tmp/a.ts:1:1)';
    const summary = summarizeInboundError(error);
    expect(summary.frames).toEqual(['at frame0 (/tmp/a.ts:1:1)']);
    expect(summary.framesUnavailable).toBeNull();
  });

  it('emits errorFramesUnavailable and the stack trace limit instead of a silent omission', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    recordInboundDiagnostic('rollback', { tenant: 't1' }, { message: 'no stack here' });
    const payload = JSON.parse((warn.mock.calls[0] as [string, string])[1]);
    expect(payload).not.toHaveProperty('errorFrames');
    // The regression: an absent `errorFrames` must never again be the only
    // thing the log says about a missing stack.
    expect(payload.errorFramesUnavailable).toBe('stack_absent:undefined');
    // A limit of 0 would make every stack empty and would explain the whole
    // observation on its own, so it is always reported alongside the failure.
    expect(payload.stackTraceLimit).toBe(Error.stackTraceLimit);
    warn.mockRestore();
  });
});

describe('an error can be described without reading its stack', () => {
  // `withAdminTransaction` reads `error.stack` in its catch before rethrowing.
  // A boundary placed to observe the error *before* that read must not perform
  // the same read, or it destroys what it exists to observe.

  it('never touches the stack getter when readStack is false', () => {
    let reads = 0;
    const error = Object.assign(new Error('Workspace became read-only'), {
      name: 'CoManagedLifecycleError', code: 'CO_MANAGED_READ_ONLY',
      lifecycle: { state: 'read_only', canWrite: false, graceEndsAt: null },
    });
    Object.defineProperty(error, 'stack', { get() { reads += 1; throw new RangeError('Maximum call stack size exceeded'); } });

    const summary = summarizeInboundError(error, { readStack: false });
    expect(reads).toBe(0);
    expect(summary.framesUnavailable).toBe('stack_not_read');
    // The identity still survives, which is the whole point: this is what
    // discriminates "the transaction raised a lifecycle error and something
    // downstream replaced it" from "the transaction really did overflow".
    expect(summary.name).toBe('CoManagedLifecycleError');
    expect(summary.code).toBe('CO_MANAGED_READ_ONLY');
    expect(summary.message).toBe('Workspace became read-only');
  });

  it('still reads the stack by default, so the option cannot silently disable diagnostics', () => {
    let reads = 0;
    const error = new Error('boom');
    Object.defineProperty(error, 'stack', {
      get() { reads += 1; return 'Error: boom\n    at frame0 (/tmp/a.ts:1:1)'; },
    });
    expect(summarizeInboundError(error).frames).toEqual(['at frame0 (/tmp/a.ts:1:1)']);
    expect(reads).toBe(1);
  });

  it('records a commit_body stage without reading the stack', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let reads = 0;
    const error = Object.assign(new Error('Workspace became read-only'), {
      name: 'CoManagedLifecycleError', code: 'CO_MANAGED_READ_ONLY',
    });
    Object.defineProperty(error, 'stack', { get() { reads += 1; return 'Error: x\n    at y (/tmp/a.ts:1:1)'; } });
    recordInboundDiagnostic('commit_body', { tenant: 't1', classifiedAsLifecycle: false }, error, { readStack: false });
    const payload = JSON.parse((warn.mock.calls[0] as [string, string])[1]);
    expect(reads).toBe(0);
    expect(payload.stage).toBe('commit_body');
    expect(payload.errorName).toBe('CoManagedLifecycleError');
    expect(payload).not.toHaveProperty('errorFrames');
    expect(payload.errorFramesUnavailable).toBe('stack_not_read');
    warn.mockRestore();
  });
});
