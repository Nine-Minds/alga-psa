/**
 * TimeSource: the seam between native time (time entries, time sheets, time
 * periods, the stopwatch) and wherever a given piece of time actually lives.
 *
 * Native time resolves every call through today's server actions and cores
 * (`nativeTimeSource.ts`). A second implementation (for example time that is
 * booked against shared work in another tenant) is registered by the app /
 * composition layer through `registerTimeSource`; this package never imports
 * it, and no call site imports `@alga-psa/co-managed`.
 *
 * This module is TYPES ONLY and has zero runtime imports. Every action / core
 * reference below is `import type`, so importing the seam never loads a server
 * module and can never drag `timeEntryWriteCore` into a client bundle.
 *
 * Rules for implementers
 * - Methods are plain functions and MUST NOT depend on `this`.
 * - Method names deliberately match the native function they replace. A
 *   method takes the `TimeSourceContext` first, then EXACTLY the arguments of
 *   the native function (for `withAuth` actions the auth arguments are
 *   already stripped, so `ctx` carries the identity the action body saw).
 * - Every method answers with a `TimeSourceResult`. `{ handled: false }` is an
 *   explicit miss: the caller then runs today's native body untouched. A
 *   provider may only answer for time it owns; it never forwards a foreign
 *   work item to a native function and never queries to decide ownership.
 * - On a hit the payload is `{ handled: true, value }` where `value` is the
 *   native function's return value, unchanged.
 */
import type { Knex } from 'knex';

import type {
  fetchTimeSheet,
  fetchTimeSheetComments,
  fetchTimeSheetsForApproval,
  fetchTimeEntriesForTimeSheet as fetchTimeEntriesForTimeSheetFromSheetActions,
  addCommentToTimeSheet,
  approveTimeSheet,
  requestChangesForTimeSheet,
  reverseTimeSheetApproval,
  bulkApproveTimeSheets,
} from '../../actions/timeSheetActions';
import type {
  fetchTimeSheets,
  fetchAllTimeSheets,
  fetchOrCreateTimeSheet,
  submitTimeSheet,
  deleteTimeSheets,
  fetchTimePeriods,
} from '../../actions/timeSheetOperations';
import type {
  getLatestTimePeriod,
  getCurrentTimePeriod,
  fetchAllTimePeriods,
  getTimePeriodSettings,
  createTimePeriod,
  updateTimePeriod,
  deleteTimePeriod,
  deleteTimePeriods,
  generateAndSaveTimePeriods,
} from '../../actions/timePeriodsActions';
import type {
  getActiveTimePeriodSettings,
  updateTimePeriodSettings,
  createTimePeriodSettings,
  deleteTimePeriodSettings,
} from '../../actions/time-period-settings-actions/timePeriodSettingsActions';
import type {
  fetchWorkItemsForTimeSheet,
  addWorkItem,
  deleteWorkItem,
} from '../../actions/timeEntryWorkItemActions';
import type { fetchTimeEntryChangeRequestsForTimeSheet } from '../../actions/timeEntryChangeRequestActions';
import type { createNextTimePeriod } from '../timePeriodAutomation';
import type { ensureTimePeriodCoversDate } from '../timePeriodMaterialization';
import type {
  fetchTimeEntriesForTimeSheet,
  getTimeEntryById,
  saveTimeEntry,
  updateTimeEntryApprovalStatus,
  deleteTimeEntry,
} from '../../actions/timeEntryCrudActions';
import type {
  getMyStopwatch,
  startStopwatch,
  pauseStopwatch,
  resumeStopwatch,
  discardStopwatch,
  updateStopwatchDraft,
} from '../../actions/stopwatchActions';
import type {
  getWorkItemBillingContext,
  WorkItemBillingContext,
  PersistTimeEntryInput,
  PersistedTimeEntry,
  deleteTimeEntryCore,
} from '../timeEntryWriteCore';

// ---------------------------------------------------------------------------
// Identity and results
// ---------------------------------------------------------------------------

/**
 * Which backend a time source talks to. `'native'` is the local tenant's time
 * tables. Anything else is an app-layer source and is opaque to this package:
 * call sites never branch on it, they branch on `handled`.
 */
export type TimeSourceKind = 'native' | (string & {});

export interface TimeSourceMiss {
  handled: false;
  /** Informational only; callers must not branch on it. */
  reason?: 'not-served' | 'native-work';
}

export type TimeSourceResult<T> = TimeSourceMiss | ({ handled: true } & T);

/** A hit carries the native function's return value, unchanged, as `value`. */
export type TimeSourceValue<V> = TimeSourceResult<{ value: V }>;

/**
 * What the call site already has in hand when it asks for a source. Nothing
 * here may be fetched in order to build it: the registry discriminates on
 * these fields (and on the cached capability verdict) and never queries.
 */
export interface TimeSourceContext {
  tenant: string;
  userId?: string;
  /** Marker already on the work item / row being touched, when there is one. */
  workItemType?: string | null;
  workItemId?: string | null;
  /** Marker already on a time_entries / time_sheets / session row, when there is one. */
  rowMarker?: string | null;
}

/** A native function `F` as a provider method: ctx first, same arguments, explicit-miss result. */
export type TimeSourceMethod<F extends (...args: any[]) => any> = (
  ctx: TimeSourceContext,
  ...args: Parameters<F>
) => Promise<TimeSourceValue<Awaited<ReturnType<F>>>>;

// ---------------------------------------------------------------------------
// Method groups
// ---------------------------------------------------------------------------

/** `time_sheets` and their approval lifecycle. */
export interface TimeSourceSheets {
  read: TimeSourceMethod<typeof fetchTimeSheet>;
  list: TimeSourceMethod<typeof fetchTimeSheets>;
  listAll: TimeSourceMethod<typeof fetchAllTimeSheets>;
  listForApproval: TimeSourceMethod<typeof fetchTimeSheetsForApproval>;
  listEntries: TimeSourceMethod<typeof fetchTimeEntriesForTimeSheetFromSheetActions>;
  open: TimeSourceMethod<typeof fetchOrCreateTimeSheet>;
  submit: TimeSourceMethod<typeof submitTimeSheet>;
  approve: TimeSourceMethod<typeof approveTimeSheet>;
  bulkApprove: TimeSourceMethod<typeof bulkApproveTimeSheets>;
  requestChanges: TimeSourceMethod<typeof requestChangesForTimeSheet>;
  reverseApproval: TimeSourceMethod<typeof reverseTimeSheetApproval>;
  remove: TimeSourceMethod<typeof deleteTimeSheets>;
  comment: TimeSourceMethod<typeof addCommentToTimeSheet>;
  comments: TimeSourceMethod<typeof fetchTimeSheetComments>;
  listWorkItems: TimeSourceMethod<typeof fetchWorkItemsForTimeSheet>;
  addWorkItem: TimeSourceMethod<typeof addWorkItem>;
  removeWorkItem: TimeSourceMethod<typeof deleteWorkItem>;
}

/** `time_periods` and their settings. */
export interface TimeSourcePeriods {
  read: TimeSourceMethod<typeof fetchAllTimePeriods>;
  readLatest: TimeSourceMethod<typeof getLatestTimePeriod>;
  readCurrent: TimeSourceMethod<typeof getCurrentTimePeriod>;
  readForUser: TimeSourceMethod<typeof fetchTimePeriods>;
  readSettings: TimeSourceMethod<typeof getTimePeriodSettings>;
  create: TimeSourceMethod<typeof createTimePeriod>;
  update: TimeSourceMethod<typeof updateTimePeriod>;
  remove: TimeSourceMethod<typeof deleteTimePeriod>;
  removeMany: TimeSourceMethod<typeof deleteTimePeriods>;
  generate: TimeSourceMethod<typeof generateAndSaveTimePeriods>;
  readActiveSettings: TimeSourceMethod<typeof getActiveTimePeriodSettings>;
  updateSettings: TimeSourceMethod<typeof updateTimePeriodSettings>;
  createSettings: TimeSourceMethod<typeof createTimePeriodSettings>;
  removeSettings: TimeSourceMethod<typeof deleteTimePeriodSettings>;
  /** Nightly materialization (`createNextTimePeriod`); resolved once per tenant by the job. */
  materialize: TimeSourceMethod<typeof createNextTimePeriod>;
  /** Read-path gap fill (`ensureTimePeriodCoversDate`). */
  ensureCovers: TimeSourceMethod<typeof ensureTimePeriodCoversDate>;
}

/** `time_entries`. */
export interface TimeSourceEntries {
  read: TimeSourceMethod<typeof getTimeEntryById>;
  list: TimeSourceMethod<typeof fetchTimeEntriesForTimeSheet>;
  listChangeRequests: TimeSourceMethod<typeof fetchTimeEntryChangeRequestsForTimeSheet>;
  /** Admission of a write (create/update); native is `saveTimeEntry`. */
  admit: TimeSourceMethod<typeof saveTimeEntry>;
  review: TimeSourceMethod<typeof updateTimeEntryApprovalStatus>;
  remove: TimeSourceMethod<typeof deleteTimeEntry>;
  /** Write-core level (inside the caller's transaction): `persistTimeEntry`. */
  persist: (
    trx: Knex.Transaction,
    ctx: TimeSourceContext,
    input: PersistTimeEntryInput,
  ) => Promise<TimeSourceValue<PersistedTimeEntry>>;
  /** Write-core level (inside the caller's transaction): `deleteTimeEntryCore`. */
  removeCore: (
    trx: Knex.Transaction,
    ctx: TimeSourceContext,
    ...args: Parameters<typeof deleteTimeEntryCore> extends [any, ...infer Rest] ? Rest : never
  ) => Promise<TimeSourceValue<Awaited<ReturnType<typeof deleteTimeEntryCore>>>>;
  /**
   * The billing mode of an entry. Native time is always `'commercial'` and
   * answering costs no statement. Deliberately takes no permission: the time
   * entry dialog reads it before the user has `time_entry:read` on the entry.
   */
  billingMode: (ctx: TimeSourceContext, entryId: string) => Promise<TimeSourceValue<string>>;
  /**
   * Serializes a billing-mode decision against a concurrent write. Native
   * takes no extra lock: this exists so a provider that has one can take it in
   * the same order everywhere.
   */
  lockBillingMode: (
    trx: Knex.Transaction,
    ctx: TimeSourceContext,
    entryId: string,
  ) => Promise<TimeSourceValue<string>>;
}

/** `time_tracking_sessions` (main's single stopwatch table). */
export interface TimeSourceTimer {
  active: TimeSourceMethod<typeof getMyStopwatch>;
  start: TimeSourceMethod<typeof startStopwatch>;
  pause: TimeSourceMethod<typeof pauseStopwatch>;
  resume: TimeSourceMethod<typeof resumeStopwatch>;
  /** Abandon the timer without writing effort (REST cancel-tracking). */
  cancel: TimeSourceMethod<typeof discardStopwatch>;
  updateDraft: TimeSourceMethod<typeof updateStopwatchDraft>;
}

/** Work-item lookup. */
export interface TimeSourceWork {
  /** Which work item time for this ticket is booked against. Pure: no I/O. */
  resolveItem: (
    ctx: TimeSourceContext,
    ticketId: string,
  ) => TimeSourceResult<{ value: { workItemType: string; workItemId: string } }>;
  billingContext: (
    ctx: TimeSourceContext,
    ...args: Parameters<typeof getWorkItemBillingContext>
  ) => Promise<TimeSourceValue<WorkItemBillingContext>>;
}

/** L2's access-reduction retainer registry is called here; this card registers nothing into it. */
export interface TimeSourceRetain {
  participation: (
    ctx: TimeSourceContext,
    entryId: string,
  ) => Promise<TimeSourceValue<{ retained: boolean }>>;
}

/**
 * REST-service level surface (`TimeEntryService`, `TimeSheetService`). Those
 * services take a `ServiceContext` (user + tenant + knex) that lives in the
 * server package, so this package types them loosely: a method is looked up by
 * the NAME of the service method it replaces and receives that method's
 * arguments verbatim (ServiceContext last, as natively). Omitted methods are
 * misses. Server-side call sites go through `delegateRest`.
 */
export type TimeSourceRestMethod = (ctx: TimeSourceContext, ...args: any[]) => Promise<TimeSourceValue<any>>;
export type TimeSourceRestSurface = Readonly<Record<string, TimeSourceRestMethod | undefined>>;
export interface TimeSourceRest {
  readonly entries?: TimeSourceRestSurface;
  readonly sheets?: TimeSourceRestSurface;
}

/**
 * AUTHORIZATION CONTRACT. Every hook runs BEFORE the native action's own
 * `hasPermission` / ownership checks (those need native SQL, and the native
 * path must stay at zero extra statements). Therefore a provider that answers
 * `{ handled: true }` OWNS authorization for that call: it must authenticate
 * the caller (`ctx.userId`, `ctx.tenant`), enforce its own RBAC and tenancy,
 * and return an error value (never data) when the caller may not act. Only
 * `{ handled: false }` hands the call back to the native body, which then
 * performs its usual checks. A provider must never answer `handled: true` for
 * time it does not own.
 */
export interface TimeSource {
  readonly kind: TimeSourceKind;
  /** Optional: only non-native sources implement REST-service delegation. */
  readonly rest?: TimeSourceRest;
  readonly sheets: TimeSourceSheets;
  readonly periods: TimeSourcePeriods;
  readonly entries: TimeSourceEntries;
  readonly timer: TimeSourceTimer;
  readonly work: TimeSourceWork;
  readonly retain: TimeSourceRetain;
}

/**
 * How the registry decides a registered source applies, using ONLY data the
 * caller already holds. Never a query.
 */
export interface TimeSourceSelector {
  /** Explicit work item type markers (`work_item_type === 'co_managed'`). */
  workItemTypes?: readonly string[];
  /** Explicit row markers, matched against `ctx.rowMarker`. */
  rowMarkers?: readonly string[];
  /** Work item id prefixes (`co_managed_*`). */
  workItemIdPrefixes?: readonly string[];
  /**
   * A capability key whose cached `serves(tenant)` verdict gates the source
   * (read through `@alga-psa/core/capability`'s cache; no new statement
   * steady-state). Evaluated only after the explicit markers did not match
   * AND only when a source is registered at all.
   */
  servesCapability?: 'co-managed';
}

export type TimeSourceFactory = () => TimeSource;
