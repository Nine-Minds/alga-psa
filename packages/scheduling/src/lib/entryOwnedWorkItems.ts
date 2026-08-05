import type { WorkItemType } from '@alga-psa/types';

/**
 * Entries whose "work item" is the schedule entry itself (ad-hoc) or a record
 * owned elsewhere that has no work-item lookup (an opportunity step, written
 * from the deal's plan). Nothing here can be resolved by getWorkItemById, so
 * the calendar shows the entry's own title instead of chasing a detail row.
 */
export const ENTRY_OWNED_WORK_ITEM_TYPES = new Set<WorkItemType>(['ad_hoc', 'opportunity_step']);

/**
 * The subset whose calendar presence is written by another record's own
 * lifecycle (an opportunity step mirrors its due time and assignee onto the
 * entry). The calendar renders these but never edits them — a drag, resize,
 * or work-item swap would silently diverge from the record that owns the
 * entry and be overwritten on its next sync. Ad-hoc entries are entry-owned
 * too, but they have no upstream owner and stay fully editable.
 */
export const SOURCE_OWNED_WORK_ITEM_TYPES = new Set<WorkItemType>(['opportunity_step']);

export function isSourceOwnedWorkItemType(type: WorkItemType | null | undefined): boolean {
  return Boolean(type && SOURCE_OWNED_WORK_ITEM_TYPES.has(type));
}
