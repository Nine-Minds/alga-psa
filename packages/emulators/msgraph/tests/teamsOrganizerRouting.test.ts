import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import msgraph from '../src/index';

const nativeFetch = globalThis.fetch;
const hoisted = vi.hoisted(() => ({
  state: { mockUser: { user_id: 'user-1', user_type: 'internal' }, mockCtx: { tenant: 'tenant-1' } },
  tables: {} as Record<string, Array<Record<string, any>>>,
  secrets: new Map<string, string>(),
}));
vi.mock('@alga-psa/auth/withAuth', () => ({ withAuth: (action: any) => (...args: any[]) =>
  action(hoisted.state.mockUser, hoisted.state.mockCtx, ...args) }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
// EE also imports the SSO registry through notification delivery. Organizer
// validation does not use SSO; keep that unrelated NextAuth runtime isolated
// under the package runner as well as the server runner.
vi.mock('@alga-psa/auth', () => ({ getSSORegistry: vi.fn(() => {
  throw new Error('Organizer routing must not invoke SSO');
}) }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecretProviderInstance: async () => ({
  getTenantSecret: async (tenant: string, key: string) => hoisted.secrets.get(`${tenant}:${key}`) ?? null,
}) }));
vi.mock('@alga-psa/db', () => {
  const knex = Object.assign((table: string) => {
    const filters: Record<string, any>[] = [];
    const rows = () => (hoisted.tables[table] ?? []).filter(row =>
      filters.every(filter => Object.entries(filter).every(([key, value]) => row[key] === value)));
    const query = {
      where: (filter: Record<string, any>) => { filters.push(filter); return query; },
      andWhere: (callback: any) => { callback({ whereNull: () => ({ orWhere: () => undefined }) }); return query; },
      first: async () => rows()[0],
      select: async () => rows(),
      insert: async (value: Record<string, any>) => { (hoisted.tables[table] ??= []).push(value); return 1; },
      update: async (value: Record<string, any>) => { const matches = rows(); matches.forEach(row => Object.assign(row, value)); return matches.length; },
    };
    return query;
  }, { fn: { now: () => new Date() } });
  return { createTenantKnex: async () => ({ knex }),
    tenantDb: (conn: any, tenant: string) => ({ table: (table: string) => conn(table).where({ tenant }), unscoped: (table: string) => conn(table) }) };
});
import { saveTeamsIntegrationSettings } from '../../../integrations/src/actions/integrations/teamsActions';

const tenantSecrets = hoisted.secrets;
const teamsIntegrations: Array<Record<string, any>> = [];
function addMicrosoftProfile(input: { tenant: string; profileId: string; clientId: string; tenantId: string; secretRef: string }) {
  hoisted.tables.microsoft_profiles.push({ tenant: input.tenant, profile_id: input.profileId, client_id: input.clientId,
    tenant_id: input.tenantId, client_secret_ref: input.secretRef, is_archived: false });
}

describe('Teams organizer provider routing', () => {
  beforeEach(() => {
    teamsIntegrations.length = 0;
    hoisted.tables = { microsoft_profiles: [], teams_integrations: teamsIntegrations, microsoft_profile_consumer_bindings: [] };
    tenantSecrets.clear();
  });
  it.each(['workspace', 'enterprise'] as const)('%s saves the organizer validated by real Graph HTTP', async implementation => {
    const host = new EmulatorHost({ emulators: [msgraph], controlPort: 0, ports: { msgraph: 0 } });
    const keys = ['MICROSOFT_GRAPH_BASE_URL', 'MICROSOFT_LOGIN_BASE_URL', 'TEAMS_EMULATOR_MODE', 'NODE_ENV', 'NEXT_PUBLIC_EDITION'] as const;
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    const blocked: string[] = [];
    let startedHost = false;
    try {
      const started = await host.start();
      startedHost = true;
      const base = `http://127.0.0.1:${started.ports.msgraph}`;
      const control = `http://127.0.0.1:${started.controlPort}`;
      const seed = async (kind: string, value: unknown) => {
        const response = await nativeFetch(`${control}/control/msgraph/seed/${kind}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
        });
        expect(response.ok).toBe(true);
        expect((await response.json()).ok).toBe(true);
      };
      await seed('client', { clientId: 'organizer-client', clientSecret: 'organizer-secret' });
      await seed('directory-user', { id: 'organizer-object', displayName: 'Scheduler', userPrincipalName: 'scheduler@acme.com',
        mail: 'scheduler@acme.com', accountEnabled: true });
      process.env.MICROSOFT_GRAPH_BASE_URL = `${base}/v1.0`;
      process.env.MICROSOFT_LOGIN_BASE_URL = base;
      process.env.TEAMS_EMULATOR_MODE = 'true';
      process.env.NODE_ENV = 'test';
      process.env.NEXT_PUBLIC_EDITION = 'enterprise';
      // Exercise native HTTP, while forbidding an accidental live-vendor request.
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin !== base) {
          blocked.push(url.origin);
          return Promise.reject(new Error('Unexpected external provider route'));
        }
        return nativeFetch(input, init);
      }) as typeof fetch;
      addMicrosoftProfile({ tenant: 'tenant-1', profileId: 'profile-1', clientId: 'organizer-client',
        tenantId: 'organizer-tenant', secretRef: 'organizer-secret-ref' });
      tenantSecrets.set('tenant-1:organizer-secret-ref', 'organizer-secret');
      const input = { selectedProfileId: 'profile-1', installStatus: 'install_pending' as const,
        defaultMeetingOrganizerUpn: 'scheduler@acme.com' };
      const result = implementation === 'workspace' ? await saveTeamsIntegrationSettings(input)
        : await (await import('../../../../ee/packages/microsoft-teams/src/lib/actions/integrations/teamsActions'))
          .saveTeamsIntegrationSettingsImpl(hoisted.state.mockUser, hoisted.state.mockCtx, input);
      expect(blocked).toEqual([]);
      expect(result).toMatchObject({ success: true, integration: { defaultMeetingOrganizerObjectId: 'organizer-object' } });
      expect(teamsIntegrations[0]).toMatchObject({ default_meeting_organizer_object_id: 'organizer-object' });
      const journal = await (await nativeFetch(`${control}/control/msgraph/requests`)).json();
      expect(journal.result.complete).toBe(true);
      expect(journal.result.requests).toEqual(expect.arrayContaining([
        expect.objectContaining({ method: 'POST', path: '/organizer-tenant/oauth2/v2.0/token', status: 200 }),
        expect.objectContaining({ method: 'GET', path: '/v1.0/users/scheduler%40acme.com', status: 200 }),
      ]));
    } finally {
      globalThis.fetch = nativeFetch;
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
      }
      if (startedHost) await host.stop();
    }
  }, 20000);

});
