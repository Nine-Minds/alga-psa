import {
  buildProjectCreatedPayload,
  buildProjectStatusChangedPayload,
  buildProjectTaskAssignedPayload,
  buildProjectTaskCompletedPayload,
  buildProjectTaskCreatedPayload,
  buildProjectTaskDependencyBlockedPayload,
  buildProjectTaskDependencyUnblockedPayload,
  buildProjectTaskStatusChangedPayload,
  buildProjectUpdatedPayload,
} from '@alga-psa/workflow-streams';
import type { EmitterContracts } from '../registryTypes';
import { NO_EMITTER_UMBRELLA_TICKET } from '../registryTypes';
import { IDS, NOW, project, projectTask } from '../fixtures';

/**
 * Projects. Task/lifecycle builders predate this card (domainEventBuilders); PROJECT_CREATED got
 * one here because its four call sites each hand-built the payload.
 */

const ACTIONS = 'packages/projects/src/actions';
const SERVICE = 'server/src/lib/api/services/ProjectService.ts';

type ProjectEventType =
  | 'PROJECT_CREATED'
  | 'PROJECT_UPDATED'
  | 'PROJECT_STATUS_CHANGED'
  | 'PROJECT_APPROVAL_REQUESTED'
  | 'PROJECT_APPROVAL_GRANTED'
  | 'PROJECT_APPROVAL_REJECTED'
  | 'PROJECT_TASK_CREATED'
  | 'PROJECT_TASK_ASSIGNED'
  | 'PROJECT_TASK_STATUS_CHANGED'
  | 'PROJECT_TASK_COMPLETED'
  | 'PROJECT_TASK_DEPENDENCY_BLOCKED'
  | 'PROJECT_TASK_DEPENDENCY_UNBLOCKED';

const updatedProject = {
  ...project,
  project_name: 'Office network refresh (phase 2)',
  description: null,
  end_date: new Date('2026-10-31T00:00:00.000Z'),
  assigned_to: IDS.previousAssignee,
  updated_at: new Date(NOW),
};
const asRecord = (p: typeof project) => p as unknown as Record<string, unknown> & { project_id: string };

const taskAssigned = (assignedToType: 'user' | 'team', withName = true) =>
  buildProjectTaskAssignedPayload({
    projectId: project.project_id,
    taskId: projectTask.task_id,
    assignedToId: assignedToType === 'team' ? IDS.team : projectTask.assigned_to!,
    assignedToType,
    assignedByUserId: IDS.user,
    ...(withName ? { assignedByName: 'Pat Manager' } : {}),
    assignedAt: new Date(NOW),
  });

const taskCreated = (withDue: boolean) =>
  buildProjectTaskCreatedPayload({
    projectId: project.project_id,
    taskId: projectTask.task_id,
    title: projectTask.task_name,
    dueDate: withDue ? projectTask.due_date : null,
    status: 'To Do',
    createdByUserId: IDS.user,
    createdAt: new Date(NOW),
  });

const taskStatusChanged = () =>
  buildProjectTaskStatusChangedPayload({
    projectId: project.project_id,
    taskId: projectTask.task_id,
    previousStatus: 'To Do',
    newStatus: 'Done',
    changedAt: new Date(NOW),
  });

const taskCompleted = () =>
  buildProjectTaskCompletedPayload({
    projectId: project.project_id,
    taskId: projectTask.task_id,
    completedByUserId: IDS.user,
    completedAt: new Date(NOW),
  });

export const projectContracts = {
  PROJECT_CREATED: {
    status: 'covered',
    cases: [
      {
        site: `${ACTIONS}/projectActions.ts#createProject`,
        build: () => buildProjectCreatedPayload({ projectId: project.project_id, createdByUserId: IDS.user, createdAt: new Date(NOW) }),
      },
      {
        site: `${ACTIONS}/projectTemplateActions.ts#applyTemplate`,
        build: () => buildProjectCreatedPayload({ projectId: project.project_id, createdByUserId: IDS.user, createdAt: new Date(NOW) }),
      },
      {
        site: 'packages/opportunities/src/actions/opportunityActions.ts#winOpportunity',
        build: () => buildProjectCreatedPayload({ projectId: project.project_id, createdByUserId: IDS.user, createdAt: new Date(NOW) }),
      },
      {
        site: `${SERVICE}#createProject`,
        build: () =>
          buildProjectCreatedPayload({
            projectId: project.project_id,
            projectName: project.project_name,
            clientId: project.client_id,
            createdByUserId: IDS.user,
            createdAt: new Date(NOW),
          }),
      },
    ],
  },

  PROJECT_UPDATED: {
    status: 'covered',
    cases: [
      {
        site: `${ACTIONS}/projectActions.ts#updateProject`,
        build: () =>
          buildProjectUpdatedPayload({
            projectId: project.project_id,
            before: asRecord(project),
            after: asRecord(updatedProject),
            updatedFieldKeys: ['project_name', 'description', 'end_date', 'assigned_to'],
            updatedAt: updatedProject.updated_at,
          }),
      },
      // Branch: the update touched no field that differs (publishes anyway, with no updatedFields/changes).
      {
        site: `${ACTIONS}/projectActions.ts#updateProject`,
        build: () =>
          buildProjectUpdatedPayload({
            projectId: project.project_id,
            before: asRecord(project),
            after: asRecord(project),
            updatedFieldKeys: ['project_name'],
            updatedAt: project.updated_at,
          }),
      },
      {
        site: `${SERVICE}#update`,
        build: () =>
          buildProjectUpdatedPayload({
            projectId: project.project_id,
            before: asRecord(project),
            after: asRecord(updatedProject),
            updatedFieldKeys: ['project_name'],
            updatedAt: updatedProject.updated_at,
          }),
      },
    ],
  },

  PROJECT_STATUS_CHANGED: {
    status: 'covered',
    cases: [
      {
        site: `${ACTIONS}/projectActions.ts#updateProject`,
        build: () =>
          buildProjectStatusChangedPayload({
            projectId: project.project_id,
            previousStatus: project.status,
            newStatus: IDS.statusClosed,
            changedAt: new Date(NOW),
          }),
      },
      {
        site: `${SERVICE}#update`,
        build: () =>
          buildProjectStatusChangedPayload({
            projectId: project.project_id,
            previousStatus: project.status,
            newStatus: IDS.statusInProgress,
            changedAt: new Date(NOW),
          }),
      },
    ],
  },

  PROJECT_APPROVAL_REQUESTED: {
    status: 'no-product-emitter',
    ticket: NO_EMITTER_UMBRELLA_TICKET,
    reason: 'The schema and catalog entry exist but nothing in packages/projects, server or ee fires project approvals.',
  },
  PROJECT_APPROVAL_GRANTED: {
    status: 'no-product-emitter',
    ticket: NO_EMITTER_UMBRELLA_TICKET,
    reason: 'The schema and catalog entry exist but nothing in packages/projects, server or ee fires project approvals.',
  },
  PROJECT_APPROVAL_REJECTED: {
    status: 'no-product-emitter',
    ticket: NO_EMITTER_UMBRELLA_TICKET,
    reason: 'The schema and catalog entry exist but nothing in packages/projects, server or ee fires project approvals.',
  },

  PROJECT_TASK_CREATED: {
    status: 'covered',
    cases: [
      { site: `${ACTIONS}/projectTaskActions.ts#addTaskToPhase`, build: () => taskCreated(true) },
      { site: `${ACTIONS}/projectTaskActions.ts#duplicateTaskToPhase`, build: () => taskCreated(false) },
      { site: `${ACTIONS}/phaseTaskImportActions.ts#importPhasesAndTasks`, build: () => taskCreated(true) },
      { site: `${SERVICE}#createTask`, build: () => taskCreated(true) },
    ],
  },

  PROJECT_TASK_ASSIGNED: {
    status: 'covered',
    cases: [
      { site: `${ACTIONS}/projectTaskActions.ts#updateTaskWithChecklist`, build: () => taskAssigned('user') },
      { site: `${ACTIONS}/projectTaskActions.ts#addTaskToPhase`, build: () => taskAssigned('user', false) },
      { site: `${ACTIONS}/projectTaskActions.ts#assignTeamToProjectTask`, build: () => taskAssigned('team') },
      { site: `${ACTIONS}/projectTaskActions.ts#duplicateTaskToPhase`, build: () => taskAssigned('user') },
      { site: `${ACTIONS}/phaseTaskImportActions.ts#importPhasesAndTasks`, build: () => taskAssigned('user') },
      { site: `${SERVICE}#createTask`, build: () => taskAssigned('user') },
      { site: `${SERVICE}#updateTask`, build: () => taskAssigned('user') },
    ],
  },

  PROJECT_TASK_STATUS_CHANGED: {
    status: 'covered',
    cases: [
      { site: `${ACTIONS}/projectTaskActions.ts#updateTaskWithChecklist`, build: taskStatusChanged },
      { site: `${ACTIONS}/projectTaskActions.ts#updateTaskStatus`, build: taskStatusChanged },
      { site: `${SERVICE}#updateTask`, build: taskStatusChanged },
    ],
  },

  PROJECT_TASK_COMPLETED: {
    status: 'covered',
    cases: [
      { site: `${ACTIONS}/projectTaskActions.ts#updateTaskWithChecklist`, build: taskCompleted },
      { site: `${ACTIONS}/projectTaskActions.ts#updateTaskStatus`, build: taskCompleted },
      { site: `${SERVICE}#updateTask`, build: taskCompleted },
    ],
  },

  PROJECT_TASK_DEPENDENCY_BLOCKED: {
    status: 'covered',
    cases: [
      {
        site: `${ACTIONS}/projectTaskActions.ts#addTaskDependency`,
        build: () =>
          buildProjectTaskDependencyBlockedPayload({
            projectId: project.project_id,
            taskId: projectTask.task_id,
            blockedByTaskId: IDS.blockerTask,
            blockedAt: new Date(NOW),
          }),
      },
    ],
  },

  PROJECT_TASK_DEPENDENCY_UNBLOCKED: {
    status: 'covered',
    cases: [
      {
        site: `${ACTIONS}/projectTaskActions.ts#removeTaskDependency`,
        build: () =>
          buildProjectTaskDependencyUnblockedPayload({
            projectId: project.project_id,
            taskId: projectTask.task_id,
            unblockedByTaskId: IDS.blockerTask,
            unblockedAt: new Date(NOW),
          }),
      },
    ],
  },
} satisfies Pick<EmitterContracts, ProjectEventType>;
