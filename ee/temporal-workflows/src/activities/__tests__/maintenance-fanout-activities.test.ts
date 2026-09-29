import { beforeEach, describe, expect, it, vi } from 'vitest';

const publishEventMock = vi.fn();

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: (...args: unknown[]) => publishEventMock(...args),
}));

import { runMaintenanceJobActivity } from '../maintenance-fanout-activities';

describe('runMaintenanceJobActivity', () => {
  beforeEach(() => {
    publishEventMock.mockReset().mockResolvedValue(undefined);
  });

  it('reports publication success independently of later replenishment execution', async () => {
    const result = await runMaintenanceJobActivity({
      jobName: 'replenishContractCadenceServicePeriods',
    });

    // The activity only publishes the request; whether the sweep later succeeds
    // or partially fails is reported by the server-side runMaintenanceJob result,
    // not by this return value.
    expect(result).toEqual({
      jobName: 'replenishContractCadenceServicePeriods',
      requested: true,
    });
    expect(publishEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'MAINTENANCE_JOB_REQUESTED',
        payload: expect.objectContaining({
          jobName: 'replenishContractCadenceServicePeriods',
        }),
      }),
    );
  });
});
