import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The runner boundary must never surface upstream response bodies through its
 * error messages, because those messages reach gateway console logs. A
 * distinctive marker placed in a runner body must stay out of both the thrown
 * error and every log line.
 */
const MARKER = 'UPSTREAM-MARKER-SECRET-BODY';

const ENV_KEYS = ['RUNNER_BACKEND', 'RUNNER_BASE_URL', 'RUNNER_SERVICE_TOKEN', 'RUNNER_PUBLIC_BASE'];

function stubRunnerEnv(): void {
  process.env.RUNNER_BACKEND = 'knative';
  process.env.RUNNER_BASE_URL = 'http://runner.test';
  delete process.env.RUNNER_SERVICE_TOKEN;
  delete process.env.RUNNER_PUBLIC_BASE;
}

function jsonResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

describe('extension runner backend log hygiene', () => {
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('does not embed a non-success response body in the transport error message or in logs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(500, JSON.stringify({ error: MARKER }))),
    );
    stubRunnerEnv();

    const logs: string[] = [];
    const logSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => logs.push(args.map(String).join(' ')));
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => logs.push(args.map(String).join(' ')));

    const { getRunnerBackend } = await import('../runner-backend');
    const backend = getRunnerBackend();

    let thrown: Error | undefined;
    try {
      await backend.execute({}, { requestId: 'req-1', timeoutMs: 1000 });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown?.name).toBe('RunnerRequestError');
    expect(thrown?.message).toContain('500');
    expect(thrown?.message).not.toContain(MARKER);
    expect(logs.join('\n')).not.toContain(MARKER);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('does not embed the invalid-JSON body in the parse error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, `${MARKER}-not-json`)));
    stubRunnerEnv();

    const { getRunnerBackend } = await import('../runner-backend');
    const backend = getRunnerBackend();

    let thrown: Error | undefined;
    try {
      await backend.execute({}, { requestId: 'req-2', timeoutMs: 1000 });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown?.name).toBe('RunnerRequestError');
    expect(thrown?.message).toContain('invalid JSON');
    expect(thrown?.message).not.toContain(MARKER);
  });
});
