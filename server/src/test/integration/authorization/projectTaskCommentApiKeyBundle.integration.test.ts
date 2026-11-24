import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestContext } from '../../../../test-utils/testContext';
import { tenantDb } from '@alga-psa/db';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';
import { withTaskCommentBatchReadAccess } from '@alga-psa/projects/lib/taskComments/taskCommentAuthorization';
import { createProjectReadAuthorizer } from '@alga-psa/projects/lib/projectReadAuthorization';
import { ProjectTaskCommentService } from '../../../lib/api/services/ProjectTaskCommentService';
import { NotFoundError } from '../../../lib/api/middleware/apiMiddleware';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 900_000;

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/db/commentEventRegistry', () => ({ publishCommentEvent: vi.fn(async () => undefined) }));

type Fixture = {
  tenant: string;
  user: any;
  userId: string;
  restrictedKeyId: string;
  openKeyId: string;
  inProjectId: string;
  outProjectId: string;
  inTaskId: string;
  outTaskId: string;
};

describe('ProjectTaskCommentService API-key project bundle authorization', () => {
  let ctx: TestContext;
  let fixture: Fixture;

  function table(name: string) {
    return tenantDb(ctx.db, ctx.tenantId).table(name);
  }

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: [
        'project_task_comment_reactions', 'project_task_comments', 'comment_threads',
        'project_tasks', 'project_phases', 'project_status_mappings', 'projects', 'statuses',
        'authorization_bundle_assignments', 'authorization_bundle_rules', 'authorization_bundle_revisions',
        'authorization_bundles', 'api_keys', 'role_permissions', 'permissions', 'user_roles', 'roles', 'users',
      ],
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    fixture = await createFixture();
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  async function createFixture(): Promise<Fixture> {
    const tenant = ctx.tenantId;
    const userId = randomUUID();
    await table('users').insert({
      tenant, user_id: userId, username: `comment-authz-${userId.slice(0, 8)}`,
      email: `comment-authz-${userId}@example.com`, hashed_password: 'not-used', user_type: 'internal',
    });

    const roleId = randomUUID();
    await table('roles').insert({ tenant, role_id: roleId, role_name: `Comment API ${roleId.slice(0, 8)}`, msp: true, client: false });
    await table('user_roles').insert({ tenant, user_id: userId, role_id: roleId });
    const permissionIds: string[] = [];
    for (const action of ['read', 'create', 'update', 'delete']) {
      let permission = await table('permissions').where({ resource: 'project_task', action }).first('permission_id');
      if (!permission) {
        permission = { permission_id: randomUUID() };
        await table('permissions').insert({
          tenant, permission_id: permission.permission_id, resource: 'project_task', action,
          msp: true, client: false, description: `Test project task ${action}`,
        });
      }
      permissionIds.push(permission.permission_id);
    }
    await table('role_permissions').insert(permissionIds.map((permission_id) => ({ tenant, role_id: roleId, permission_id })));

    const user = {
      user_id: userId, tenant, user_type: 'internal' as const, username: `comment-authz-${userId.slice(0, 8)}`,
      email: `comment-authz-${userId}@example.com`, is_inactive: false,
      roles: [{ role_id: roleId, role_name: `Comment API ${roleId.slice(0, 8)}`, msp: true, client: false }],
    };
    const clientId = ctx.clientId;
    const projectStatusId = randomUUID();
    await table('statuses').insert({
      tenant, status_id: projectStatusId, name: `Planned ${projectStatusId.slice(0, 6)}`,
      status_type: 'project', item_type: 'project', is_closed: false, order_number: 1,
    });

    const projectIds = [randomUUID(), randomUUID()];
    const taskIds = [randomUUID(), randomUUID()];
    for (const [index, projectId] of projectIds.entries()) {
      const token = projectId.slice(0, 8);
      await table('projects').insert({
        tenant, project_id: projectId, client_id: clientId, project_name: `Comment authz ${token}`,
        wbs_code: `${index + 1}`, project_number: `CA-${token}`, status: projectStatusId,
        is_inactive: false, assigned_to: index === 0 ? userId : null,
      });
      const phaseId = randomUUID();
      await table('project_phases').insert({
        tenant, phase_id: phaseId, project_id: projectId, phase_name: `Phase ${token}`,
        wbs_code: `${index + 1}.1`, status: 'active', order_number: 1, order_key: 'a0',
      });
      await table('project_tasks').insert({
        tenant, task_id: taskIds[index], phase_id: phaseId, task_name: `Task ${token}`, wbs_code: `${index + 1}.1.1`,
      });
    }

    const keyIds = [randomUUID(), randomUUID()];
    for (const [index, apiKeyId] of keyIds.entries()) {
      await table('api_keys').insert({
        tenant, api_key_id: apiKeyId, api_key: `test-${randomUUID()}`, user_id: userId,
        active: true, description: index === 0 ? 'restricted' : 'open',
      });
    }

    const bundle = await createAuthorizationBundle(ctx.db, {
      tenant, name: `Task comment assigned scope ${randomUUID()}`, actorUserId: userId,
    });
    for (const action of ['read', 'update']) {
      await upsertBundleRule(ctx.db, {
        tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId,
        resourceType: 'project', action, templateKey: 'assigned', config: {}, actorUserId: userId,
      });
    }
    await publishBundleRevision(ctx.db as any, {
      tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: userId,
    });
    await createBundleAssignment(ctx.db, {
      tenant, bundleId: bundle.bundleId, targetType: 'api_key', targetId: keyIds[0], actorUserId: userId,
    });

    const authorizeRead = await createProjectReadAuthorizer(ctx.db, tenant, user, 'read', keyIds[0]);
    const authorizeUpdate = await createProjectReadAuthorizer(ctx.db, tenant, user, 'update', keyIds[0]);
    const projects = await table('projects').whereIn('project_id', projectIds).select('*');
    const projectById = new Map(projects.map((project: any) => [project.project_id, project]));
    expect(await authorizeRead(projectById.get(projectIds[0])!)).toBe(true);
    expect(await authorizeUpdate(projectById.get(projectIds[0])!)).toBe(true);
    expect(await authorizeRead(projectById.get(projectIds[1])!)).toBe(false);
    expect(await authorizeUpdate(projectById.get(projectIds[1])!)).toBe(false);

    return {
      tenant, user, userId, restrictedKeyId: keyIds[0], openKeyId: keyIds[1],
      inProjectId: projectIds[0], outProjectId: projectIds[1], inTaskId: taskIds[0], outTaskId: taskIds[1],
    };
  }

  async function seedComment(taskId: string): Promise<string> {
    const commentId = randomUUID();
    const threadId = randomUUID();
    await table('comment_threads').insert({
      tenant: fixture.tenant, thread_id: threadId, project_task_id: taskId,
      root_comment_id: commentId, is_internal: false,
    });
    await table('project_task_comments').insert({
      tenant: fixture.tenant, task_comment_id: commentId, task_id: taskId, thread_id: threadId,
      user_id: fixture.userId, note: '[]', author_type: 'internal',
    });
    return commentId;
  }

  function serviceContext(apiKeyId?: string) {
    return {
      tenant: fixture.tenant, userId: fixture.userId, user: fixture.user, apiKeyId, db: ctx.db,
    } as any;
  }

  it('enforces restricted-key scope on every REST operation while preserving open-key and session behavior', async () => {
    const service = new ProjectTaskCommentService();
    const identities = [
      { label: 'restricted API key', apiKeyId: fixture.restrictedKeyId, restricted: true },
      { label: 'unrestricted API key', apiKeyId: fixture.openKeyId, restricted: false },
      { label: 'session', apiKeyId: undefined, restricted: false },
    ];
    const operations = ['read', 'create', 'update', 'delete', 'react'] as const;

    for (const identity of identities) {
      for (const project of [
        { name: 'in-scope', taskId: fixture.inTaskId, outOfScope: false },
        { name: 'out-of-scope', taskId: fixture.outTaskId, outOfScope: true },
      ]) {
        for (const operation of operations) {
          const commentId = operation === 'create' ? undefined : await seedComment(project.taskId);
          const isDenied = identity.restricted && project.outOfScope;
          const context = serviceContext(identity.apiKeyId);
          const persistedBefore = commentId
            ? await table('project_task_comments').where({ task_comment_id: commentId }).first('note')
            : null;
          const taskCommentCountBefore = await table('project_task_comments')
            .where({ task_id: project.taskId }).count('* as count').first();
          const reactionsBefore = commentId
            ? await table('project_task_comment_reactions').where({ task_comment_id: commentId }).count('* as count').first()
            : null;

          const invoke = async () => {
            switch (operation) {
              case 'read': return service.listComments(project.taskId, context);
              case 'create': return service.createComment(project.taskId, { note: '[]' }, context);
              case 'update': return service.updateComment(project.taskId, commentId!, { note: '[{"type":"paragraph","content":[{"type":"text","text":"updated"}]}]' }, context);
              case 'delete': return service.deleteComment(project.taskId, commentId!, context);
              case 'react': return service.toggleReaction(project.taskId, commentId!, '👍', context);
            }
          };

          if (isDenied) {
            await expect(invoke(), `${identity.label} ${operation} on ${project.name}`).rejects.toBeInstanceOf(NotFoundError);
            if (operation === 'create') {
              expect(await table('project_task_comments').where({ task_id: project.taskId }).count('* as count').first())
                .toEqual(taskCommentCountBefore);
            } else if (operation === 'update' || operation === 'delete') {
              expect(await table('project_task_comments').where({ task_comment_id: commentId }).first('note'))
                .toMatchObject({ note: persistedBefore.note });
            } else if (operation === 'react') {
              const after = await table('project_task_comment_reactions').where({ task_comment_id: commentId }).count('* as count').first();
              expect(Number(after?.count)).toBe(Number(reactionsBefore?.count ?? 0));
            }
          } else {
            const result = await invoke();
            if (operation === 'read') expect(result).toEqual(expect.arrayContaining([expect.objectContaining({ task_id: project.taskId })]));
            if (operation === 'create') expect(result).toMatchObject({ task_id: project.taskId });
            if (operation === 'update') expect(result).toMatchObject({ task_comment_id: commentId });
            if (operation === 'delete') expect(await table('project_task_comments').where({ task_comment_id: commentId }).first()).toBeUndefined();
            if (operation === 'react') expect(result).toMatchObject({ added: true });
          }
        }
      }
    }
  }, 120_000);

  it('carries API-key identity through batch read authorization', async () => {
    const readIds = async (apiKeyId?: string) => withTaskCommentBatchReadAccess(
      ctx.db, fixture.tenant, fixture.user,
      { taskIds: [fixture.inTaskId, fixture.outTaskId] }, 'read',
      async ({ ids }) => ids,
      apiKeyId,
    );
    expect(await readIds(fixture.restrictedKeyId)).toEqual([fixture.inTaskId]);
    expect(await readIds(fixture.openKeyId)).toEqual(expect.arrayContaining([fixture.inTaskId, fixture.outTaskId]));
    expect(await readIds()).toEqual(expect.arrayContaining([fixture.inTaskId, fixture.outTaskId]));
  });
});
