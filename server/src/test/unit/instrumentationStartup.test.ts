import { afterEach, describe, expect, it, vi } from 'vitest';

const initializeApp = vi.hoisted(() => vi.fn());

vi.mock('../../lib/telemetry/initialization', () => ({
  initializeTelemetry: vi.fn(),
}));

vi.mock('../../lib/initializeApp', () => ({
  initializeApp,
}));

describe('Next server instrumentation startup', () => {
  const originalRuntime = process.env.NEXT_RUNTIME;
  const originalSkip = process.env.E2E_SKIP_APP_INIT;

  afterEach(() => {
    if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = originalRuntime;
    if (originalSkip === undefined) delete process.env.E2E_SKIP_APP_INIT;
    else process.env.E2E_SKIP_APP_INIT = originalSkip;
    vi.resetModules();
    initializeApp.mockReset();
  });

  it('rejects startup when critical application initialization fails', async () => {
    const initializationError = new Error('Credential vault encryption key is not configured');
    initializeApp.mockRejectedValue(initializationError);
    process.env.NEXT_RUNTIME = 'nodejs';
    delete process.env.E2E_SKIP_APP_INIT;

    const { register } = await import('../../instrumentation');

    await expect(register()).rejects.toBe(initializationError);
  });
});
