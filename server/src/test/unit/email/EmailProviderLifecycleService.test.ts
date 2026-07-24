import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAdminConnection: vi.fn(),
  graphDelete: vi.fn(),
  graphInitialize: vi.fn(),
  gmailStop: vi.fn(),
  gmailRegister: vi.fn(),
  operations: [] as string[],
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: mocks.getAdminConnection,
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: (knex: any) => ({ table: (table: string) => knex(table) }),
}));
vi.mock('@alga-psa/shared/services/email/microsoftEmailProviderConfig', () => ({
  buildMicrosoftEmailProviderConfig: vi.fn(async (config) => config),
}));
vi.mock('@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter', () => ({
  MicrosoftGraphAdapter: vi.fn(function MicrosoftGraphAdapter() {
    return {
      deleteSubscription: (...args: any[]) => mocks.graphDelete(...args),
      initializeWebhook: (...args: any[]) => mocks.graphInitialize(...args),
    };
  }),
}));
vi.mock('@alga-psa/shared/services/email/providers/GmailAdapter', () => ({
  GmailAdapter: vi.fn(function GmailAdapter() {
    return {
      stopWatch: (...args: any[]) => mocks.gmailStop(...args),
      registerWebhookSubscription: (...args: any[]) => mocks.gmailRegister(...args),
    };
  }),
}));

import { EmailProviderLifecycleService } from '@alga-psa/shared/services/email/EmailProviderLifecycleService';

function createState(providerType: 'microsoft' | 'google' | 'imap') {
  const state: any = {
    provider: {
      id: `provider-${providerType}`,
      tenant: 'tenant-1',
      provider_type: providerType,
      provider_name: 'Support',
      mailbox: 'support@example.com',
      is_active: true,
      status: 'connected',
      inbound_paused_at: null,
      inbound_pause_reason: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    microsoft_email_provider_config: {
      email_provider_id: 'provider-microsoft',
      tenant: 'tenant-1',
      delivery_mode: 'webhook',
      webhook_subscription_id: 'graph-sub-1',
      webhook_expires_at: new Date(Date.now() + 60_000).toISOString(),
      access_token: 'access',
      refresh_token: 'refresh',
      token_expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
    google_email_provider_config: {
      email_provider_id: 'provider-google',
      tenant: 'tenant-1',
      watch_expiration: new Date(Date.now() + 60_000).toISOString(),
      access_token: 'access',
      refresh_token: 'refresh',
      token_expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
    imap_email_provider_config: {
      email_provider_id: 'provider-imap',
      tenant: 'tenant-1',
    },
  };

  const knex: any = vi.fn((table: string) => {
    let requireNull = false;
    let requireNotNull = false;
    const builder: any = {
      where() {
        return builder;
      },
      whereNull() {
        requireNull = true;
        return builder;
      },
      whereNotNull() {
        requireNotNull = true;
        return builder;
      },
      async first() {
        if (table === 'email_providers') return state.provider;
        return state[table];
      },
      async update(values: any) {
        if (table === 'email_providers') {
          if (requireNull && state.provider.inbound_paused_at) return 0;
          if (requireNotNull && !state.provider.inbound_paused_at) return 0;
          Object.assign(state.provider, values);
        } else {
          Object.assign(state[table], values);
        }
        mocks.operations.push(`update:${table}`);
        return 1;
      },
      async del() {
        mocks.operations.push(`delete:${table}`);
        if (table === 'email_providers') state.provider = null;
        else state[table] = null;
        return 1;
      },
    };
    return builder;
  });
  knex.fn = {
    now: vi.fn(() => '2026-07-23T18:00:00.000Z'),
  };
  mocks.getAdminConnection.mockResolvedValue(knex);
  return state;
}

describe('EmailProviderLifecycleService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.operations.length = 0;
    mocks.graphDelete.mockImplementation(async () => {
      mocks.operations.push('external:graph-delete');
    });
    mocks.graphInitialize.mockResolvedValue({ success: true, subscriptionId: 'graph-sub-new' });
    mocks.gmailStop.mockImplementation(async () => {
      mocks.operations.push('external:gmail-stop');
    });
    mocks.gmailRegister.mockResolvedValue(undefined);
  });

  it.each([
    ['T019', 'microsoft', 'external:graph-delete', 'webhook_subscription_id'],
    ['T020', 'google', 'external:gmail-stop', 'watch_expiration'],
    ['T021', 'imap', null, null],
  ] as const)('%s: pauses %s and tears down its notification source', async (
    _id,
    providerType,
    expectedExternalOperation,
    clearedField
  ) => {
    const state = createState(providerType);

    await expect(
      new EmailProviderLifecycleService().pauseProvider(
        `provider-${providerType}`,
        'tenant-1',
        'manual'
      )
    ).resolves.toBe(true);

    expect(state.provider).toMatchObject({
      inbound_paused_at: '2026-07-23T18:00:00.000Z',
      inbound_pause_reason: 'manual',
    });
    if (expectedExternalOperation) expect(mocks.operations).toContain(expectedExternalOperation);
    if (clearedField) {
      expect(state[`${providerType === 'microsoft' ? 'microsoft' : 'google'}_email_provider_config`][clearedField])
        .toBeNull();
    }
  });

  it('T022: keeps the database pause when external teardown fails', async () => {
    const state = createState('microsoft');
    mocks.graphDelete.mockRejectedValue(new Error('Graph unavailable'));

    await expect(
      new EmailProviderLifecycleService().pauseProvider('provider-microsoft', 'tenant-1', 'manual')
    ).resolves.toBe(true);

    expect(state.provider.inbound_pause_reason).toBe('manual');
    expect(state.microsoft_email_provider_config.webhook_subscription_id).toBeNull();
  });

  it('T023: an already-paused provider is an idempotent no-op', async () => {
    const state = createState('google');
    const service = new EmailProviderLifecycleService();
    await service.pauseProvider('provider-google', 'tenant-1', 'manual');
    const originalPausedAt = state.provider.inbound_paused_at;

    await expect(
      service.pauseProvider('provider-google', 'tenant-1', 'tenant_cancelled')
    ).resolves.toBe(false);

    expect(state.provider.inbound_paused_at).toBe(originalPausedAt);
    expect(state.provider.inbound_pause_reason).toBe('manual');
    expect(mocks.gmailStop).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['T024', 'microsoft', 'graph'],
    ['T025', 'google', 'gmail'],
    ['T026', 'imap', null],
  ] as const)('%s: resumes %s with the appropriate registration behavior', async (
    _id,
    providerType,
    registration
  ) => {
    const state = createState(providerType);
    state.provider.inbound_paused_at = '2026-07-23T18:00:00.000Z';
    state.provider.inbound_pause_reason = 'manual';

    const result = await new EmailProviderLifecycleService().resumeProvider(
      `provider-${providerType}`,
      'tenant-1'
    );

    expect(state.provider.inbound_paused_at).toBeNull();
    expect(state.provider.inbound_pause_reason).toBeNull();
    expect(result).toMatchObject({
      resumed: true,
      webhookRegistered: registration !== null,
    });
    expect(mocks.graphInitialize).toHaveBeenCalledTimes(registration === 'graph' ? 1 : 0);
    expect(mocks.gmailRegister).toHaveBeenCalledTimes(registration === 'gmail' ? 1 : 0);
  });

  it('T027: registration failure leaves the provider resumed and surfaces error status', async () => {
    const state = createState('microsoft');
    state.provider.inbound_paused_at = '2026-07-23T18:00:00.000Z';
    state.provider.inbound_pause_reason = 'manual';
    mocks.graphInitialize.mockRejectedValue(new Error('expired refresh token'));

    const result = await new EmailProviderLifecycleService().resumeProvider(
      'provider-microsoft',
      'tenant-1'
    );

    expect(result).toMatchObject({
      resumed: true,
      webhookRegistered: false,
      error: 'expired refresh token',
    });
    expect(state.provider).toMatchObject({
      inbound_paused_at: null,
      inbound_pause_reason: null,
      status: 'error',
      error_message: 'expired refresh token',
    });
  });

  it('T028: pause/resume round-trip restores an ingestable webhook provider', async () => {
    const state = createState('microsoft');
    const service = new EmailProviderLifecycleService();

    await service.pauseProvider('provider-microsoft', 'tenant-1', 'manual');
    expect(Boolean(state.provider.is_active && !state.provider.inbound_paused_at)).toBe(false);

    const result = await service.resumeProvider('provider-microsoft', 'tenant-1');
    expect(result).toMatchObject({ resumed: true, webhookRegistered: true });
    expect(Boolean(state.provider.is_active && !state.provider.inbound_paused_at)).toBe(true);
    expect(mocks.graphInitialize).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['T029', 'microsoft', 'external:graph-delete'],
    ['T030', 'google', 'external:gmail-stop'],
  ] as const)('%s: delete tears down %s before removing rows', async (
    _id,
    providerType,
    externalOperation
  ) => {
    createState(providerType);
    if (providerType === 'google') {
      mocks.gmailStop.mockImplementation(async () => {
        mocks.operations.push('external:gmail-stop');
        throw new Error('revoked');
      });
    }

    await new EmailProviderLifecycleService().deleteProvider(
      `provider-${providerType}`,
      'tenant-1'
    );

    expect(mocks.operations).toContain(externalOperation);
    expect(mocks.operations.indexOf(externalOperation)).toBeLessThan(
      mocks.operations.indexOf(`delete:${providerType}_email_provider_config`)
    );
    expect(mocks.operations).toContain('delete:email_providers');
  });
});
