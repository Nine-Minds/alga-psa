import { beforeEach, describe, expect, it, vi } from 'vitest';

const createNotificationMock = vi.hoisted(() => vi.fn());
const getConnectionMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/notifications/actions', () => ({
  createNotificationFromTemplateInternal: createNotificationMock,
}));

vi.mock('@/lib/db/db', () => ({
  getConnection: getConnectionMock,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { warn: vi.fn() },
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => {
    const query: Record<string, unknown> = {};
    for (const method of ['where', 'whereRaw', 'whereNot', 'distinct']) {
      query[method] = vi.fn(() => query);
    }
    query.then = (
      resolve: (rows: Array<{ user_id: string }>) => unknown,
      reject: (error: unknown) => unknown,
    ) => Promise.resolve([{ user_id: 'admin-1' }]).then(resolve, reject);
    return {
      table: vi.fn(() => query),
      tenantJoin: vi.fn(),
    };
  },
}));

describe('AI credits admin notifications', () => {
  beforeEach(() => {
    vi.resetModules();
    createNotificationMock.mockReset();
    createNotificationMock.mockResolvedValue({});
    getConnectionMock.mockReset();
    getConnectionMock.mockResolvedValue({});
  });

  it('throttles repeated notices per tenant and surface for one day', async () => {
    const { AiCreditsError } = await import('../../../../../../ee/server/src/lib/aiGateway/types');
    const { notifyAiCreditsUnavailable } = await import(
      '../../../../../../ee/server/src/lib/aiGateway/notifications'
    );
    const error = new AiCreditsError('out_of_credits');

    await notifyAiCreditsUnavailable('tenant-1', 'inventory-classifier', error);
    await notifyAiCreditsUnavailable('tenant-1', 'inventory-classifier', error);
    await notifyAiCreditsUnavailable('tenant-1', 'email-rule-classifier', error);

    expect(createNotificationMock).toHaveBeenCalledTimes(2);
    expect(createNotificationMock).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-1',
        user_id: 'admin-1',
        template_name: 'system-announcement',
        type: 'warning',
        metadata: expect.objectContaining({
          ai_feature: 'inventory-classifier',
          ai_credits_reason: 'out_of_credits',
        }),
      }),
    );
  });
});
