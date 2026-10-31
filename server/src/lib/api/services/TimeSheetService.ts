/**
 * Time Sheet API Service
 * Handles all time sheet-related database operations for the REST API
 */

import { delegateRest } from '@alga-psa/scheduling/lib/timeSource';
import { v4 as uuidv4 } from 'uuid';
import { assertHumanWorkAssignee, assertHumanWorkOwner } from '@alga-psa/shared/lib/humanWork/assertHumanWorkAssignee';
import { Knex } from 'knex';
import { withTransaction } from '@alga-psa/db';
import { BaseService, ServiceContext, ListOptions, ListResult, tenantDb } from '@alga-psa/db';
import { 
  CreateTimeSheetData,
  UpdateTimeSheetData,
  TimeSheetFilterData,
  CreateTimePeriodData,
  UpdateTimePeriodData,
  CreateTimePeriodSettingsData,
  UpdateTimePeriodSettingsData,
  CreateTimeSheetCommentData,
  SubmitTimeSheetData,
  ApproveTimeSheetData,
  RequestChangesTimeSheetData,
  BulkApproveTimeSheetData,
  ReverseApprovalData,
  TimeSheetSearchData,
  TimeSheetExportQuery,
  CreateScheduleEntryData,
  UpdateScheduleEntryData,
  ScheduleEntryFilters,
  CalendarResponse
} from '../schemas/timeSheet';
import {
  TIME_SHEET_LIST_DEFAULT_SORT,
  TIME_SHEET_LIST_SORT_ALIASES,
  TIME_SHEET_LIST_SORT_KEYS,
} from '../schemas/timeSheetSort';
import { publishUnregisteredEventType } from 'server/src/lib/eventBus/publishers';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildScheduleEntryCreatedPayload, buildScheduleEntryDeletedPayload, buildScheduleEntryUpdatedPayload } from '@alga-psa/workflow-streams';
import { TimePeriod } from '@alga-psa/scheduling/models/timePeriod';
import { ensureTimePeriodCoversDate } from '@alga-psa/scheduling/lib/timePeriodMaterialization';
import { Temporal } from '@js-temporal/polyfill';
import { hasPermission } from '../../auth/rbac';
import {
  assertEditableGroupCalendar,
  buildVisibilityFilter,
  canAssignUser,
  evaluateEntryAccess,
  levelAtLeast,
  resolveCalendarAccess,
  type CalendarAccess,
} from '@alga-psa/scheduling/lib/calendarAccess';
import { assertCanActOnBehalf } from '@alga-psa/scheduling/actions/timeEntryDelegationAuth';
import { loadVisibleCalendars } from '@alga-psa/scheduling/lib/visibleCalendars';
import type { IVisibleCalendar } from '@alga-psa/types';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../middleware/apiMiddleware';

/**
 * Normalize a DATE column value to YYYY-MM-DD.
 * pg has no DATE (1082) parser, so the driver builds a Date at *server-local* midnight; local getters reverse that.
 * If a 1082 parser returning strings is ever added, the string branch handles it.
 */
// LEVERAGE: friction pg-date-parsing — DATE columns arrive as local-midnight Dates, so every reader re-derives the
// calendar date by hand. A global 1082 type parser would remove this (and the same bug in the TimePeriod model).
export function formatDbDate(value: string | Date): string {
  if (value instanceof Date) {
    const y = String(value.getFullYear()).padStart(4, '0');
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

/** Shape a time_periods row for the API: YYYY-MM-DD dates, derived is_current and computed fields. */
export function toApiTimePeriod(row: any, today: string): any {
  const start = formatDbDate(row.start_date);
  const end = formatDbDate(row.end_date);
  const startDate = Temporal.PlainDate.from(start);
  const endDate = Temporal.PlainDate.from(end);
  const pastDaysOfYear = startDate.dayOfYear - 1;
  const firstDayOfWeek = startDate.with({ month: 1, day: 1 }).dayOfWeek % 7; // 0 = Sunday
  return {
    ...row,
    start_date: start,
    end_date: end,
    is_current: start <= today && today < end,
    is_closed: !!row.is_closed,
    duration_days: startDate.until(endDate, { largestUnit: 'days' }).days,
    week_number: Math.ceil((pastDaysOfYear + firstDayOfWeek + 1) / 7),
    month_name: new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(startDate.year, startDate.month - 1, startDate.day))
    ),
    year: startDate.year,
  };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

const CLOSED_TIME_PERIOD_MESSAGE = 'Time period is closed; reopen it first';

function throwTimePeriodSettingsApiError(error: unknown): never {
  const dbError = error as { code?: string; column?: string };

  if (dbError?.code === '22P02') {
    throw new BadRequestError('One of the time period setting identifiers is invalid');
  }
  if (dbError?.code === '23502') {
    throw new BadRequestError(`Missing required time period setting field${dbError.column ? `: ${dbError.column}` : ''}`);
  }
  if (dbError?.code === '23503') {
    throw new BadRequestError('The selected time period setting references a record that does not exist');
  }
  if (dbError?.code === '23505') {
    throw new ConflictError('A conflicting time period setting already exists');
  }

  throw error;
}

type TimeSheetSortSpec = { column: string; nullable?: boolean };

// LEVERAGE: pattern api-list-sort-allowlist — fifth hand-rolled list-sort allowlist (Ticket, Financial, ContractLine, Team, TimeSheet); a shared per-resource sort declaration is missing below.
const TIME_SHEET_LIST_SORT_SQL: Record<string, TimeSheetSortSpec> = {
  period_start: { column: 'time_periods.start_date' },
  period_end: { column: 'time_periods.end_date' },
  submitted_at: { column: 'time_sheets.submitted_at', nullable: true },
  approved_at: { column: 'time_sheets.approved_at', nullable: true },
  approval_status: { column: 'time_sheets.approval_status' },
};

export { TIME_SHEET_LIST_SORT_KEYS, TIME_SHEET_LIST_DEFAULT_SORT };

/**
 * Resolve a caller-supplied sort key to SQL. time_sheets has no created_at column, so
 * the shared list layer's injected 'created_at' is accepted as an alias of the default.
 */
export function resolveTimeSheetListSort(sort: string | undefined): { field: string; spec: TimeSheetSortSpec } {
  const requested = sort ?? TIME_SHEET_LIST_DEFAULT_SORT;
  const field = TIME_SHEET_LIST_SORT_ALIASES[requested] ?? requested;
  const spec = Object.prototype.hasOwnProperty.call(TIME_SHEET_LIST_SORT_SQL, field)
    ? TIME_SHEET_LIST_SORT_SQL[field]
    : undefined;
  if (!spec) {
    throw new ValidationError(
      `Unknown sort field: ${requested}. Supported values: ${[...TIME_SHEET_LIST_SORT_KEYS, ...Object.keys(TIME_SHEET_LIST_SORT_ALIASES)].join(', ')}`
    );
  }
  return { field, spec };
}

export class TimeSheetService extends BaseService<any> {
  constructor() {
    super({
      tableName: 'time_sheets',
      primaryKey: 'id',
      tenantColumn: 'tenant',
      searchableFields: ['user_id', 'period_id', 'approval_status'],
      defaultSort: TIME_SHEET_LIST_DEFAULT_SORT,
      defaultOrder: 'desc',
      auditFields: {
        createdBy: 'created_by',
        updatedBy: 'updated_by',
        createdAt: 'created_at',
        updatedAt: 'updated_at'
      }
    });
  }

  /**
   * time_sheets has no created_at/updated_at, so the common created_ and
   * updated_ range keys are unsupported and rejected by `applyRangeFilters`. The
   * supported ranges map to the sheet's submitted/approved timestamps and, via
   * the time_periods join, the period window.
   */
  protected rangeFilterColumns(): Record<string, string | null> {
    return {
      // time_sheets has no created_at/updated_at: declare the common keys as
      // unsupported so they are rejected instead of silently ignored.
      created_from: null,
      created_to: null,
      updated_from: null,
      updated_to: null,
      submitted_from: `${this.tableName}.submitted_at`,
      submitted_to: `${this.tableName}.submitted_at`,
      approved_from: `${this.tableName}.approved_at`,
      approved_to: `${this.tableName}.approved_at`,
      period_start_from: 'time_periods.start_date',
      period_start_to: 'time_periods.start_date',
      period_end_from: 'time_periods.end_date',
      period_end_to: 'time_periods.end_date',
    };
  }

  async list(options: ListOptions, context: ServiceContext, filters?: TimeSheetFilterData): Promise<ListResult<any>> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'list', [options, context, filters]);
    if (delegated.handled) return delegated.value;
      const { knex } = await this.getKnex();
      const db = tenantDb(knex, context.tenant);
      
      // Resolve the sort first so a bad key is rejected before touching the database.
      const { spec: sortSpec } = resolveTimeSheetListSort(options.sort);

      // The controller passes filters as options.filters; direct callers use the third argument.
      const effectiveFilters = filters ?? (options.filters as TimeSheetFilterData | undefined);

      let query = this.buildTenantScopedQuery(knex, context);

      // time_periods is joined exactly once: filters and ORDER BY both reference it.
      db.tenantJoin(query, 'time_periods', 'time_sheets.period_id', 'time_periods.period_id', { type: 'left' });

      // Apply filters
      if (effectiveFilters) {
        if (effectiveFilters.user_id) {
          query.where(`${this.tableName}.user_id`, effectiveFilters.user_id);
        }
        if (effectiveFilters.period_id) {
          query.where(`${this.tableName}.period_id`, effectiveFilters.period_id);
        }
        if (effectiveFilters.approval_status) {
          query.where(`${this.tableName}.approval_status`, effectiveFilters.approval_status);
        }
        if (effectiveFilters.approved_by) {
          query.where(`${this.tableName}.approved_by`, effectiveFilters.approved_by);
        }
        if (effectiveFilters.has_entries !== undefined) {
          const subquery = tenantDb(knex, context.tenant).table('time_entries')
            .where('time_entries.time_sheet_id', knex.raw(`${this.tableName}.id`))
            .select(knex.raw('1'));
          
          if (effectiveFilters.has_entries) {
            query.whereExists(subquery);
          } else {
            query.whereNotExists(subquery);
          }
        }
      }
  
      // Add joins for additional data
      db.tenantJoin(query, 'users', 'time_sheets.user_id', 'users.user_id', { type: 'left' });
      db.tenantJoin(query, 'users as approvers', 'time_sheets.approved_by', 'approvers.user_id', { type: 'left' });

      // Range filters (submitted_*, approved_*, period_*) after the time_periods
      // join; unsupported keys such as created_from throw.
      if (effectiveFilters) {
        this.applyRangeFilters(query, effectiveFilters as Record<string, unknown>);
      }

      query.select(
          `${this.tableName}.*`,
          knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as user_name`),
          knex.raw(`CONCAT(approvers.first_name, ' ', approvers.last_name) as approver_name`),
          'time_periods.start_date as period_start',
          'time_periods.end_date as period_end'
      );
  
      // Add computed fields
      // One correlated scalar subquery per aggregate (each selects exactly one column).
      const entryAggregate = (expression: string) =>
        tenantDb(knex, context.tenant).table('time_entries')
          .where('time_entries.time_sheet_id', knex.raw(`${this.tableName}.id`))
          .select(knex.raw(expression))
          .toQuery();

      query.select([
        knex.raw(`(${entryAggregate('SUM(billable_duration) / 60.0')}) as total_hours`),
        knex.raw(`(${entryAggregate('SUM(CASE WHEN billable_duration > 0 THEN billable_duration ELSE 0 END) / 60.0')}) as billable_hours`),
        knex.raw(`(${entryAggregate('COUNT(*)')}) as entry_count`)
      ]);
  
      // Get total count for pagination
      const countQuery = query.clone().clearSelect().clearOrder().count('* as count');
  
      // Apply sorting
      const direction = options.order === 'asc' ? 'asc' : 'desc';
      query.orderBy(sortSpec.column, direction, sortSpec.nullable ? 'last' : undefined);
      query.orderBy('time_sheets.id', direction); // unique tie-break for stable pagination

      // Apply pagination
      const page = options.page || 1;
      const limit = options.limit || 25;
      const offset = (page - 1) * limit;
      query.limit(limit).offset(offset);
  
      const [data, [{ count }]] = await Promise.all([
        query,
        countQuery
      ]);
  
      return {
        data,
        total: parseInt(count as string)
      };
    }


  async getById(id: string, context: ServiceContext): Promise<any | null> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'getById', [id, context]);
    if (delegated.handled) return delegated.value;
      const { knex } = await this.getKnex();
      const db = tenantDb(knex, context.tenant);
      const query = this.buildTenantScopedQuery(knex, context);

      db.tenantJoin(query, 'users', 'time_sheets.user_id', 'users.user_id', { type: 'left' });
      db.tenantJoin(query, 'users as approvers', 'time_sheets.approved_by', 'approvers.user_id', { type: 'left' });
      db.tenantJoin(query, 'time_periods', 'time_sheets.period_id', 'time_periods.period_id', { type: 'left' });
      
      const timeSheet = await query
        .where(`${this.tableName}.${this.primaryKey}`, id)
        .select(
          `${this.tableName}.*`,
          knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as user_name`),
          knex.raw(`CONCAT(approvers.first_name, ' ', approvers.last_name) as approver_name`),
          'time_periods.start_date as period_start',
          'time_periods.end_date as period_end'
        )
        .first();
  
      return timeSheet || null;
    }


  async getWithDetails(id: string, context: ServiceContext): Promise<any | null> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'getWithDetails', [id, context]);
    if (delegated.handled) return delegated.value;
    const timeSheet = await this.getById(id, context);
    if (!timeSheet) return null;

    const [user, approvedByUser, timePeriod, timeEntries, comments, summary] = await Promise.all([
      this.getTimeSheetUser(timeSheet.user_id, context),
      timeSheet.approved_by ? this.getTimeSheetUser(timeSheet.approved_by, context) : null,
      this.getTimePeriod(timeSheet.period_id, context),
      this.getTimeSheetEntries(id, context),
      this.getTimeSheetComments(id, context),
      this.getTimeSheetSummary(id, context)
    ]);

    return {
      ...timeSheet,
      user,
      approved_by_user: approvedByUser,
      time_period: timePeriod,
      time_entries: timeEntries,
      comments,
      summary
    };
  }

  async create(data: CreateTimeSheetData, context: ServiceContext): Promise<any> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'create', [data, context]);
    if (delegated.handled) return delegated.value;
      const { knex } = await this.getKnex();
      
      const created = await withTransaction(knex, async (trx) => {
        // Delegation guard: opening a sheet for someone else needs the same rights as acting
        // on that user's time elsewhere (time_sheet approve + read_all or manager-of-subject).
        if (data.user_id && data.user_id !== context.userId) {
          try {
            await assertCanActOnBehalf(context.user, context.tenant, data.user_id, trx);
          } catch (error) {
            if (error instanceof Error && error.message.includes('Permission denied:')) {
              throw new ForbiddenError(error.message);
            }
            throw error;
          }
        }
        // Human-work guard: an explicit owner must be a licensed user; a defaulted owner
        // (the caller) must be one too.
        if (data.user_id) {
          await assertHumanWorkAssignee(trx, context.tenant, [data.user_id]);
        } else {
          await assertHumanWorkOwner(trx, context.tenant, context.userId, 'user_id');
        }
        const timeSheetData = {
          ...data,
          user_id: data.user_id || context.userId,
          approval_status: 'DRAFT',
          tenant: context.tenant
        };

        const [timeSheet] = await tenantDb(trx, context.tenant).table(this.tableName)
          .insert(timeSheetData)
          .returning('*');

        return timeSheet;
      });

      // KNOWN DEFECT alga-2026-0002675: TIME_SHEET_CREATED is not in EVENT_TYPES, so the transport rejects this publish; behaviour kept as-is until the defect is fixed.
      await publishUnregisteredEventType({
        eventType: 'TIME_SHEET_CREATED',
        payload: {
          tenantId: context.tenant,
          timeSheetId: created.id,
          userId: context.userId,
          periodId: created.period_id,
          timestamp: new Date().toISOString()
        }
      });

      // Re-fetch after commit: getWithDetails runs on a pooled
      // (non-transaction) connection and must read the row post-commit.
      return this.getWithDetails(created.id, context);
    }


  async update(id: string, data: UpdateTimeSheetData, context: ServiceContext): Promise<any> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'update', [id, data, context]);
    if (delegated.handled) return delegated.value;
      const { knex } = await this.getKnex();
      
      await withTransaction(knex, async (trx) => {
        const existing = await this.getById(id, context);
        if (!existing) {
          throw new NotFoundError('Time sheet not found');
        }
  
        // Check permissions
        if (existing.user_id !== context.userId && !await this.canManageTimeSheets(context)) {
          throw new ForbiddenError('Permission denied: Cannot update this time sheet');
        }
  
        // Check if approved (prevent modification)
        if (existing.approval_status === 'APPROVED' && !await this.canManageTimeSheets(context)) {
          throw new ConflictError('Cannot modify approved time sheets');
        }
  
        // time_sheets has no updated_at column: write only the caller's fields.
        const updateData = { ...data };
  
        await this.buildTenantScopedQuery(trx, context)
          .where({ [this.primaryKey]: id })
          .update(updateData);
  
      });

      // KNOWN DEFECT alga-2026-0002675: TIME_SHEET_UPDATED is not in EVENT_TYPES, so the transport rejects this publish; behaviour kept as-is until the defect is fixed.
      await publishUnregisteredEventType({
        eventType: 'TIME_SHEET_UPDATED',
        payload: {
          tenantId: context.tenant,
          timeSheetId: id,
          userId: context.userId,
          changes: data,
          timestamp: new Date().toISOString()
        }
      });

      // Re-fetch after commit: getById runs on a pooled (non-transaction)
      // connection and must read the row post-commit.
      return this.getById(id, context);
    }


  async delete(id: string, context: ServiceContext): Promise<void> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'delete', [id, context]);
    if (delegated.handled) return delegated.value;
      const { knex } = await this.getKnex();
      
      await withTransaction(knex, async (trx) => {
        const existing = await this.getById(id, context);
        if (!existing) {
          throw new NotFoundError('Time sheet not found');
        }
  
        // Check permissions
        if (existing.user_id !== context.userId && !await this.canManageTimeSheets(context)) {
          throw new ForbiddenError('Permission denied: Cannot delete this time sheet');
        }
  
        // Check if approved
        if (existing.approval_status === 'APPROVED') {
          throw new ConflictError('Cannot delete approved time sheets');
        }
  
        await this.buildTenantScopedQuery(trx, context)
          .where({ [this.primaryKey]: id })
          .del();
      });

      // KNOWN DEFECT alga-2026-0002675: TIME_SHEET_DELETED is not in EVENT_TYPES, so the transport rejects this publish; behaviour kept as-is until the defect is fixed.
      await publishUnregisteredEventType({
        eventType: 'TIME_SHEET_DELETED',
        payload: {
          tenantId: context.tenant,
          timeSheetId: id,
          userId: context.userId,
          timestamp: new Date().toISOString()
        }
      });
    }


  // Time sheet workflow operations
  async submitTimeSheet(id: string, data: SubmitTimeSheetData, context: ServiceContext): Promise<any> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'submitTimeSheet', [id, data, context]);
    if (delegated.handled) return delegated.value;
      const { knex } = await this.getKnex();
      
      await withTransaction(knex, async (trx) => {
        const timeSheet = await this.getById(id, context);
        if (!timeSheet) {
          throw new NotFoundError('Time sheet not found');
        }
  
        // Check permissions
        if (timeSheet.user_id !== context.userId) {
          throw new ForbiddenError('Permission denied: Can only submit your own time sheets');
        }
  
        // Check current status
        if (timeSheet.approval_status !== 'DRAFT' && timeSheet.approval_status !== 'CHANGES_REQUESTED') {
          throw new ConflictError('Time sheet can only be submitted from DRAFT or CHANGES_REQUESTED status');
        }
  
        // Validate time sheet has entries
        const hasEntries = await this.hasTimeEntries(id, context);
        if (!hasEntries) {
          throw new ConflictError('Cannot submit time sheet without time entries');
        }
  
        await this.buildTenantScopedQuery(trx, context)
          .where({ id })
          .update({
            approval_status: 'SUBMITTED',
            submitted_at: new Date(),
            submission_notes: data.submission_notes,
            updated_at: new Date()
          });
  
      });

      // KNOWN DEFECT alga-2026-0002675: TIME_SHEET_SUBMITTED is not in EVENT_TYPES, so the transport rejects this publish; behaviour kept as-is until the defect is fixed.
      await publishUnregisteredEventType({
        eventType: 'TIME_SHEET_SUBMITTED',
        payload: {
          tenantId: context.tenant,
          timeSheetId: id,
          userId: context.userId,
          timestamp: new Date().toISOString()
        }
      });

      // Re-fetch after commit: getById runs on a pooled (non-transaction)
      // connection and must read the row post-commit.
      return this.getById(id, context);
    }


  async approveTimeSheet(id: string, data: ApproveTimeSheetData, context: ServiceContext): Promise<any> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'approveTimeSheet', [id, data, context]);
    if (delegated.handled) return delegated.value;
      const { knex } = await this.getKnex();
      
      await withTransaction(knex, async (trx) => {
        const timeSheet = await this.getById(id, context);
        if (!timeSheet) {
          throw new NotFoundError('Time sheet not found');
        }
  
        // Check permissions
        if (!await this.canApproveTimeSheets(context)) {
          throw new ForbiddenError('Permission denied: Cannot approve time sheets');
        }
  
        // Check current status
        if (timeSheet.approval_status !== 'SUBMITTED') {
          throw new ConflictError('Time sheet must be submitted before approval');
        }

        // Human-work guard: approval requires a human approver.
        await assertHumanWorkOwner(trx, context.tenant, context.userId, 'approved_by');
  
        await this.buildTenantScopedQuery(trx, context)
          .where({ id })
          .update({
            approval_status: 'APPROVED',
            approved_at: new Date(),
            approved_by: context.userId
          });

        // time_sheets has neither approval_notes nor updated_at; keep the notes as an approver comment
        // using the real time_sheet_comments columns (same shape the workflow runtime writes).
        if (data.approval_notes) {
          await tenantDb(trx, context.tenant).table('time_sheet_comments').insert({
            comment_id: uuidv4(),
            time_sheet_id: id,
            user_id: context.userId,
            comment: data.approval_notes,
            is_approver: true,
            created_at: trx.fn.now(),
            tenant: context.tenant
          });
        }
  
        // Update all time entries to approved status. time_entries has no approved_at/approved_by
        // columns (they live on time_sheets), so only approval_status/updated_at are written.
        await tenantDb(trx, context.tenant).table('time_entries')
          .where({ time_sheet_id: id })
          .update({
            approval_status: 'APPROVED',
            updated_at: new Date()
          });
  
      });

      // KNOWN DEFECT alga-2026-0002675: TIME_SHEET_APPROVED is not in EVENT_TYPES, so the transport rejects this publish; behaviour kept as-is until the defect is fixed.
      await publishUnregisteredEventType({
        eventType: 'TIME_SHEET_APPROVED',
        payload: {
          tenantId: context.tenant,
          timeSheetId: id,
          approvedBy: context.userId,
          timestamp: new Date().toISOString()
        }
      });

      // Re-fetch after commit: getById runs on a pooled (non-transaction)
      // connection and must read the row post-commit.
      return this.getById(id, context);
    }


  async requestChanges(id: string, data: RequestChangesTimeSheetData, context: ServiceContext): Promise<any> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'requestChanges', [id, data, context]);
    if (delegated.handled) return delegated.value;
      const { knex } = await this.getKnex();
      
      await withTransaction(knex, async (trx) => {
        const timeSheet = await this.getById(id, context);
        if (!timeSheet) {
          throw new NotFoundError('Time sheet not found');
        }
  
        // Check permissions
        if (!await this.canApproveTimeSheets(context)) {
          throw new ForbiddenError('Permission denied: Cannot request changes to time sheets');
        }
  
        // Check current status
        if (timeSheet.approval_status !== 'SUBMITTED') {
          throw new ConflictError('Time sheet must be submitted before requesting changes');
        }
  
        await this.buildTenantScopedQuery(trx, context)
          .where({ id })
          .update({
            approval_status: 'CHANGES_REQUESTED',
            change_reason: data.change_reason,
            detailed_feedback: data.detailed_feedback,
            updated_at: new Date()
          });
  
        // Add comment with feedback
        await this.addComment(id, {
          comment_text: `Changes requested: ${data.change_reason}${data.detailed_feedback ? `\n\nDetails: ${data.detailed_feedback}` : ''}`
        }, context);
  
      });

      // KNOWN DEFECT alga-2026-0002675: TIME_SHEET_CHANGES_REQUESTED is not in EVENT_TYPES, so the transport rejects this publish; behaviour kept as-is until the defect is fixed.
      await publishUnregisteredEventType({
        eventType: 'TIME_SHEET_CHANGES_REQUESTED',
        payload: {
          tenantId: context.tenant,
          timeSheetId: id,
          requestedBy: context.userId,
          reason: data.change_reason,
          timestamp: new Date().toISOString()
        }
      });

      // Re-fetch after commit: getById runs on a pooled (non-transaction)
      // connection and must read the row post-commit.
      return this.getById(id, context);
    }


  async bulkApprove(data: BulkApproveTimeSheetData, context: ServiceContext): Promise<any[]> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'bulkApprove', [data, context]);
    if (delegated.handled) return delegated.value;
      const results: { success: boolean; error?: string; time_sheet_id: string; data?: any }[] = [];
      
      for (const timeSheetId of data.time_sheet_ids) {
        try {
          const result = await this.approveTimeSheet(timeSheetId, { approval_notes: data.approval_notes }, context);
          results.push({ success: true, time_sheet_id: timeSheetId, data: result });
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
          results.push({ success: false, error: errorMessage, time_sheet_id: timeSheetId });
        }
      }
  
      return results;
    }


  async reverseApproval(id: string, data: ReverseApprovalData, context: ServiceContext): Promise<any> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'reverseApproval', [id, data, context]);
    if (delegated.handled) return delegated.value;
      const { knex } = await this.getKnex();
      
      await withTransaction(knex, async (trx) => {
        const timeSheet = await this.getById(id, context);
        if (!timeSheet) {
          throw new NotFoundError('Time sheet not found');
        }
  
        // Check permissions
        if (!await this.canManageTimeSheets(context)) {
          throw new ForbiddenError('Permission denied: Cannot reverse time sheet approval');
        }
  
        // Check current status
        if (timeSheet.approval_status !== 'APPROVED') {
          throw new ConflictError('Time sheet is not approved');
        }
  
        // Check if time sheet has been invoiced (would prevent reversal)
        const isInvoiced = await this.isTimeSheetInvoiced(id, context);
        if (isInvoiced) {
          throw new ConflictError('Cannot reverse approval of time sheet that has been invoiced');
        }
  
        await this.buildTenantScopedQuery(trx, context)
          .where({ id })
          .update({
            approval_status: 'CHANGES_REQUESTED',
            approved_at: null,
            approved_by: null,
            reversal_reason: data.reversal_reason,
            reversed_at: new Date(),
            reversed_by: context.userId,
            updated_at: new Date()
          });
  
        // Revert time entries to changes requested status
        await tenantDb(trx, context.tenant).table('time_entries')
          .where({ time_sheet_id: id })
          .update({
            approval_status: 'CHANGES_REQUESTED',
            approved_at: null,
            approved_by: null,
            updated_at: new Date()
          });
  
        // Add comment with reversal reason
        await this.addComment(id, {
          comment_text: `Approval reversed: ${data.reversal_reason}`
        }, context);
  
      });

      // KNOWN DEFECT alga-2026-0002675: TIME_SHEET_APPROVAL_REVERSED is not in EVENT_TYPES, so the transport rejects this publish; behaviour kept as-is until the defect is fixed.
      await publishUnregisteredEventType({
        eventType: 'TIME_SHEET_APPROVAL_REVERSED',
        payload: {
          tenantId: context.tenant,
          timeSheetId: id,
          reversedBy: context.userId,
          reason: data.reversal_reason,
          timestamp: new Date().toISOString()
        }
      });

      // Re-fetch after commit: getById runs on a pooled (non-transaction)
      // connection and must read the row post-commit.
      return this.getById(id, context);
    }


  // Time sheet comments
  async addComment(id: string, data: CreateTimeSheetCommentData, context: ServiceContext): Promise<any> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'addComment', [id, data, context]);
    if (delegated.handled) return delegated.value;
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        const commentData = {
          time_sheet_id: id,
          comment_text: data.comment_text,
          user_id: context.userId,
          user_role: await this.getUserRole(context.userId, context),
          tenant: context.tenant,
          created_at: new Date()
        };
  
        const [comment] = await tenantDb(trx, context.tenant).table('time_sheet_comments')
          .insert(commentData)
          .returning('*');
  
        return {
          ...comment,
          user: await this.getTimeSheetUser(context.userId, context)
        };
      });
    }


  async getTimeSheetComments(timeSheetId: string, context: ServiceContext): Promise<any[]> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'getTimeSheetComments', [timeSheetId, context]);
    if (delegated.handled) return delegated.value;
      const { knex } = await this.getKnex();
      const db = tenantDb(knex, context.tenant);
      const query = db.table('time_sheet_comments');
      
      db.tenantJoin(query, 'users', 'time_sheet_comments.user_id', 'users.user_id', { type: 'left' });

      const comments = await query
        .where({ 'time_sheet_comments.time_sheet_id': timeSheetId })
        .select(
          'time_sheet_comments.*',
          knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as user_name`)
        )
        .orderBy('created_at', 'desc');
  
      return comments.map(comment => ({
        ...comment,
        user: {
          user_id: comment.user_id,
          first_name: comment.first_name,
          last_name: comment.last_name,
          email: comment.email
        }
      }));
    }


  // Time periods management
  async getTimePeriods(context: ServiceContext): Promise<any[]> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'getTimePeriods', [context]);
    if (delegated.handled) return delegated.value;
      const { knex } = await this.getKnex();
      const today = todayUtc();

      const rows = await tenantDb(knex, context.tenant).table('time_periods')
        .orderBy('start_date', 'desc');
      return rows.map((row: any) => toApiTimePeriod(row, today));
    }


  async getCurrentTimePeriod(context: ServiceContext, date?: string): Promise<any | null> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'getCurrentTimePeriod', [context, date]);
    if (delegated.handled) return delegated.value;
      const { knex } = await this.getKnex();

      const today = todayUtc();
      const targetDate = date ?? today;
      let period = await TimePeriod.findByDate(knex, context.tenant, targetDate);

      // Materialize the current period from the tenant's settings, but never for other dates.
      if (!period && targetDate === today) {
        await ensureTimePeriodCoversDate(knex, context.tenant, Temporal.PlainDate.from(today));
        period = await TimePeriod.findByDate(knex, context.tenant, targetDate);
      }

      return period ? this.getTimePeriod(period.period_id, context) : null;
    }


  async getTimePeriod(id: string, context: ServiceContext, db?: Knex | Knex.Transaction): Promise<any | null> {
      const conn = db ?? (await this.getKnex()).knex;

      const period = await tenantDb(conn, context.tenant).table('time_periods')
        .where({ period_id: id })
        .first();

      return period ? toApiTimePeriod(period, todayUtc()) : null;
    }


  async createTimePeriod(data: CreateTimePeriodData, context: ServiceContext): Promise<any> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'createTimePeriod', [data, context]);
    if (delegated.handled) return delegated.value;
      const { knex } = await this.getKnex();

      return withTransaction(knex, async (trx) => {
        // Dates are already normalized to YYYY-MM-DD by the schema; is_current is ignored (derived on read).
        const { start_date: startDate, end_date: endDate } = data;

        if (startDate >= endDate) {
          throw new BadRequestError('Start date must be before end date');
        }

        const overlappingPeriod = await TimePeriod.findOverlapping(trx, context.tenant, startDate, endDate);
        if (overlappingPeriod) {
          throw new ConflictError('Cannot create time period: overlaps with existing period');
        }

        const period = await TimePeriod.create(trx, context.tenant, { start_date: startDate, end_date: endDate });

        return this.getTimePeriod(period.period_id, context, trx);
      });
    }


  async updateTimePeriod(id: string, data: UpdateTimePeriodData, context: ServiceContext): Promise<any> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'updateTimePeriod', [id, data, context]);
    if (delegated.handled) return delegated.value;
      const { knex } = await this.getKnex();

      return withTransaction(knex, async (trx) => {
        const existingPeriod = await TimePeriod.findById(trx, context.tenant, id);

        if (!existingPeriod) {
          throw new NotFoundError('Time period not found');
        }

        if (existingPeriod.is_closed) {
          throw new ConflictError(CLOSED_TIME_PERIOD_MESSAGE);
        }

        // is_current is ignored; only the dates are editable.
        if (data.start_date === undefined && data.end_date === undefined) {
          return this.getTimePeriod(id, context, trx);
        }

        const nextStartDate = data.start_date ?? formatDbDate(existingPeriod.start_date as string | Date);
        const nextEndDate = data.end_date ?? formatDbDate(existingPeriod.end_date as string | Date);

        if (nextStartDate >= nextEndDate) {
          throw new BadRequestError('Start date must be before end date');
        }

        if (!(await TimePeriod.isEditable(trx, context.tenant, id))) {
          throw new ConflictError('Cannot change the dates of a time period that has associated time sheets');
        }

        const overlappingPeriod = await TimePeriod.findOverlapping(trx, context.tenant, nextStartDate, nextEndDate, id);
        if (overlappingPeriod) {
          throw new ConflictError('Cannot update time period: overlaps with existing period');
        }

        await TimePeriod.update(trx, context.tenant, id, {
          ...(data.start_date !== undefined ? { start_date: data.start_date } : {}),
          ...(data.end_date !== undefined ? { end_date: data.end_date } : {}),
        });

        return this.getTimePeriod(id, context, trx);
      });
    }


  async deleteTimePeriod(id: string, context: ServiceContext): Promise<void> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'deleteTimePeriod', [id, context]);
    if (delegated.handled) return delegated.value;
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        const period = await TimePeriod.findById(trx, context.tenant, id);

        if (!period) {
          throw new NotFoundError('Time period not found');
        }

        if (period.is_closed) {
          throw new ConflictError(CLOSED_TIME_PERIOD_MESSAGE);
        }

        // Check if period has time sheets
        const hasTimeSheets = await tenantDb(trx, context.tenant).table('time_sheets')
          .where({ period_id: id })
          .first();
  
        if (hasTimeSheets) {
          throw new ConflictError('Cannot delete time period that has associated time sheets');
        }
  
        const deletedCount = await tenantDb(trx, context.tenant).table('time_periods')
          .where({ period_id: id })
          .del();

        if (deletedCount === 0) {
          throw new NotFoundError('Time period not found');
        }
      });
    }


  async closeTimePeriod(id: string, context: ServiceContext): Promise<any> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'closeTimePeriod', [id, context]);
    if (delegated.handled) return delegated.value;
      return this.setTimePeriodClosed(id, true, context);
    }


  async reopenTimePeriod(id: string, context: ServiceContext): Promise<any> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'reopenTimePeriod', [id, context]);
    if (delegated.handled) return delegated.value;
      return this.setTimePeriodClosed(id, false, context);
    }


  private async setTimePeriodClosed(id: string, closed: boolean, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();

      return withTransaction(knex, async (trx) => {
        const period = await TimePeriod.setClosed(trx, context.tenant, id, closed);
        if (!period) {
          throw new NotFoundError('Time period not found');
        }
        return this.getTimePeriod(id, context, trx);
      });
    }


  // Time period settings
  async getTimePeriodSettings(context: ServiceContext): Promise<any[]> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'getTimePeriodSettings', [context]);
    if (delegated.handled) return delegated.value;
      const { knex } = await this.getKnex();
      
      return tenantDb(knex, context.tenant).table('time_period_settings')
        .orderBy('effective_from', 'desc');
    }


  async createTimePeriodSettings(data: CreateTimePeriodSettingsData, context: ServiceContext): Promise<any> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'createTimePeriodSettings', [data, context]);
    if (delegated.handled) return delegated.value;
      const { knex } = await this.getKnex();

      try {
        return await withTransaction(knex, async (trx) => {
          // Deactivate previous settings if new one is active
          if (data.is_active) {
            await tenantDb(trx, context.tenant).table('time_period_settings')
              .where({ is_active: true })
              .update({ is_active: false, updated_at: new Date() });
          }

          const settingsData = {
            ...data,
            tenant: context.tenant,
            created_at: new Date(),
            updated_at: new Date()
          };

          const [settings] = await tenantDb(trx, context.tenant).table('time_period_settings')
            .insert(settingsData)
            .returning('*');

          return settings;
        });
      } catch (error) {
        throwTimePeriodSettingsApiError(error);
      }
    }


  async updateTimePeriodSettings(id: string, data: UpdateTimePeriodSettingsData, context: ServiceContext): Promise<any> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'updateTimePeriodSettings', [id, data, context]);
    if (delegated.handled) return delegated.value;
      const { knex } = await this.getKnex();

      try {
        return await withTransaction(knex, async (trx) => {
          const existing = await tenantDb(trx, context.tenant).table('time_period_settings')
            .where({ time_period_settings_id: id })
            .first();

          if (!existing) {
            throw new NotFoundError('Time period settings not found');
          }

          // Deactivate other settings if this one is being activated
          if (data.is_active) {
            await tenantDb(trx, context.tenant).table('time_period_settings')
              .where({ is_active: true })
              .whereNot('time_period_settings_id', id)
              .update({ is_active: false, updated_at: new Date() });
          }

          const updateData = {
            ...data,
            updated_at: new Date()
          };

          const updatedCount = await tenantDb(trx, context.tenant).table('time_period_settings')
            .where({ time_period_settings_id: id })
            .update(updateData);

          if (updatedCount === 0) {
            throw new NotFoundError('Time period settings not found');
          }

          const settings = await tenantDb(trx, context.tenant).table('time_period_settings')
            .where({ time_period_settings_id: id })
            .first();

          if (!settings) {
            throw new NotFoundError('Time period settings not found');
          }

          return settings;
        });
      } catch (error) {
        throwTimePeriodSettingsApiError(error);
      }
    }



  // Schedule entries
  async getScheduleEntries(context: ServiceContext, filters?: ScheduleEntryFilters): Promise<any[]> {
      const { visible, access } = await this.loadVisibleScheduleEntries(context, filters);
      const results = await Promise.all(
        visible.map((candidate) => this.buildScheduleEntryResult(candidate, access, context))
      );
      return results.filter((entry) => entry !== null);
    }

  /**
   * Paginated variant of getScheduleEntries. Visibility (SQL filter plus the
   * per-entry access decision, which can hide an entry entirely) is resolved
   * for every candidate BEFORE counting, so `total` never includes hidden
   * entries. Only the requested page is then masked / enriched (work item
   * lookups), which is the expensive part.
   */
  async getScheduleEntriesPage(
    context: ServiceContext,
    filters: ScheduleEntryFilters,
    pagination: { page: number; limit: number }
  ): Promise<{ data: any[]; total: number }> {
      const { visible, access } = await this.loadVisibleScheduleEntries(context, filters);
      const offset = (pagination.page - 1) * pagination.limit;
      const pageRows = visible.slice(offset, offset + pagination.limit);
      const data = await Promise.all(
        pageRows.map((candidate) => this.buildScheduleEntryResult(candidate, access, context))
      );
      return { data: data.filter((entry) => entry !== null), total: visible.length };
    }

  private async loadVisibleScheduleEntries(context: ServiceContext, filters?: ScheduleEntryFilters) {
      const { knex } = await this.getKnex();
      const db = tenantDb(knex, context.tenant);
      
      let query = db.table('schedule_entries');
  
      // Apply date filters if provided
      if (filters?.start_date) {
        query = query.where('scheduled_start', '>=', filters.start_date);
      }
      if (filters?.end_date) {
        query = query.where('scheduled_end', '<=', filters.end_date);
      }
      // Date-only end_date arrives as an exclusive next-day bound (see ScheduleEntryFilters).
      if (filters?.end_before) {
        query = query.where('scheduled_end', '<', filters.end_before);
      }
      if (filters?.user_id) {
        query = db.tenantJoin(query, 'schedule_entry_assignees', 'schedule_entries.entry_id', 'schedule_entry_assignees.entry_id')
          .where('schedule_entry_assignees.user_id', filters.user_id);
      }
  
      // Visibility comes from the shared-calendar resolver: own entries,
      // shared personal calendars, group calendars, or everything for
      // user_schedule:update holders. Filtered in SQL, then masked per entry.
      const access = await resolveCalendarAccess(
        knex,
        context.tenant,
        { user_id: context.userId },
        await this.canViewAllSchedules(context)
      );
      const visibility = buildVisibilityFilter(access);
      if (visibility) {
        const visibleUserIds = visibility.userIds;
        const visibleCalendarIds = visibility.calendarIds;
        const assigneeVisibilityQuery = db.subquery('schedule_entry_assignees as sea')
          .select(knex.raw('1'))
          .whereRaw('?? = ??', ['sea.entry_id', 'schedule_entries.entry_id'])
          .whereIn('sea.user_id', visibleUserIds);
        db.tenantWhereColumn(assigneeVisibilityQuery, 'sea.tenant', 'schedule_entries.tenant');

        query = query.where(function() {
          this.whereExists(assigneeVisibilityQuery);
          if (visibleCalendarIds.length > 0) {
            this.orWhereIn('schedule_entries.calendar_id', visibleCalendarIds);
          }
        });
      }
      if (access.hiddenCalendarIds.length > 0) {
        query = query.where(function() {
          this.whereNull('schedule_entries.calendar_id')
            .orWhereNotIn('schedule_entries.calendar_id', access.hiddenCalendarIds);
        });
      }

      const entries = await query
        .select('schedule_entries.*')
        .distinct()
        .orderBy('scheduled_start')
        .orderBy('schedule_entries.entry_id');

      // Resolve assignees + access decision per entry; drop hidden entries.
      const candidates = await Promise.all(entries.map(async (entry: any) => {
        const assignedUsers = await this.getScheduleAssignees(entry.entry_id, context);
        const decision = evaluateEntryAccess(
          { ...entry, assigned_user_ids: assignedUsers.map((u: any) => u.user_id) },
          access
        );
        return decision.access === 'none' ? null : { entry, assignedUsers, decision };
      }));

      return { visible: candidates.filter((c) => c !== null) as any[], access };
    }

  private async buildScheduleEntryResult(
    { entry, assignedUsers, decision }: { entry: any; assignedUsers: any[]; decision: any },
    access: any,
    context: ServiceContext
  ): Promise<any> {
        const startTime = entry.scheduled_start ? new Date(entry.scheduled_start) : new Date();
        const endTime = entry.scheduled_end ? new Date(entry.scheduled_end) : new Date();
        const durationMs = endTime.getTime() - startTime.getTime();
        const durationHours = durationMs / (1000 * 60 * 60);
        const timing = {
          duration_hours: Math.round(durationHours * 100) / 100,
          is_current: startTime <= new Date() && endTime >= new Date(),
        };

        if (decision.access === 'busy') {
          return maskApiScheduleEntry({ ...entry, ...timing }, assignedUsers, access);
        }

        const workItem = entry.work_item_id ? await this.getWorkItemForSchedule(entry.work_item_id, entry.work_item_type, context) : null;
        return {
          ...entry,
          ...timing,
          assigned_users: assignedUsers,
          work_item: workItem,
          access: 'full',
          can_edit: decision.canEdit,
        };
    }


  async createScheduleEntry(data: CreateScheduleEntryData, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      const ScheduleEntry = (await import('@alga-psa/shared/models/scheduleEntry')).default;

      // Group calendar placement: same access path as the addScheduleEntry server action.
      // Failures throw (404/403); they never fall back to a personal entry.
      const calendarId = data.calendar_id ?? null;
      const assignedUserIds: string[] = data.assigned_user_ids || [];
      if (calendarId) {
        const access = await this.assertWritableGroupCalendar(knex, calendarId, context);
        if (assignedUserIds.some((userId) => !canAssignUser(userId, access))) {
          throw new ForbiddenError('Permission denied: Cannot assign schedules to other users');
        }
      }

      const entry = await withTransaction(knex, async (trx) => {
        // Map work_item_type to valid WorkItemType or default
        let workItemType: 'ticket' | 'project_task' | 'non_billable_category' | 'ad_hoc' | 'interaction';
        if (data.work_item_type === 'ticket' || data.work_item_type === 'project_task') {
          workItemType = data.work_item_type;
        } else {
          // Map other types to non_billable_category or ad_hoc
          workItemType = 'ad_hoc';
        }

        // Use ScheduleEntry.create() which handles ticket/task assignment notifications
        const entry = await ScheduleEntry.create(trx, context.tenant, {
          title: data.title,
          scheduled_start: new Date(data.scheduled_start),
          scheduled_end: new Date(data.scheduled_end),
          work_item_id: data.work_item_id ?? null,
          work_item_type: workItemType,
          notes: data.notes,
          is_private: data.is_private,
          is_all_day: data.is_all_day ?? false,
          recurrence_pattern: data.recurrence_pattern ? JSON.parse(data.recurrence_pattern) : null,
          assigned_user_ids: assignedUserIds,
          calendar_id: calendarId,
          status: 'scheduled'
        }, {
          assignedUserIds,
          assignedByUserId: context.userId
        });

        return entry;
      });

      await publishWorkflowEvent({ eventType: 'SCHEDULE_ENTRY_CREATED', payload: buildScheduleEntryCreatedPayload({ userId: context.userId, entryId: entry.entry_id, changes: {
            after: entry,
            assignedUserIds,
          } }), ctx: { tenantId: context.tenant, actor: { actorType: 'USER', actorUserId: context.userId } } });

      // Re-fetch after commit: getScheduleEntry runs on a pooled
      // (non-transaction) connection and must read the row post-commit.
      return this.getScheduleEntry(entry.entry_id, context);
    }


  async updateScheduleEntry(id: string, data: UpdateScheduleEntryData, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      const result = await withTransaction(knex, async (trx) => {
        const existing = await tenantDb(trx, context.tenant).table('schedule_entries')
          .where({ entry_id: id })
          .first();
  
        if (!existing) {
          throw new NotFoundError('Schedule entry not found');
        }

        // Check permissions
        const assigneeIds = await tenantDb(trx, context.tenant).table('schedule_entry_assignees')
          .where({ entry_id: id })
          .pluck('user_id');
        // Same rule as the updateScheduleEntry server action and the REST controller.
        const access = await resolveCalendarAccess(
          trx,
          context.tenant,
          { user_id: context.userId },
          await this.canViewAllSchedules(context)
        );
        const isOwnEntry = assigneeIds.length === 1 && assigneeIds[0] === context.userId;
        if (existing.is_private && !existing.calendar_id && !isOwnEntry) {
          throw new ForbiddenError('Permission denied: Cannot update a private schedule entry');
        }
        const decision = evaluateEntryAccess({ ...existing, assigned_user_ids: assigneeIds }, access);
        if (decision.access === 'none') {
          throw new NotFoundError('Schedule entry not found');
        }
        if (!decision.canEdit) {
          throw new ForbiddenError('Permission denied: Cannot update this schedule entry');
        }
        const addedToEntry = (data.assigned_user_ids ?? []).filter((userId: string) => !assigneeIds.includes(userId));
        if (addedToEntry.some((userId: string) => !canAssignUser(userId, access))) {
          throw new ForbiddenError('Permission denied: Cannot assign schedules to other users');
        }

        // calendar_id: undefined = unchanged, null = move to the personal calendar (no target check,
        // same as the updateScheduleEntry server action; edit on the existing entry was checked above),
        // uuid = move onto that group calendar.
        // Moving onto a group calendar requires edit access there; never silently ignored.
        if (data.calendar_id && data.calendar_id !== existing.calendar_id) {
          const targetAccess = await this.assertWritableGroupCalendar(trx, data.calendar_id, context);
          const addedAssignees = (data.assigned_user_ids ?? []).filter((userId: string) => !assigneeIds.includes(userId));
          if (addedAssignees.some((userId: string) => !canAssignUser(userId, targetAccess))) {
            throw new ForbiddenError('Permission denied: Cannot assign schedules to other users');
          }
        }

        // assigned_user_ids lives in schedule_entry_assignees, not on schedule_entries.
        const { assigned_user_ids: _assignedUserIds, ...rowData } = data;
        const updateData = {
          ...rowData,
          // Group calendar entries are never private (same invariant as ScheduleEntry.create). Judged on
          // the resulting calendar, as the server action does; a move to personal (null) leaves is_private as sent.
          ...((data.calendar_id !== undefined ? data.calendar_id : existing.calendar_id) ? { is_private: false } : {}),
          updated_at: new Date()
        };

        const { validateAllDayInterval } = await import('@alga-psa/shared/models/scheduleEntry');
        validateAllDayInterval({
          is_all_day: data.is_all_day ?? existing.is_all_day,
          scheduled_start: data.scheduled_start === undefined ? existing.scheduled_start : new Date(data.scheduled_start),
          scheduled_end: data.scheduled_end === undefined ? existing.scheduled_end : new Date(data.scheduled_end),
        });

        await tenantDb(trx, context.tenant).table('schedule_entries')
          .where({ entry_id: id })
          .update(updateData);
  
        // Update assignees if provided
        if (data.assigned_user_ids !== undefined) {
          // Human-work guard: validate only assignees this write adds (legacy ones are kept).
          await assertHumanWorkAssignee(trx, context.tenant, addedToEntry);

          await tenantDb(trx, context.tenant).table('schedule_entry_assignees')
            .where({ entry_id: id })
            .del();
  
          if (data.assigned_user_ids.length > 0) {
            const assigneeData = data.assigned_user_ids.map((userId: string) => ({
              entry_id: id,
              user_id: userId,
              tenant: context.tenant
            }));
  
            await tenantDb(trx, context.tenant).table('schedule_entry_assignees').insert(assigneeData);
          }
        }

        const updated = await tenantDb(trx, context.tenant).table('schedule_entries')
          .where({ entry_id: id })
          .first();

        const finalAssigneeIds: string[] = data.assigned_user_ids !== undefined
          ? data.assigned_user_ids
          : assigneeIds;

        return {
          existing,
          updated,
          beforeAssigneeIds: assigneeIds as string[],
          afterAssigneeIds: finalAssigneeIds,
        };
      });

      await publishWorkflowEvent({ eventType: 'SCHEDULE_ENTRY_UPDATED', payload: buildScheduleEntryUpdatedPayload({ userId: context.userId, entryId: id, changes: {
            before: this.scheduleEntryEventSnapshot(result.existing, result.beforeAssigneeIds),
            after: this.scheduleEntryEventSnapshot(result.updated, result.afterAssigneeIds),
          } }), ctx: { tenantId: context.tenant, actor: { actorType: 'USER', actorUserId: context.userId } } });

      // Re-fetch after commit: getScheduleEntry runs on a pooled
      // (non-transaction) connection and must read the row post-commit.
      return this.getScheduleEntry(id, context);
    }


  /**
   * Calendars visible to the caller (GET /api/v1/calendars). Visibility is the same helper the
   * getCalendarsVisibleToMe server action uses, with canViewAll = the caller's user_schedule:update.
   */
  async listCalendars(
    context: ServiceContext,
    filters: { type?: 'personal' | 'group'; include_archived?: boolean } = {}
  ): Promise<CalendarResponse[]> {
    const { knex } = await this.getKnex();
    const canViewAll = await this.canViewAllSchedules(context);
    const visible = await loadVisibleCalendars(knex, context.tenant, { user_id: context.userId }, canViewAll);

    const toItem = (calendar: IVisibleCalendar): CalendarResponse => ({
      calendar_id: calendar.calendar_id,
      name: calendar.name,
      calendar_type: calendar.calendar_type,
      owner_user_id: calendar.owner_user_id,
      access_level: calendar.access_level,
      can_edit: levelAtLeast(calendar.access_level, 'edit'),
      is_archived: !!calendar.is_archived,
    });

    return [visible.me, ...visible.people, ...visible.groups]
      .map(toItem)
      .filter((item) => !filters.type || item.calendar_type === filters.type)
      .filter((item) => filters.include_archived || !item.is_archived);
  }

  async deleteScheduleEntry(id: string, context: ServiceContext): Promise<void> {
      const { knex } = await this.getKnex();
      
      const existing = await withTransaction(knex, async (trx) => {
        const existing = await tenantDb(trx, context.tenant).table('schedule_entries')
          .where({ entry_id: id })
          .first();
  
        if (!existing) {
          throw new NotFoundError('Schedule entry not found');
        }

        // Check permissions
        const assigneeIds = await tenantDb(trx, context.tenant).table('schedule_entry_assignees')
          .where({ entry_id: id })
          .pluck('user_id');
        // Same rule as the deleteScheduleEntry server action (which checks plain is_private).
        const isOwnEntry = assigneeIds.length === 1 && assigneeIds[0] === context.userId;
        if (existing.is_private && !isOwnEntry) {
          throw new ForbiddenError('Permission denied: Cannot delete a private schedule entry');
        }
        const access = await resolveCalendarAccess(
          trx,
          context.tenant,
          { user_id: context.userId },
          await this.canViewAllSchedules(context)
        );
        const decision = evaluateEntryAccess({ ...existing, assigned_user_ids: assigneeIds }, access);
        if (decision.access === 'none') {
          throw new NotFoundError('Schedule entry not found');
        }
        if (!decision.canEdit) {
          throw new ForbiddenError('Permission denied: Cannot delete this schedule entry');
        }

        await tenantDb(trx, context.tenant).table('schedule_entries')
          .where({ entry_id: id })
          .del();

        return existing;
      });

      await publishWorkflowEvent({ eventType: 'SCHEDULE_ENTRY_DELETED', payload: buildScheduleEntryDeletedPayload({ userId: context.userId, entryId: id, changes: {
            before: existing,
          } }), ctx: { tenantId: context.tenant, actor: { actorType: 'USER', actorUserId: context.userId } } });
    }


  // Search and statistics
  async search(searchData: TimeSheetSearchData, context: ServiceContext): Promise<any[]> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'search', [searchData, context]);
    if (delegated.handled) return delegated.value;
      const { knex } = await this.getKnex();
      const db = tenantDb(knex, context.tenant);
      const tableName = this.tableName; // Capture tableName to use in callbacks
      
      const query = this.buildTenantScopedQuery(knex, context);
  
      // Join users first: the name match below references users.*.
      // `user_name` is the only searchable field; no column name derived from input reaches SQL.
      db.tenantJoin(query, 'users', 'time_sheets.user_id', 'users.user_id', { type: 'left' });
      query.where(knex.raw(`CONCAT(users.first_name, ' ', users.last_name)`), 'ilike', `%${searchData.query}%`);

      // Apply filters
      if (searchData.approval_statuses && searchData.approval_statuses.length > 0) {
        query.whereIn(`${tableName}.approval_status`, searchData.approval_statuses);
      }
      if (searchData.user_ids && searchData.user_ids.length > 0) {
        query.whereIn(`${tableName}.user_id`, searchData.user_ids);
      }
      if (searchData.period_ids && searchData.period_ids.length > 0) {
        query.whereIn(`${tableName}.period_id`, searchData.period_ids);
      }
      if (searchData.date_from) {
        db.tenantJoin(query, 'time_periods', 'time_sheets.period_id', 'time_periods.period_id')
          .where('time_periods.start_date', '>=', searchData.date_from);
      }
      if (searchData.date_to) {
        if (!query.toString().includes('time_periods')) {
          db.tenantJoin(query, 'time_periods', 'time_sheets.period_id', 'time_periods.period_id');
        }
        query.where('time_periods.end_date', '<=', searchData.date_to);
      }
  
      query.select(
          `${tableName}.*`,
          knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as user_name`)
        )
        .limit(searchData.limit || 25);
  
      const timeSheets = await query;
  
      // Include entries if requested
      if (searchData.include_entries) {
        return Promise.all(timeSheets.map(async timeSheet => ({
          ...timeSheet,
          time_entries: await this.getTimeSheetEntries(timeSheet.id, context)
        })));
      }
  
      return timeSheets;
    }



  async getStatistics(context: ServiceContext, filters?: TimeSheetFilterData): Promise<any> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'getStatistics', [context, filters]);
    if (delegated.handled) return delegated.value;
    // Implementation would return comprehensive time sheet statistics
    // Similar to other statistics methods in the pattern
    return {
      total_time_sheets: 0,
      pending_approval: 0,
      approved_this_period: 0,
      // ... other stats
    };
  }

  // Helper methods
  private async hasTimeEntries(timeSheetId: string, context: ServiceContext): Promise<boolean> {
      const { knex } = await this.getKnex();
      
      const entry = await tenantDb(knex, context.tenant).table('time_entries')
        .where({ time_sheet_id: timeSheetId })
        .first();
      return !!entry;
    }


  private async isTimeSheetInvoiced(timeSheetId: string, context: ServiceContext): Promise<boolean> {
    // Check if time sheet entries have been included in invoices
    return false; // Simplified for now
  }

  private async canManageTimeSheets(context: ServiceContext): Promise<boolean> {
    // Check RBAC permissions
    return false; // Simplified for now
  }

  private async canApproveTimeSheets(context: ServiceContext): Promise<boolean> {
    // Check RBAC permissions
    return false; // Simplified for now
  }

  /**
   * Resolve the caller's calendar access and require an editable, non-archived group calendar.
   * 404 when the calendar is unavailable to the caller (missing, other tenant, personal, archived,
   * or not visible to them); 403 when they can see it but lack edit access.
   */
  private async assertWritableGroupCalendar(
    knexOrTrx: Knex | Knex.Transaction,
    calendarId: string,
    context: ServiceContext
  ): Promise<CalendarAccess> {
    const access = await resolveCalendarAccess(
      knexOrTrx,
      context.tenant,
      { user_id: context.userId },
      await this.canViewAllSchedules(context)
    );
    const error = await assertEditableGroupCalendar(knexOrTrx, context.tenant, calendarId, access);
    if (error) {
      // A group calendar the caller has some access to (but not edit) is a 403; one they cannot
      // see at all must be indistinguishable from a missing/other-tenant calendar (404).
      if (access.groupLevels.has(calendarId) && error.startsWith('Permission denied')) {
        throw new ForbiddenError(error);
      }
      throw new NotFoundError('The selected calendar is not available.');
    }
    return access;
  }

  /**
   * Same before/after shape the scheduleActions server action publishes (camelCase, with
   * assignedUserIds), which the calendar sync subscriber reads to decide per-user sync.
   */
  // LEVERAGE: pattern schedule-entry-event-snapshot — duplicates sanitizeScheduleEntryForEvent in scheduleActions.ts
  private scheduleEntryEventSnapshot(entry: any, assignedUserIds: string[]) {
    if (!entry) return undefined;
    const toIso = (value: unknown): string | null => {
      if (!value) return null;
      const date = value instanceof Date ? value : new Date(value as string);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };
    return {
      id: entry.entry_id,
      title: entry.title,
      scheduledStart: toIso(entry.scheduled_start),
      scheduledEnd: toIso(entry.scheduled_end),
      status: entry.status,
      workItemId: entry.work_item_id,
      workItemType: entry.work_item_type,
      isRecurring: entry.is_recurring,
      recurrencePattern: entry.recurrence_pattern,
      assignedUserIds,
      isPrivate: entry.is_private,
    };
  }

  private async canViewAllSchedules(context: ServiceContext): Promise<boolean> {
    if (!context.user) return false;
    const { knex } = await this.getKnex();
    return hasPermission(context.user, 'user_schedule', 'update', knex);
  }

  private async canManageSchedules(context: ServiceContext, action: 'update' | 'delete' = 'update'): Promise<boolean> {
    if (!context.user) return false;
    const { knex } = await this.getKnex();
    return hasPermission(context.user, 'user_schedule', action, knex);
  }

  private async getUserRole(userId: string, context: ServiceContext): Promise<string> {
      const { knex } = await this.getKnex();
      
      const user = await tenantDb(knex, context.tenant).table('users')
        .where({ user_id: userId })
        .first();
      return user?.role || 'user';
    }


  private async getTimeSheetUser(userId: string, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      return tenantDb(knex, context.tenant).table('users')
        .where({ user_id: userId })
        .select('user_id', 'first_name', 'last_name', 'email')
        .first();
    }


  async getTimeSheetEntries(timeSheetId: string, context: ServiceContext): Promise<any[]> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'getTimeSheetEntries', [timeSheetId, context]);
    if (delegated.handled) return delegated.value;
      const { knex } = await this.getKnex();
      
      // work_date is a DATE column; node-pg would turn it into a JS Date (serialized as an
      // ISO datetime), so format it in SQL. The later alias overrides the `*` value.
      return tenantDb(knex, context.tenant).table('time_entries')
        .where({ time_sheet_id: timeSheetId })
        .select('time_entries.*', knex.raw("to_char(work_date, 'YYYY-MM-DD') as work_date"))
        .orderBy('start_time');
    }


  async getTimeSheetSummary(timeSheetId: string, context: ServiceContext): Promise<any> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'sheets', 'getTimeSheetSummary', [timeSheetId, context]);
    if (delegated.handled) return delegated.value;
      const { knex } = await this.getKnex();
      
      // worked_minutes is the real duration (end - start); billable_duration is the billed
      // subset in minutes, so non-billable hours are the difference. Billable minutes are
      // clamped to the entry's worked minutes (an entry with NULL start_time/end_time has 0
      // worked minutes but may still carry a billable_duration), so billable <= total and
      // non-billable >= 0 always hold.
      const rows = await tenantDb(knex, context.tenant).table('time_entries')
        .where({ time_sheet_id: timeSheetId })
        .select([
          knex.raw("COALESCE(work_item_type, 'unknown') as work_item_type"),
          knex.raw("to_char(work_date, 'YYYY-MM-DD') as work_date"),
          knex.raw('COALESCE(EXTRACT(EPOCH FROM (end_time - start_time)) / 60.0, 0) as worked_minutes'),
          knex.raw(
            'LEAST(COALESCE(billable_duration, 0), COALESCE(EXTRACT(EPOCH FROM (end_time - start_time)) / 60.0, 0)) as billable_minutes'
          )
        ]) as any[];

      let workedMinutes = 0;
      let billableMinutes = 0;
      const entriesByType: Record<string, number> = {};
      const entriesByDay: Record<string, number> = {};
      for (const row of rows) {
        const worked = Number(row.worked_minutes);
        workedMinutes += worked;
        billableMinutes += Number(row.billable_minutes);
        entriesByType[row.work_item_type] = (entriesByType[row.work_item_type] ?? 0) + worked / 60;
        entriesByDay[row.work_date] = (entriesByDay[row.work_date] ?? 0) + worked / 60;
      }

      const totalHours = workedMinutes / 60;
      const billableHours = billableMinutes / 60;
  
      return {
        total_hours: totalHours,
        billable_hours: billableHours,
        non_billable_hours: totalHours - billableHours,
        entries_by_type: entriesByType,
        entries_by_day: entriesByDay,
        approval_ready: rows.length > 0
      };
    }



  async getScheduleEntry(id: string, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      const entry = await tenantDb(knex, context.tenant).table('schedule_entries')
        .where({ entry_id: id })
        .first();
  
      if (!entry) return null;
  
      const assignedUsers = await this.getScheduleAssignees(id, context);

      // Internal callers (e.g. update/delete permission lookups) pass no user;
      // REST reads always carry one and go through the shared-calendar resolver.
      if (context.user) {
        const access = await resolveCalendarAccess(
          knex,
          context.tenant,
          { user_id: context.userId },
          await this.canViewAllSchedules(context)
        );
        const decision = evaluateEntryAccess(
          { ...entry, assigned_user_ids: assignedUsers.map((u: any) => u.user_id) },
          access
        );
        if (decision.access === 'none') return null;
        if (decision.access === 'busy') {
          return maskApiScheduleEntry(entry, assignedUsers, access);
        }
        const workItem = entry.work_item_id ? await this.getWorkItemForSchedule(entry.work_item_id, entry.work_item_type, context) : null;
        return {
          ...entry,
          assigned_users: assignedUsers,
          work_item: workItem,
          access: 'full',
          can_edit: decision.canEdit,
        };
      }

      const workItem = entry.work_item_id ? await this.getWorkItemForSchedule(entry.work_item_id, entry.work_item_type, context) : null;
  
      return {
        ...entry,
        assigned_users: assignedUsers,
        work_item: workItem
      };
    }


  /**
   * Raw entry plus assigned_user_ids, for authorization only. getScheduleEntry cannot be used
   * for that: it returns null/masked data for viewers without full access and exposes
   * assigned_users, not the assigned_user_ids evaluateEntryAccess reads.
   */
  async getScheduleEntryForAccess(id: string, context: ServiceContext): Promise<any | null> {
      const { knex } = await this.getKnex();
      const db = tenantDb(knex, context.tenant);
      const entry = await db.table('schedule_entries').where({ entry_id: id }).first();
      if (!entry) return null;
      const assigned_user_ids: string[] = await db.table('schedule_entry_assignees')
        .where({ entry_id: id })
        .pluck('user_id');
      return { ...entry, assigned_user_ids };
    }

  private async getScheduleAssignees(entryId: string, context: ServiceContext): Promise<any[]> {
      const { knex } = await this.getKnex();
      const db = tenantDb(knex, context.tenant);
      const query = db.table('schedule_entry_assignees');
      
      db.tenantJoin(query, 'users', 'schedule_entry_assignees.user_id', 'users.user_id');

      return query
        .where({ 'schedule_entry_assignees.entry_id': entryId })
        .select('users.user_id', 'users.first_name', 'users.last_name', 'users.email');
    }


  private async getWorkItemForSchedule(workItemId: string, workItemType: string, context: ServiceContext): Promise<any> {
    // Similar to TimeEntryService implementation
    return { id: workItemId, title: 'Unknown Work Item', type: workItemType };
  }
}

/**
 * Busy view of a schedule entry for REST responses: timing only, with
 * assignees narrowed to calendars the viewer can see.
 */
function maskApiScheduleEntry(entry: any, assignedUsers: any[], access: CalendarAccess): any {
  return {
    ...entry,
    title: 'Busy',
    notes: '',
    work_item_id: null,
    work_item_type: 'ad_hoc',
    work_item: null,
    recurrence_pattern: null,
    assigned_users: assignedUsers.filter(
      (u: any) => u.user_id === access.viewerUserId || access.canViewAll || access.userLevels.has(u.user_id)
    ),
    access: 'busy',
    can_edit: false,
  };
}
