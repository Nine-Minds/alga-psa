import type { IProjectTask, ProjectStatus } from '@alga-psa/types';

/**
 * Sentinel mapping id for the synthetic "needs status assignment" fallback
 * group rendered when phase tasks reference a status mapping outside the
 * phase's effective scope. Nothing is persisted with this id.
 */
export const FALLBACK_STATUS_MAPPING_ID = '__needs_status_assignment__';

export function isFallbackStatus(status: { project_status_mapping_id?: string | null }): boolean {
  return status.project_status_mapping_id === FALLBACK_STATUS_MAPPING_ID;
}

/**
 * Build the synthetic ProjectStatus used to label a fallback group. Kept out
 * of every real bucket so total/done counts only ever count real statuses.
 */
export function createFallbackStatus(): ProjectStatus {
  return {
    project_status_mapping_id: FALLBACK_STATUS_MAPPING_ID,
    status_id: FALLBACK_STATUS_MAPPING_ID,
    name: 'Needs status assignment',
    custom_name: 'Needs status assignment',
    is_visible: true,
    display_order: Number.MAX_SAFE_INTEGER,
    is_standard: false,
    is_closed: false,
  };
}

/**
 * Tasks whose mapping id is not among the phase's effective statuses (the
 * `statuses` passed by the caller must be the phase's effective scope). These
 * are legacy orphans that must stay visible rather than vanish from rendering.
 */
export function partitionStatusScope(
  statuses: ProjectStatus[],
  phaseTasks: IProjectTask[]
): { orphanTasks: IProjectTask[] } {
  const validIds = new Set(statuses.map((status) => status.project_status_mapping_id));
  const orphanTasks = phaseTasks.filter(
    (task) =>
      task.project_status_mapping_id == null || !validIds.has(task.project_status_mapping_id)
  );
  return { orphanTasks };
}