// The defining modules own their 'use server' boundaries. Keep this facade a
// plain re-export so Next uses each action's original server reference instead
// of registering a second reference for the same function.

import { getClientIdForWorkItem } from './timeEntryHelpers';
import {
  fetchTimeSheets,
  submitTimeSheet,
  fetchAllTimeSheets,
  fetchTimePeriods,
  fetchOrCreateTimeSheet,
  deleteTimeSheets
} from './timeSheetOperations';
import {
  fetchTimeEntriesForTimeSheet,
  saveTimeEntry,
  logStopwatchSession,
  updateTimeEntryApprovalStatus,
  deleteTimeEntry,
  getTimeEntryById
} from './timeEntryCrudActions';
import { fetchTimeEntryChangeRequestsForTimeSheet } from './timeEntryChangeRequestActions';
import {
  fetchWorkItemsForTimeSheet,
  addWorkItem,
  deleteWorkItem,
  isServiceOptionalForWorkItem
} from './timeEntryWorkItemActions';
import {
  fetchTaxRegions,
  fetchClientTaxRateForWorkItem,
  fetchServicesForTimeEntry,
  fetchScheduleEntryForWorkItem,
  fetchDefaultClientTaxRateInfoForWorkItem // Added export
} from './timeEntryServices';
import { resolveDefaultTicketTimeEntryService } from './timeEntryServiceDefaults';

export {
  getClientIdForWorkItem,
  fetchTimeSheets,
  submitTimeSheet,
  fetchAllTimeSheets,
  fetchTimePeriods,
  fetchOrCreateTimeSheet,
  deleteTimeSheets,
  fetchTimeEntriesForTimeSheet,
  saveTimeEntry,
  logStopwatchSession,
  updateTimeEntryApprovalStatus,
  deleteTimeEntry,
  getTimeEntryById,
  fetchTimeEntryChangeRequestsForTimeSheet,
  fetchWorkItemsForTimeSheet,
  addWorkItem,
  deleteWorkItem,
  isServiceOptionalForWorkItem,
  fetchTaxRegions,
  fetchClientTaxRateForWorkItem,
  fetchServicesForTimeEntry,
  fetchScheduleEntryForWorkItem,
  fetchDefaultClientTaxRateInfoForWorkItem, // Added export
  resolveDefaultTicketTimeEntryService
};

// Note: Types and schemas previously re-exported from here must now be imported
// Note: these schemas were originally sourced from the legacy server action module due to 'use server' constraints.
// This file now only exports the async server actions.
