/**
 * Time Sheet API Service
 * Handles all time sheet-related database operations for the REST API
 */

import { Knex } from 'knex';
import { withTransaction } from '@alga-psa/db';
import { BaseService, ServiceContext, ListOptions, ListResult } from '@alga-psa/db';
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

  async list(options: ListOptions, context: ServiceContext, filters?: TimeSheetFilterData): Promise<ListResult<any>> {
      const { knex } = await this.getKnex();
      
      let query = knex(this.tableName)
        .where(`${this.tableName}.tenant`, context.tenant);
  
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
          query.join('time_periods', `${this.tableName}.period_id`, 'time_periods.period_id')
            .where('time_periods.start_date', '>=', filters.period_start_from);
        }
        if (filters.period_start_to) {
          if (!query.toString().includes('time_periods')) {
            query.join('time_periods', `${this.tableName}.period_id`, 'time_periods.period_id');
          }
          query.where('time_periods.start_date', '<=', filters.period_start_to);
        }
        if (filters.period_end_from) {
          if (!query.toString().includes('time_periods')) {
            query.join('time_periods', `${this.tableName}.period_id`, 'time_periods.period_id');
          }
          query.where('time_periods.end_date', '>=', filters.period_end_from);
        }
        if (filters.period_end_to) {
          if (!query.toString().includes('time_periods')) {
            query.join('time_periods', `${this.tableName}.period_id`, 'time_periods.period_id');
          }
          query.where('time_periods.end_date', '<=', filters.period_end_to);
        }
        if (filters.has_entries !== undefined) {
          const subquery = knex('time_entries')
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
      query.leftJoin('users', `${this.tableName}.user_id`, 'users.user_id')
        .leftJoin('users as approvers', `${this.tableName}.approved_by`, 'approvers.user_id')
        .leftJoin('time_periods', `${this.tableName}.period_id`, 'time_periods.period_id')
        .select(
          `${this.tableName}.*`,
          knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as user_name`),
          knex.raw(`CONCAT(approvers.first_name, ' ', approvers.last_name) as approver_name`),
          'time_periods.start_date as period_start',
          'time_periods.end_date as period_end'
        );
  
      // Add computed fields
      const timeEntrySubquery = knex('time_entries')
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
      
      const timeSheet = await knex(this.tableName)
        .leftJoin('users', `${this.tableName}.user_id`, 'users.user_id')
        .leftJoin('users as approvers', `${this.tableName}.approved_by`, 'approvers.user_id')
        .leftJoin('time_periods', `${this.tableName}.period_id`, 'time_periods.period_id')
        .where({
          [`${this.tableName}.${this.primaryKey}`]: id,
          [`${this.tableName}.tenant`]: context.tenant
        })
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
      
      return withTransaction(knex, async (trx) => {
        const timeSheetData = {
          ...data,
          user_id: data.user_id || context.userId,
          approval_status: 'DRAFT',
          tenant: context.tenant,
          created_at: new Date(),
          updated_at: new Date()
        };
  
        const [timeSheet] = await trx(this.tableName)
          .insert(timeSheetData)
          .returning('*');
  
        // Publish event
        await publishEvent({
          eventType: 'TIME_SHEET_CREATED',
          payload: {
            tenantId: context.tenant,
            timeSheetId: timeSheet.id,
            userId: context.userId,
            periodId: timeSheet.period_id,
            timestamp: new Date().toISOString()
          }
        });
  
        return this.getWithDetails(timeSheet.id, context);
      });
    }


  async update(id: string, data: UpdateTimeSheetData, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        const existing = await this.getById(id, context);
        if (!existing) {
          throw new Error('Time sheet not found');
        }
  
        // Check permissions
        if (existing.user_id !== context.userId && !await this.canManageTimeSheets(context)) {
          throw new Error('Permission denied: Cannot update this time sheet');
        }
  
        // Check if approved (prevent modification)
        if (existing.approval_status === 'APPROVED' && !await this.canManageTimeSheets(context)) {
          throw new Error('Cannot modify approved time sheets');
        }
  
        const updateData = {
          ...data,
          updated_at: new Date()
        };
  
        await trx(this.tableName)
          .where({ [this.primaryKey]: id, tenant: context.tenant })
          .update(updateData);
  
        // Publish event
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
  
        return this.getById(id, context);
      });
    }


  async delete(id: string, context: ServiceContext): Promise<void> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        const existing = await this.getById(id, context);
        if (!existing) {
          throw new Error('Time sheet not found');
        }
  
        // Check permissions
        if (existing.user_id !== context.userId && !await this.canManageTimeSheets(context)) {
          throw new Error('Permission denied: Cannot delete this time sheet');
        }
  
        // Check if approved
        if (existing.approval_status === 'APPROVED') {
          throw new Error('Cannot delete approved time sheets');
        }
  
        await trx(this.tableName)
          .where({ [this.primaryKey]: id, tenant: context.tenant })
          .del();
  
        // Publish event
        await publishEvent({
          eventType: 'TIME_SHEET_DELETED',
          payload: {
            tenantId: context.tenant,
            timeSheetId: id,
            userId: context.userId,
            timestamp: new Date().toISOString()
          }
        });
      });
    }


  // Time sheet workflow operations
  async submitTimeSheet(id: string, data: SubmitTimeSheetData, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        const timeSheet = await this.getById(id, context);
        if (!timeSheet) {
          throw new Error('Time sheet not found');
        }
  
        // Check permissions
        if (timeSheet.user_id !== context.userId) {
          throw new Error('Permission denied: Can only submit your own time sheets');
        }
  
        // Check current status
        if (timeSheet.approval_status !== 'DRAFT' && timeSheet.approval_status !== 'CHANGES_REQUESTED') {
          throw new Error('Time sheet can only be submitted from DRAFT or CHANGES_REQUESTED status');
        }
  
        // Validate time sheet has entries
        const hasEntries = await this.hasTimeEntries(id, context);
        if (!hasEntries) {
          throw new Error('Cannot submit time sheet without time entries');
        }
  
        await trx(this.tableName)
          .where({ id, tenant: context.tenant })
          .update({
            approval_status: 'SUBMITTED',
            submitted_at: new Date(),
            submission_notes: data.submission_notes,
            updated_at: new Date()
          });
  
        // Publish event
        await publishEvent({
          eventType: 'TIME_SHEET_SUBMITTED',
          payload: {
            tenantId: context.tenant,
            timeSheetId: id,
            userId: context.userId,
            timestamp: new Date().toISOString()
          }
        });
  
        return this.getById(id, context);
      });
    }


  async approveTimeSheet(id: string, data: ApproveTimeSheetData, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        const timeSheet = await this.getById(id, context);
        if (!timeSheet) {
          throw new Error('Time sheet not found');
        }
  
        // Check permissions
        if (!await this.canApproveTimeSheets(context)) {
          throw new Error('Permission denied: Cannot approve time sheets');
        }
  
        // Check current status
        if (timeSheet.approval_status !== 'SUBMITTED') {
          throw new Error('Time sheet must be submitted before approval');
        }
  
        await trx(this.tableName)
          .where({ id, tenant: context.tenant })
          .update({
            approval_status: 'APPROVED',
            approved_at: new Date(),
            approved_by: context.userId,
            approval_notes: data.approval_notes,
            updated_at: new Date()
          });
  
        // Update all time entries to approved status
        await trx('time_entries')
          .where({ time_sheet_id: id, tenant: context.tenant })
          .update({
            approval_status: 'APPROVED',
            approved_at: new Date(),
            approved_by: context.userId,
            updated_at: new Date()
          });
  
        // Publish event
        await publishEvent({
          eventType: 'TIME_SHEET_APPROVED',
          payload: {
            tenantId: context.tenant,
            timeSheetId: id,
            approvedBy: context.userId,
            timestamp: new Date().toISOString()
          }
        });
  
        return this.getById(id, context);
      });
    }


  async requestChanges(id: string, data: RequestChangesTimeSheetData, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        const timeSheet = await this.getById(id, context);
        if (!timeSheet) {
          throw new Error('Time sheet not found');
        }
  
        // Check permissions
        if (!await this.canApproveTimeSheets(context)) {
          throw new Error('Permission denied: Cannot request changes to time sheets');
        }
  
        // Check current status
        if (timeSheet.approval_status !== 'SUBMITTED') {
          throw new Error('Time sheet must be submitted before requesting changes');
        }
  
        await trx(this.tableName)
          .where({ id, tenant: context.tenant })
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
  
        // Publish event
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
  
        return this.getById(id, context);
      });
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
      
      return withTransaction(knex, async (trx) => {
        const timeSheet = await this.getById(id, context);
        if (!timeSheet) {
          throw new Error('Time sheet not found');
        }
  
        // Check permissions
        if (!await this.canManageTimeSheets(context)) {
          throw new Error('Permission denied: Cannot reverse time sheet approval');
        }
  
        // Check current status
        if (timeSheet.approval_status !== 'APPROVED') {
          throw new Error('Time sheet is not approved');
        }
  
        // Check if time sheet has been invoiced (would prevent reversal)
        const isInvoiced = await this.isTimeSheetInvoiced(id, context);
        if (isInvoiced) {
          throw new Error('Cannot reverse approval of time sheet that has been invoiced');
        }
  
        await trx(this.tableName)
          .where({ id, tenant: context.tenant })
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
        await trx('time_entries')
          .where({ time_sheet_id: id, tenant: context.tenant })
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
  
        // Publish event
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
  
        return this.getById(id, context);
      });
    }


  // Time sheet comments
  async addComment(id: string, data: CreateTimeSheetCommentData, context: ServiceContext): Promise<any> {
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
  
        const [comment] = await trx('time_sheet_comments')
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
      
      const comments = await knex('time_sheet_comments')
        .leftJoin('users', 'time_sheet_comments.user_id', 'users.user_id')
        .where({
          'time_sheet_comments.time_sheet_id': timeSheetId,
          'time_sheet_comments.tenant': context.tenant
        })
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
      
      return knex('time_periods')
        .where({ tenant: context.tenant })
        .orderBy('start_date', 'desc');
    }


  async getTimePeriod(id: string, context: ServiceContext): Promise<any | null> {
      const { knex } = await this.getKnex();
      
      const period = await knex('time_periods')
        .where({ period_id: id, tenant: context.tenant })
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
      
      return withTransaction(knex, async (trx) => {
        const periodData = {
          ...data,
          tenant: context.tenant,
          created_at: new Date(),
          updated_at: new Date()
        };
  
        const [period] = await trx('time_periods')
          .insert(periodData)
          .returning('*');
  
        return this.getTimePeriod(period.period_id, context);
      });
    }


  async updateTimePeriod(id: string, data: UpdateTimePeriodData, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        const updateData = {
          ...data,
          updated_at: new Date()
        };
  
        await trx('time_periods')
          .where({ period_id: id, tenant: context.tenant })
          .update(updateData);
  
        return this.getTimePeriod(id, context);
      });
    }


  async deleteTimePeriod(id: string, context: ServiceContext): Promise<void> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        // Check if period has time sheets
        const hasTimeSheets = await trx('time_sheets')
          .where({ period_id: id, tenant: context.tenant })
          .first();
  
        if (hasTimeSheets) {
          throw new Error('Cannot delete time period that has associated time sheets');
        }
  
        await trx('time_periods')
          .where({ period_id: id, tenant: context.tenant })
          .del();
      });
    }


  async generateTimePeriods(data: GenerateTimePeriodsData, context: ServiceContext): Promise<any[]> {
      const { knex } = await this.getKnex();
      
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
      
      return knex('time_period_settings')
        .where({ tenant: context.tenant })
        .orderBy('effective_from', 'desc');
    }


  async createTimePeriodSettings(data: CreateTimePeriodSettingsData, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        // Deactivate previous settings if new one is active
        if (data.is_active) {
          await trx('time_period_settings')
            .where({ tenant: context.tenant, is_active: true })
            .update({ is_active: false, updated_at: new Date() });
        }
  
        const settingsData = {
          ...data,
          tenant: context.tenant,
          created_at: new Date(),
          updated_at: new Date()
        };
  
        const [settings] = await trx('time_period_settings')
          .insert(settingsData)
          .returning('*');
  
        return settings;
      });
    }


  async updateTimePeriodSettings(id: string, data: UpdateTimePeriodSettingsData, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        // Deactivate other settings if this one is being activated
        if (data.is_active) {
          await trx('time_period_settings')
            .where({ tenant: context.tenant, is_active: true })
            .whereNot('settings_id', id)
            .update({ is_active: false, updated_at: new Date() });
        }
  
        const updateData = {
          ...data,
          updated_at: new Date()
        };
  
        await trx('time_period_settings')
          .where({ settings_id: id, tenant: context.tenant })
          .update(updateData);
  
        return trx('time_period_settings')
          .where({ settings_id: id, tenant: context.tenant })
          .first();
      });
    }



  // Schedule entries
  async getScheduleEntries(context: ServiceContext, filters?: any): Promise<any[]> {
      const { knex } = await this.getKnex();
      
      let query = knex('schedule_entries')
        .where('schedule_entries.tenant', context.tenant);
  
      // Apply date filters if provided
      if (filters?.start_date) {
        query = query.where('scheduled_start', '>=', filters.start_date);
      }
      if (filters?.end_date) {
        query = query.where('scheduled_end', '<=', filters.end_date);
      }
      if (filters?.user_id) {
        query = query.join('schedule_entry_assignees', 'schedule_entries.entry_id', 'schedule_entry_assignees.entry_id')
          .where('schedule_entry_assignees.user_id', filters.user_id);
      }
  
      // Check permissions for private entries
      if (!await this.canViewAllSchedules(context)) {
        query = query.where(function() {
          this.where('is_private', false)
            .orWhere('created_by', context.userId);
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
  
        return {
          ...entry,
          assigned_users: assignedUsers,
          work_item: workItem,
          duration_hours: Math.round(durationHours * 100) / 100,
          is_current: startTime <= new Date() && endTime >= new Date()
        };
      }));
    }


  async createScheduleEntry(data: CreateScheduleEntryData, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      const ScheduleEntry = (await import('@alga-psa/scheduling/models/scheduleEntry')).default;

      return withTransaction(knex, async (trx) => {
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

        return this.getScheduleEntry(entry.entry_id, context);
      });
    }


  async updateScheduleEntry(id: string, data: UpdateScheduleEntryData, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        const existing = await knex('schedule_entries')
          .where({ entry_id: id, tenant: context.tenant })
          .first();
  
        if (!existing) {
          throw new Error('Schedule entry not found');
        }
  
        // Check permissions
        if (existing.created_by !== context.userId && !await this.canManageSchedules(context)) {
          throw new Error('Permission denied: Cannot update this schedule entry');
        }
  
        const updateData = {
          ...data,
          updated_at: new Date()
        };
  
        await trx('schedule_entries')
          .where({ entry_id: id, tenant: context.tenant })
          .update(updateData);
  
        // Update assignees if provided
        if (data.assigned_user_ids !== undefined) {
          await trx('schedule_entry_assignees')
            .where({ entry_id: id, tenant: context.tenant })
            .del();
  
          if (data.assigned_user_ids.length > 0) {
            const assigneeData = data.assigned_user_ids.map((userId: string) => ({
              entry_id: id,
              user_id: userId,
              tenant: context.tenant
            }));
  
            await trx('schedule_entry_assignees').insert(assigneeData);
          }
        }
  
        return this.getScheduleEntry(id, context);
      });
    }


  async deleteScheduleEntry(id: string, context: ServiceContext): Promise<void> {
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        const existing = await knex('schedule_entries')
          .where({ entry_id: id, tenant: context.tenant })
          .first();
  
        if (!existing) {
          throw new Error('Schedule entry not found');
        }
  
        // Check permissions
        if (existing.created_by !== context.userId && !await this.canManageSchedules(context)) {
          throw new Error('Permission denied: Cannot delete this schedule entry');
        }
  
        await trx('schedule_entries')
          .where({ entry_id: id, tenant: context.tenant })
          .del();
      });
    }


  // Search and statistics
  async search(searchData: TimeSheetSearchData, context: ServiceContext): Promise<any[]> {
      const { knex } = await this.getKnex();
      const tableName = this.tableName; // Capture tableName to use in callbacks
      
      const query = knex(tableName)
        .where(`${tableName}.tenant`, context.tenant);
  
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
        query.join('time_periods', `${tableName}.period_id`, 'time_periods.period_id')
          .where('time_periods.start_date', '>=', searchData.date_from);
      }
      if (searchData.date_to) {
        if (!query.toString().includes('time_periods')) {
          query.join('time_periods', `${tableName}.period_id`, 'time_periods.period_id');
        }
        query.where('time_periods.end_date', '<=', searchData.date_to);
      }
  
      // Add joins
      query.leftJoin('users', `${tableName}.user_id`, 'users.user_id')
        .select(
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
      
      const entry = await knex('time_entries')
        .where({ time_sheet_id: timeSheetId, tenant: context.tenant })
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
    // Check RBAC permissions
    return false; // Simplified for now
  }

  private async canManageSchedules(context: ServiceContext): Promise<boolean> {
    // Check RBAC permissions
    return false; // Simplified for now
  }

  private async getUserRole(userId: string, context: ServiceContext): Promise<string> {
      const { knex } = await this.getKnex();
      
      const user = await knex('users')
        .where({ user_id: userId })
        .first();
      return user?.role || 'user';
    }


  private async getTimeSheetUser(userId: string, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      return knex('users')
        .where({ user_id: userId })
        .select('user_id', 'first_name', 'last_name', 'email')
        .first();
    }


  private async getTimeSheetEntries(timeSheetId: string, context: ServiceContext): Promise<any[]> {
      const { knex } = await this.getKnex();
      
      return knex('time_entries')
        .where({ time_sheet_id: timeSheetId, tenant: context.tenant })
        .orderBy('start_time');
    }


  private async getTimeSheetSummary(timeSheetId: string, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      const stats = await knex('time_entries')
        .where({ time_sheet_id: timeSheetId, tenant: context.tenant })
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



  private async getScheduleEntry(id: string, context: ServiceContext): Promise<any> {
      const { knex } = await this.getKnex();
      
      const entry = await knex('schedule_entries')
        .where({ entry_id: id, tenant: context.tenant })
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
      
      return knex('schedule_entry_assignees')
        .join('users', 'schedule_entry_assignees.user_id', 'users.user_id')
        .where({ 'schedule_entry_assignees.entry_id': entryId, 'schedule_entry_assignees.tenant': context.tenant })
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
