/**
 * `withAdminTransaction`'s failure handler must describe the error it is given
 * without ever becoming the error the caller receives.
 *
 * The handler logs `error.stack`. That is a lazy getter: V8 formats the trace on
 * first access, and under vite-node a source-mapping `prepareStackTrace` runs at
 * that moment and itself consumes stack, so the read can raise a *second* error
 * precisely when the stack is already deep. When the read is unguarded inside the
 * catch block, the getter's throw propagates in place of the `throw error` below
 * it, and the caller receives `RangeError: Maximum call stack size exceeded`
 * instead of the exception the transaction body raised.
 *
 * These cases fail if the guard (`describeError`) is removed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./lib/admin', () => ({ getAdminConnection: vi.fn() }));

let withAdminTransaction: typeof import('./index')['withAdminTransaction'];

beforeEach(async () => {
  vi.resetModules();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  ({ withAdminTransaction } = await import('./index'));
});

afterEach(() => vi.restoreAllMocks());

/** A transaction-shaped object good enough for the existing-transaction branch. */
const fakeTransaction = () => ({ commit: vi.fn(), rollback: vi.fn() }) as never;

/**
 * An error whose `stack` getter throws, exactly as V8's does when the stack is
 * exhausted at the moment of the read.
 */
function errorWithHostileStack(name: string, message: string, code?: string): Error {
  const error = new Error(message);
  error.name = name;
  if (code) Object.assign(error, { code });
  Object.defineProperty(error, 'stack', {
    configurable: true,
    get() {
      const thrown = new Error('Maximum call stack size exceeded');
      thrown.name = 'RangeError';
      throw thrown;
    },
  });
  return error;
}

const caughtFrom = (body: () => Promise<unknown>) =>
  withAdminTransaction(body, fakeTransaction()).then(() => null, (error: unknown) => error);

describe('withAdminTransaction error fidelity', () => {
  it("delivers the body's error (same object) even when reading its stack throws", async () => {
    const raised = errorWithHostileStack('DomainError', 'Workspace became read-only', 'READ_ONLY');

    const caught = await caughtFrom(async () => {
      throw raised;
    });

    // Identity, not just shape: downstream duck-typed classification must still match.
    expect(caught).toBe(raised);
    expect((caught as Error).name).toBe('DomainError');
    expect((caught as { code?: string }).code).toBe('READ_ONLY');
    expect((caught as Error).name).not.toBe('RangeError');
  });

  it('an ordinary error survives too', async () => {
    const raised = errorWithHostileStack('Error', 'insert into "comments" failed');

    const caught = await caughtFrom(async () => {
      throw raised;
    });

    expect(caught).toBe(raised);
    expect((caught as Error).message).toBe('insert into "comments" failed');
  });

  it('a non-Error rejection is passed through untouched', async () => {
    const raised = { code: 'X', toString: () => { throw new Error('hostile toString'); } };

    const caught = await caughtFrom(async () => {
      throw raised;
    });

    expect(caught).toBe(raised);
  });

  it('still reports the failure when the stack is unreadable', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const raised = errorWithHostileStack('Error', 'boom');

    await caughtFrom(async () => {
      throw raised;
    });

    const logged = errorSpy.mock.calls.find(([first]) =>
      typeof first === 'string' && first.includes('Transaction failed'));
    expect(logged).toBeDefined();
    expect(String((logged as [string, { error?: string }])[1].error)).toContain('boom');
  });

  it('a readable stack is still logged verbatim', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const raised = new Error('ordinary failure');
    Object.defineProperty(raised, 'stack', { value: 'Error: ordinary failure\n    at somewhere (/app/x.ts:1:1)' });

    await caughtFrom(async () => {
      throw raised;
    });

    const logged = errorSpy.mock.calls.find(([first]) =>
      typeof first === 'string' && first.includes('Transaction failed'));
    expect((logged as [string, { stack?: string }])[1].stack).toContain('at somewhere (/app/x.ts:1:1)');
  });
});
