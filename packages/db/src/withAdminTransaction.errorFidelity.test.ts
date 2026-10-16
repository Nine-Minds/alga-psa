/**
 * CF002. `withAdminTransaction`'s failure handler must describe the error it is
 * given without ever becoming the error the caller receives.
 *
 * The handler logs `error.stack`. That is a lazy getter: V8 formats the trace on
 * first access, and under vite-node a source-mapping `prepareStackTrace` runs at
 * that moment and itself consumes stack, so the read can raise a *second* error
 * precisely when the stack is already deep. The read sat unguarded inside the
 * catch block, so the getter's throw propagated in place of the `throw error`
 * below it, and the caller received `RangeError: Maximum call stack size
 * exceeded` instead of the exception the transaction body raised.
 *
 * Measured on CI run 35534035281, integration shard 1, job 106141697370: the
 * `commit_body` diagnostic taken *inside* the callback reports
 * `CoManagedLifecycleError` / `CO_MANAGED_READ_ONLY` with
 * `classifiedAsLifecycle: true`, and the very next stage reports `RangeError`.
 * A requester lifecycle pause that must `defer` therefore returned `retry`,
 * because the disposition handler could no longer recognise the error.
 *
 * These cases fail if the guard is removed.
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

describe('withAdminTransaction error fidelity', () => {
  it('delivers the body\'s error even when reading its stack throws', async () => {
    const raised = errorWithHostileStack(
      'CoManagedLifecycleError',
      'Workspace became read-only',
      'CO_MANAGED_READ_ONLY',
    );

    const caught = await withAdminTransaction(async () => {
      throw raised;
    }, fakeTransaction()).then(() => null, (error: unknown) => error);

    // Identity, not just shape: the caller must receive the very object the
    // body raised, so downstream duck-typed classification still matches.
    expect(caught).toBe(raised);
    expect((caught as Error).name).toBe('CoManagedLifecycleError');
    expect((caught as { code?: string }).code).toBe('CO_MANAGED_READ_ONLY');
    // The substitution this test exists to prevent.
    expect((caught as Error).name).not.toBe('RangeError');
  });

  it('is not specific to lifecycle errors: an ordinary error survives too', async () => {
    // Shard 1 showed the same substitution over a plain Error, so the guard is
    // a general property of the wrapper, not a co-managed special case.
    const raised = errorWithHostileStack('Error', 'insert into "comments" failed');

    const caught = await withAdminTransaction(async () => {
      throw raised;
    }, fakeTransaction()).then(() => null, (error: unknown) => error);

    expect(caught).toBe(raised);
    expect((caught as Error).message).toBe('insert into "comments" failed');
  });

  it('still reports the failure, naming the unreadable stack rather than omitting it', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const raised = errorWithHostileStack('Error', 'boom');

    await withAdminTransaction(async () => {
      throw raised;
    }, fakeTransaction()).catch(() => {});

    // Guarding the read must not silence the diagnostic: a failure to describe
    // the error is itself worth saying.
    const logged = errorSpy.mock.calls.find(([first]) =>
      typeof first === 'string' && first.includes('Transaction failed'));
    expect(logged).toBeDefined();
    expect(String((logged as unknown[])[1] && (logged as [string, { stack?: string }])[1].stack))
      .toContain('reading error.stack threw');
  });

  it('a readable stack is still logged verbatim', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const raised = new Error('ordinary failure');
    Object.defineProperty(raised, 'stack', { value: 'Error: ordinary failure\n    at somewhere (/app/x.ts:1:1)' });

    await withAdminTransaction(async () => {
      throw raised;
    }, fakeTransaction()).catch(() => {});

    const logged = errorSpy.mock.calls.find(([first]) =>
      typeof first === 'string' && first.includes('Transaction failed'));
    expect((logged as [string, { stack?: string }])[1].stack).toContain('at somewhere (/app/x.ts:1:1)');
  });
});
