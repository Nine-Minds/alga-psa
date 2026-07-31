import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnex = vi.fn();
const hasPermission = vi.fn();
const setTenantSecret = vi.fn();
const deleteTenantSecret = vi.fn();
const createInboundDelivery = vi.fn();
const updateInboundDeliveryOutcome = vi.fn();
const dispatchInboundWebhookHandler = vi.fn();
const featureMocks = vi.hoisted(() => ({
  isEnterprise: true,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: unknown[]) => createTenantKnex(...args),
  tenantDb: (knex: any, tenant: string) => ({
    table: (table: string) => {
      const builder = knex(table);
      if (!builder || typeof builder.where !== 'function') {
        return builder;
      }

      builder.where({ tenant });
      return {
        ...builder,
        where: (criteriaOrColumn: unknown, ...args: unknown[]) => {
          if (
            criteriaOrColumn &&
            typeof criteriaOrColumn === 'object' &&
            !Array.isArray(criteriaOrColumn)
          ) {
            return builder.where({ tenant, ...(criteriaOrColumn as Record<string, unknown>) });
          }
          return builder.where(criteriaOrColumn, ...args);
        },
      };
    },
  }),
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

vi.mock('@/lib/inboundWebhooks/deliveryPersistence', () => ({
  createInboundDelivery: (...args: unknown[]) => createInboundDelivery(...args),
  updateInboundDeliveryOutcome: (...args: unknown[]) => updateInboundDeliveryOutcome(...args),
}));

vi.mock('@/lib/inboundWebhooks/dispatcher', () => ({
  dispatchInboundWebhookHandler: (...args: unknown[]) => dispatchInboundWebhookHandler(...args),
}));

vi.mock('@alga-psa/core/features', () => ({
  get isEnterprise() {
    return featureMocks.isEnterprise;
  },
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

interface InboundWebhookDeliveryRowFixture {
  tenant: string;
  delivery_id: string;
  inbound_webhook_id: string | null;
  idempotency_key: string | null;
  received_at: Date | string;
  request_method: string;
  request_path: string;
  request_headers: Record<string, string | string[]>;
  request_body: unknown | null;
  source_ip: string | null;
  user_agent: string | null;
  auth_status: string;
  dispatch_status: string;
  handler_outcome: Record<string, unknown> | null;
  response_status: number | null;
  response_body: unknown | null;
  duration_ms: number | null;
  retry_count: number;
  is_replay: boolean;
  replayed_from: string | null;
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

function inboundDeliveryRow(overrides: Partial<InboundWebhookDeliveryRowFixture> = {}): InboundWebhookDeliveryRowFixture {
  return {
    tenant: 'tenant-a',
    delivery_id: 'delivery-1',
    inbound_webhook_id: 'webhook-1',
    idempotency_key: null,
    received_at: '2026-05-11T00:00:00.000Z',
    request_method: 'POST',
    request_path: '/api/inbound/tenant-slug/rmm-alerts',
    request_headers: {},
    request_body: { alert: { message: 'Disk full' } },
    source_ip: '203.0.113.10',
    user_agent: 'vitest',
    auth_status: 'verified',
    dispatch_status: 'dispatched',
    handler_outcome: { success: true },
    response_status: 200,
    response_body: { delivery_id: 'delivery-1' },
    duration_ms: 12,
    retry_count: 0,
    is_replay: false,
    replayed_from: null,
    created_at: '2026-05-11T00:00:00.000Z',
    updated_at: '2026-05-11T00:00:01.000Z',
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

function makeGetKnex(row: InboundWebhookRowFixture | null) {
  const whereCalls: Record<string, unknown>[] = [];
  const builder: any = {
    where: vi.fn((criteria: Record<string, unknown>) => {
      whereCalls.push(criteria);
      return builder;
    }),
    first: vi.fn(async () => {
      if (!row) {
        return null;
      }

      const criteria = Object.assign({}, ...whereCalls);
      return Object.entries(criteria).every(([key, value]) => row[key as keyof InboundWebhookRowFixture] === value)
        ? row
        : null;
    }),
  };

  const knex = vi.fn((table: string) => {
    if (table !== 'inbound_webhooks') {
      throw new Error(`Unexpected table ${table}`);
    }

    return builder;
  });

  return { knex, builder };
}

function makeGetDeliveryKnex(row: InboundWebhookDeliveryRowFixture | null) {
  const whereCalls: Record<string, unknown>[] = [];
  const builder: any = {
    where: vi.fn((criteria: Record<string, unknown>) => {
      whereCalls.push(criteria);
      return builder;
    }),
    first: vi.fn(async () => {
      if (!row) {
        return null;
      }

      const criteria = Object.assign({}, ...whereCalls);
      return Object.entries(criteria).every(
        ([key, value]) => row[key as keyof InboundWebhookDeliveryRowFixture] === value,
      )
        ? row
        : null;
    }),
  };

  const knex = vi.fn((table: string) => {
    if (table !== 'inbound_webhook_deliveries') {
      throw new Error(`Unexpected table ${table}`);
    }

    return builder;
  });

  return { knex, builder };
}

function makeReplayKnex(args: {
  original: InboundWebhookDeliveryRowFixture;
  webhook: InboundWebhookRowFixture;
  replayed: InboundWebhookDeliveryRowFixture;
}) {
  let deliveryLookupCount = 0;

  function deliveryBuilderFor(row: InboundWebhookDeliveryRowFixture | null) {
    const whereCalls: Record<string, unknown>[] = [];
    const builder: any = {
      where: vi.fn((criteria: Record<string, unknown>) => {
        whereCalls.push(criteria);
        return builder;
      }),
      first: vi.fn(async () => {
        if (!row) {
          return null;
        }

        const criteria = Object.assign({}, ...whereCalls);
        return Object.entries(criteria).every(([key, value]) => row[key as keyof InboundWebhookDeliveryRowFixture] === value)
          ? row
          : null;
      }),
    };

    return builder;
  }

  const webhookWhereCalls: Record<string, unknown>[] = [];
  const webhookBuilder: any = {
    where: vi.fn((criteria: Record<string, unknown>) => {
      webhookWhereCalls.push(criteria);
      return webhookBuilder;
    }),
    first: vi.fn(async () => {
      const criteria = Object.assign({}, ...webhookWhereCalls);
      return Object.entries(criteria).every(([key, value]) => args.webhook[key as keyof InboundWebhookRowFixture] === value)
        ? args.webhook
        : null;
    }),
  };

  const originalBuilder = deliveryBuilderFor(args.original);
  const replayedBuilder = deliveryBuilderFor(args.replayed);
  const knex = vi.fn((table: string) => {
    if (table === 'inbound_webhook_deliveries') {
      deliveryLookupCount += 1;
      return deliveryLookupCount === 1 ? originalBuilder : replayedBuilder;
    }

    if (table === 'inbound_webhooks') {
      return webhookBuilder;
    }

    throw new Error(`Unexpected table ${table}`);
  });

  return { knex, originalBuilder, webhookBuilder, replayedBuilder };
}

function makeRotateKnex(row: InboundWebhookRowFixture) {
  const now = new Date('2026-05-11T02:00:00.000Z');
  let updatedPayload: Record<string, unknown> | null = null;

  const getBuilder: any = {
    where: vi.fn(() => getBuilder),
    first: vi.fn(async () => row),
  };

  const updateBuilder: any = {
    where: vi.fn(() => updateBuilder),
    update: vi.fn((payload: Record<string, unknown>) => {
      updatedPayload = payload;
      return updateBuilder;
    }),
    returning: vi.fn(async () => [
      inboundWebhookRow({
        ...row,
        ...(updatedPayload as Partial<InboundWebhookRowFixture>),
        updated_at: now,
      }),
    ]),
  };

  const knex = vi.fn((table: string) => {
    if (table !== 'inbound_webhooks') {
      throw new Error(`Unexpected table ${table}`);
    }

    return knex.mock.calls.length === 1 ? getBuilder : updateBuilder;
  });

  knex.fn = {
    now: vi.fn(() => now),
  };

  return { knex, getBuilder, updateBuilder, getUpdatedPayload: () => updatedPayload };
}

function makeDeleteKnex(row: InboundWebhookRowFixture) {
  const getBuilder: any = {
    where: vi.fn(() => getBuilder),
    first: vi.fn(async () => row),
  };

  const deleteBuilder: any = {
    where: vi.fn(() => deleteBuilder),
    delete: vi.fn(async () => 1),
  };

  const deliveriesUpdateBuilder: any = {
    where: vi.fn(() => deliveriesUpdateBuilder),
    update: vi.fn(async () => 0),
  };

  const knex = vi.fn((table: string) => {
    if (table === 'inbound_webhook_deliveries') {
      return deliveriesUpdateBuilder;
    }

    if (table !== 'inbound_webhooks') {
      throw new Error(`Unexpected table ${table}`);
    }

    const inboundWebhooksCallCount = knex.mock.calls.filter(
      (call: unknown[]) => call[0] === 'inbound_webhooks',
    ).length;
    return inboundWebhooksCallCount === 1 ? getBuilder : deleteBuilder;
  });

  return { knex, getBuilder, deleteBuilder, deliveriesUpdateBuilder };
}

function makeUpdateWebhookKnex(row: InboundWebhookRowFixture) {
  const now = new Date('2026-05-11T03:00:00.000Z');
  let updatedPayload: Record<string, unknown> | null = null;

  const builder: any = {
    where: vi.fn(() => builder),
    update: vi.fn((payload: Record<string, unknown>) => {
      updatedPayload = payload;
      return builder;
    }),
    returning: vi.fn(async () => [
      inboundWebhookRow({
        ...row,
        ...(updatedPayload as Partial<InboundWebhookRowFixture>),
        updated_at: now,
      }),
    ]),
  };

  const knex = vi.fn((table: string) => {
    if (table !== 'inbound_webhooks') {
      throw new Error(`Unexpected table ${table}`);
    }

    return builder;
  });

  knex.fn = {
    now: vi.fn(() => now),
  };

  return { knex, builder, getUpdatedPayload: () => updatedPayload };
}

describe('inbound webhook server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureMocks.isEnterprise = true;
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

  it('returns no workflow consumer options outside Enterprise edition', async () => {
    featureMocks.isEnterprise = false;
    const knex = {};
    createTenantKnex.mockResolvedValue({ knex });

    const { listInboundWorkflowOptions } = await import('@/lib/actions/inboundWebhookActions');
    const result = await listInboundWorkflowOptions();

    expect(hasPermission).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1' }),
      'inbound_webhook',
      'read',
      knex,
    );
    expect(result).toEqual([]);
  });

  it('T021: upsertInboundWebhook rejects duplicate slug in the same tenant', async () => {
    const { knex, builder } = makeDuplicateSlugKnex({ inbound_webhook_id: 'existing-webhook-id' });
    createTenantKnex.mockResolvedValue({ knex });

    const { upsertInboundWebhook } = await import('@/lib/actions/inboundWebhookActions');
    const result = await upsertInboundWebhook(validUpsertInput());

    expect(result).toEqual({
      actionError: 'Inbound webhook slug "rmm-alerts" already exists.',
    });

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

  it('rejects workflow consumers outside Enterprise edition', async () => {
    featureMocks.isEnterprise = false;
    const knex = {};
    createTenantKnex.mockResolvedValue({ knex });

    const { upsertInboundWebhook } = await import('@/lib/actions/inboundWebhookActions');
    const result = await upsertInboundWebhook(validUpsertInput({
      handler_type: 'workflow',
      handler_config: {
        type: 'workflow',
        workflow_id: '11111111-1111-4111-8111-111111111111',
      },
    }));

    expect(result).toEqual({
      actionError: 'Inbound webhook workflow handlers require Enterprise edition.',
    });

    expect(hasPermission).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1' }),
      'inbound_webhook',
      'create',
      knex,
    );
    expect(setTenantSecret).not.toHaveBeenCalled();
  });

  it('T023: upsertInboundWebhook writes secrets to the vault and stores only vault metadata', async () => {
    const { knex, getInsertedPayload } = makeCreateKnex([]);
    createTenantKnex.mockResolvedValue({ knex });

    const { upsertInboundWebhook } = await import('@/lib/actions/inboundWebhookActions');
    const result = await upsertInboundWebhook(validUpsertInput());

    const insertedPayload = getInsertedPayload();
    expect(setTenantSecret).toHaveBeenCalledWith(
      'tenant-a',
      expect.stringContaining('inbound_webhook_'),
      '0123456789abcdef',
    );
    expect(insertedPayload?.auth_config).toMatchObject({
      type: 'hmac_sha256',
      signature_header: 'X-Signature',
      secret_vault_path: expect.stringContaining('inbound-webhooks/inbound_webhook_'),
    });
    expect(insertedPayload?.auth_config).not.toHaveProperty('secret');
    expect(result.webhook.authConfig).toMatchObject({
      type: 'hmac_sha256',
      signatureHeader: 'X-Signature',
      secretVaultPath: expect.stringContaining('inbound-webhooks/inbound_webhook_'),
    });
    expect(result.secret).toBe('0123456789abcdef');
  });

  it('T024: getInboundWebhook does not return raw secrets', async () => {
    const { knex, builder } = makeGetKnex(
      inboundWebhookRow({
        auth_config: {
          type: 'hmac_sha256',
          signature_header: 'X-Signature',
          secret: 'raw-db-secret-should-not-leak',
          secret_vault_path: 'inbound-webhooks/inbound_webhook_webhook-1_hmac_secret',
        },
      }),
    );
    createTenantKnex.mockResolvedValue({ knex });

    const { getInboundWebhook } = await import('@/lib/actions/inboundWebhookActions');
    const result = await getInboundWebhook('webhook-1');

    expect(builder.where).toHaveBeenCalledWith({ tenant: 'tenant-a', inbound_webhook_id: 'webhook-1' });
    expect(result?.authConfig).toEqual({
      type: 'hmac_sha256',
      signatureHeader: 'X-Signature',
      secretVaultPath: 'inbound-webhooks/inbound_webhook_webhook-1_hmac_secret',
    });
    expect(JSON.stringify(result)).not.toContain('raw-db-secret-should-not-leak');
  });

  it('T025: rotateInboundWebhookSecret overwrites the existing vault secret immediately', async () => {
    const existingVaultPath = 'inbound-webhooks/inbound_webhook_webhook-1_hmac_secret';
    const { knex, getBuilder, updateBuilder, getUpdatedPayload } = makeRotateKnex(
      inboundWebhookRow({
        auth_config: {
          type: 'hmac_sha256',
          signature_header: 'X-Signature',
          secret_vault_path: existingVaultPath,
        },
      }),
    );
    createTenantKnex.mockResolvedValue({ knex });

    const { rotateInboundWebhookSecret } = await import('@/lib/actions/inboundWebhookActions');
    const result = await rotateInboundWebhookSecret('webhook-1');

    expect(hasPermission).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1' }), 'inbound_webhook', 'update', knex);
    expect(getBuilder.where).toHaveBeenCalledWith({ tenant: 'tenant-a', inbound_webhook_id: 'webhook-1' });
    expect(setTenantSecret).toHaveBeenCalledWith(
      'tenant-a',
      'inbound_webhook_webhook-1_hmac_secret',
      result.secret,
    );
    expect(result.secret).toEqual(expect.any(String));
    expect(result.secret.length).toBeGreaterThan(20);
    expect(getUpdatedPayload()?.auth_config).toMatchObject({
      type: 'hmac_sha256',
      signature_header: 'X-Signature',
      secret_vault_path: existingVaultPath,
    });
    expect(updateBuilder.where).toHaveBeenCalledWith({ tenant: 'tenant-a', inbound_webhook_id: 'webhook-1' });
    expect(result.webhook.authConfig).toEqual({
      type: 'hmac_sha256',
      signatureHeader: 'X-Signature',
      secretVaultPath: existingVaultPath,
    });
    expect(JSON.stringify(result.webhook)).not.toContain(result.secret);
  });

  it('T026: deleteInboundWebhook retains deliveries and removes only the config plus auth secret', async () => {
    const { knex, getBuilder, deleteBuilder, deliveriesUpdateBuilder } = makeDeleteKnex(
      inboundWebhookRow({
        auth_config: {
          type: 'bearer',
          token_vault_path: 'inbound-webhooks/inbound_webhook_webhook-1_bearer_token',
        },
      }),
    );
    createTenantKnex.mockResolvedValue({ knex });

    const { deleteInboundWebhook } = await import('@/lib/actions/inboundWebhookActions');
    const result = await deleteInboundWebhook('webhook-1');

    expect(hasPermission).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1' }), 'inbound_webhook', 'delete', knex);
    expect(getBuilder.where).toHaveBeenCalledWith({ tenant: 'tenant-a', inbound_webhook_id: 'webhook-1' });
    expect(deleteBuilder.where).toHaveBeenCalledWith({ tenant: 'tenant-a', inbound_webhook_id: 'webhook-1' });
    expect(deleteBuilder.delete).toHaveBeenCalledTimes(1);
    expect(deliveriesUpdateBuilder.where).toHaveBeenCalledWith({ tenant: 'tenant-a', inbound_webhook_id: 'webhook-1' });
    expect(deliveriesUpdateBuilder.update).toHaveBeenCalledWith({ inbound_webhook_id: null });
    expect(deleteTenantSecret).toHaveBeenCalledWith(
      'tenant-a',
      'inbound_webhook_webhook-1_bearer_token',
    );
    expect(result).toEqual({ deleted: true, inboundWebhookId: 'webhook-1' });
  });

  it('T027: server actions reject when the user lacks inbound_webhook permission', async () => {
    const knex = vi.fn(() => {
      throw new Error('webhook data should not be queried after permission denial');
    });
    createTenantKnex.mockResolvedValue({ knex });
    hasPermission.mockResolvedValue(false);

    const { listInboundWebhooks } = await import('@/lib/actions/inboundWebhookActions');

    const result = await listInboundWebhooks();

    expect(result).toEqual({
      permissionError: 'Permission denied: inbound_webhook:read permission required',
    });
    expect(hasPermission).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1' }), 'inbound_webhook', 'read', knex);
    expect(knex).not.toHaveBeenCalled();
  });

  it('T028: core server actions require the tenant context supplied by withAuth', async () => {
    const actions = await import('@/lib/actions/inboundWebhookActions');

    const getHarness = makeGetKnex(inboundWebhookRow());
    createTenantKnex.mockResolvedValueOnce({ knex: getHarness.knex });
    await actions.getInboundWebhook('webhook-1');
    expect(createTenantKnex).toHaveBeenLastCalledWith('tenant-a');
    expect(getHarness.builder.where).toHaveBeenCalledWith({ tenant: 'tenant-a', inbound_webhook_id: 'webhook-1' });

    const createHarness = makeCreateKnex([]);
    createTenantKnex.mockResolvedValueOnce({ knex: createHarness.knex });
    await actions.upsertInboundWebhook(validUpsertInput({ slug: 'tenant-context-hook' }));
    expect(createTenantKnex).toHaveBeenLastCalledWith('tenant-a');
    expect(createHarness.collisionBuilder.where).toHaveBeenCalledWith({ tenant: 'tenant-a', slug: 'tenant-context-hook' });
    expect(createHarness.getInsertedPayload()).toMatchObject({ tenant: 'tenant-a' });

    const deleteHarness = makeDeleteKnex(inboundWebhookRow());
    createTenantKnex.mockResolvedValueOnce({ knex: deleteHarness.knex });
    await actions.deleteInboundWebhook('webhook-1');
    expect(createTenantKnex).toHaveBeenLastCalledWith('tenant-a');
    expect(deleteHarness.getBuilder.where).toHaveBeenCalledWith({ tenant: 'tenant-a', inbound_webhook_id: 'webhook-1' });
    expect(deleteHarness.deleteBuilder.where).toHaveBeenCalledWith({ tenant: 'tenant-a', inbound_webhook_id: 'webhook-1' });
  });

  it('T192: getInboundDelivery blocks cross-tenant delivery lookup', async () => {
    const { knex, builder } = makeGetDeliveryKnex(
      inboundDeliveryRow({
        tenant: 'tenant-b',
        delivery_id: 'delivery-foreign',
      }),
    );
    createTenantKnex.mockResolvedValue({ knex });

    const { getInboundDelivery } = await import('@/lib/actions/inboundWebhookActions');
    const result = await getInboundDelivery('delivery-foreign');

    expect(hasPermission).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1' }), 'inbound_webhook', 'read', knex);
    expect(builder.where).toHaveBeenCalledWith({ tenant: 'tenant-a', delivery_id: 'delivery-foreign' });
    expect(result).toBeNull();
  });

  it('T193: getInboundWebhook blocks cross-tenant config lookup', async () => {
    const { knex, builder } = makeGetKnex(
      inboundWebhookRow({
        tenant: 'tenant-b',
        inbound_webhook_id: 'webhook-foreign',
      }),
    );
    createTenantKnex.mockResolvedValue({ knex });

    const { getInboundWebhook } = await import('@/lib/actions/inboundWebhookActions');
    const result = await getInboundWebhook('webhook-foreign');

    expect(hasPermission).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1' }), 'inbound_webhook', 'read', knex);
    expect(builder.where).toHaveBeenCalledWith({ tenant: 'tenant-a', inbound_webhook_id: 'webhook-foreign' });
    expect(result).toBeNull();
  });

  it('T202: replay of a failed delivery creates a linked successful delivery using current config', async () => {
    const original = inboundDeliveryRow({
      delivery_id: 'delivery-failed-1',
      dispatch_status: 'failed',
      handler_outcome: { error: 'Missing required mapped field "title"' },
      response_status: 500,
      response_body: { delivery_id: 'delivery-failed-1', error: 'dispatch_failed' },
      request_body: { alert: { message: 'Fixed mapping alert' } },
    });
    const webhook = inboundWebhookRow({
      inbound_webhook_id: 'webhook-1',
      slug: 'rmm-alerts',
      handler_config: {
        type: 'direct_action',
        action: 'createTicket',
        field_mapping: {
          title: 'alert.message',
        },
      },
    });
    const replayed = inboundDeliveryRow({
      delivery_id: 'delivery-replay-1',
      dispatch_status: 'dispatched',
      handler_outcome: {
        action: 'createTicket',
        entity_type: 'ticket',
        entity_id: 'ticket-replay-1',
      },
      response_status: 200,
      response_body: { delivery_id: 'delivery-replay-1' },
      is_replay: true,
      replayed_from: 'delivery-failed-1',
    });
    const { knex, originalBuilder, webhookBuilder, replayedBuilder } = makeReplayKnex({
      original,
      webhook,
      replayed,
    });
    createTenantKnex.mockResolvedValue({ knex });
    createInboundDelivery.mockResolvedValue({ deliveryId: 'delivery-replay-1' });
    dispatchInboundWebhookHandler.mockResolvedValue({
      action: 'createTicket',
      entity_type: 'ticket',
      entity_id: 'ticket-replay-1',
    });

    const { replayInboundDelivery } = await import('@/lib/actions/inboundWebhookActions');
    const result = await replayInboundDelivery('delivery-failed-1');

    expect(hasPermission).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1' }), 'inbound_webhook', 'replay', knex);
    expect(originalBuilder.where).toHaveBeenCalledWith({ tenant: 'tenant-a', delivery_id: 'delivery-failed-1' });
    expect(webhookBuilder.where).toHaveBeenCalledWith({ tenant: 'tenant-a', inbound_webhook_id: 'webhook-1' });
    expect(createInboundDelivery).toHaveBeenCalledWith(
      knex,
      expect.objectContaining({
        tenant: 'tenant-a',
        inboundWebhookId: 'webhook-1',
        requestBody: { alert: { message: 'Fixed mapping alert' } },
        authStatus: 'verified',
        isReplay: true,
        replayedFrom: 'delivery-failed-1',
      }),
    );
    expect(dispatchInboundWebhookHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        webhook: expect.objectContaining({
          slug: 'rmm-alerts',
          handler_config: expect.objectContaining({
            field_mapping: {
              title: 'alert.message',
            },
          }),
        }),
        deliveryId: 'delivery-replay-1',
        body: { alert: { message: 'Fixed mapping alert' } },
      }),
    );
    expect(updateInboundDeliveryOutcome).toHaveBeenCalledWith(
      knex,
      expect.objectContaining({
        tenant: 'tenant-a',
        deliveryId: 'delivery-replay-1',
        dispatchStatus: 'dispatched',
        responseStatus: 200,
        responseBody: { delivery_id: 'delivery-replay-1' },
      }),
    );
    expect(replayedBuilder.where).toHaveBeenCalledWith({ tenant: 'tenant-a', delivery_id: 'delivery-replay-1' });
    expect(result).toMatchObject({
      deliveryId: 'delivery-replay-1',
      dispatchStatus: 'dispatched',
      isReplay: true,
      replayedFrom: 'delivery-failed-1',
      handlerOutcome: {
        action: 'createTicket',
        entity_type: 'ticket',
        entity_id: 'ticket-replay-1',
      },
    });
  });

  it('T082: clearSamplePayload removes the saved sample and capture window', async () => {
    const { knex, builder, getUpdatedPayload } = makeUpdateWebhookKnex(
      inboundWebhookRow({
        sample_payload: { alert: { id: 'alert-123' } },
        sample_capture_expires_at: '2026-05-11T03:05:00.000Z',
      }),
    );
    createTenantKnex.mockResolvedValue({ knex });

    const { clearSamplePayload } = await import('@/lib/actions/inboundWebhookActions');
    const result = await clearSamplePayload('webhook-1');

    expect(hasPermission).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1' }), 'inbound_webhook', 'update', knex);
    expect(builder.where).toHaveBeenCalledWith({ tenant: 'tenant-a', inbound_webhook_id: 'webhook-1' });
    expect(getUpdatedPayload()).toMatchObject({
      sample_payload: null,
      sample_capture_expires_at: null,
    });
    expect(result.samplePayload).toBeNull();
    expect(result.sampleCaptureExpiresAt).toBeNull();
  });
});
