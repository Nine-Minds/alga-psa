/**
 * Time Sheet API Service
 * Handles all time sheet-related database operations for the REST API
 */

import { Knex } from 'knex';
import { withTransaction, TimePeriodCalendarError } from '@alga-psa/db';
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
  GenerateTimePeriodsData,
  CreateScheduleEntryData,
  UpdateScheduleEntryData
} from '../schemas/timeSheet';
import { publishEvent } from 'server/src/lib/eventBus/publishers';
import { TimePeriod } from '@alga-psa/scheduling/models/timePeriod';
import { hasPermission } from '../../auth/rbac';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../middleware/apiMiddleware';
import { readCoManagedNativeTimePeriods, commandCoManagedNativeTimePeriods, generateTimePeriodCalendar, NativeTimeSheetError, createCoManagedNativeTimeSheet, editCoManagedNativeTimeSheet, CoManagedSharedWorkError, NativeTimeReviewError, readCoManagedNativeTimeSheet, listCoManagedNativeTimeSheets, commandCoManagedNativeTimeSheets, deleteCoManagedNativeTimeSheet, addCoManagedNativeTimeSheetComment } from '@alga-psa/co-managed';
import { CoManagedLifecycleError } from '@alga-psa/licensing';
import { exportTimeSheetProjections, timeSheetStatistics, timeSheetDto, timeSheetCommentDto, filterTimeSheets, sortTimeSheets } from './timeSheetCollection';

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

export class TimeSheetService extends BaseService<any> {
  constructor() {
    super({
      tableName: 'time_sheets',
      primaryKey: 'id',
      tenantColumn: 'tenant',
      searchableFields: ['user_id', 'period_id', 'approval_status'],
      defaultSort: 'created_at',
      defaultOrder: 'desc',
      auditFields: {
        createdBy: 'created_by',
        updatedBy: 'updated_by',
        createdAt: 'created_at',
        updatedAt: 'updated_at'
      }
    });
  }

  private sheetActor(context: ServiceContext) {
    if (!context.apiKeyId || context.user?.user_id !== context.userId || context.user?.tenant !== context.tenant || context.user?.user_type !== 'internal') throw new CoManagedSharedWorkError();
    return { kind: 'api_key' as const, tenant: context.tenant, userId: context.userId, apiKeyId: context.apiKeyId };
  }

  private async withSheetErrors<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); } catch (error) {
      if (error instanceof CoManagedSharedWorkError) throw new ForbiddenError('Permission denied: Cannot access this time sheet');
      if (error instanceof CoManagedLifecycleError) throw Object.assign(new ForbiddenError(error.message), { code: error.code });
      if (error instanceof TimePeriodCalendarError) {
        if (error.code === 'PERIOD_INVALID_DATES') throw new BadRequestError(error.message);
        if (error.code === 'PERIOD_NOT_FOUND') throw new NotFoundError(error.message);
        throw new ConflictError(error.message);
      }
      if (error instanceof NativeTimeSheetError) {
        if (error.code === 'SHEET_INVALID_INPUT') throw new BadRequestError(error.message);
        throw new ConflictError(error.message);
      }
      if (error instanceof Error && error.message === 'Time period not found') throw new NotFoundError(error.message);
      if (error instanceof NativeTimeReviewError) {
        if (error.code === 'TIME_REVIEW_NOT_FOUND') throw new NotFoundError(error.message);
        throw new ConflictError(error.message);
      }
      if (error instanceof Error && error.message === 'Time sheet not found') throw new NotFoundError(error.message);
      if (error instanceof Error && ['Only draft time sheets can be removed', 'Time sheet still has time entries'].includes(error.message)) throw new ConflictError(error.message);
      if (error instanceof Error && error.message === 'Comment cannot be empty') throw new BadRequestError(error.message);
      throw error;
    }
  }

  private currentSheet(knex: Knex, id: string, context: ServiceContext) {
    return this.withSheetErrors(async () => {
      const current = await readCoManagedNativeTimeSheet(knex, context.tenant, id, async () => this.sheetActor(context), { view: true, comments: true, employee: true, summary: true });
      return current.handled ? { handled: true as const, sheet: timeSheetDto({ ...current.sheet, time_entries: current.entries, comments: current.comments }) } : current;
    });
  }

  private currentSheets(knex: Knex, context: ServiceContext) {
    return this.withSheetErrors(() => listCoManagedNativeTimeSheets(knex, context.tenant, async () => this.sheetActor(context), { details: true }));
  }

  private currentSheetCommand(knex: Knex, id: string, command: 'submit' | 'approve' | 'request_changes' | 'reverse', context: ServiceContext, note?: string) {
    // Keep command, private feedback and response admission in one transaction.
    // A failure to disclose the result must also roll back the mutation/events.
    return this.withSheetErrors(() => withTransaction(knex, async trx => {
      const current = await commandCoManagedNativeTimeSheets(trx, context.tenant, { sheetIds: [id], command, reason: note }, async () => this.sheetActor(context), event => publishEvent(event));
      if (!current.handled) return current;
      if (note?.trim() && command !== 'reverse') await addCoManagedNativeTimeSheetComment(trx, context.tenant,
        { sheetId: id, userId: context.userId, comment: note }, async () => this.sheetActor(context));
      const result = await this.currentSheet(trx, id, context);
      if (!result.handled) throw new CoManagedSharedWorkError();
      return result;
    }));
  }

  async list(options: ListOptions, context: ServiceContext, filters?: TimeSheetFilterData): Promise<ListResult<any>> {
      const { knex } = await this.getKnex();
      const current = await this.currentSheets(knex, context);
      if (current.handled) {
        const rows = sortTimeSheets(filterTimeSheets(current.sheets.map(timeSheetDto), { ...options.filters, ...filters }), options.sort, options.order);
        const limit = options.limit ?? 25, offset = ((options.page ?? 1) - 1) * limit;
        return { data: rows.slice(offset, offset + limit), total: rows.length };
      }
      const db = tenantDb(knex, context.tenant);
      
      let query = this.buildTenantScopedQuery(knex, context);
  
      // Apply filters
      if (filters) {
        if (filters.user_id) {
          query.where(`${this.tableName}.user_id`, filters.user_id);
        }
        if (filters.period_id) {
          query.where(`${this.tableName}.period_id`, filters.period_id);
        }
        if (filters.approval_status) {
          query.where(`${this.tableName}.approval_status`, filters.approval_status);
        }
        if (filters.submitted_from) {
          query.where(`${this.tableName}.submitted_at`, '>=', filters.submitted_from);
        }
        if (filters.submitted_to) {
          query.where(`${this.tableName}.submitted_at`, '<=', filters.submitted_to);
        }
        if (filters.approved_from) {
          query.where(`${this.tableName}.approved_at`, '>=', filters.approved_from);
        }
        if (filters.approved_to) {
          query.where(`${this.tableName}.approved_at`, '<=', filters.approved_to);
        }
        if (filters.approved_by) {
          query.where(`${this.tableName}.approved_by`, filters.approved_by);
        }
        if (filters.period_start_from) {
          db.tenantJoin(query, 'time_periods', 'time_sheets.period_id', 'time_periods.period_id')
            .where('time_periods.start_date', '>=', filters.period_start_from);
        }
        if (filters.period_start_to) {
          if (!query.toString().includes('time_periods')) {
            db.tenantJoin(query, 'time_periods', 'time_sheets.period_id', 'time_periods.period_id');
          }
          query.where('time_periods.start_date', '<=', filters.period_start_to);
        }
        if (filters.period_end_from) {
          if (!query.toString().includes('time_periods')) {
            db.tenantJoin(query, 'time_periods', 'time_sheets.period_id', 'time_periods.period_id');
          }
          query.where('time_periods.end_date', '>=', filters.period_end_from);
        }
        if (filters.period_end_to) {
          if (!query.toString().includes('time_periods')) {
            db.tenantJoin(query, 'time_periods', 'time_sheets.period_id', 'time_periods.period_id');
          }
          query.where('time_periods.end_date', '<=', filters.period_end_to);
        }
        if (filters.has_entries !== undefined) {
          const subquery = tenantDb(knex, context.tenant).table('time_entries')
            .where('time_entries.time_sheet_id', knex.raw(`${this.tableName}.id`))
            .select(knex.raw('1'));
          
          if (filters.has_entries) {
            query.whereExists(subquery);
          } else {
            query.whereNotExists(subquery);
          }
        }
      }
  
      // Add joins for additional data
      db.tenantJoin(query, 'users', 'time_sheets.user_id', 'users.user_id', { type: 'left' });
      db.tenantJoin(query, 'users as approvers', 'time_sheets.approved_by', 'approvers.user_id', { type: 'left' });
      db.tenantJoin(query, 'time_periods', 'time_sheets.period_id', 'time_periods.period_id', { type: 'left' });

      query.select(
          `${this.tableName}.*`,
          knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as user_name`),
          knex.raw(`CONCAT(approvers.first_name, ' ', approvers.last_name) as approver_name`),
          'time_periods.start_date as period_start',
          'time_periods.end_date as period_end'
      );
  
      // Add computed fields
      const timeEntrySubquery = tenantDb(knex, context.tenant).table('time_entries')
        .where('time_entries.time_sheet_id', knex.raw(`${this.tableName}.id`))
        .select([
          knex.raw('SUM(billable_duration) / 60.0 as total_hours'),
          knex.raw('SUM(CASE WHEN billable_duration > 0 THEN billable_duration ELSE 0 END) / 60.0 as billable_hours'),
          knex.raw('COUNT(*) as entry_count')
        ])
        .first();
  
      query.select([
        knex.raw(`(${timeEntrySubquery.clone().select('total_hours').toQuery()}) as total_hours`),
        knex.raw(`(${timeEntrySubquery.clone().select('billable_hours').toQuery()}) as billable_hours`),
        knex.raw(`(${timeEntrySubquery.clone().select('entry_count').toQuery()}) as entry_count`)
      ]);
  
      // Get total count for pagination
      const countQuery = query.clone().clearSelect().clearOrder().count('* as count');
  
      // Apply sorting
      const sortField = options.sort || 'created_at';
      const sortOrder = options.order || 'desc';
      query.orderBy(`${this.tableName}.${sortField}`, sortOrder);
  
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
      const { knex } = await this.getKnex();
      const current = await this.currentSheet(knex, id, context);
      if (current.handled) return current.sheet;
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
    const { knex } = await this.getKnex();
    const current = await this.currentSheet(knex, id, context);
    if (current.handled) return current.sheet;
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
      const { knex } = await this.getKnex();
      const current = await this.withSheetErrors(() => withTransaction(knex, async trx => {
        const result = await createCoManagedNativeTimeSheet(trx, context.tenant, { userId: data.user_id ?? context.userId, periodId: data.period_id, notes: data.notes }, async () => this.sheetActor(context));
        if (!result.handled) return result;
        const response = await this.currentSheet(trx, result.sheet.id, context);
        if (!response.handled) throw new CoManagedSharedWorkError();
        return response;
      }));
      if (current.handled) return current.sheet;
      
      const created = await withTransaction(knex, async (trx) => {
        const timeSheetData = {
          ...data,
          user_id: data.user_id || context.userId,
          approval_status: 'DRAFT',
          tenant: context.tenant,
          created_at: new Date(),
          updated_at: new Date()
        };

        const [timeSheet] = await tenantDb(trx, context.tenant).table(this.tableName)
          .insert(timeSheetData)
          .returning('*');

        return timeSheet;
      });

      await publishEvent({
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
      const { knex } = await this.getKnex();
      const current = await this.withSheetErrors(() => withTransaction(knex, async trx => {
        if (!await editCoManagedNativeTimeSheet(trx, context.tenant, id, data, async () => this.sheetActor(context), event => publishEvent(event))) return { handled: false as const };
        const response = await this.currentSheet(trx, id, context);
        if (!response.handled) throw new CoManagedSharedWorkError();
        return response;
      }));
      if (current.handled) return current.sheet;
      
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
  
        const updateData = {
          ...data,
          updated_at: new Date()
        };
  
        await this.buildTenantScopedQuery(trx, context)
          .where({ [this.primaryKey]: id })
          .update(updateData);
  
      });

      await publishEvent({
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
      const { knex } = await this.getKnex();
      if (await this.withSheetErrors(() => deleteCoManagedNativeTimeSheet(knex, context.tenant, id, async () => this.sheetActor(context)))) return;
      
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

      await publishEvent({
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
      const { knex } = await this.getKnex();
      const current = await this.currentSheetCommand(knex, id, 'submit', context, data.submission_notes);
      if (current.handled) return current.sheet;
      
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

      await publishEvent({
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
      const { knex } = await this.getKnex();
      const current = await this.currentSheetCommand(knex, id, 'approve', context, data.approval_notes);
      if (current.handled) return current.sheet;
      
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
  
        await this.buildTenantScopedQuery(trx, context)
          .where({ id })
          .update({
            approval_status: 'APPROVED',
            approved_at: new Date(),
            approved_by: context.userId,
            approval_notes: data.approval_notes,
            updated_at: new Date()
          });
  
        // Update all time entries to approved status
        await tenantDb(trx, context.tenant).table('time_entries')
          .where({ time_sheet_id: id })
          .update({
            approval_status: 'APPROVED',
            approved_at: new Date(),
            approved_by: context.userId,
            updated_at: new Date()
          });
  
      });

      await publishEvent({
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
      const { knex } = await this.getKnex();
      const current = await this.currentSheetCommand(knex, id, 'request_changes', context, [data.change_reason, data.detailed_feedback].filter(Boolean).join('\n\n'));
      if (current.handled) return current.sheet;
      
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

      await publishEvent({
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
      const { knex } = await this.getKnex();
      const current = await this.currentSheetCommand(knex, id, 'reverse', context, data.reversal_reason);
      if (current.handled) return current.sheet;
      
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

      await publishEvent({
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
      const { knex } = await this.getKnex();
      const current = await this.withSheetErrors(() => addCoManagedNativeTimeSheetComment(knex, context.tenant,
        { sheetId: id, userId: context.userId, comment: data.comment_text }, async () => this.sheetActor(context)));
      if (current.handled) return timeSheetCommentDto(current.comment);
      
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
      const { knex } = await this.getKnex();
      const current = await this.currentSheet(knex, timeSheetId, context);
      if (current.handled) return current.sheet.comments;
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
      const { knex } = await this.getKnex();
      const current = await this.withSheetErrors(() => readCoManagedNativeTimePeriods(knex, context.tenant, async () => this.sheetActor(context)));
      if (current.handled) return current.periods;
      
      return tenantDb(knex, context.tenant).table('time_periods')
        .orderBy('start_date', 'desc');
    }


  async getCurrentTimePeriod(context: ServiceContext, date?: string): Promise<any | null> {
      const { knex } = await this.getKnex();
      const current = await this.withSheetErrors(() => readCoManagedNativeTimePeriods(knex, context.tenant, async () => this.sheetActor(context), { date: date ?? new Date().toISOString().slice(0, 10) }));
      if (current.handled) return current.periods[0] ?? null;

      const targetDate = date ?? new Date().toISOString().slice(0, 10);
      const period = await TimePeriod.findByDate(knex, context.tenant, targetDate);

      return period ? this.getTimePeriod(period.period_id, context) : null;
    }


  async getTimePeriod(id: string, context: ServiceContext): Promise<any | null> {
      const { knex } = await this.getKnex();
      const current = await this.withSheetErrors(() => readCoManagedNativeTimePeriods(knex, context.tenant, async () => this.sheetActor(context), { id }));
      if (current.handled) return current.periods[0] ?? null;
      
      const period = await tenantDb(knex, context.tenant).table('time_periods')
        .where({ period_id: id })
        .first();
  
      if (period && period.start_date && period.end_date) {
        const startDate = new Date(period.start_date);
        const endDate = new Date(period.end_date);
        const durationMs = endDate.getTime() - startDate.getTime();
        const durationDays = Math.ceil(durationMs / (1000 * 60 * 60 * 24));
  
        return {
          ...period,
          duration_days: durationDays,
          week_number: this.getWeekNumber(startDate),
          month_name: startDate.toLocaleString('default', { month: 'long' }),
          year: startDate.getFullYear()
        };
      }
  
      return period || null;
    }


  async createTimePeriod(data: CreateTimePeriodData, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      const current = await this.withSheetErrors(() => commandCoManagedNativeTimePeriods(knex, context.tenant, { action: 'create', periods: [data] }, async () => this.sheetActor(context)));
      if (current.handled) return current.periods[0];
      
      return withTransaction(knex, async (trx) => {
        const startDate = data.start_date ? new Date(data.start_date) : null;
        const endDate = data.end_date ? new Date(data.end_date) : null;

        if (!startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
          throw new BadRequestError('Start date and end date must be valid dates');
        }

        if (startDate >= endDate) {
          throw new BadRequestError('Start date must be before end date');
        }

        const overlappingPeriod = await tenantDb(trx, context.tenant).table('time_periods')
          .whereRaw('start_date < ?', [data.end_date])
          .whereRaw('end_date > ?', [data.start_date])
          .first();

        if (overlappingPeriod) {
          throw new ConflictError('Cannot create time period: overlaps with existing period');
        }

        const periodData = {
          ...data,
          tenant: context.tenant,
          created_at: new Date(),
          updated_at: new Date()
        };
  
        const [period] = await tenantDb(trx, context.tenant).table('time_periods')
          .insert(periodData)
          .returning('*');
  
        return this.getTimePeriod(period.period_id, context);
      });
    }


  async updateTimePeriod(id: string, data: UpdateTimePeriodData, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      const current = await this.withSheetErrors(() => commandCoManagedNativeTimePeriods(knex, context.tenant, { action: 'update', id, dates: data }, async () => this.sheetActor(context)));
      if (current.handled) return current.periods[0];
      
      return withTransaction(knex, async (trx) => {
        const existingPeriod = await tenantDb(trx, context.tenant).table('time_periods')
          .where({ period_id: id })
          .first();

        if (!existingPeriod) {
          throw new NotFoundError('Time period not found');
        }

        const nextStartDate = data.start_date ?? existingPeriod.start_date;
        const nextEndDate = data.end_date ?? existingPeriod.end_date;
        const startDate = new Date(nextStartDate);
        const endDate = new Date(nextEndDate);

        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
          throw new BadRequestError('Start date and end date must be valid dates');
        }

        if (startDate >= endDate) {
          throw new BadRequestError('Start date must be before end date');
        }

        const overlappingPeriod = await tenantDb(trx, context.tenant).table('time_periods')
          .whereNot('period_id', id)
          .where('start_date', '<', nextEndDate)
          .where('end_date', '>', nextStartDate)
          .first();

        if (overlappingPeriod) {
          throw new ConflictError('Cannot update time period: overlaps with existing period');
        }

        const updateData = {
          ...data,
          updated_at: new Date()
        };
  
        const updatedCount = await tenantDb(trx, context.tenant).table('time_periods')
          .where({ period_id: id })
          .update(updateData);

        if (updatedCount === 0) {
          throw new NotFoundError('Time period not found');
        }
  
        return this.getTimePeriod(id, context);
      });
    }


  async deleteTimePeriod(id: string, context: ServiceContext): Promise<void> {
      const { knex } = await this.getKnex();
      const current = await this.withSheetErrors(() => commandCoManagedNativeTimePeriods(knex, context.tenant, { action: 'delete', id }, async () => this.sheetActor(context)));
      if (current.handled) return;
      
      return withTransaction(knex, async (trx) => {
        const period = await tenantDb(trx, context.tenant).table('time_periods')
          .where({ period_id: id })
          .first();

        if (!period) {
          throw new NotFoundError('Time period not found');
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


  async generateTimePeriods(data: GenerateTimePeriodsData, context: ServiceContext): Promise<any[]> {
      const { knex } = await this.getKnex();
      const current = await this.withSheetErrors(() => commandCoManagedNativeTimePeriods(knex, context.tenant, { action: 'create', periods: generateTimePeriodCalendar(data) }, async () => this.sheetActor(context)));
      if (current.handled) return current.periods;
      
      return withTransaction(knex, async (trx) => {
        const periods: any[] = [];
        const startDate = new Date(data.start_date!);
        const endDate = new Date(data.end_date!);
        let currentDate = new Date(startDate);
  
        while (currentDate <= endDate) {
          const periodEnd = this.calculatePeriodEnd(currentDate, data.frequency, data.frequency_unit);
          
          if (periodEnd <= endDate) {
            const period = await this.createTimePeriod({
              start_date: currentDate.toISOString().split('T')[0],
              end_date: periodEnd.toISOString().split('T')[0],
              is_current: false
            }, context);
            
            periods.push(period);
          }
  
          currentDate = new Date(periodEnd);
          currentDate.setDate(currentDate.getDate() + 1);
        }
  
        return periods;
      });
    }


  // Time period settings
  async getTimePeriodSettings(context: ServiceContext): Promise<any[]> {
      const { knex } = await this.getKnex();
      
      return tenantDb(knex, context.tenant).table('time_period_settings')
        .orderBy('effective_from', 'desc');
    }


  async createTimePeriodSettings(data: CreateTimePeriodSettingsData, context: ServiceContext): Promise<any> {
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
  async getScheduleEntries(context: ServiceContext, filters?: any): Promise<any[]> {
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
      if (filters?.user_id) {
        query = db.tenantJoin(query, 'schedule_entry_assignees', 'schedule_entries.entry_id', 'schedule_entry_assignees.entry_id')
          .where('schedule_entry_assignees.user_id', filters.user_id);
      }
  
      // Check permissions for private entries
      if (!await this.canViewAllSchedules(context)) {
        const userId = context.userId;
        const assigneeVisibilityQuery = tenantDb(knex, context.tenant).table('schedule_entry_assignees as sea')
          .select('sea.user_id')
          .whereRaw('sea.entry_id = schedule_entries.entry_id')
          .where('sea.user_id', userId);

        query = query.where(function() {
          this.where('is_private', false)
            .orWhere('created_by', userId)
            .orWhereExists(assigneeVisibilityQuery);
        });
      }

      const entries = await query
        .select('schedule_entries.*')
        .distinct()
        .orderBy('scheduled_start');

      // Get assigned users for each entry
      return Promise.all(entries.map(async entry => {
        const assignedUsers = await this.getScheduleAssignees(entry.entry_id, context);
        const workItem = entry.work_item_id ? await this.getWorkItemForSchedule(entry.work_item_id, entry.work_item_type, context) : null;

        const startTime = entry.scheduled_start ? new Date(entry.scheduled_start) : new Date();
        const endTime = entry.scheduled_end ? new Date(entry.scheduled_end) : new Date();
        const durationMs = endTime.getTime() - startTime.getTime();
        const durationHours = durationMs / (1000 * 60 * 60);

        const result = {
          ...entry,
          assigned_users: assignedUsers,
          work_item: workItem,
          duration_hours: Math.round(durationHours * 100) / 100,
          is_current: startTime <= new Date() && endTime >= new Date()
        };

        // Private entries are masked for anyone who is not the creator or an assignee
        const isOwnEntry = entry.created_by === context.userId ||
          assignedUsers.some((u: any) => u.user_id === context.userId);
        if (entry.is_private && !isOwnEntry) {
          return {
            ...result,
            title: 'Busy',
            notes: '',
            work_item_id: null,
            work_item: null
          };
        }

        return result;
      }));
    }


  async createScheduleEntry(data: CreateScheduleEntryData, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      const ScheduleEntry = (await import('@alga-psa/shared/models/scheduleEntry')).default;

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
          recurrence_pattern: data.recurrence_pattern ? JSON.parse(data.recurrence_pattern) : null,
          assigned_user_ids: data.assigned_user_ids || [],
          status: 'scheduled'
        }, {
          assignedUserIds: data.assigned_user_ids || [],
          assignedByUserId: context.userId
        });

        return entry;
      });

      await publishEvent({
        eventType: 'SCHEDULE_ENTRY_CREATED',
        payload: {
          tenantId: context.tenant,
          userId: context.userId,
          entryId: entry.entry_id,
          changes: {
            after: entry,
            assignedUserIds: data.assigned_user_ids || [],
          },
        },
      });

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
        const isOwnEntry = existing.created_by === context.userId ||
          (assigneeIds.length === 1 && assigneeIds[0] === context.userId);

        if (existing.is_private && !isOwnEntry) {
          throw new ForbiddenError('Permission denied: Cannot update a private schedule entry');
        }

        if (!await this.canManageSchedules(context, 'update')) {
          const assignmentRemainsOwn = data.assigned_user_ids
            ? data.assigned_user_ids.length === 1 && data.assigned_user_ids[0] === context.userId
            : true;
          if (!isOwnEntry || !assignmentRemainsOwn) {
            throw new ForbiddenError('Permission denied: Cannot update this schedule entry');
          }
        }

        const updateData = {
          ...data,
          updated_at: new Date()
        };
  
        await tenantDb(trx, context.tenant).table('schedule_entries')
          .where({ entry_id: id })
          .update(updateData);
  
        // Update assignees if provided
        if (data.assigned_user_ids !== undefined) {
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

        return {
          existing,
          updated,
        };
      });

      await publishEvent({
        eventType: 'SCHEDULE_ENTRY_UPDATED',
        payload: {
          tenantId: context.tenant,
          userId: context.userId,
          entryId: id,
          changes: {
            before: result.existing,
            after: result.updated,
            assignedUserIds: data.assigned_user_ids,
          },
        },
      });

      // Re-fetch after commit: getScheduleEntry runs on a pooled
      // (non-transaction) connection and must read the row post-commit.
      return this.getScheduleEntry(id, context);
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
        const isOwnEntry = existing.created_by === context.userId ||
          (assigneeIds.length === 1 && assigneeIds[0] === context.userId);

        if (existing.is_private && !isOwnEntry) {
          throw new ForbiddenError('Permission denied: Cannot delete a private schedule entry');
        }

        if (!isOwnEntry && !await this.canManageSchedules(context, 'delete')) {
          throw new ForbiddenError('Permission denied: Cannot delete this schedule entry');
        }

        await tenantDb(trx, context.tenant).table('schedule_entries')
          .where({ entry_id: id })
          .del();

        return existing;
      });

      await publishEvent({
        eventType: 'SCHEDULE_ENTRY_DELETED',
        payload: {
          tenantId: context.tenant,
          userId: context.userId,
          entryId: id,
          changes: {
            before: existing,
          },
        },
      });
    }


  // Search and statistics
  async search(searchData: TimeSheetSearchData, context: ServiceContext): Promise<any[]> {
      const { knex } = await this.getKnex();
      const current = await this.currentSheets(knex, context);
      if (current.handled) {
        const rows = filterTimeSheets(current.sheets.map(timeSheetDto), { period_start_from: searchData.date_from, period_end_to: searchData.date_to });
        const query = searchData.query.toLocaleLowerCase(), fields = searchData.fields?.length ? searchData.fields : ['notes'];
        return rows.filter(sheet => (!query || fields.some(field => typeof sheet[field] === 'string' && sheet[field].toLocaleLowerCase().includes(query))) &&
          (!searchData.approval_statuses?.length || searchData.approval_statuses.includes(sheet.approval_status)) &&
          (!searchData.user_ids?.length || searchData.user_ids.includes(sheet.user_id)) &&
          (!searchData.period_ids?.length || searchData.period_ids.includes(sheet.period_id)))
          .slice(0, searchData.limit ?? 25).map(sheet => { const { time_entries, ...fields } = sheet; return searchData.include_entries ? sheet : fields; });
      }
      const db = tenantDb(knex, context.tenant);
      const tableName = this.tableName; // Capture tableName to use in callbacks
      
      const query = this.buildTenantScopedQuery(knex, context);
  
      // Build search query
      if (searchData.fields && searchData.fields.length > 0) {
        query.where(function() {
          searchData.fields!.forEach(field => {
            if (field === 'user_name') {
              this.orWhere(knex.raw(`CONCAT(users.first_name, ' ', users.last_name)`), 'ilike', `%${searchData.query}%`);
            } else {
              this.orWhere(`${tableName}.${field}`, 'ilike', `%${searchData.query}%`);
            }
          });
        });
      } else {
        // Default search in notes
        query.where(`${tableName}.notes`, 'ilike', `%${searchData.query}%`);
      }
  
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
  
      // Add joins
      db.tenantJoin(query, 'users', 'time_sheets.user_id', 'users.user_id', { type: 'left' });

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



  async exportCurrentTimeSheets(options: TimeSheetExportQuery, context: ServiceContext) {
    const { knex } = await this.getKnex();
    const current = await this.currentSheets(knex, context);
    if (!current.handled) return current;
    const rows = filterTimeSheets(current.sheets.map(timeSheetDto), { period_start_from: options.date_from, period_end_to: options.date_to })
      .filter(sheet => (!options.user_ids?.length || options.user_ids.includes(sheet.user_id)) &&
        (!options.period_ids?.length || options.period_ids.includes(sheet.period_id)) &&
        (!options.approval_statuses?.length || options.approval_statuses.includes(sheet.approval_status)));
    try { return { handled: true as const, data: await exportTimeSheetProjections(rows, options) }; }
    catch (error) { if (error instanceof Error && error.message === 'Unknown timesheet export field') throw new BadRequestError(error.message); throw error; }
  }

  async getStatistics(context: ServiceContext, filters?: TimeSheetFilterData): Promise<any> {
    const { knex } = await this.getKnex();
    const current = await this.currentSheets(knex, context);
    if (current.handled) return timeSheetStatistics(filterTimeSheets(current.sheets.map(timeSheetDto), filters));
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


  private async getTimeSheetEntries(timeSheetId: string, context: ServiceContext): Promise<any[]> {
      const { knex } = await this.getKnex();
      
      return tenantDb(knex, context.tenant).table('time_entries')
        .where({ time_sheet_id: timeSheetId })
        .orderBy('start_time');
    }


  private async getTimeSheetSummary(timeSheetId: string, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      const stats = await tenantDb(knex, context.tenant).table('time_entries')
        .where({ time_sheet_id: timeSheetId })
        .select([
          knex.raw('SUM(billable_duration) / 60.0 as total_hours'),
          knex.raw('SUM(CASE WHEN billable_duration > 0 THEN billable_duration ELSE 0 END) / 60.0 as billable_hours'),
          knex.raw('COUNT(*) as entry_count')
        ])
        .first() as any;
  
      const totalHours = parseFloat(stats?.total_hours || '0');
      const billableHours = parseFloat(stats?.billable_hours || '0');
  
      return {
        total_hours: totalHours,
        billable_hours: billableHours,
        non_billable_hours: totalHours - billableHours,
        entries_by_type: {}, // Would calculate from entries
        entries_by_day: {}, // Would calculate from entries
        approval_ready: parseInt(stats?.entry_count || '0') > 0
      };
    }



  async getScheduleEntry(id: string, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      const entry = await tenantDb(knex, context.tenant).table('schedule_entries')
        .where({ entry_id: id })
        .first();
  
      if (!entry) return null;
  
      const assignedUsers = await this.getScheduleAssignees(id, context);
      const workItem = entry.work_item_id ? await this.getWorkItemForSchedule(entry.work_item_id, entry.work_item_type, context) : null;
  
      return {
        ...entry,
        assigned_users: assignedUsers,
        work_item: workItem
      };
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

  private getWeekNumber(date: Date): number {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }

  private calculatePeriodEnd(startDate: Date, frequency: string, interval: number = 1): Date {
    const endDate = new Date(startDate);
    
    switch (frequency) {
      case 'daily':
        endDate.setDate(endDate.getDate() + interval - 1);
        break;
      case 'weekly':
        endDate.setDate(endDate.getDate() + (interval * 7) - 1);
        break;
      case 'monthly':
        endDate.setMonth(endDate.getMonth() + interval);
        endDate.setDate(endDate.getDate() - 1);
        break;
      case 'quarterly':
        endDate.setMonth(endDate.getMonth() + (interval * 3));
        endDate.setDate(endDate.getDate() - 1);
        break;
      case 'yearly':
        endDate.setFullYear(endDate.getFullYear() + interval);
        endDate.setDate(endDate.getDate() - 1);
        break;
    }
    
    return endDate;
  }
}
