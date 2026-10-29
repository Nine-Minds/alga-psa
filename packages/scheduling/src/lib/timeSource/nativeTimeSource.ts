/**
 * The native TimeSource: today's server actions and cores, unchanged.
 *
 * Every entry is a LAZY forwarder (`lazy(() => import('...'), 'fn')`), not the
 * function itself, for the same reasons as `nativeTicketDataSource`:
 * 1. Module mocks that export only a subset of a module keep working: the
 *    export is read when the method is called.
 * 2. The singleton is built once at module level and must not throw while the
 *    module graph is still loading.
 * 3. Importing the seam must not pull every action module (and its server
 *    dependencies) into whoever merely resolves a source.
 *
 * Arguments and results are forwarded byte-for-byte (`ctx` is dropped; the
 * native function authenticates itself). Errors are NOT caught, wrapped or
 * retried, so existing error mapping (`timeSheetActionErrors.ts`) keeps working.
 */
import type {
  TimeSource,
  TimeSourceContext,
  TimeSourceMethod,
  TimeSourceValue,
} from './timeSource';

// LEVERAGE: pattern late-bound-action-forwarder - same lazy forwarder as nativeTicketDataSource; a shared helper in a lower package would remove both copies
const lazy = <M extends Record<string, any>, K extends keyof M & string>(
  load: () => Promise<M>,
  key: K,
): TimeSourceMethod<M[K]> =>
  (async (_ctx: TimeSourceContext, ...args: unknown[]) => ({
    handled: true as const,
    value: await (await load())[key](...args),
  })) as unknown as TimeSourceMethod<M[K]>;

const sheetActions = () => import('../../actions/timeSheetActions');
const sheetOps = () => import('../../actions/timeSheetOperations');
const periodActions = () => import('../../actions/timePeriodsActions');
const entryCrud = () => import('../../actions/timeEntryCrudActions');
const stopwatch = () => import('../../actions/stopwatchActions');
const workItemActions = () => import('../../actions/timeEntryWorkItemActions');
const periodSettingsActions = () => import('../../actions/time-period-settings-actions/timePeriodSettingsActions');
const periodAutomation = () => import('../timePeriodAutomation');
const periodMaterialization = () => import('../timePeriodMaterialization');
const changeRequests = () => import('../../actions/timeEntryChangeRequestActions');
const writeCore = () => import('../timeEntryWriteCore');

export const nativeTimeSource: TimeSource = Object.freeze({
  kind: 'native',

  sheets: Object.freeze({
    read: lazy(sheetActions, 'fetchTimeSheet'),
    list: lazy(sheetOps, 'fetchTimeSheets'),
    listAll: lazy(sheetOps, 'fetchAllTimeSheets'),
    listForApproval: lazy(sheetActions, 'fetchTimeSheetsForApproval'),
    listEntries: lazy(sheetActions, 'fetchTimeEntriesForTimeSheet'),
    open: lazy(sheetOps, 'fetchOrCreateTimeSheet'),
    submit: lazy(sheetOps, 'submitTimeSheet'),
    approve: lazy(sheetActions, 'approveTimeSheet'),
    bulkApprove: lazy(sheetActions, 'bulkApproveTimeSheets'),
    requestChanges: lazy(sheetActions, 'requestChangesForTimeSheet'),
    reverseApproval: lazy(sheetActions, 'reverseTimeSheetApproval'),
    remove: lazy(sheetOps, 'deleteTimeSheets'),
    comment: lazy(sheetActions, 'addCommentToTimeSheet'),
    comments: lazy(sheetActions, 'fetchTimeSheetComments'),
    listWorkItems: lazy(workItemActions, 'fetchWorkItemsForTimeSheet'),
    addWorkItem: lazy(workItemActions, 'addWorkItem'),
    removeWorkItem: lazy(workItemActions, 'deleteWorkItem'),
  }),

  periods: Object.freeze({
    read: lazy(periodActions, 'fetchAllTimePeriods'),
    readLatest: lazy(periodActions, 'getLatestTimePeriod'),
    readCurrent: lazy(periodActions, 'getCurrentTimePeriod'),
    readForUser: lazy(sheetOps, 'fetchTimePeriods'),
    readSettings: lazy(periodActions, 'getTimePeriodSettings'),
    create: lazy(periodActions, 'createTimePeriod'),
    update: lazy(periodActions, 'updateTimePeriod'),
    remove: lazy(periodActions, 'deleteTimePeriod'),
    removeMany: lazy(periodActions, 'deleteTimePeriods'),
    generate: lazy(periodActions, 'generateAndSaveTimePeriods'),
    readActiveSettings: lazy(periodSettingsActions, 'getActiveTimePeriodSettings'),
    updateSettings: lazy(periodSettingsActions, 'updateTimePeriodSettings'),
    createSettings: lazy(periodSettingsActions, 'createTimePeriodSettings'),
    removeSettings: lazy(periodSettingsActions, 'deleteTimePeriodSettings'),
    materialize: lazy(periodAutomation, 'createNextTimePeriod'),
    ensureCovers: lazy(periodMaterialization, 'ensureTimePeriodCoversDate'),
  }),

  entries: Object.freeze({
    read: lazy(entryCrud, 'getTimeEntryById'),
    list: lazy(entryCrud, 'fetchTimeEntriesForTimeSheet'),
    listChangeRequests: lazy(changeRequests, 'fetchTimeEntryChangeRequestsForTimeSheet'),
    admit: lazy(entryCrud, 'saveTimeEntry'),
    review: lazy(entryCrud, 'updateTimeEntryApprovalStatus'),
    remove: lazy(entryCrud, 'deleteTimeEntry'),
    persist: (async (trx: any, _ctx: TimeSourceContext, input: any) => ({
      handled: true as const,
      value: await (await writeCore()).persistTimeEntry(trx, input),
    })) as TimeSource['entries']['persist'],
    removeCore: (async (trx: any, _ctx: TimeSourceContext, ...rest: any[]) => ({
      handled: true as const,
      value: await (await writeCore()).deleteTimeEntryCore(trx, ...(rest as [any, any, any?])),
    })) as TimeSource['entries']['removeCore'],
    // Native time is always commercial. No SQL, no lock, no permission: the
    // `time_entries.billing_mode` column may not even exist yet.
    billingMode: async (): Promise<TimeSourceValue<string>> => ({ handled: true, value: 'commercial' }),
    lockBillingMode: async (): Promise<TimeSourceValue<string>> => ({ handled: true, value: 'commercial' }),
  }),

  timer: Object.freeze({
    active: lazy(stopwatch, 'getMyStopwatch'),
    start: lazy(stopwatch, 'startStopwatch'),
    pause: lazy(stopwatch, 'pauseStopwatch'),
    resume: lazy(stopwatch, 'resumeStopwatch'),
    cancel: lazy(stopwatch, 'discardStopwatch'),
    updateDraft: lazy(stopwatch, 'updateStopwatchDraft'),
  }),

  work: Object.freeze({
    // Native default, identical to L3a's `resolveTicketTimeWorkItem` fallback.
    resolveItem: (_ctx: TimeSourceContext, ticketId: string) => ({
      handled: true as const,
      value: { workItemType: 'ticket', workItemId: ticketId },
    }),
    billingContext: async (_ctx: TimeSourceContext, ...args: any[]) => ({
      handled: true as const,
      value: await (await import('../timeEntryWriteCore')).getWorkItemBillingContext(
        ...(args as Parameters<typeof import('../timeEntryWriteCore').getWorkItemBillingContext>),
      ),
    }),
  }),

  retain: Object.freeze({
    // No retainer registry exists for native time (L2 owns it): nothing is retained.
    participation: async (): Promise<TimeSourceValue<{ retained: boolean }>> => ({
      handled: true,
      value: { retained: false },
    }),
  }),
}) as TimeSource;
