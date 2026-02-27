'use server';

import type {
  IPriority,
  IProjectTask,
  IProjectTaskDependency,
  IProjectTicketLinkWithDetails,
  IStandardPriority,
  ITag,
  ITaskChecklistItem,
  ITaskResource,
  ITaskType,
} from '@alga-psa/types';
import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { getAllPriorities } from '@alga-psa/reference-data/actions';
import { findTagsByEntityId } from '@alga-psa/tags/actions';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/users/actions';
import { Knex } from 'knex';
import { getProjectTreeData } from './projectActions';
import { getAllProjectTasksForListView, getTaskTypes } from './projectTaskActions';
import { calculateProjectCompletion, type ProjectCompletionMetrics } from '../lib/projectUtils';

export interface ProjectKanbanBootstrapData {
  projectTags: ITag[];
  projectMetrics: ProjectCompletionMetrics;
  projectTreeData: unknown[];
  priorities: (IPriority | IStandardPriority)[];
  taskTypes: ITaskType[];
  allProjectTasks: IProjectTask[];
  allProjectTicketLinks: Record<string, IProjectTicketLinkWithDetails[]>;
  allProjectTaskResources: Record<string, ITaskResource[]>;
  allProjectChecklistItems: Record<string, ITaskChecklistItem[]>;
  allProjectTaskTags: Record<string, ITag[]>;
  allProjectTaskDependencies: Record<string, {
    predecessors: IProjectTaskDependency[];
    successors: IProjectTaskDependency[];
  }>;
  phaseTaskCounts: Record<string, number>;
  avatarUrls: Record<string, string | null>;
  allTaskDocumentCounts: Record<string, number>;
}

export const getProjectKanbanBootstrapData = withAuth(async (_user, { tenant }, projectId: string): Promise<ProjectKanbanBootstrapData> => {
  const { knex } = await createTenantKnex();
  const [projectTags, projectMetrics, projectTreeData, priorities, taskTypes, listViewData] = await Promise.all([
    findTagsByEntityId(projectId, 'project').catch(() => []),
    calculateProjectCompletion(projectId),
    getProjectTreeData(projectId),
    getAllPriorities('project_task'),
    getTaskTypes(),
    getAllProjectTasksForListView(projectId),
  ]);

  const phaseTaskCounts = listViewData.tasks.reduce<Record<string, number>>((counts, task) => {
    if (task.phase_id) {
      counts[task.phase_id] = (counts[task.phase_id] || 0) + 1;
    }
    return counts;
  }, {});

  const taskIds = listViewData.tasks.map((task) => task.task_id);
  const allTaskDocumentCounts: Record<string, number> = {};

  if (taskIds.length > 0) {
    const counts = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return trx('document_associations')
        .select('entity_id')
        .count('document_id as count')
        .where('tenant', tenant)
        .whereIn('entity_id', taskIds)
        .where('entity_type', 'project_task')
        .groupBy('entity_id');
    });

    const countMap = new Map<string, number>();
    counts.forEach((row) => {
      countMap.set(String(row.entity_id), Number(row.count));
    });

    for (const taskId of taskIds) {
      allTaskDocumentCounts[taskId] = countMap.get(taskId) ?? 0;
    }
  }

  const additionalUserIds = new Set<string>();
  Object.values(listViewData.taskResources).forEach((resources) => {
    (resources || []).forEach((resource) => {
      if (resource?.additional_user_id) {
        additionalUserIds.add(resource.additional_user_id);
      }
    });
  });

  const avatarUrls: Record<string, string | null> = {};
  if (additionalUserIds.size > 0) {
    const avatarMap = await getUserAvatarUrlsBatchAction(Array.from(additionalUserIds), tenant);
    avatarMap.forEach((url, userId) => {
      avatarUrls[userId] = url;
    });
  }

  return {
    projectTags,
    projectMetrics,
    projectTreeData,
    priorities,
    taskTypes,
    allProjectTasks: listViewData.tasks,
    allProjectTicketLinks: listViewData.ticketLinks,
    allProjectTaskResources: listViewData.taskResources,
    allProjectChecklistItems: listViewData.checklistItems,
    allProjectTaskTags: listViewData.taskTags,
    allProjectTaskDependencies: listViewData.taskDependencies,
    phaseTaskCounts,
    avatarUrls,
    allTaskDocumentCounts,
  };
});
