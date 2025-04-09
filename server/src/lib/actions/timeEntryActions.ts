'use server'

// Import and re-export async functions explicitly to comply with 'use server'

import { getCompanyIdForWorkItem } from './timeEntryHelpers';
import {
  fetchTimeSheets,
  submitTimeSheet,
  fetchAllTimeSheets,
  fetchTimePeriods,
  fetchOrCreateTimeSheet
} from './timeSheetOperations';
import {
  fetchTimeEntriesForTimeSheet,
  saveTimeEntry,
  deleteTimeEntry,
  getTimeEntryById
} from './timeEntryCrudActions';
import {
  fetchWorkItemsForTimeSheet,
  addWorkItem,
  deleteWorkItem
} from './timeEntryWorkItemActions';
import {
  fetchTaxRegions,
  fetchCompanyTaxRateForWorkItem,
  fetchServicesForTimeEntry,
  fetchScheduleEntryForWorkItem
} from './timeEntryServices';

export {
  getCompanyIdForWorkItem,
  fetchTimeSheets,
  submitTimeSheet,
  fetchAllTimeSheets,
  fetchTimePeriods,
  fetchOrCreateTimeSheet,
  fetchTimeEntriesForTimeSheet,
  saveTimeEntry,
  deleteTimeEntry,
  getTimeEntryById,
  fetchWorkItemsForTimeSheet,
  addWorkItem,
  deleteWorkItem,
  fetchTaxRegions,
  fetchCompanyTaxRateForWorkItem,
  fetchServicesForTimeEntry,
  fetchScheduleEntryForWorkItem
};

// Note: Types and schemas previously re-exported from here must now be imported
// directly from 'server/src/lib/actions/timeEntrySchemas.ts' due to 'use server' constraints.
// This file now only exports the async server actions.