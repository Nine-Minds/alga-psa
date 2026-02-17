import { beforeEach, describe, expect, it, vi } from 'vitest';

let secretProvider: { getTenantSecret: (tenant: string, key: string) => Promise<string | null> };
let knexMock: any;

let remoteClients: any[] = [];
let throwOnClientList: Error | null = null;

type DbState = {
  rmm_alerts: Array<any>;
};

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => secretProvider),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: knexMock })),
}));

vi.mock('@alga-psa/assets/actions/assetActions', () => ({
  createAsset: vi.fn(),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/integrations/lib/rmm/tacticalrmm/tacticalApiClient', async () => {
  const actual: any = await vi.importActual(
    '@alga-psa/integrations/lib/rmm/tacticalrmm/tacticalApiClient'
  );

  class TacticalRmmClientMock {
    async listAllBeta(args: any) {
      if (String(args?.path) === '/api/beta/v1/client/') {
        if (throwOnClientList) throw throwOnClientList;
        return remoteClients;
      }
      return [];
    }
    async request(_args: any) {
      throw new Error('request not implemented in this mock');
    }
    async checkCreds() {
      return { totp: false };
    }
    async login() {
      return { token: 'token' };
    }
  }

  return { ...actual, TacticalRmmClient: TacticalRmmClientMock };
});

describe('Tactical event-bus publishing', () => {
  let state: DbState;

  beforeEach(async () => {
    remoteClients = [];
    throwOnClientList = null;

    state = { rmm_alerts: [] };

    secretProvider = {
      getTenantSecret: vi.fn(async (_tenant: string, key: string) => {
        if (key === 'tacticalrmm_api_key') return 'api_key_1';
        if (key === 'tacticalrmm_webhook_secret') return 'expected_secret';
        return null;
      }),
    };

    const integrationRow = {
      integration_id: 'integration_1',
      instance_url: 'https://tactical.example',
      settings: { auth_mode: 'api_key' },
    };

    knexMock = ((table: string) => {
      if (table === 'rmm_integrations') {
        return {
          where: vi.fn().mockReturnThis(),
          first: vi.fn(async () => integrationRow),
          update: vi.fn(async () => 1),
        };
      }

      if (table === 'rmm_organization_mappings') {
        return {
          where: vi.fn().mockReturnThis(),
          select: vi.fn(async () => []),
          insert: (_row: any) => ({
            onConflict: (_cols: string[]) => ({
              merge: async (_merge: any) => undefined,
            }),
          }),
        };
      }

      if (table === 'tenant_external_entity_mappings') {
        return {
          where: vi.fn().mockReturnThis(),
          first: vi.fn(async () => undefined),
        };
      }

      if (table === 'rmm_alerts') {
        return {
          where: vi.fn().mockReturnThis(),
          first: vi.fn(async () => undefined),
          insert: vi.fn(async (row: any) => {
            state.rmm_alerts.push(row);
            return [row];
          }),
          update: vi.fn(async () => 1),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }) as any;

    knexMock.fn = { now: vi.fn(() => new Date('2026-02-13T12:00:00.000Z')) };

    const { publishEvent } = await import('@alga-psa/event-bus/publishers');
    vi.mocked(publishEvent).mockClear();
  });

  it('publishes sync started/completed events for org sync', async () => {
    const { publishEvent } = await import('@alga-psa/event-bus/publishers');
    const publish = vi.mocked(publishEvent);

    const { syncTacticalRmmOrganizations } = await import(
      '@alga-psa/msp-composition/integrations'
    );

    remoteClients = [{ id: 1, name: 'Org One' }];

    const res = await syncTacticalRmmOrganizations({ user_id: 'u1' } as any, { tenant: 'tenant_1' });
    expect(res.success).toBe(true);

    const eventTypes = publish.mock.calls.map((c) => (c[0] as any)?.eventType);
    expect(eventTypes).toContain('RMM_SYNC_STARTED');
    expect(eventTypes).toContain('RMM_SYNC_COMPLETED');
  });

  it('publishes sync failed event when org sync throws after start', async () => {
    const { publishEvent } = await import('@alga-psa/event-bus/publishers');
    const publish = vi.mocked(publishEvent);

    const { syncTacticalRmmOrganizations } = await import(
      '@alga-psa/msp-composition/integrations'
    );

    throwOnClientList = new Error('boom');

    const res = await syncTacticalRmmOrganizations({ user_id: 'u1' } as any, { tenant: 'tenant_1' });
    expect(res.success).toBe(false);

    const eventTypes = publish.mock.calls.map((c) => (c[0] as any)?.eventType);
    expect(eventTypes).toContain('RMM_SYNC_STARTED');
    expect(eventTypes).toContain('RMM_SYNC_FAILED');
    expect(eventTypes).not.toContain('RMM_SYNC_COMPLETED');
  });

  it('publishes RMM_WEBHOOK_RECEIVED on valid webhook calls', async () => {
    const { publishEvent } = await import('@alga-psa/event-bus/publishers');
    const publish = vi.mocked(publishEvent);

    const { POST } = await import('server/src/app/api/webhooks/tacticalrmm/route');
    const req = new Request('http://localhost/api/webhooks/tacticalrmm?tenant=tenant_1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Alga-Webhook-Secret': 'expected_secret',
      },
      body: JSON.stringify({ agent_id: 'a1', event: 'trigger', severity: 'critical' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const eventTypes = publish.mock.calls.map((c) => (c[0] as any)?.eventType);
    expect(eventTypes).toContain('RMM_WEBHOOK_RECEIVED');
  });
});

