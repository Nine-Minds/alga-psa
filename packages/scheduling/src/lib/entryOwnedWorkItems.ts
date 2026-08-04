import type { WorkItemType } from '@alga-psa/types';

/**
 * Entries whose "work item" is the schedule entry itself (ad-hoc) or a record
 * owned elsewhere that has no work-item lookup (an opportunity step, written
 * from the deal's plan). Nothing here can be resolved by getWorkItemById, so
 * the calendar shows the entry's own title instead of chasing a detail row.
 */
export const ENTRY_OWNED_WORK_ITEM_TYPES = new Set<WorkItemType>(['ad_hoc', 'opportunity_step']);
