import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InternalNotification } from '@alga-psa/notifications';

const SHARED_TEAMS_NOTIFICATION_MODULE =
  '../../../../../packages/notifications/src/realtime/teamsNotificationDelivery';

// Teams notification delivery was consolidated into the shared notifications
// package; deliverTeamsNotification now performs the availability gating, DB
// lookups, and Microsoft Graph call directly (no EE wrapper/loadEe* delegation).
// These tests cover the self-contained early-return branches with the server-only
// boundaries mocked, plus the source-ownership contract.

const hoisted = vi.hoisted(() => ({
  isEnterprise: { value: true },
  createTenantKnexMock: vi.fn(),
}));

vi.mock('@alga-psa/core/features', () => ({
  get isEnterprise() {
    return hoisted.isEnterprise.value;
  },
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: vi.fn(async () => undefined),
    getTenantSecret: vi.fn(async () => undefined),
  })),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: hoisted.createTenantKnexMock,
}));

vi.mock('@alga-psa/auth', () => ({
  getSSORegistry: vi.fn(async () => ({})),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
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
  } as InternalNotification;
}

describe('teamsNotificationDelivery shared delivery', () => {
  beforeEach(() => {
    vi.resetModules();
    hoisted.isEnterprise.value = true;
    hoisted.createTenantKnexMock.mockReset();
  });

  it('skips notifications whose template does not map to a supported Teams category', async () => {
    const { deliverTeamsNotification } = await import(SHARED_TEAMS_NOTIFICATION_MODULE);

    const result = await deliverTeamsNotification(
      makeNotification({ template_name: 'totally-unrelated-template', link: '/msp/foo' })
    );

    expect(result).toEqual({ status: 'skipped', reason: 'unsupported_category' });
    // Should short-circuit before touching the database.
    expect(hoisted.createTenantKnexMock).not.toHaveBeenCalled();
  });

  it('skips notifications without a deep-linkable target', async () => {
    const { deliverTeamsNotification } = await import(SHARED_TEAMS_NOTIFICATION_MODULE);

    const result = await deliverTeamsNotification(makeNotification({ link: null }));

    expect(result).toEqual({ status: 'skipped', reason: 'missing_link' });
    expect(hoisted.createTenantKnexMock).not.toHaveBeenCalled();
  });

  it('skips Teams delivery entirely in community edition', async () => {
    hoisted.isEnterprise.value = false;

    const { deliverTeamsNotification } = await import(SHARED_TEAMS_NOTIFICATION_MODULE);

    const result = await deliverTeamsNotification(makeNotification());

    expect(result).toEqual({ status: 'skipped', reason: 'ce_unavailable' });
    expect(hoisted.createTenantKnexMock).not.toHaveBeenCalled();
  });

  it('keeps the shared delivery implementation self-contained (no EE delegation wrapper)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../../../packages/notifications/src/realtime/teamsNotificationDelivery.ts'),
      'utf8'
    );

    // The implementation performs the Graph call directly and is edition-gated in
    // place; it no longer routes through an EE wrapper module.
    expect(source).toContain('teamwork/sendActivityNotification');
    expect(source).toContain('export async function deliverTeamsNotification');
    expect(source).not.toContain('loadEeTeamsNotificationDelivery');
    expect(source).not.toContain('ee/server/src/lib/notifications/teamsNotificationDelivery');
  });
});
