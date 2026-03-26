import { beforeEach, describe, expect, it, vi } from 'vitest';

const activityMock = vi.fn();
const logInfoMock = vi.fn();

vi.mock('@temporalio/workflow', () => ({
  proxyActivities: vi.fn(() => ({
    proactiveNinjaOneTokenRefreshActivity: activityMock,
  })),
  log: {
    info: logInfoMock,
  },
}));

describe('ninjaOneProactiveTokenRefreshWorkflow', () => {
  beforeEach(() => {
    activityMock.mockReset();
    logInfoMock.mockReset();
  });

  it('logs structured start/success context and returns activity result', async () => {
    activityMock.mockResolvedValue({ outcome: 'success' });

    const { ninjaOneProactiveTokenRefreshWorkflow } = await import(
      '../ninjaone-token-refresh-workflow'
    );

    const result = await ninjaOneProactiveTokenRefreshWorkflow({
      tenantId: 'tenant-1',
      integrationId: 'integration-1',
      scheduleNonce: 8,
      scheduledFor: '2026-03-27T00:00:00.000Z',
      scheduledBy: 'backfill',
    });

    expect(result).toEqual({ outcome: 'success' });
    expect(logInfoMock).toHaveBeenCalledWith(
      'Starting NinjaOne proactive token refresh workflow',
      expect.objectContaining({
        tenantId: 'tenant-1',
        integrationId: 'integration-1',
        scheduleNonce: 8,
        scheduledFor: '2026-03-27T00:00:00.000Z',
      })
    );
    expect(logInfoMock).toHaveBeenCalledWith(
      'Completed NinjaOne proactive token refresh workflow',
      expect.objectContaining({
        tenantId: 'tenant-1',
        integrationId: 'integration-1',
        scheduleNonce: 8,
        outcome: 'success',
      })
    );
  });
});
