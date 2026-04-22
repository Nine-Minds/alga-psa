import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (fileName: string) => readFileSync(path.resolve(__dirname, fileName), 'utf8');

describe('project authorization kernel contracts', () => {
  const projectActionsSource = readSource('projectActions.ts');
  const commentActionsSource = readSource('projectTaskCommentActions.ts');

  it('T020: preserves own-comment/internal-user behavior and supports bundle narrowing on project list/detail', () => {
    expect(commentActionsSource).toContain('if (user.user_type === \'internal\') {');
    expect(commentActionsSource).toContain('relationshipRules: [{ template: \'own\' }],');
    expect(commentActionsSource).toContain("type: 'project_task_comment'");

    expect(projectActionsSource).toContain('export const getProjects = withAuth(async (user, { tenant })');
    expect(projectActionsSource).toContain('export const getProject = withAuth(async (user, { tenant }, projectId: string)');
    expect(projectActionsSource).toContain('builtinProvider: new BuiltinAuthorizationKernelProvider(),');
    expect(projectActionsSource).toContain('bundleProvider: new BundleAuthorizationKernelProvider({');
    expect(projectActionsSource).toContain('return await resolveBundleNarrowingRulesForEvaluation(trx, input);');
    expect(projectActionsSource).toContain('record: toProjectAuthorizationRecord(project),');
  });

  it('T038: narrows project tree/phase/detail/status mutation surfaces through shared project read authorization helpers', () => {
    expect(projectActionsSource).toContain('async function createProjectReadAuthorizer(');
    expect(projectActionsSource).toContain('async function filterAuthorizedProjects<T extends Partial<IProject>>(');
    expect(projectActionsSource).toContain('async function assertProjectReadAllowed(');
    expect(projectActionsSource).toContain('async function resolveProjectIdForPhase(');
    expect(projectActionsSource).toContain('async function resolveProjectIdsForStatus(');
    expect(projectActionsSource).toContain('return await filterAuthorizedProjects(trx, tenant, user as IUserWithRoles, rows);');
    expect(projectActionsSource).toContain('const authorizedProjects = await filterAuthorizedProjects(');
    expect(projectActionsSource).toContain('await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, projectId);');
    expect(projectActionsSource).toContain('const projectId = await resolveProjectIdForPhase(trx, tenant, phaseId);');
    expect(projectActionsSource).toContain('const projectIds = await resolveProjectIdsForStatus(trx, tenant, statusId);');
  });

  it('T019: phase/detail/status surfaces enforce parent-project narrowing before read/update/delete operations', () => {
    expect(projectActionsSource).toContain('export const updatePhase = withAuth(async (user, { tenant }, phaseId: string');
    expect(projectActionsSource).toContain('export const deletePhase = withAuth(async (user, { tenant }, phaseId: string');
    expect(projectActionsSource).toContain('export const addProjectPhase = withAuth(async (user, { tenant }, phaseData: Omit<IProjectPhase');
    expect(projectActionsSource).toContain('export const reorderPhase = withAuth(async (user, { tenant }, phaseId: string');
    expect(projectActionsSource).toContain('export const updateProjectStatus = withAuth(async (');
    expect(projectActionsSource).toContain('export const deleteProjectStatus = withAuth(async (user, { tenant }, statusId: string)');
    expect(projectActionsSource).toContain('await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, phase.project_id);');
    expect(projectActionsSource).toContain('const projectId = await resolveProjectIdForPhase(trx, tenant, phaseId);');
    expect(projectActionsSource).toContain('await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, project.project_id);');
    expect(projectActionsSource).toContain('const relatedProjectIds = await resolveProjectIdsForStatus(trx, tenant, statusId);');
    expect(projectActionsSource).toContain('await Promise.all(');
  });
});
