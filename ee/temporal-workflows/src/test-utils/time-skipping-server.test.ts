import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import type { TestProject } from 'vitest/node';

// Only this file's import of the global setup sees the mock; the real setup
// runs in the vitest main process and provisions the server checked below.
const { createTimeSkipping } = vi.hoisted(() => ({ createTimeSkipping: vi.fn() }));
vi.mock('@temporalio/testing', () => ({ TestWorkflowEnvironment: { createTimeSkipping } }));

import provisionTimeSkippingServer from './time-skipping-server.global-setup';

describe('time-skipping test server provisioning', () => {
  it('is cached locally before any engine test creates an environment', () => {
    expect(inject('temporalTimeSkippingServerProvisioned')).toBe(true);
    const cached = readdirSync(tmpdir()).filter((file) => file.startsWith('temporal-test-server-sdk-typescript-'));
    expect(cached).not.toHaveLength(0);
  });
});

function fakeProject() {
  return { provide: vi.fn() } as unknown as TestProject & { provide: ReturnType<typeof vi.fn> };
}

describe('provisionTimeSkippingServer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    createTimeSkipping.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries a test-server download whose body was truncated mid-transfer', async () => {
    const teardown = vi.fn().mockResolvedValue(undefined);
    createTimeSkipping
      .mockRejectedValueOnce(
        new Error(
          'Failed to start ephemeral server: error decoding response body: error reading a body from connection: end of file before message length reached',
        ),
      )
      .mockResolvedValueOnce({ teardown });
    const project = fakeProject();

    const provisioned = provisionTimeSkippingServer(project);
    await vi.runAllTimersAsync();
    await provisioned;

    expect(createTimeSkipping).toHaveBeenCalledTimes(2);
    expect(teardown).toHaveBeenCalledOnce();
    expect(project.provide).toHaveBeenCalledWith('temporalTimeSkippingServerProvisioned', true);
  });

  it('fails immediately on an error that is not transport-shaped', async () => {
    createTimeSkipping.mockRejectedValue(new Error('Failed to start ephemeral server: permission denied'));
    const project = fakeProject();

    await expect(provisionTimeSkippingServer(project)).rejects.toThrow('permission denied');
    expect(createTimeSkipping).toHaveBeenCalledTimes(1);
    expect(project.provide).not.toHaveBeenCalled();
  });
});
