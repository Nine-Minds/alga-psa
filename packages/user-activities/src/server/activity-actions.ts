/**
 * Server-only entry for the identity-explicit activity cores used by the v1 REST API.
 *
 * These cores (`fetchUserActivitiesForApi`, the ad-hoc `*ForApi` functions) import knex via
 * `@alga-psa/db` and are deliberately NOT `'use server'` — they take an already-resolved
 * `(user, tenant, …)` and run under the caller's `runWithTenant`. They must never reach a
 * client bundle, so they live here rather than in the client-importable `../actions` barrel
 * (re-exporting them there pulls knex into the browser graph → "Can't resolve 'fs'").
 *
 * Import path: `@alga-psa/user-activities/server/activity-actions` (server code only).
 */

export {
  fetchUserActivitiesForApi,
  fetchUserActivitiesGroupedForApi,
} from '../actions/activityAggregationActions';
export type {
  ActivityGroupByKey,
  ApiActivityGroup,
  GroupedActivityResponse,
} from '../actions/activityAggregationActions';

export {
  createAdHocActivityForApi,
  getAdHocActivityForApi,
  getAdHocActivityAsActivityForApi,
  updateAdHocActivityForApi,
  setAdHocActivityDoneForApi,
  deleteAdHocActivityForApi,
} from '../actions/adHocActivityCore';
export type {
  CreateAdHocActivityInput,
  UpdateAdHocActivityInput,
  AdHocActivityDetails,
} from '../actions/adHocActivityCore';

export {
  getUserActivityGroupsForApi,
  moveActivityToGroupForApi,
  removeActivityFromGroupsForApi,
  reorderActivitiesInGroupForApi,
} from '../actions/activityGroupCore';
export type { ActivityGroup, ActivityGroupItem } from '../actions/activityGroupCore';
