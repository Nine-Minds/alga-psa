'use server'

// Import and re-export async functions explicitly to comply with 'use server'

import { getClientIdForWorkItem } from './timeEntryHelpers';
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
  fetchClientTaxRateForWorkItem,
  fetchServicesForTimeEntry,
  fetchScheduleEntryForWorkItem,
  fetchDefaultClientTaxRateInfoForWorkItem // Added export
} from './timeEntryServices';

export {
  getClientIdForWorkItem,
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
  fetchClientTaxRateForWorkItem,
  fetchServicesForTimeEntry,
  fetchScheduleEntryForWorkItem,
  fetchDefaultClientTaxRateInfoForWorkItem // Added export
};

// Note: Types and schemas previously re-exported from here must now be imported
// directly from '@product/actions/timeEntrySchemas.ts' due to 'use server' constraints.
// This file now only exports the async server actions.