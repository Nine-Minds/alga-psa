/**
 * @alga-psa/scheduling
 *
 * Scheduling module for Alga PSA.
 * Provides time management, schedule booking, and technician dispatch.
 */

// Models
export { ScheduleEntry } from './models';

// Re-export scheduling types from @alga-psa/types
export type {
  IScheduleEntry,
  IRecurrencePattern,
  IResource,
  IScheduleConflict,
  IWorkItem,
  IExtendedWorkItem,
  WorkItemWithStatus,
  WorkItemType,
  ITimePeriod,
  ITimeEntry,
  HighlightedSlot,
} from '@alga-psa/types';

// Re-export enums
export { IEditScope, Views } from '@alga-psa/types';

// Utils
export { generateICS, type ICSEventData } from './utils/icsGenerator';

// Note: This module contains:
// - Schedule Entry management (migrated)
// - Time entry management (pending migration)
// - Schedule booking (pending migration)
// - Technician dispatch (pending migration)
// - 32 time-management + schedule + 13 technician-dispatch components (pending migration)
