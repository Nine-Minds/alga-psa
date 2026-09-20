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
    expect(summary).toEqual({
      name: 'Error',
      code: '23505',
      message: 'insert into "comments" failed',
      cause: null,
    });
    expect(JSON.stringify(summary)).not.toContain('hunter2');
    expect(JSON.stringify(summary)).not.toContain('bindings');
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
    });
    for (const value of Object.values(parsed)) {
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
