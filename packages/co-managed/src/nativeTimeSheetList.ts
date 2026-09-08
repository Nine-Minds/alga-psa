import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { productTimeEntryMode } from '@alga-psa/types';
import { toCalendarDateString } from '@alga-psa/core';
import { getCoManagedOperationalState } from '@alga-psa/licensing';
import { hasCoManagedConversationOwnership } from './nativeConversationEvents';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { admitCoManagedNativeTimeOwner, isNativeTimeFieldHidden } from './nativeTimeEntryAccess';
import { hasCoManagedLocalPermission } from './localPermission';
import { readCoManagedNativeTimeSheet } from './nativeTimeRead';

/** Lists and period pickers consume the same projected sheets as detail views.
 * One outer transaction retains credentials and all owners/sheets before any
 * source parent, including when several sheets are shown together. */
export async function listCoManagedNativeTimeSheets(db: Knex, tenant: string,
  identify: () => Promise<CoManagedAuthenticatedActor>, options: { userId?: string; approval?: boolean; includeApproved?: boolean; periods?: boolean; details?: boolean } = {}
): Promise<{ handled: false } | { handled: true; sheets: any[]; periods: any[] }> {
  const { userId, approval, includeApproved, periods: includePeriods, details } = options;
  if (!isCoManagedUuid(tenant) || (userId && !isCoManagedUuid(userId)) || (includePeriods && !userId)) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    await getCoManagedOperationalState(trx, tenant);
    const owner = tenantDb(trx, tenant), workspace = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
    const operational = await owner.table('time_entries').where(q => q.where('billing_mode', 'operational').orWhere('work_item_type', 'co_managed')).first('entry_id');
    if (workspace?.product_code !== 'co_managed' && !operational && !await hasCoManagedConversationOwnership(trx, tenant)) return { handled: false };
    if (!workspace || workspace.suspended_at || !productTimeEntryMode(workspace.product_code)) throw new CoManagedSharedWorkError();
    const actor = snapshotCoManagedAuthenticatedActor(await identify());
    if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor);
    if (!await hasCoManagedLocalPermission(trx, actor, 'time_sheet', 'read', true) ||
      (approval && !await hasCoManagedLocalPermission(trx, actor, 'time_sheet', 'approve', true))) throw new CoManagedSharedWorkError();
    if (userId) await admitCoManagedNativeTimeOwner(trx, actor, credential.subject, userId, true);
    const query = owner.table('time_sheets').orderBy('id');
    // Period removal counts need complete sheet visibility. Otherwise counts
    // remain unknown, which keeps the existing removal UI disabled.
    if (userId && !includePeriods) query.where('user_id', userId);
    const hints = await query.select('id', 'user_id', 'period_id');
    await owner.table('users').whereIn('user_id', [...new Set(hints.map(row => row.user_id))]).orderBy('user_id').forShare().select('user_id');
    await owner.table('time_sheets').whereIn('id', hints.map(row => row.id)).orderBy('id').forShare().select('id');
    const admitted = new Map<string, Extract<Awaited<ReturnType<typeof readCoManagedNativeTimeSheet>>, { handled: true }>>();
    for (const hint of hints) {
      try {
        const current = await readCoManagedNativeTimeSheet(trx, tenant, hint.id, async () => actor, { view: true, comments: !!approval || details, approval, employee: !!approval || details, summary: details });
        if (current.handled) admitted.set(hint.id, current);
      } catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; }
    }
    let sheets = [...admitted.values()].map(current => ({ ...current.sheet, ...(approval || details ? { comments: current.comments } : {}), ...(details ? { time_entries: current.entries } : {}) }));
    if (userId) sheets = sheets.filter(sheet => sheet.user_id === userId);
    if (approval) sheets = sheets.filter(sheet => (includeApproved ? ['SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED'] : ['SUBMITTED', 'CHANGES_REQUESTED']).includes(sheet.approval_status));
    sheets.sort((a, b) => (b.time_period?.start_date ?? '').localeCompare(a.time_period?.start_date ?? '') || a.id.localeCompare(b.id));
    const periods: any[] = [];
    if (includePeriods) {
      const calendar = await owner.table('time_periods').orderBy('start_date', 'desc').orderBy('period_id').forShare().select('period_id', 'start_date', 'end_date');
      // Unopened periods belong to the selected user's sheet workflow. They
      // need the same user/delegation and sheet-read scope as an existing sheet.
      const unopenedPolicy = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'time_sheet', 'read', { ownerUserId: userId, assignedUserIds: [userId!] });
      for (const period of calendar) {
        const hint = hints.find(sheet => sheet.user_id === userId && sheet.period_id === period.period_id);
        const current = hint ? admitted.get(hint.id) : undefined;
        if (hint && !current) continue;
        const fields = current?.visibility.redactedFields ?? unopenedPolicy.redactedFields;
        const hidden = (names: string[]) => isNativeTimeFieldHidden(fields, names.flatMap(name => [name, `time_sheets.${name}`]));
        if (hidden(['period_id', 'time_period', 'time_period.start_date', 'time_period.end_date', 'period_start_date', 'period_end_date'])) continue;
        const start = toCalendarDateString(period.start_date), end = toCalendarDateString(period.end_date);
        const entries = current?.entries.filter(entry => entry.work_date >= start && entry.work_date < end) ?? [];
        const dates = [...new Set<string>(entries.map(entry => entry.work_date))].sort();
        periods.push({ tenant, period_id: period.period_id, start_date: start, end_date: end,
          timeSheetStatus: current?.sheet.approval_status ?? 'DRAFT', timeSheetId: current?.sheet.id ?? null,
          hoursEntered: hidden(['hoursEntered', 'hours_entered', 'total_hours', 'total_minutes', 'duration', 'elapsed_minutes']) ? null : entries.reduce((sum, entry) => sum + entry.elapsed_minutes, 0) / 60,
          daysLogged: hidden(['daysLogged', 'days_logged']) ? null : dates.length,
          lastEntryDate: hidden(['lastEntryDate', 'last_entry_date']) ? undefined : dates.at(-1),
          entryCount: hidden(['entry_count', 'entryCount', 'total_entries']) || (current && !current.visibility.completeEntries) ? undefined : current?.entries.length ?? 0,
          periodTimesheetCount: admitted.size === hints.length && !hidden(['periodTimesheetCount', 'period_sheet_count']) ? hints.filter(sheet => sheet.period_id === period.period_id).length : undefined,
        });
      }
    }
    await credential.assertCurrent();
    return { handled: true, sheets, periods };
  });
}
