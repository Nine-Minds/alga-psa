import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { DockerServiceManager } from '../../e2e/utils/docker-service-manager';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('legacy email workflow processing wait', () => {
  it('fails when the worker remains healthy but reports no processed events', async () => {
    vi.useFakeTimers();
    vi.mocked(axios.get).mockResolvedValue({ data: { eventsProcessed: 0 } });
    const result = expect(new DockerServiceManager().waitForWorkflowProcessing(3000)).rejects.toThrow('Workflow processing was not observed');
    await vi.advanceTimersByTimeAsync(3000);
    await result;
  });

  it('fails when the worker remains unreachable', async () => {
    vi.useFakeTimers();
    vi.mocked(axios.get).mockRejectedValue(new Error('connection refused'));
    const result = expect(new DockerServiceManager().waitForWorkflowProcessing(2000)).rejects.toThrow('Workflow processing was not observed');
    await vi.advanceTimersByTimeAsync(2000);
    await result;
  });

  it('completes after the worker reports processing', async () => {
    vi.useFakeTimers();
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { eventsProcessed: 0 } })
      .mockResolvedValueOnce({ data: { eventsProcessed: 1 } });
    const result = new DockerServiceManager().waitForWorkflowProcessing(3000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toBeUndefined();
    expect(axios.get).toHaveBeenCalledTimes(2);
  });
});
