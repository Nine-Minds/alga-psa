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
// Notification delivery is imported by the EE settings module, but saving an
// organizer does not publish notifications. Fail if that boundary is crossed;
// do not require unrelated event-schema dist artifacts just to load the action.
vi.mock('@alga-psa/workflow-streams', () => {
  const unexpectedNotification = () => { throw new Error('Organizer routing must not build notifications'); };
  return { buildNotificationDeliveredPayload: unexpectedNotification,
    buildNotificationFailedPayload: unexpectedNotification, buildNotificationSentPayload: unexpectedNotification };
});
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: () => {
  throw new Error('Organizer routing must not publish workflow events');
} }));
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
  it.each([
    { implementation: 'workspace', scenario: 'save' },
    { implementation: 'enterprise', scenario: 'save' },
    { implementation: 'workspace', scenario: 'unknown organizer recovery' },
    { implementation: 'enterprise', scenario: 'unknown organizer recovery' },
  ] as const)('T072: $implementation $scenario through real Graph HTTP', async ({ implementation, scenario }) => {
    const host = new EmulatorHost({ emulators: [msgraph], controlPort: 0, ports: { msgraph: 0 } });
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
      vi.stubEnv('MICROSOFT_GRAPH_BASE_URL', `${base}/v1.0`);
      vi.stubEnv('MICROSOFT_LOGIN_BASE_URL', base);
      vi.stubEnv('TEAMS_EMULATOR_MODE', 'true');
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('NEXT_PUBLIC_EDITION', 'enterprise');
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
      const save = async (settings: typeof input & { sendMeetingInvites?: boolean }) => implementation === 'workspace'
        ? saveTeamsIntegrationSettings(settings)
        : (await import('../../../../ee/packages/microsoft-teams/src/lib/actions/integrations/teamsActions'))
          .saveTeamsIntegrationSettingsImpl(hoisted.state.mockUser, hoisted.state.mockCtx, settings);
      const result = await save(input);
      expect(blocked).toEqual([]);
      expect(result).toMatchObject({ success: true, integration: {
        defaultMeetingOrganizerUpn: 'scheduler@acme.com', defaultMeetingOrganizerObjectId: 'organizer-object',
      } });
      expect(teamsIntegrations).toHaveLength(1);
      expect(teamsIntegrations[0]).toMatchObject({ default_meeting_organizer_upn: 'scheduler@acme.com',
        default_meeting_organizer_object_id: 'organizer-object' });
      if (scenario === 'unknown organizer recovery') {
        const originalRows = structuredClone(teamsIntegrations);
        const changed = { ...input, defaultMeetingOrganizerUpn: 'replacement@acme.com', sendMeetingInvites: false };
        const failed = await save(changed);
        expect(failed).toEqual({ success: false, error: 'Microsoft could not find the configured meeting organizer' });
        expect(teamsIntegrations).toEqual(originalRows);
        const failedJournal = await (await nativeFetch(`${control}/control/msgraph/requests`)).json();
        expect(failedJournal.result.complete).toBe(true);
        expect(failedJournal.result.requests).toEqual(expect.arrayContaining([
          expect.objectContaining({ method: 'GET', path: '/v1.0/users/replacement%40acme.com', status: 404 }),
        ]));
        await seed('directory-user', { id: 'replacement-object', displayName: 'Replacement',
          userPrincipalName: 'replacement@acme.com', mail: 'replacement@acme.com', accountEnabled: true });
        expect(await save(changed)).toMatchObject({ success: true, integration: {
          defaultMeetingOrganizerUpn: 'replacement@acme.com', defaultMeetingOrganizerObjectId: 'replacement-object',
          sendMeetingInvites: false,
        } });
        expect(teamsIntegrations).toHaveLength(1);
        expect(teamsIntegrations[0]).toMatchObject({ selected_profile_id: 'profile-1',
          default_meeting_organizer_upn: 'replacement@acme.com', default_meeting_organizer_object_id: 'replacement-object',
          send_meeting_invites: false });
        const recoveredJournal = await (await nativeFetch(`${control}/control/msgraph/requests`)).json();
        expect(recoveredJournal.result.complete).toBe(true);
        expect(recoveredJournal.result.requests.filter((request: { path: string }) => request.path === '/v1.0/users/replacement%40acme.com'))
          .toEqual([
            expect.objectContaining({ method: 'GET', status: 404 }),
            expect.objectContaining({ method: 'GET', status: 200 }),
          ]);
        expect(blocked).toEqual([]);
      }
      const journal = await (await nativeFetch(`${control}/control/msgraph/requests`)).json();
      expect(journal.result.complete).toBe(true);
      expect(journal.result.requests).toEqual(expect.arrayContaining([
        expect.objectContaining({ method: 'POST', path: '/organizer-tenant/oauth2/v2.0/token', status: 200 }),
        expect.objectContaining({ method: 'GET', path: '/v1.0/users/scheduler%40acme.com', status: 200 }),
      ]));
    } finally {
      globalThis.fetch = nativeFetch;
      vi.unstubAllEnvs();
      if (startedHost) await host.stop();
    }
  }, 20000);

});
