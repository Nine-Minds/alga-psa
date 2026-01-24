import { describe, expect, it, vi } from 'vitest';

vi.mock(
  '@alga-psa/event-bus/publishers',
  () => ({
    publishWorkflowEvent: vi.fn(),
  }),
  { virtual: true }
);

const { maybePublishCapacityThresholdReached } = await import('../capacityThresholdWorkflowEvents');

describe('maybePublishCapacityThresholdReached', () => {
  it('does nothing when there are no impacted assignees', async () => {
    const publishWorkflowEvent = vi.fn();

    await maybePublishCapacityThresholdReached({
      db: {} as any,
      tenantId: 'tenant-1',
      actorUserId: 'user-1',
      __deps: {
        publishWorkflowEvent: publishWorkflowEvent as any,
        getTeamIdsForUsers: vi.fn().mockResolvedValue(['team-1']),
      },
    });

    expect(publishWorkflowEvent).not.toHaveBeenCalled();
  });

  it('does not publish when capacity thresholds are not configured', async () => {
    const publishWorkflowEvent = vi.fn();

    await maybePublishCapacityThresholdReached({
      db: {} as any,
      tenantId: 'tenant-1',
      actorUserId: 'user-1',
      after: {
        scheduled_start: '2026-01-24T10:00:00.000Z',
        scheduled_end: '2026-01-24T11:00:00.000Z',
        assigned_user_ids: ['user-1'],
      },
      __deps: {
        publishWorkflowEvent: publishWorkflowEvent as any,
        getTeamIdsForUsers: vi.fn().mockResolvedValue(['team-1']),
        getTeamMembershipForUsers: vi.fn().mockResolvedValue(new Map([['team-1', new Set(['user-1'])]])),
        getTeamDailyCapacityLimitHours: vi.fn().mockResolvedValue(0),
        getTeamDailyBookedHours: vi.fn().mockResolvedValue(8),
      },
    });

    expect(publishWorkflowEvent).not.toHaveBeenCalled();
  });

  it('publishes CAPACITY_THRESHOLD_REACHED only on a threshold crossing', async () => {
    const publishWorkflowEvent = vi.fn();
    const now = () => new Date('2026-01-24T12:00:00.000Z');

    await maybePublishCapacityThresholdReached({
      db: {} as any,
      tenantId: 'tenant-1',
      actorUserId: 'user-1',
      after: {
        scheduled_start: '2026-01-24T10:00:00.000Z',
        scheduled_end: '2026-01-24T11:00:00.000Z',
        assigned_user_ids: ['user-1'],
      },
      __deps: {
        now,
        publishWorkflowEvent: publishWorkflowEvent as any,
        getTeamIdsForUsers: vi.fn().mockResolvedValue(['team-1']),
        getTeamMembershipForUsers: vi.fn().mockResolvedValue(new Map([['team-1', new Set(['user-1'])]])),
        getTeamDailyCapacityLimitHours: vi.fn().mockResolvedValue(8),
        getTeamDailyBookedHours: vi.fn().mockResolvedValue(8),
      },
    });

    expect(publishWorkflowEvent).toHaveBeenCalledTimes(1);
    expect(publishWorkflowEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CAPACITY_THRESHOLD_REACHED',
        ctx: expect.objectContaining({
          tenantId: 'tenant-1',
          actor: { actorType: 'USER', actorUserId: 'user-1' },
          idempotencyKey: 'capacity-threshold-reached:team-1:2026-01-24',
        }),
        payload: expect.objectContaining({
          teamId: 'team-1',
          date: '2026-01-24',
          capacityLimit: 8,
          currentBooked: 8,
          triggeredAt: now().toISOString(),
        }),
      })
    );

    publishWorkflowEvent.mockClear();

    await maybePublishCapacityThresholdReached({
      db: {} as any,
      tenantId: 'tenant-1',
      actorUserId: 'user-1',
      after: {
        scheduled_start: '2026-01-24T10:00:00.000Z',
        scheduled_end: '2026-01-24T11:00:00.000Z',
        assigned_user_ids: ['user-1'],
      },
      __deps: {
        now,
        publishWorkflowEvent: publishWorkflowEvent as any,
        getTeamIdsForUsers: vi.fn().mockResolvedValue(['team-1']),
        getTeamMembershipForUsers: vi.fn().mockResolvedValue(new Map([['team-1', new Set(['user-1'])]])),
        getTeamDailyCapacityLimitHours: vi.fn().mockResolvedValue(8),
        getTeamDailyBookedHours: vi.fn().mockResolvedValue(9),
      },
    });

    expect(publishWorkflowEvent).not.toHaveBeenCalled();
  });
});
