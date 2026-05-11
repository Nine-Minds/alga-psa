import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnex = vi.fn();
const hasPermission = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: unknown[]) => createTenantKnex(...args),
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth:
    (fn: any) =>
    (...args: unknown[]) =>
      fn({ user_id: 'user-1' }, { tenant: 'tenant-a' }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: unknown[]) => hasPermission(...args),
}));

interface InboundWebhookRowFixture {
  tenant: string;
  inbound_webhook_id: string;
  name: string;
  slug: string;
  description: string | null;
  auth_type: string;
  auth_config: Record<string, unknown>;
  idempotency_source: Record<string, unknown> | null;
  idempotency_window_seconds: number;
  handler_type: string;
  handler_config: Record<string, unknown>;
  sample_payload: unknown | null;
  sample_capture_expires_at: Date | string | null;
  is_active: boolean;
  rate_limit_per_minute: number;
  auto_disabled_at: Date | string | null;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function inboundWebhookRow(overrides: Partial<InboundWebhookRowFixture> = {}): InboundWebhookRowFixture {
  const id = overrides.inbound_webhook_id ?? 'webhook-1';

  return {
    tenant: 'tenant-a',
    inbound_webhook_id: id,
    name: 'RMM Alerts',
    slug: 'rmm-alerts',
    description: null,
    auth_type: 'hmac_sha256',
    auth_config: {
      type: 'hmac_sha256',
      signature_header: 'X-Signature',
      secret_vault_path: `inbound-webhooks/${id}`,
    },
    idempotency_source: null,
    idempotency_window_seconds: 86_400,
    handler_type: 'direct_action',
    handler_config: {
      type: 'direct_action',
      action: 'createTicket',
      field_mapping: {
        title: 'alert.message',
      },
    },
    sample_payload: null,
    sample_capture_expires_at: null,
    is_active: true,
    rate_limit_per_minute: 600,
    auto_disabled_at: null,
    created_by: 'user-1',
    created_at: '2026-05-11T00:00:00.000Z',
    updated_at: '2026-05-11T01:00:00.000Z',
    ...overrides,
  };
}

function makeListKnex(rows: InboundWebhookRowFixture[]) {
  const whereCalls: unknown[] = [];

  const builder: any = {
    where: vi.fn((criteria: unknown) => {
      whereCalls.push(criteria);
      return builder;
    }),
    orderBy: vi.fn(() => builder),
    then: (resolve: (rows: InboundWebhookRowFixture[]) => unknown, reject?: (error: unknown) => unknown) => {
      const tenantCriteria = whereCalls.find(
        (criteria): criteria is { tenant: string } =>
          !!criteria && typeof criteria === 'object' && 'tenant' in criteria,
      );
      return Promise.resolve(rows.filter((row) => row.tenant === tenantCriteria?.tenant)).then(resolve, reject);
    },
  };

  const knex = vi.fn((table: string) => {
    if (table !== 'inbound_webhooks') {
      throw new Error(`Unexpected table ${table}`);
    }

    return builder;
  });

  knex.fn = {
    now: vi.fn(() => new Date('2026-05-11T00:00:00.000Z')),
  };

  return { knex, builder };
}

describe('inbound webhook server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermission.mockResolvedValue(true);
  });

  it('T020: listInboundWebhooks returns only the current tenant webhooks', async () => {
    const { knex, builder } = makeListKnex([
      inboundWebhookRow({ tenant: 'tenant-a', inbound_webhook_id: 'webhook-a', slug: 'tenant-a-hook' }),
      inboundWebhookRow({ tenant: 'tenant-b', inbound_webhook_id: 'webhook-b', slug: 'tenant-b-hook' }),
    ]);
    createTenantKnex.mockResolvedValue({ knex });

    const { listInboundWebhooks } = await import('@/lib/actions/inboundWebhookActions');
    const result = await listInboundWebhooks();

    expect(createTenantKnex).toHaveBeenCalledWith('tenant-a');
    expect(hasPermission).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1' }), 'inbound_webhook', 'read', knex);
    expect(builder.where).toHaveBeenCalledWith({ tenant: 'tenant-a' });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      tenant: 'tenant-a',
      inboundWebhookId: 'webhook-a',
      slug: 'tenant-a-hook',
    });
  });
});
