import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InternalNotification } from '@alga-psa/notifications';

const EE_TEAMS_NOTIFICATION_MODULE =
  '@alga-psa/ee-microsoft-teams/lib/notifications/teamsNotificationDelivery';
const SHARED_TEAMS_NOTIFICATION_MODULE =
  '../../../../../packages/notifications/src/realtime/teamsNotificationDelivery';

const hoisted = vi.hoisted(() => ({
  warnMock: vi.fn(),
  getTeamsAvailabilityMock: vi.fn(async () => ({
    enabled: true,
    reason: 'enabled',
    flagKey: 'teams-integration-ui',
  })),
  deliverTeamsNotificationImplMock: vi.fn(async () => ({
    status: 'delivered' as const,
    category: 'assignment' as const,
    providerMessageId: 'graph-request-1',
  })),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    warn: hoisted.warnMock,
  },
}));

vi.mock('@alga-psa/integrations/lib/teamsAvailability', () => ({
  getTeamsAvailability: hoisted.getTeamsAvailabilityMock,
}));

function makeNotification(overrides: Partial<InternalNotification> = {}): InternalNotification {
  return {
    internal_notification_id: 'notification-1',
    tenant: 'tenant-1',
    user_id: 'user-1',
    template_name: 'ticket-assigned',
    language_code: 'en',
    title: 'Ticket #1001 assigned',
    message: 'Critical issue has been assigned to you.',
    type: 'info',
    category: 'tickets',
    link: '/msp/tickets/ticket-1',
    metadata: null,
    is_read: false,
    read_at: null,
    deleted_at: null,
    delivery_status: 'pending',
    delivery_attempts: 0,
    last_delivery_attempt: null,
    delivery_error: null,
    created_at: '2026-03-07T12:00:00.000Z',
    updated_at: '2026-03-07T12:00:00.000Z',
    ...overrides,
  };
}

describe('teamsNotificationDelivery shared wrapper', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock(EE_TEAMS_NOTIFICATION_MODULE);
    hoisted.warnMock.mockReset();
    hoisted.getTeamsAvailabilityMock.mockReset();
    hoisted.getTeamsAvailabilityMock.mockResolvedValue({
      enabled: true,
      reason: 'enabled',
      flagKey: 'teams-integration-ui',
    });
    hoisted.deliverTeamsNotificationImplMock.mockReset();
    hoisted.deliverTeamsNotificationImplMock.mockResolvedValue({
      status: 'delivered',
      category: 'assignment',
      providerMessageId: 'graph-request-1',
    });
  });

  it('T283/T289/T291/T292/T293/T294: delegates Teams notification delivery into the EE implementation after the shared availability check passes', async () => {
    vi.doMock(EE_TEAMS_NOTIFICATION_MODULE, () => ({
      deliverTeamsNotificationImpl: hoisted.deliverTeamsNotificationImplMock,
    }));

    const { deliverTeamsNotification } = await import(SHARED_TEAMS_NOTIFICATION_MODULE);
    const notification = makeNotification();

    const result = await deliverTeamsNotification(notification);

    expect(result).toEqual({
      status: 'delivered',
      category: 'assignment',
      providerMessageId: 'graph-request-1',
    });
    expect(hoisted.getTeamsAvailabilityMock).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
    expect(hoisted.deliverTeamsNotificationImplMock).toHaveBeenCalledWith(notification);
  });

  it('T303/T304/T305/T306/T353/T354: returns a stable skipped result and bounded warning when the EE Teams delivery implementation cannot be loaded', async () => {
    vi.doMock(EE_TEAMS_NOTIFICATION_MODULE, () => {
      throw new Error('EE notification delivery missing');
    });

    const { deliverTeamsNotification } = await import(SHARED_TEAMS_NOTIFICATION_MODULE);

    const result = await deliverTeamsNotification(makeNotification());

    expect(result).toEqual({
      status: 'skipped',
      reason: 'delivery_unavailable',
    });
    expect(hoisted.warnMock).toHaveBeenCalledWith(
      '[TeamsNotificationDelivery] Failed to load EE notification delivery implementation',
      expect.objectContaining({
        error: expect.any(String),
      })
    );
  });

  it('T305/T306/T353/T354: keeps the shared notification wrapper free of direct EE runtime imports outside the lazy loader', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(path.resolve(__dirname, '../../../../../packages/notifications/src/realtime/teamsNotificationDelivery.ts'), 'utf8');

    expect(source).toContain('loadEeTeamsNotificationDelivery');
    expect(source).toContain("import('@alga-psa/ee-microsoft-teams/lib/notifications/teamsNotificationDelivery')");
    expect(source).not.toContain('ee/server/src/lib/notifications/teamsNotificationDelivery');
  });
});
