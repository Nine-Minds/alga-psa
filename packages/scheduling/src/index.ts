/**
 * @alga-psa/scheduling
 *
 * Scheduling module for Alga PSA.
 * Provides time management, schedule booking, and technician dispatch.
 *
 * Main entry point exports buildable code only.
 * For runtime code, use:
 * - '@alga-psa/scheduling/actions' for server actions
 * - '@alga-psa/scheduling/components' for React components
 */

// Models
export { default as ScheduleEntry } from './models/scheduleEntry';
export { TimePeriod } from './models/timePeriod';
export { TimePeriodSettings } from './models/timePeriodSettings';

// Lib utilities
export {
  getUtcDatesOverlappedByInterval,
  getOverlapHoursForUtcDate,
  didCrossThreshold,
  utcStartOfDayIso,
} from './lib/capacityThresholdMath';
export { maybePublishCapacityThresholdReached } from './lib/capacityThresholdWorkflowEvents';
export { TimePeriodSuggester } from './lib/timePeriodSuggester';
export type { TimePeriodSettings as TimePeriodSettingsType } from './lib/timePeriodSuggester';

// Schemas
export * from './schemas/appointmentRequestSchemas';
// Note: appointmentSchemas has overlapping exports with appointmentRequestSchemas
// Only export unique items from appointmentSchemas to avoid conflicts
export {
  availabilitySettingTypeSchema,
  createAppointmentRequestSchema,
  type CreateAppointmentRequestInput,
  updateAppointmentRequestSchema,
  type UpdateAppointmentRequestInput,
  createPublicAppointmentRequestSchema,
  type CreatePublicAppointmentRequestInput,
  cancelAppointmentRequestSchema,
  type CancelAppointmentRequestInput,
  availabilitySettingSchema,
  type AvailabilitySettingInput,
  availabilityExceptionSchema,
  type AvailabilityExceptionInput,
} from './schemas/appointmentSchemas';
export * from './schemas/timeSheet.schemas';
export { fetchTimeEntriesParamsSchema, saveTimeEntryParamsSchema, addWorkItemParamsSchema, submitTimeSheetParamsSchema, fetchOrCreateTimeSheetParamsSchema, fetchTimePeriodsParamsSchema } from './actions/timeEntrySchemas';
export type { FetchTimeEntriesParams, SaveTimeEntryParams, AddWorkItemParams, SubmitTimeSheetParams, FetchOrCreateTimeSheetParams, FetchTimePeriodsParams } from './actions/timeEntrySchemas';

// Services
export {
  findOrCreateCurrentBucketUsageRecord,
  updateBucketUsageMinutes,
  reconcileBucketUsageRecord,
} from './services/bucketUsageService';

// Utils
export { generateICS, generateICSBuffer, generateICSFilename, type ICSEventData } from './utils/icsGenerator';

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
