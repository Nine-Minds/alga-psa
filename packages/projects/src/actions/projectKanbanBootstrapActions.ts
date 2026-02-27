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
import { getUserAvatarUrlsBatchAction } from '@alga-psa/users/actions';
import { Knex } from 'knex';
import { getProjectTreeDataInTransaction } from './projectActions';
import { getAllProjectTasksForListViewInTransaction, getTaskTypesInTransaction } from './projectTaskActions';
import { calculateProjectCompletionInTransaction, type ProjectCompletionMetrics } from '../lib/projectUtils';

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

async function getProjectTagsInTransaction(
  trx: Knex.Transaction,
  tenant: string,
  projectId: string
): Promise<ITag[]> {
  const tags = await trx('tag_mappings as tm')
    .join('tag_definitions as td', function() {
      this.on('tm.tenant', '=', 'td.tenant')
        .andOn('tm.tag_id', '=', 'td.tag_id');
    })
    .where('tm.tenant', tenant)
    .where('tm.tagged_id', projectId)
    .where('tm.tagged_type', 'project')
    .select(
      'tm.mapping_id as tag_id',
      'tm.tenant',
      'td.board_id',
      'td.tag_text',
      'tm.tagged_id',
      'tm.tagged_type',
      'td.background_color',
      'td.text_color',
      'tm.created_by'
    )
    .orderBy('td.tag_text', 'asc');

  return tags as ITag[];
}

async function getProjectTaskPrioritiesInTransaction(
  trx: Knex.Transaction,
  tenant: string
): Promise<(IPriority | IStandardPriority)[]> {
  const priorities = await trx('priorities')
    .select('*')
    .where({ tenant, item_type: 'project_task' })
    .orderBy('order_number', 'asc');

  return priorities as (IPriority | IStandardPriority)[];
}

export const getProjectKanbanBootstrapData = withAuth(async (user, { tenant }, projectId: string): Promise<ProjectKanbanBootstrapData> => {
  const { knex } = await createTenantKnex();
  const bootstrapData = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const [projectTags, projectMetrics, projectTreeData, priorities, taskTypes, listViewData] = await Promise.all([
      getProjectTagsInTransaction(trx, tenant, projectId).catch(() => []),
      calculateProjectCompletionInTransaction(trx, tenant, projectId),
      getProjectTreeDataInTransaction(trx, user, tenant, projectId),
      getProjectTaskPrioritiesInTransaction(trx, tenant),
      getTaskTypesInTransaction(trx, user, tenant),
      getAllProjectTasksForListViewInTransaction(trx, user, tenant, projectId),
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
      const counts = await trx('document_associations')
        .select('entity_id')
        .count('document_id as count')
        .where('tenant', tenant)
        .whereIn('entity_id', taskIds)
        .where('entity_type', 'project_task')
        .groupBy('entity_id');

      const countMap = new Map<string, number>();
      counts.forEach((row) => {
        countMap.set(String(row.entity_id), Number(row.count));
      });

      for (const taskId of taskIds) {
        allTaskDocumentCounts[taskId] = countMap.get(taskId) ?? 0;
      }
    }

    return {
      projectTags,
      projectMetrics,
      projectTreeData,
      priorities,
      taskTypes,
      listViewData,
      phaseTaskCounts,
      allTaskDocumentCounts
    };
  });

  const additionalUserIds = new Set<string>();
  Object.values(bootstrapData.listViewData.taskResources).forEach((resources) => {
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
    projectTags: bootstrapData.projectTags,
    projectMetrics: bootstrapData.projectMetrics,
    projectTreeData: bootstrapData.projectTreeData,
    priorities: bootstrapData.priorities,
    taskTypes: bootstrapData.taskTypes,
    allProjectTasks: bootstrapData.listViewData.tasks,
    allProjectTicketLinks: bootstrapData.listViewData.ticketLinks,
    allProjectTaskResources: bootstrapData.listViewData.taskResources,
    allProjectChecklistItems: bootstrapData.listViewData.checklistItems,
    allProjectTaskTags: bootstrapData.listViewData.taskTags,
    allProjectTaskDependencies: bootstrapData.listViewData.taskDependencies,
    phaseTaskCounts: bootstrapData.phaseTaskCounts,
    avatarUrls,
    allTaskDocumentCounts: bootstrapData.allTaskDocumentCounts,
  };
});
