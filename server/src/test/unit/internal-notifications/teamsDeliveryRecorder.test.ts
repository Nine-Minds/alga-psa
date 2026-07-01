import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = {
    idempotencyKeys: new Set<string>(),
    deliveries: [] as Array<Record<string, unknown>>,
    failCreateTenantKnex: false,
  };

  function buildInsertChain(row: Record<string, unknown>) {
    const chain: any = {
      onConflict: () => chain,
      ignore: () => chain,
      returning: async () => {
        const key = `${row.tenant as string}:${row.idempotency_key as string}`;
        if (state.idempotencyKeys.has(key)) {
          return [];
        }
        state.idempotencyKeys.add(key);
        state.deliveries.push(row);
        return [{ delivery_id: row.delivery_id }];
      },
    };
    return chain;
  }

  const knex = Object.assign(
    (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        if (table !== 'teams_notification_deliveries') {
          throw new Error(`Unexpected insert table: ${table}`);
        }
        return buildInsertChain(row);
      },
    }),
    {}
  );

  return {
    state,
    knex,
    warnMock: vi.fn(),
    createTenantKnexMock: vi.fn(async (tenant: string) => {
      if (state.failCreateTenantKnex) {
        throw new Error('database unavailable');
      }
      return { knex, tenant };
    }),
  };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: hoisted.createTenantKnexMock,
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
  }),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    warn: hoisted.warnMock,
  },
}));

import {
  computeTeamsDeliveryIdempotencyKey,
  truncateTeamsDeliveryErrorMessage,
  writeTeamsDeliveryRow,
} from '@alga-psa/ee-microsoft-teams/lib/notifications/teamsDeliveryRecorder';

describe('Teams delivery recorder', () => {
  beforeEach(() => {
    hoisted.state.idempotencyKeys.clear();
    hoisted.state.deliveries.length = 0;
    hoisted.state.failCreateTenantKnex = false;
    hoisted.createTenantKnexMock.mockClear();
    hoisted.warnMock.mockClear();
  });

  it('computes the delivery idempotency key deterministically from the PRD tuple', () => {
    const input = {
      internalNotificationId: '11111111-1111-1111-1111-111111111111',
      tenant: '22222222-2222-2222-2222-222222222222',
      destinationType: 'user_activity' as const,
      destinationId: 'aad-user-1',
      attemptNumber: 2,
    };

    expect(computeTeamsDeliveryIdempotencyKey(input)).toBe(computeTeamsDeliveryIdempotencyKey({ ...input }));
    expect(computeTeamsDeliveryIdempotencyKey(input)).not.toBe(
      computeTeamsDeliveryIdempotencyKey({ ...input, attemptNumber: 3 })
    );
  });

  it('truncates delivery error messages to 1024 characters', () => {
    const longMessage = 'x'.repeat(1100);
    expect(truncateTeamsDeliveryErrorMessage(longMessage)).toHaveLength(1024);
    expect(truncateTeamsDeliveryErrorMessage(' short ')).toBe('short');
    expect(truncateTeamsDeliveryErrorMessage('   ')).toBeNull();
  });

  it('inserts one delivery row and no-ops on duplicate idempotency key', async () => {
    const input = {
      tenant: '22222222-2222-2222-2222-222222222222',
      internalNotificationId: '11111111-1111-1111-1111-111111111111',
      category: 'assignment',
      destinationType: 'user_activity' as const,
      destinationId: 'aad-user-1',
      attemptNumber: 1,
      status: 'delivered' as const,
      providerMessageId: 'graph-message-1',
      providerRequestId: 'graph-request-1',
      sentAt: '2026-05-24T10:00:00.000Z',
      deliveredAt: '2026-05-24T10:00:01.000Z',
    };

    const first = await writeTeamsDeliveryRow(input);
    const second = await writeTeamsDeliveryRow(input);

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(hoisted.state.deliveries).toHaveLength(1);
    expect(hoisted.state.deliveries[0]).toMatchObject({
      tenant: input.tenant,
      internal_notification_id: input.internalNotificationId,
      category: input.category,
      destination_type: input.destinationType,
      destination_id: input.destinationId,
      attempt_number: input.attemptNumber,
      provider_message_id: input.providerMessageId,
      provider_request_id: input.providerRequestId,
      status: input.status,
      sent_at: input.sentAt,
      delivered_at: input.deliveredAt,
    });
  });

  it('logs and swallows recorder persistence failures', async () => {
    hoisted.state.failCreateTenantKnex = true;

    const result = await writeTeamsDeliveryRow({
      tenant: '22222222-2222-2222-2222-222222222222',
      internalNotificationId: '11111111-1111-1111-1111-111111111111',
      destinationType: 'user_activity',
      destinationId: 'aad-user-1',
      status: 'failed',
      errorCode: 'transient',
      errorMessage: 'network timeout',
      retryable: true,
    });

    expect(result.inserted).toBe(false);
    expect(result.deliveryId).toBeNull();
    expect(hoisted.warnMock).toHaveBeenCalledWith(
      '[TeamsDeliveryRecorder] Failed to persist Teams notification delivery row',
      expect.objectContaining({
        error: 'database unavailable',
        status: 'failed',
      })
    );
  });
});
