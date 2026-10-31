import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CO_MANAGED_TENANT, clearWriteAdmissionCacheForTests, createFakeKnex, withReadOnlyWorkspace, type FakeKnex } from './fakeKnex';

const h = vi.hoisted(() => ({ fake: null as any }));
const ID = '00000000-0000-4000-8000-000000000001';
const CLIENT = '00000000-0000-4000-8000-000000000002';
const NOW = '2026-10-27T12:00:00.000Z';

// Keep withAuth, localization, tenantDb, transactions and every mutation real.
// Only identity, authorization decisions, the connection and downstream effects are supplied.
vi.mock('../../../../../packages/auth/src/lib/getCurrentUser', () => ({
  getCurrentUserWithRevocationCheck: async () => ({
    user_id: '00000000-0000-4000-8000-000000000003', tenant: '10000000-0000-4000-8000-000000000001',
    user_type: 'internal', first_name: 'Test', last_name: 'User', roles: [{ role_id: ID }],
  }),
  getCurrentUser: async () => null,
}));
vi.unmock('@alga-psa/auth');
vi.mock('../../../../../packages/auth/src/lib/rbac', async (original) => ({ ...(await original<object>()), hasPermission: async () => true }));
vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({ getServerTranslation: async () => ({ t: (_key: string, options: any) => options.defaultValue }) }));
vi.mock('@alga-psa/db', async (original) => ({
  ...(await original<object>()), createTenantKnex: async () => ({ knex: h.fake.knex, tenant: CO_MANAGED_TENANT }),
}));
vi.mock('@alga-psa/authorization/kernel', async (original) => ({
  ...(await original<object>()), createAuthorizationKernel: () => ({ authorizeResource: async () => ({ allowed: true }) }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(), publishWorkflowEvent: vi.fn(), publishStoredWorkflowEvent: vi.fn(),
  publishNonCatalogWorkflowEvent: vi.fn(), publishNonCatalogEventByName: vi.fn(), publishUnregisteredEventType: vi.fn(), publishBuiltWorkflowPayload: vi.fn(),
}));
vi.mock('@alga-psa/db/commentEventRegistry', () => ({ publishCommentEvent: vi.fn() }));
vi.mock('@alga-psa/tickets/lib/liveUpdates', () => ({ publishTicketUpdate: vi.fn() }));
vi.mock('@alga-psa/tickets/lib/cannedResponses/commentMerge', () => ({ resolveCommentMergeTokens: async (_db: unknown, _tenant: string, _ticket: string, _user: string, _type: string, note: string) => note }));
vi.mock('@alga-psa/formatting/blocknoteUtils', () => ({ convertBlockNoteToMarkdown: async () => 'hello' }));
vi.mock('@alga-psa/tickets/actions/ticketBundleUtils', () => ({ maybeReopenBundleMasterFromChildReply: vi.fn(), revertBundlePropagationForChild: vi.fn() }));

let fake: FakeKnex;
let rows: Record<string, Record<string, unknown>>;
beforeEach(() => {
  clearWriteAdmissionCacheForTests();
  rows = {
    assets: { tenant: CO_MANAGED_TENANT, asset_id: ID, client_id: CLIENT, asset_type: 'custom-device', name: 'Old', asset_tag: 'TAG', status: 'active', created_at: NOW, updated_at: NOW },
    projects: { tenant: CO_MANAGED_TENANT, project_id: ID, client_id: CLIENT, project_name: 'Old', is_closed: false, created_at: NOW, updated_at: NOW },
    project_tasks: { tenant: CO_MANAGED_TENANT, task_id: ID, task_name: 'Old', phase_id: ID, project_id: ID, project_status_mapping_id: ID, created_at: NOW, updated_at: NOW },
    project_phases: { phase_id: ID, project_id: ID, wbs_code: '1' },
    users: { user_id: ID, user_type: 'internal', first_name: 'Test', last_name: 'User' },
    tickets: { ticket_id: ID, client_id: CLIENT, response_state: null, status_id: ID },
    comments: { comment_id: ID, thread_id: ID, ticket_id: ID, user_id: ID, note: 'hello', created_at: NOW, updated_at: NOW },
  };
  fake = createFakeKnex((sql, bindings) => {
    if (/gen_random_uuid\(\)/i.test(sql)) return [{ comment_id: ID, thread_id: ID }];
    const mutation = /^\s*update "(\w+)" set (.*?) where /i.exec(sql);
    if (mutation && rows[mutation[1]]) {
      const patch: Record<string, unknown> = {};
      for (const field of mutation[2].matchAll(/"(\w+)" = \$(\d+)/g)) patch[field[1]] = bindings[Number(field[2]) - 1];
      rows[mutation[1]] = { ...rows[mutation[1]], ...patch };
      return [rows[mutation[1]]];
    }
    const table = /(?:from|insert into) "(\w+)"/i.exec(sql)?.[1];
    return table && rows[table] ? [{ ...rows[table] }] : undefined;
  });
  h.fake = fake;
});
afterEach(async () => {
  await fake.destroy();
  clearWriteAdmissionCacheForTests();
  vi.unstubAllEnvs();
});

const surfaces = [
  ['project', 'projects', async () => (await import('@alga-psa/projects/actions/projectActions')).updateProject(ID, { project_name: 'Renamed project' }), { project_id: ID, project_name: 'Renamed project' }],
  ['task', 'project_tasks', async () => (await import('@alga-psa/projects/actions/projectTaskActions')).updateTaskWithChecklist(ID, { task_name: 'Renamed task' }), { task_id: ID, task_name: 'Renamed task' }],
  ['asset', 'assets', async () => (await import('@alga-psa/assets/actions/assetActions')).updateAsset(ID, { name: 'Renamed asset' }), { asset_id: ID, name: 'Renamed asset' }],
  ['comment', 'comments', async () => (await import('@alga-psa/tickets/actions/comment-actions/commentActions')).createComment({ ticket_id: ID, note: 'hello', is_internal: true } as any), ID],
] as const;

describe.each(surfaces)('%s public action', (_surface, table, run, success) => {
  it('returns its native localized refusal from the real mutation and writes nothing', async () => {
    const result = await withReadOnlyWorkspace(run);
    expect(result).toMatchObject({ actionError: expect.stringContaining('read-only'), messageKey: 'common:errors.coManaged.readOnly' });
    expect(fake.writes()).toEqual([]);
    expect(fake.statements.some((sql) => /^rollback/i.test(sql))).toBe(true);
  }, 60_000);

  it('completes and commits the same mutation with the kill switch off', async () => {
    // Warm a denial first, so this also tests cached decisions at the public boundary.
    await withReadOnlyWorkspace(async () => {
      await run();
      fake.statements.length = 0;
      vi.stubEnv('FORCE_CAPABILITIES', 'co-managed:off');
      const result = await run();
      if (typeof success === 'string') expect(result).toBe(success);
      else expect(result).toMatchObject(success);
      expect(fake.writes().some((sql) => new RegExp(`^(?:update|insert into) "${table}"`, 'i').test(sql))).toBe(true);
      expect(fake.statements.some((sql) => /^commit/i.test(sql))).toBe(true);
      expect(fake.statements.some((sql) => /^rollback/i.test(sql))).toBe(false);
    });
  }, 60_000);
});
