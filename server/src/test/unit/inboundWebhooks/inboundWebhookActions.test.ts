import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnex = vi.fn();
const hasPermission = vi.fn();
const setTenantSecret = vi.fn();
const deleteTenantSecret = vi.fn();

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

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    setTenantSecret: (...args: unknown[]) => setTenantSecret(...args),
    deleteTenantSecret: (...args: unknown[]) => deleteTenantSecret(...args),
  })),
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

function validUpsertInput(overrides: Record<string, unknown> = {}) {
  return {
    name: 'RMM Alerts',
    slug: 'rmm-alerts',
    auth_type: 'hmac_sha256',
    auth_config: {
      type: 'hmac_sha256',
      signature_header: 'X-Signature',
      secret: '0123456789abcdef',
    },
    handler_type: 'direct_action',
    handler_config: {
      type: 'direct_action',
      action: 'createTicket',
      field_mapping: {
        title: 'alert.message',
      },
    },
    ...overrides,
  };
}

function makeDuplicateSlugKnex(collisionRow: Record<string, unknown>) {
  const builder: any = {
    where: vi.fn(() => builder),
    modify: vi.fn((callback: (query: any) => void) => {
      callback(builder);
      return builder;
    }),
    andWhereNot: vi.fn(() => builder),
    first: vi.fn(async () => collisionRow),
    insert: vi.fn(() => {
      throw new Error('insert should not be called when slug collides');
    }),
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

function makeCreateKnex(existingRows: InboundWebhookRowFixture[]) {
  const now = new Date('2026-05-11T00:00:00.000Z');
  const collisionWhereCalls: Record<string, unknown>[] = [];
  let insertedPayload: Record<string, unknown> | null = null;

  const collisionBuilder: any = {
    where: vi.fn((criteria: Record<string, unknown>) => {
      collisionWhereCalls.push(criteria);
      return collisionBuilder;
    }),
    modify: vi.fn((callback: (query: any) => void) => {
      callback(collisionBuilder);
      return collisionBuilder;
    }),
    andWhereNot: vi.fn(() => collisionBuilder),
    first: vi.fn(async () => {
      const criteria = Object.assign({}, ...collisionWhereCalls);
      return (
        existingRows.find((row) =>
          Object.entries(criteria).every(([key, value]) => row[key as keyof InboundWebhookRowFixture] === value),
        ) ?? null
      );
    }),
  };

  const insertBuilder: any = {
    insert: vi.fn((payload: Record<string, unknown>) => {
      insertedPayload = payload;
      return insertBuilder;
    }),
    returning: vi.fn(async () => {
      if (!insertedPayload) {
        throw new Error('insert payload missing');
      }

      return [
        inboundWebhookRow({
          ...(insertedPayload as Partial<InboundWebhookRowFixture>),
          created_at: now,
          updated_at: now,
        }),
      ];
    }),
  };

  const knex = vi.fn((table: string) => {
    if (table !== 'inbound_webhooks') {
      throw new Error(`Unexpected table ${table}`);
    }

    return knex.mock.calls.length === 1 ? collisionBuilder : insertBuilder;
  });

  knex.fn = {
    now: vi.fn(() => now),
  };

  return { knex, collisionBuilder, insertBuilder, getInsertedPayload: () => insertedPayload };
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

  it('T021: upsertInboundWebhook rejects duplicate slug in the same tenant', async () => {
    const { knex, builder } = makeDuplicateSlugKnex({ inbound_webhook_id: 'existing-webhook-id' });
    createTenantKnex.mockResolvedValue({ knex });

    const { upsertInboundWebhook } = await import('@/lib/actions/inboundWebhookActions');
    await expect(upsertInboundWebhook(validUpsertInput())).rejects.toThrow(
      'Inbound webhook slug "rmm-alerts" already exists',
    );

    expect(hasPermission).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1' }), 'inbound_webhook', 'create', knex);
    expect(builder.where).toHaveBeenCalledWith({ tenant: 'tenant-a', slug: 'rmm-alerts' });
    expect(setTenantSecret).not.toHaveBeenCalled();
    expect(builder.insert).not.toHaveBeenCalled();
  });

  it('T022: upsertInboundWebhook allows the same slug across different tenants', async () => {
    const { knex, collisionBuilder, insertBuilder, getInsertedPayload } = makeCreateKnex([
      inboundWebhookRow({ tenant: 'tenant-b', inbound_webhook_id: 'tenant-b-webhook', slug: 'rmm-alerts' }),
    ]);
    createTenantKnex.mockResolvedValue({ knex });

    const { upsertInboundWebhook } = await import('@/lib/actions/inboundWebhookActions');
    const result = await upsertInboundWebhook(validUpsertInput());

    expect(collisionBuilder.where).toHaveBeenCalledWith({ tenant: 'tenant-a', slug: 'rmm-alerts' });
    expect(insertBuilder.insert).toHaveBeenCalledTimes(1);
    expect(getInsertedPayload()).toMatchObject({
      tenant: 'tenant-a',
      slug: 'rmm-alerts',
      auth_type: 'hmac_sha256',
      handler_type: 'direct_action',
    });
    expect(result.webhook).toMatchObject({
      tenant: 'tenant-a',
      slug: 'rmm-alerts',
    });
  });
});
