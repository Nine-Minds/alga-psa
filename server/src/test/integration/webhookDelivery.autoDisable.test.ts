import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbState = vi.hoisted(() => ({
  knexFactory: null as ((table: string) => any) | null,
  getConnectionMock: vi.fn(async (_tenantId: string | null | undefined) => {
    function knex(table: string) {
      if (!dbState.knexFactory) {
        throw new Error('knex factory not configured');
      }
      return dbState.knexFactory(table);
    }
    (knex as any).fn = { now: () => 'NOW()' };
    return knex;
  }),
}));

const emailState = vi.hoisted(() => ({
  sendEmailMock: vi.fn(),
}));

vi.mock('@/lib/db/db', () => ({
  getConnection: (...args: unknown[]) => dbState.getConnectionMock(...args),
}));

vi.mock('@alga-psa/email', () => ({
  getSystemEmailService: async () => ({
    sendEmail: (...args: unknown[]) => emailState.sendEmailMock(...args),
  }),
}));

import { maybeAutoDisable } from '@/lib/webhooks/autoDisable';
import type { WebhookRecord } from '@/lib/webhooks/webhookModel';

const TENANT = 'tenant-a';
const WEBHOOK_ID = 'webhook-1';
const OWNER_USER_ID = 'user-1';

function makeWebhook(overrides: Partial<WebhookRecord> = {}): WebhookRecord {
  return {
    tenant: TENANT,
    webhookId: WEBHOOK_ID,
    name: 'Always-failing webhook',
    url: 'http://example.invalid/hook',
    method: 'POST',
    eventTypes: ['ticket.assigned'],
    customHeaders: null,
    eventFilter: null,
    securityType: 'hmac',
    verifySsl: true,
    retryConfig: null,
    rateLimitPerMin: 100,
    isActive: true,
    totalDeliveries: 5,
    successfulDeliveries: 0,
    failedDeliveries: 5,
    lastDeliveryAt: new Date(),
    lastSuccessAt: null,
    lastFailureAt: new Date(),
    autoDisabledAt: null,
    createdByUserId: OWNER_USER_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildKnexFactory(opts: {
  firstFailureAttemptedAt: Date | null;
  updateReturnsRow: boolean;
  user: { email: string | null; first_name: string | null; last_name: string | null } | null;
}) {
  const updateCalls: Array<Record<string, unknown>> = [];

  const factory = (table: string) => {
    if (table === 'webhook_deliveries') {
      const chain: any = {
        where: () => chain,
        modify: (fn: (q: any) => void) => {
          fn({ andWhere: () => chain });
          return chain;
        },
        whereNot: () => chain,
        orderBy: () => chain,
        select: () => chain,
        first: async () =>
          opts.firstFailureAttemptedAt
            ? { attempted_at: opts.firstFailureAttemptedAt }
            : null,
      };
      return chain;
    }

    if (table === 'webhooks') {
      const chain: any = {
        where: () => chain,
        update: (input: Record<string, unknown>) => {
          updateCalls.push(input);
          chain.__lastUpdate = input;
          return chain;
        },
        returning: async () =>
          opts.updateReturnsRow
            ? [
                {
                  webhook_id: WEBHOOK_ID,
                  tenant: TENANT,
                  name: 'Always-failing webhook',
                  created_by_user_id: OWNER_USER_ID,
                },
              ]
            : [],
      };
      return chain;
    }

    if (table === 'users') {
      const chain: any = {
        select: () => chain,
        where: () => chain,
        first: async () =>
          opts.user
            ? {
                user_id: OWNER_USER_ID,
                email: opts.user.email,
                first_name: opts.user.first_name,
                last_name: opts.user.last_name,
              }
            : null,
      };
      return chain;
    }

    throw new Error(`Unhandled table in test knex stub: ${table}`);
  };

  return { factory, updateCalls };
}

describe('maybeAutoDisable (T028)', () => {
  beforeEach(() => {
    dbState.getConnectionMock.mockClear();
    emailState.sendEmailMock.mockReset();
    emailState.sendEmailMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    dbState.knexFactory = null;
  });

  it('flips is_active=false + sets auto_disabled_at + emails the owner when failure streak exceeds 24h', async () => {
    const olderThan24h = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const factory = buildKnexFactory({
      firstFailureAttemptedAt: olderThan24h,
      updateReturnsRow: true,
      user: { email: 'owner@example.com', first_name: 'Sam', last_name: 'Sender' },
    });
    dbState.knexFactory = factory.factory;

    await maybeAutoDisable(makeWebhook());

    expect(factory.updateCalls).toHaveLength(1);
    const update = factory.updateCalls[0];
    expect(update.is_active).toBe(false);
    expect(update.auto_disabled_at).toBeInstanceOf(Date);

    expect(emailState.sendEmailMock).toHaveBeenCalledTimes(1);
    const [emailArgs] = emailState.sendEmailMock.mock.calls;
    expect(emailArgs[0]).toMatchObject({
      to: 'owner@example.com',
      tenantId: TENANT,
      userId: OWNER_USER_ID,
    });
    expect(emailArgs[0].subject).toMatch(/Always-failing webhook/);
  });

  it('does not auto-disable when the failure streak is younger than 24h', async () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000);
    const factory = buildKnexFactory({
      firstFailureAttemptedAt: recent,
      updateReturnsRow: true,
      user: { email: 'owner@example.com', first_name: null, last_name: null },
    });
    dbState.knexFactory = factory.factory;

    await maybeAutoDisable(makeWebhook());

    expect(factory.updateCalls).toHaveLength(0);
    expect(emailState.sendEmailMock).not.toHaveBeenCalled();
  });

  it('skips entirely when the webhook is already inactive or auto-disabled', async () => {
    dbState.knexFactory = (_table: string) => {
      throw new Error('knex should not be touched for inactive webhook');
    };

    await maybeAutoDisable(makeWebhook({ isActive: false }));
    await maybeAutoDisable(makeWebhook({ autoDisabledAt: new Date() }));

    expect(emailState.sendEmailMock).not.toHaveBeenCalled();
  });
});
