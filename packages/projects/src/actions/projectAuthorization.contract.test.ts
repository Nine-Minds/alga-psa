import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (fileName: string) => readFileSync(path.resolve(__dirname, fileName), 'utf8');

describe('project authorization kernel contracts', () => {
  const projectActionsSource = readSource('projectActions.ts');
  const projectTaskActionsSource = readSource('projectTaskActions.ts');
  const projectTaskStatusActionsSource = readSource('projectTaskStatusActions.ts');
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

  it('T020: task/checklist/dependency/resource/ticket-link actions enforce reusable parent-project gating', () => {
    expect(projectTaskActionsSource).toContain('async function assertProjectReadAllowedById(');
    expect(projectTaskActionsSource).toContain('async function resolveProjectIdForTask(');
    expect(projectTaskActionsSource).toContain('async function resolveProjectIdForChecklistItem(');
    expect(projectTaskActionsSource).toContain('async function resolveProjectIdForTaskResourceAssignment(');
    expect(projectTaskActionsSource).toContain('async function resolveProjectIdForTaskTicketLink(');
    expect(projectTaskActionsSource).toContain('async function resolveProjectIdsForTicket(');
    expect(projectTaskActionsSource).toContain('export const updateTaskWithChecklist = withAuth(async (');
    expect(projectTaskActionsSource).toContain('export const addTaskToPhase = withAuth(async (');
    expect(projectTaskActionsSource).toContain('export const addChecklistItemToTask = withAuth(async (');
    expect(projectTaskActionsSource).toContain('export const updateChecklistItem = withAuth(async (');
    expect(projectTaskActionsSource).toContain('export const deleteChecklistItem = withAuth(async (');
    expect(projectTaskActionsSource).toContain('export const addTaskDependency = withAuth(async (');
    expect(projectTaskActionsSource).toContain('export const addTaskResourceAction = withAuth(async (');
    expect(projectTaskActionsSource).toContain('export const removeTaskResourceAction = withAuth(async (');
    expect(projectTaskActionsSource).toContain('export const addTicketLinkAction = withAuth(async (');
    expect(projectTaskActionsSource).toContain('export const deleteTaskTicketLinkAction = withAuth(async (');
    expect(projectTaskActionsSource).toContain('await assertProjectReadAllowedById(trx, tenant, user as IUserWithRoles, projectId);');
    expect(projectTaskActionsSource).toContain('const sourceProjectId = await resolveProjectIdForPhase(trx, tenant, existingTask.phase_id);');
    expect(projectTaskActionsSource).toContain('const projectId = await resolveProjectIdForChecklistItem(trx, tenant, checklistItemId);');
    expect(projectTaskActionsSource).toContain('const projectIds = await resolveProjectIdsForTicket(trx, tenant, ticketId);');
  });

  it('T021: status/phase mapping actions enforce parent-project narrowing and close prior zero-check count surfaces', () => {
    expect(projectTaskStatusActionsSource).toContain('async function assertProjectReadAllowed(');
    expect(projectTaskStatusActionsSource).toContain('export const getProjectStatusMappings = withAuth(async (');
    expect(projectTaskStatusActionsSource).toContain('export const copyProjectStatusesToPhase = withAuth(async (');
    expect(projectTaskStatusActionsSource).toContain('export const removePhaseStatuses = withAuth(async (');
    expect(projectTaskStatusActionsSource).toContain('export const updateProjectStatusMapping = withAuth(async (');
    expect(projectTaskStatusActionsSource).toContain('export const getStatusMappingTaskCount = withAuth(async (');
    expect(projectTaskStatusActionsSource).toContain('export const deleteProjectStatusMapping = withAuth(async (');
    expect(projectTaskStatusActionsSource).toContain('export const reorderProjectStatuses = withAuth(async (');
    expect(projectTaskStatusActionsSource).toContain('await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, projectId);');
    expect(projectTaskStatusActionsSource).toContain('await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, mapping.project_id);');
    expect(projectTaskStatusActionsSource).toContain('if (!await hasPermission(user, \'project\', \'read\', trx)) {');
  });

  it('T022: project task/status count helpers require parent-project authorization before returning cardinalities', () => {
    expect(projectTaskActionsSource).toContain('export const getPhaseTaskCounts = withAuth(async (');
    expect(projectTaskActionsSource).toContain('export const getProjectTaskData = withAuth(async (');
    expect(projectTaskActionsSource).toContain('await assertProjectReadAllowedById(trx, tenant, user as IUserWithRoles, projectId);');
    expect(projectTaskStatusActionsSource).toContain('export const getStatusMappingTaskCount = withAuth(async (');
    expect(projectTaskStatusActionsSource).toContain('await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, mapping.project_id);');
  });

  it('T023: cross-project move/duplicate/link flows authorize both source and target project contexts', () => {
    expect(projectTaskActionsSource).toContain('export const moveTaskToPhase = withAuth(async (');
    expect(projectTaskActionsSource).toContain('export const duplicateTaskToPhase = withAuth(async (');
    expect(projectTaskActionsSource).toContain('export const addTicketLinkAction = withAuth(async (');
    expect(projectTaskActionsSource).toContain('const sourceProjectId = await resolveProjectIdForPhase(trx, tenant, existingTask.phase_id);');
    expect(projectTaskActionsSource).toContain('await assertProjectReadAllowedById(trx, tenant, user as IUserWithRoles, sourceProjectId);');
    expect(projectTaskActionsSource).toContain('await assertProjectReadAllowedById(trx, tenant, user as IUserWithRoles, newPhase.project_id);');
    expect(projectTaskActionsSource).toContain('await assertProjectReadAllowedById(trx, tenant, user as IUserWithRoles, projectId);');
  });

  it('F033: linked ticket payloads in project structural surfaces apply ticket-resource intersection semantics', () => {
    expect(projectTaskActionsSource).toContain('async function filterAuthorizedTicketIds(');
    expect(projectTaskActionsSource).toContain('async function assertTicketReadAllowedById(');
    expect(projectTaskActionsSource).toContain('resource: { type: \'ticket\', action: \'read\', id: ticket.ticket_id }');
    expect(projectTaskActionsSource).toContain('await assertTicketReadAllowedById(trx, tenant, user as IUserWithRoles, ticketId);');
    expect(projectTaskActionsSource).toContain('const allowedTicketIds = await filterAuthorizedTicketIds(');
    expect(projectTaskActionsSource).toContain('const authorizedTicketLinksArray = ticketLinksArray.filter((link) => allowedTicketIds.has(link.ticket_id));');
  });
});
