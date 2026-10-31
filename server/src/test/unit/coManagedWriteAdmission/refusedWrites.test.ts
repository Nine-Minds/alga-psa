/**
 * Model-level checks against a recording fake knex. A refusal must be a
 * CoManagedLifecycleError and leave no write
 * statement behind. Public-boundary behavior requires separate tests.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import Comment from '@alga-psa/tickets/models/comment';
import ProjectModel from '@alga-psa/projects/models/project';
import ProjectTaskModel from '@alga-psa/projects/models/projectTask';
import { isCoManagedLifecycleError } from '@alga-psa/licensing/lifecycle-error';
import { createFakeKnex, CO_MANAGED_TENANT, clearWriteAdmissionCacheForTests, withReadOnlyWorkspace } from './fakeKnex';

const fake = createFakeKnex((sql) => (/from "users"/.test(sql) ? [{ user_type: 'internal' }] : /from "project_phases"/.test(sql) ? [{ phase_id: 'phase', wbs_code: '1' }] : /gen_random_uuid\(\)/i.test(sql) ? [{ comment_id: 'comment-1', thread_id: 'thread-1' }] : /insert into "comments"/i.test(sql) || /from "comments"/i.test(sql) ? [{ comment_id: 'comment-1', ticket_id: 'tk', note: 'x' }] : undefined));
afterAll(() => fake.destroy());
afterEach(() => {
  fake.statements.length = 0;
  clearWriteAdmissionCacheForTests();
  vi.unstubAllEnvs();
});

const surfaces: Array<[string, (tenant: string) => Promise<unknown>]> = [
  ['Comment.insert', (t) => Comment.insert(fake.knex, t, { ticket_id: 'tk', author_type: 'internal', user_id: 'u', note: 'x', is_internal: true } as any)],
  ['ProjectModel.create', (t) => ProjectModel.create(fake.knex, t, { project_name: 'p', client_id: 'c', status: 's', is_inactive: false } as any)],
  ['ProjectTaskModel.addTask', (t) => ProjectTaskModel.addTask(fake.knex, t, 'phase', { task_name: 'n', project_status_mapping_id: 'm' } as any)],
];

it('re-evaluates a cached refusal when the kill switch changes', async () => {
  await withReadOnlyWorkspace(async () => {
    const run = surfaces[0][1];
    await expect(run(CO_MANAGED_TENANT)).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
    vi.stubEnv('FORCE_CAPABILITIES', 'co-managed:off');
    await expect(run(CO_MANAGED_TENANT)).resolves.toBe('comment-1');
    expect(fake.writes().some((sql) => /insert into "comments"/i.test(sql))).toBe(true);
    vi.stubEnv('FORCE_CAPABILITIES', '');
    await expect(run(CO_MANAGED_TENANT)).rejects.toMatchObject({ code: 'CO_MANAGED_READ_ONLY' });
  });
});

describe.each(surfaces)('%s on a read-only co-managed tenant', (_name, run) => {
  it('is refused with a lifecycle error and issues no write', async () => {
    await withReadOnlyWorkspace(async () => {
      const error = await run(CO_MANAGED_TENANT).catch((e) => e);
      expect(isCoManagedLifecycleError(error)).toBe(true);
      expect(error.code).toBe('CO_MANAGED_READ_ONLY');
      expect(fake.writes()).toEqual([]);
    });
  });

});
