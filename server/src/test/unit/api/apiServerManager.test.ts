import { afterEach, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { ensureApiServerRunning } from '../../e2e/utils/apiServerManager';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => { throw new Error('Unexpected application replacement'); }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it('accepts a healthy owned application without starting a replacement server', async () => {
  vi.stubEnv('E2E_DATABASE_ISOLATED', 'true');
  const fetch = vi.fn().mockResolvedValue(new Response('ready', { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  await ensureApiServerRunning('http://127.0.0.1:3000/');
  expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:3000/api/health');
  expect(spawn).not.toHaveBeenCalled();
});

it.each(['unhealthy', 'unreachable'])('fails when the owned application is %s without falling back to other code', async (state) => {
  vi.stubEnv('E2E_DATABASE_ISOLATED', 'true');
  const fetch = state === 'unhealthy'
    ? vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }))
    : vi.fn().mockRejectedValue(new Error('Connection refused'));
  vi.stubGlobal('fetch', fetch);
  await expect(ensureApiServerRunning('http://127.0.0.1:3000'))
    .rejects.toThrow('Owned API application is not ready');
  expect(spawn).not.toHaveBeenCalled();
});
