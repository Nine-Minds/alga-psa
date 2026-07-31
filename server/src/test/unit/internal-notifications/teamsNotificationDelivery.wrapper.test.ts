import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InternalNotification } from '@alga-psa/notifications';

const SHARED_TEAMS_NOTIFICATION_MODULE =
  '../../../../../packages/notifications/src/realtime/teamsNotificationDelivery';

// Teams notification delivery is consolidated into the EE implementation that
// records teams_notification_deliveries rows. The shared notifications module
// is a thin CE-safe delegator across the @alga-psa/ee-stubs edition seam and
// holds no delivery or classification logic of its own (F007/F008).

const hoisted = vi.hoisted(() => ({
  isEnterprise: { value: true },
  seamFactoryCalls: { count: 0 },
  deliverTeamsNotificationImplMock: vi.fn(),
  seamHasImpl: { value: true },
}));

vi.mock('@alga-psa/core/features', () => ({
  get isEnterprise() {
    return hoisted.isEnterprise.value;
  },
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/ee-stubs/lib/notifications/teamsNotificationDelivery', () => {
  hoisted.seamFactoryCalls.count += 1;
  return {
    get deliverTeamsNotificationImpl() {
      return hoisted.seamHasImpl.value ? hoisted.deliverTeamsNotificationImplMock : undefined;
    },
  };
});

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
  } as InternalNotification;
}

describe('teamsNotificationDelivery shared delegator (T018/T019)', () => {
  beforeEach(() => {
    vi.resetModules();
    hoisted.isEnterprise.value = true;
    hoisted.seamHasImpl.value = true;
    hoisted.seamFactoryCalls.count = 0;
    hoisted.deliverTeamsNotificationImplMock.mockReset();
  });

  it('T018: delegates to the recording EE implementation and passes the result through', async () => {
    hoisted.deliverTeamsNotificationImplMock.mockResolvedValue({
      status: 'delivered',
      category: 'assignment',
      providerMessageId: 'graph-request-1',
    });

    const { deliverTeamsNotification } = await import(SHARED_TEAMS_NOTIFICATION_MODULE);
    const notification = makeNotification();
    const result = await deliverTeamsNotification(notification);

    expect(hoisted.deliverTeamsNotificationImplMock).toHaveBeenCalledWith(notification);
    expect(result).toEqual({
      status: 'delivered',
      category: 'assignment',
      providerMessageId: 'graph-request-1',
    });
  });

  it('T019: skips with ce_unavailable in community edition without importing the delivery implementation', async () => {
    hoisted.isEnterprise.value = false;

    const { deliverTeamsNotification } = await import(SHARED_TEAMS_NOTIFICATION_MODULE);
    const result = await deliverTeamsNotification(makeNotification());

    expect(result).toEqual({ status: 'skipped', reason: 'ce_unavailable' });
    expect(hoisted.seamFactoryCalls.count).toBe(0);
    expect(hoisted.deliverTeamsNotificationImplMock).not.toHaveBeenCalled();
  });

  it('skips with delivery_unavailable when the seam module lacks an implementation', async () => {
    hoisted.seamHasImpl.value = false;

    const { deliverTeamsNotification } = await import(SHARED_TEAMS_NOTIFICATION_MODULE);
    const result = await deliverTeamsNotification(makeNotification());

    expect(result).toEqual({ status: 'skipped', reason: 'delivery_unavailable' });
  });

  it('T018: module shape — no delivery or classification logic remains in the shared module', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../../../packages/notifications/src/realtime/teamsNotificationDelivery.ts'),
      'utf8'
    );

    // Delegation seam is the only integration point.
    expect(source).toContain("import('@alga-psa/ee-stubs/lib/notifications/teamsNotificationDelivery')");
    expect(source).toContain('export async function deliverTeamsNotification');

    // No duplicated delivery/classification logic.
    expect(source).not.toContain('teamwork/sendActivityNotification');
    expect(source).not.toContain('graph.microsoft.com');
    expect(source).not.toContain('classifyTeamsNotificationCategory');
    expect(source).not.toContain('tenant_addons');
    expect(source).not.toContain('teams_integrations');
    expect(source).not.toContain('login.microsoftonline.com');
  });
});
