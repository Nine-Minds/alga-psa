// LEVERAGE: friction calendar-sync-duplicate-copies — stale copy of
// ee/packages/calendar/src/lib/services/calendar (and utils/calendar). The live
// path is @alga-psa/ee-calendar; the recurring-series import fix landed there
// only. Reachable from tests alone (the integrations webhook handlers are dead:
// calendarWebhookRoutes.delegator.test asserts the routes do not import them).
// Do not fix bugs here — repoint the remaining test imports and delete.
export { CalendarSyncService } from './calendar/CalendarSyncService';
