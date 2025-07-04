/**
 * Time Entry API Service
 * Handles all time entry-related database operations for the REST API
 */

import { Knex } from 'knex';
import { BaseService, ServiceContext, ListOptions, ListResult } from './BaseService';
import { 
  CreateTimeEntryData,
  UpdateTimeEntryData,
  TimeEntryFilterData,
  BulkTimeEntryData,
  BulkUpdateTimeEntryData,
  BulkDeleteTimeEntryData,
  CreateTimeTemplateData,
  TimeEntrySearchData,
  TimeEntryExportQuery,
  StartTimeTrackingData,
  StopTimeTrackingData,
  ApproveTimeEntriesData,
  RequestTimeEntryChangesData
} from '../schemas/timeEntry';
import { publishEvent } from 'server/src/lib/eventBus/publishers';

export class TimeEntryService extends BaseService<any> {
  constructor() {
    super({
      tableName: 'time_entries',
      primaryKey: 'entry_id',
      tenantColumn: 'tenant',
      searchableFields: ['notes'],
      defaultSort: 'start_time',
      defaultOrder: 'desc'
    });
  }

  async list(options: ListOptions, context: ServiceContext, filters?: TimeEntryFilterData): Promise<ListResult<any>> {
    const { knex } = await this.getKnex();
    const query = knex(this.tableName)
      .where(`${this.tableName}.tenant`, context.tenant);

    // Apply filters
    if (filters) {
      if (filters.user_id) {
        query.where(`${this.tableName}.user_id`, filters.user_id);
      }
      if (filters.work_item_id) {
        query.where(`${this.tableName}.work_item_id`, filters.work_item_id);
      }
      if (filters.work_item_type) {
        query.where(`${this.tableName}.work_item_type`, filters.work_item_type);
      }
      if (filters.service_id) {
        query.where(`${this.tableName}.service_id`, filters.service_id);
      }
      if (filters.approval_status) {
        query.where(`${this.tableName}.approval_status`, filters.approval_status);
      }
      if (filters.is_billable !== undefined) {
        query.where(`${this.tableName}.billable_duration`, filters.is_billable ? '>' : '=', 0);
      }
      if (filters.start_time_from) {
        query.where(`${this.tableName}.start_time`, '>=', filters.start_time_from);
      }
      if (filters.start_time_to) {
        query.where(`${this.tableName}.start_time`, '<=', filters.start_time_to);
      }
      if (filters.end_time_from) {
        query.where(`${this.tableName}.end_time`, '>=', filters.end_time_from);
      }
      if (filters.end_time_to) {
        query.where(`${this.tableName}.end_time`, '<=', filters.end_time_to);
      }
      if (filters.date_from) {
        query.where(knex.raw('DATE(start_time)'), '>=', filters.date_from);
      }
      if (filters.date_to) {
        query.where(knex.raw('DATE(start_time)'), '<=', filters.date_to);
      }
      if (filters.time_sheet_id) {
        query.where(`${this.tableName}.time_sheet_id`, filters.time_sheet_id);
      }
      if (filters.billing_plan_id) {
        query.where(`${this.tableName}.billing_plan_id`, filters.billing_plan_id);
      }
      if (filters.company_id) {
        query.leftJoin('tickets', function() {
          this.on(`time_entries.work_item_id`, 'tickets.ticket_id')
            .andOn(`time_entries.work_item_type`, knex.raw('?', ['ticket']));
        })
        .leftJoin('project_tasks', function() {
          this.on(`time_entries.work_item_id`, 'project_tasks.task_id')
            .andOn(`time_entries.work_item_type`, knex.raw('?', ['project_task']));
        })
        .leftJoin('project_phases', 'project_tasks.phase_id', 'project_phases.phase_id')
        .leftJoin('projects', 'project_phases.project_id', 'projects.project_id')
        .where(function() {
          this.where('tickets.company_id', filters.company_id!)
            .orWhere('projects.company_id', filters.company_id!);
        });
      }
      if (filters.duration_min !== undefined) {
        query.where(`${this.tableName}.billable_duration`, '>=', filters.duration_min);
      }
      if (filters.duration_max !== undefined) {
        query.where(`${this.tableName}.billable_duration`, '<=', filters.duration_max);
      }
    }

    // Add joins for additional data
    query.leftJoin('users', `${this.tableName}.user_id`, 'users.user_id')
      .leftJoin('services', `${this.tableName}.service_id`, 'services.service_id')
      .leftJoin('time_sheets', `${this.tableName}.time_sheet_id`, 'time_sheets.id')
      .select(
        `${this.tableName}.*`,
        knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as user_name`),
        'services.service_name',
        knex.raw(`ROUND(${this.tableName}.billable_duration / 60.0, 2) as duration_hours`),
        knex.raw(`CASE WHEN ${this.tableName}.billable_duration > 0 THEN true ELSE false END as is_billable`)
      );

    // Apply pagination and sorting
    const { page = 1, limit = 25, sort, order } = options;
    const offset = (page - 1) * limit;
    
    const sortField = sort || this.defaultSort;
    const sortOrder = order || this.defaultOrder;
    
    query.orderBy(`${this.tableName}.${sortField}`, sortOrder);
    query.limit(limit).offset(offset);

    // Get total count
    const countQuery = knex(this.tableName)
      .where(`${this.tableName}.tenant`, context.tenant);
    
    const [data, [{ count }]] = await Promise.all([
      query,
      countQuery.count('* as count')
    ]);

    return {
      data,
      total: parseInt(count as string)
    };
  }

  async getById(id: string, context: ServiceContext): Promise<any | null> {
    const { knex } = await this.getKnex();
    const timeEntry = await knex(this.tableName)
      .leftJoin('users', `${this.tableName}.user_id`, 'users.user_id')
      .leftJoin('services', `${this.tableName}.service_id`, 'services.service_id')
      .leftJoin('time_sheets', `${this.tableName}.time_sheet_id`, 'time_sheets.id')
      .where({
        [`${this.tableName}.${this.primaryKey}`]: id,
        [`${this.tableName}.tenant`]: context.tenant
      })
      .select(
        `${this.tableName}.*`,
        knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as user_name`),
        'services.service_name',
        knex.raw(`ROUND(${this.tableName}.billable_duration / 60.0, 2) as duration_hours`),
        knex.raw(`CASE WHEN ${this.tableName}.billable_duration > 0 THEN true ELSE false END as is_billable`)
      )
      .first();

    return timeEntry || null;
  }

  async getWithDetails(id: string, context: ServiceContext): Promise<any | null> {
    const timeEntry = await this.getById(id, context);
    if (!timeEntry) return null;

    const [user, workItem, service, timeSheet, billingInfo] = await Promise.all([
      this.getTimeEntryUser(timeEntry.user_id, context),
      this.getWorkItemDetails(timeEntry.work_item_id, timeEntry.work_item_type, context),
      timeEntry.service_id ? this.getServiceDetails(timeEntry.service_id, context) : null,
      timeEntry.time_sheet_id ? this.getTimeSheetDetails(timeEntry.time_sheet_id, context) : null,
      this.getBillingInfo(timeEntry, context)
    ]);

    return {
      ...timeEntry,
      user,
      work_item: workItem,
      service,
      time_sheet: timeSheet,
      billing_info: billingInfo
    };
  }

  async create(data: CreateTimeEntryData, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();
    
    // Calculate billable duration
    const startTime = new Date(data.start_time);
    const endTime = new Date(data.end_time);
    const durationMs = endTime.getTime() - startTime.getTime();
    const billableDuration = Math.round(durationMs / (1000 * 60)); // minutes

    // Get or create time sheet for the period
    const timeSheetId = await this.getOrCreateTimeSheet(data.start_time, context.userId, context);

    const timeEntryData = {
      ...data,
      user_id: context.userId,
      billable_duration: data.is_billable !== false ? billableDuration : 0,
      time_sheet_id: timeSheetId,
      approval_status: 'DRAFT',
      tenant: context.tenant,
      created_at: new Date(),
      updated_at: new Date()
    };

    // Get billing information if billable
    if (data.is_billable !== false) {
      const billingInfo = await this.calculateBillingInfo(timeEntryData, context);
      Object.assign(timeEntryData, billingInfo);
    }

    const [timeEntry] = await knex(this.tableName)
      .insert(timeEntryData)
      .returning('*');

    // Publish event
    await publishEvent({
      eventType: 'TIME_ENTRY_CREATED',
      payload: {
        tenantId: context.tenant,
        timeEntryId: timeEntry.entry_id,
        userId: context.userId,
        workItemId: timeEntry.work_item_id,
        workItemType: timeEntry.work_item_type,
        duration: billableDuration,
        timestamp: new Date().toISOString()
      }
    });

    return this.getWithDetails(timeEntry.entry_id, context);
  }

  async update(id: string, data: UpdateTimeEntryData, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();
    const existing = await this.getById(id, context);
    if (!existing) {
      throw new Error('Time entry not found');
    }

    // Check if user can update this entry
    if (existing.user_id !== context.userId && !await this.canManageTimeEntries(context)) {
      throw new Error('Permission denied: Cannot update this time entry');
    }

    // Check if entry is approved (prevent modification)
    if (existing.approval_status === 'APPROVED') {
      throw new Error('Cannot modify approved time entries');
    }

    const updateData: any = {
      ...data,
      updated_at: new Date()
    };

    // Recalculate duration if times changed
    if (data.start_time || data.end_time) {
      const startTime = new Date(data.start_time || existing.start_time);
      const endTime = new Date(data.end_time || existing.end_time);
      const durationMs = endTime.getTime() - startTime.getTime();
      updateData.billable_duration = Math.round(durationMs / (1000 * 60));
    }

    // Recalculate billing if relevant fields changed
    if (data.service_id !== undefined || updateData.billable_duration !== undefined) {
      const billingInfo = await this.calculateBillingInfo({ ...existing, ...updateData }, context);
      Object.assign(updateData, billingInfo);
    }

    await knex(this.tableName)
      .where({ [this.primaryKey]: id, tenant: context.tenant })
      .update(updateData);

    // Publish event
    await publishEvent({
      eventType: 'TIME_ENTRY_UPDATED',
      payload: {
        tenantId: context.tenant,
        timeEntryId: id,
        userId: context.userId,
        changes: data,
        timestamp: new Date().toISOString()
      }
    });

    return this.getById(id, context);
  }

  async delete(id: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();
    const existing = await this.getById(id, context);
    if (!existing) {
      throw new Error('Time entry not found');
    }

    // Check permissions
    if (existing.user_id !== context.userId && !await this.canManageTimeEntries(context)) {
      throw new Error('Permission denied: Cannot delete this time entry');
    }

    // Check if entry is approved
    if (existing.approval_status === 'APPROVED') {
      throw new Error('Cannot delete approved time entries');
    }

    await knex(this.tableName)
      .where({ [this.primaryKey]: id, tenant: context.tenant })
      .del();

    // Publish event
    await publishEvent({
      eventType: 'TIME_ENTRY_DELETED',
      payload: {
        tenantId: context.tenant,
        timeEntryId: id,
        userId: context.userId,
        timestamp: new Date().toISOString()
      }
    });
  }

  // Override bulk methods to match BaseService signature
  async bulkCreateTimeEntries(data: BulkTimeEntryData, context: ServiceContext): Promise<any[]> {
    const results = [];
    
    for (const entryData of data.entries) {
      try {
        const result = await this.create(entryData, context);
        results.push({ success: true, data: result });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({ success: false, error: errorMessage, data: entryData });
      }
    }

    return results;
  }

  async bulkUpdateTimeEntries(data: BulkUpdateTimeEntryData, context: ServiceContext): Promise<any[]> {
    const results = [];
    
    for (const { entry_id, data: updateData } of data.entries) {
      try {
        const result = await this.update(entry_id, updateData, context);
        results.push({ success: true, data: result });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({ success: false, error: errorMessage, entry_id });
      }
    }

    return results;
  }

  async bulkDeleteTimeEntries(data: BulkDeleteTimeEntryData, context: ServiceContext): Promise<any[]> {
    const results = [];
    
    for (const entryId of data.entry_ids) {
      try {
        await this.delete(entryId, context);
        results.push({ success: true, entry_id: entryId });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({ success: false, error: errorMessage, entry_id: entryId });
      }
    }

    return results;
  }

  // Time tracking sessions
  async startTimeTracking(data: StartTimeTrackingData, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();
    
    // Check for existing active session
    const existingSession = await knex('active_time_sessions')
      .where({ user_id: context.userId, tenant: context.tenant })
      .first();

    if (existingSession) {
      throw new Error('Active time tracking session already exists. Please stop the current session first.');
    }

    const sessionData = {
      ...data,
      user_id: context.userId,
      start_time: new Date(),
      tenant: context.tenant,
      created_at: new Date()
    };

    const [session] = await knex('active_time_sessions')
      .insert(sessionData)
      .returning('*');

    return {
      ...session,
      elapsed_minutes: 0,
      work_item_title: data.work_item_id ? await this.getWorkItemTitle(data.work_item_id, data.work_item_type, context) : null,
      service_name: data.service_id ? await this.getServiceName(data.service_id, context) : null
    };
  }

  async stopTimeTracking(sessionId: string, data: StopTimeTrackingData, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();
    const session = await knex('active_time_sessions')
      .where({ session_id: sessionId, user_id: context.userId, tenant: context.tenant })
      .first();

    if (!session) {
      throw new Error('Active session not found');
    }

    const endTime = data.end_time ? new Date(data.end_time) : new Date();
    
    // Create time entry
    const timeEntryData: CreateTimeEntryData = {
      work_item_id: session.work_item_id,
      work_item_type: session.work_item_type,
      start_time: session.start_time,
      end_time: endTime.toISOString(),
      notes: data.notes || session.notes,
      service_id: data.service_id || session.service_id,
      is_billable: true // Add required property
    };

    const timeEntry = await this.create(timeEntryData, context);

    // Delete active session
    await knex('active_time_sessions')
      .where({ session_id: sessionId, tenant: context.tenant })
      .del();

    return timeEntry;
  }

  async getActiveSession(context: ServiceContext): Promise<any | null> {
    const { knex } = await this.getKnex();
    const session = await knex('active_time_sessions')
      .where({ user_id: context.userId, tenant: context.tenant })
      .first();

    if (!session) return null;

    const now = new Date();
    const elapsedMs = now.getTime() - new Date(session.start_time).getTime();
    const elapsedMinutes = Math.round(elapsedMs / (1000 * 60));

    return {
      ...session,
      elapsed_minutes: elapsedMinutes,
      work_item_title: session.work_item_id ? await this.getWorkItemTitle(session.work_item_id, session.work_item_type, context) : null,
      service_name: session.service_id ? await this.getServiceName(session.service_id, context) : null
    };
  }

  // Templates
  async createTemplate(data: CreateTimeTemplateData, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();
    const templateData = {
      ...data,
      user_id: context.userId,
      tenant: context.tenant,
      created_at: new Date(),
      updated_at: new Date()
    };

    const [template] = await knex('time_entry_templates')
      .insert(templateData)
      .returning('*');

    return template;
  }

  async getTemplates(context: ServiceContext): Promise<any[]> {
    const { knex } = await this.getKnex();
    return knex('time_entry_templates')
      .where({ user_id: context.userId, tenant: context.tenant, is_active: true })
      .orderBy('template_name');
  }

  // Approval operations
  async approveTimeEntries(data: ApproveTimeEntriesData, context: ServiceContext): Promise<any[]> {
    const { knex } = await this.getKnex();
    const results = [];
    
    for (const entryId of data.entry_ids) {
      try {
        await knex(this.tableName)
          .where({ 
            entry_id: entryId, 
            tenant: context.tenant,
            approval_status: ['SUBMITTED', 'CHANGES_REQUESTED']
          })
          .update({
            approval_status: 'APPROVED',
            approved_at: new Date(),
            approved_by: context.userId,
            approval_notes: data.approval_notes,
            updated_at: new Date()
          });

        results.push({ success: true, entry_id: entryId });

        // Publish event
        await publishEvent({
          eventType: 'TIME_ENTRY_APPROVED',
          payload: {
            tenantId: context.tenant,
            timeEntryId: entryId,
            approvedBy: context.userId,
            timestamp: new Date().toISOString()
          }
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({ success: false, error: errorMessage, entry_id: entryId });
      }
    }

    return results;
  }

  async requestChanges(data: RequestTimeEntryChangesData, context: ServiceContext): Promise<any[]> {
    const { knex } = await this.getKnex();
    const results = [];
    
    for (const entryId of data.entry_ids) {
      try {
        await knex(this.tableName)
          .where({ 
            entry_id: entryId, 
            tenant: context.tenant,
            approval_status: 'SUBMITTED'
          })
          .update({
            approval_status: 'CHANGES_REQUESTED',
            change_reason: data.change_reason,
            detailed_feedback: data.detailed_feedback,
            updated_at: new Date()
          });

        results.push({ success: true, entry_id: entryId });

        // Publish event
        await publishEvent({
          eventType: 'TIME_ENTRY_CHANGES_REQUESTED',
          payload: {
            tenantId: context.tenant,
            timeEntryId: entryId,
            requestedBy: context.userId,
            reason: data.change_reason,
            timestamp: new Date().toISOString()
          }
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({ success: false, error: errorMessage, entry_id: entryId });
      }
    }

    return results;
  }

  // Search and export
  async search(searchData: TimeEntrySearchData, context: ServiceContext): Promise<any[]> {
    const { knex } = await this.getKnex();
    const query = knex(this.tableName)
      .where(`${this.tableName}.tenant`, context.tenant);

    // Build search query
    if (searchData.fields && searchData.fields.length > 0) {
      query.where(function() {
        searchData.fields!.forEach(field => {
          if (field === 'user_name') {
            this.orWhere(knex.raw(`CONCAT(users.first_name, ' ', users.last_name)`), 'ilike', `%${searchData.query}%`);
          } else if (field === 'service_name') {
            this.orWhere('services.service_name', 'ilike', `%${searchData.query}%`);
          } else {
            this.orWhere(`time_entries.${field}`, 'ilike', `%${searchData.query}%`);
          }
        });
      });
    } else {
      // Default search in notes
      query.where(`${this.tableName}.notes`, 'ilike', `%${searchData.query}%`);
    }

    // Apply filters
    if (searchData.work_item_types && searchData.work_item_types.length > 0) {
      query.whereIn(`${this.tableName}.work_item_type`, searchData.work_item_types);
    }
    if (searchData.approval_statuses && searchData.approval_statuses.length > 0) {
      query.whereIn(`${this.tableName}.approval_status`, searchData.approval_statuses);
    }
    if (searchData.user_ids && searchData.user_ids.length > 0) {
      query.whereIn(`${this.tableName}.user_id`, searchData.user_ids);
    }
    if (searchData.service_ids && searchData.service_ids.length > 0) {
      query.whereIn(`${this.tableName}.service_id`, searchData.service_ids);
    }
    if (searchData.date_from) {
      query.where(knex.raw('DATE(start_time)'), '>=', searchData.date_from);
    }
    if (searchData.date_to) {
      query.where(knex.raw('DATE(start_time)'), '<=', searchData.date_to);
    }
    if (searchData.billable_only) {
      query.where(`${this.tableName}.billable_duration`, '>', 0);
    }

    // Add joins
    query.leftJoin('users', `${this.tableName}.user_id`, 'users.user_id')
      .leftJoin('services', `${this.tableName}.service_id`, 'services.service_id')
      .select(
        `${this.tableName}.*`,
        knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as user_name`),
        'services.service_name'
      )
      .limit(searchData.limit || 25);

    return query;
  }

  // Statistics
  async getStatistics(context: ServiceContext, filters?: TimeEntryFilterData): Promise<any> {
    const { knex } = await this.getKnex();
    let query = knex(this.tableName)
      .where(`${this.tableName}.tenant`, context.tenant);

    // Apply date filters if provided
    if (filters?.date_from) {
      query = query.where(knex.raw('DATE(start_time)'), '>=', filters.date_from);
    }
    if (filters?.date_to) {
      query = query.where(knex.raw('DATE(start_time)'), '<=', filters.date_to);
    }

    const [basicStats, typeStats, statusStats, userStats, serviceStats, topWorkItems] = await Promise.all([
      this.getBasicTimeStats(query.clone(), context),
      this.getEntriesByType(query.clone(), context),
      this.getEntriesByStatus(query.clone(), context),
      this.getEntriesByUser(query.clone(), context),
      this.getEntriesByService(query.clone(), context),
      this.getTopWorkItems(query.clone(), context)
    ]);

    return {
      ...basicStats,
      entries_by_type: typeStats,
      entries_by_status: statusStats,
      entries_by_user: userStats,
      entries_by_service: serviceStats,
      top_work_items: topWorkItems
    };
  }

  // Helper methods
  private async getOrCreateTimeSheet(startTime: string, userId: string, context: ServiceContext): Promise<string> {
    const { knex } = await this.getKnex();
    
    // Get time period for the start date
    const startDate = new Date(startTime);
    const period = await this.getTimePeriodForDate(startDate, context);
    
    if (!period) {
      throw new Error('No time period found for this date');
    }

    // Check for existing time sheet
    let timeSheet = await knex('time_sheets')
      .where({
        period_id: period.period_id,
        user_id: userId,
        tenant: context.tenant
      })
      .first();

    if (!timeSheet) {
      // Create new time sheet
      const [newTimeSheet] = await knex('time_sheets')
        .insert({
          period_id: period.period_id,
          user_id: userId,
          approval_status: 'DRAFT',
          tenant: context.tenant,
          created_at: new Date(),
          updated_at: new Date()
        })
        .returning('*');
      
      timeSheet = newTimeSheet;
    }

    return timeSheet.id;
  }

  private async getTimePeriodForDate(date: Date, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();
    return knex('time_periods')
      .where({
        tenant: context.tenant
      })
      .where('start_date', '<=', date)
      .where('end_date', '>=', date)
      .first();
  }

  private async calculateBillingInfo(timeEntry: any, context: ServiceContext): Promise<any> {
    // This would integrate with billing system
    // For now, return basic structure
    return {
      billing_plan_id: null,
      tax_rate_id: null,
      tax_percentage: 0,
      tax_region: timeEntry.tax_region || null
    };
  }

  private async canManageTimeEntries(context: ServiceContext): Promise<boolean> {
    // Check if user has permission to manage time entries
    // This would integrate with RBAC system
    return false; // Simplified for now
  }

  private async getTimeEntryUser(userId: string, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();
    return knex('users')
      .where({ user_id: userId })
      .select('user_id', 'first_name', 'last_name', 'email')
      .first();
  }

  private async getWorkItemDetails(workItemId: string | null, workItemType: string, context: ServiceContext): Promise<any> {
    if (!workItemId) return null;

    const { knex } = await this.getKnex();
    
    switch (workItemType) {
      case 'ticket':
        return knex('tickets')
          .where({ ticket_id: workItemId, tenant: context.tenant })
          .select('ticket_id as id', 'title', knex.raw('? as type', [workItemType]), 'company_id')
          .first();
      case 'project_task':
        return knex('project_tasks')
          .join('project_phases', 'project_tasks.phase_id', 'project_phases.phase_id')
          .join('projects', 'project_phases.project_id', 'projects.project_id')
          .where({ 'project_tasks.task_id': workItemId, 'project_tasks.tenant': context.tenant })
          .select(
            'project_tasks.task_id as id', 
            'project_tasks.task_name as title', 
            knex.raw('? as type', [workItemType]),
            'projects.company_id',
            'projects.project_id'
          )
          .first();
      default:
        return { id: workItemId, title: 'Unknown Work Item', type: workItemType };
    }
  }

  private async getServiceDetails(serviceId: string, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();
    return knex('services')
      .where({ service_id: serviceId, tenant: context.tenant })
      .select('service_id', 'service_name', 'default_rate', 'billing_unit')
      .first();
  }

  private async getTimeSheetDetails(timeSheetId: string, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();
    return knex('time_sheets')
      .where({ id: timeSheetId, tenant: context.tenant })
      .select('id', 'period_id', 'approval_status', 'submitted_at', 'approved_at')
      .first();
  }

  private async getBillingInfo(timeEntry: any, context: ServiceContext): Promise<any> {
    // Calculate billing information
    return {
      billing_plan_id: timeEntry.billing_plan_id,
      billing_plan_name: null, // Would join with billing plans
      rate: null, // Would calculate from service/billing plan
      tax_rate: timeEntry.tax_percentage,
      total_amount: null // Would calculate total
    };
  }

  private async getWorkItemTitle(workItemId: string, workItemType: string, context: ServiceContext): Promise<string | null> {
    const workItem = await this.getWorkItemDetails(workItemId, workItemType, context);
    return workItem?.title || null;
  }

  private async getServiceName(serviceId: string, context: ServiceContext): Promise<string | null> {
    const service = await this.getServiceDetails(serviceId, context);
    return service?.service_name || null;
  }

  private async getBasicTimeStats(query: Knex.QueryBuilder, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();
    const stats = await query
      .select([
        knex.raw('COUNT(*) as total_entries'),
        knex.raw('SUM(CASE WHEN billable_duration > 0 THEN billable_duration ELSE 0 END) / 60.0 as total_billable_hours'),
        knex.raw('SUM(CASE WHEN billable_duration = 0 THEN EXTRACT(EPOCH FROM (end_time - start_time)) / 3600 ELSE 0 END) as total_non_billable_hours'),
        knex.raw('AVG(billable_duration) as average_entry_duration'),
        knex.raw(`COUNT(CASE WHEN start_time >= date_trunc('week', NOW()) THEN 1 END) as entries_this_week`),
        knex.raw(`COUNT(CASE WHEN start_time >= date_trunc('month', NOW()) THEN 1 END) as entries_this_month`)
      ])
      .first();

    const totalBillableHours = parseFloat(stats?.total_billable_hours || '0');
    const totalNonBillableHours = parseFloat(stats?.total_non_billable_hours || '0');
    const totalHours = totalBillableHours + totalNonBillableHours;

    return {
      total_entries: parseInt(stats?.total_entries || '0'),
      total_billable_hours: totalBillableHours,
      total_non_billable_hours: totalNonBillableHours,
      billable_percentage: totalHours > 0 ? Math.round((totalBillableHours / totalHours) * 100) : 0,
      average_entry_duration: parseFloat(stats?.average_entry_duration || '0'),
      entries_this_week: parseInt(stats?.entries_this_week || '0'),
      entries_this_month: parseInt(stats?.entries_this_month || '0'),
      total_revenue: 0 // Would calculate from billing
    };
  }

  private async getEntriesByType(query: Knex.QueryBuilder, context: ServiceContext): Promise<Record<string, number>> {
    const { knex } = await this.getKnex();
    const results = await query
      .groupBy('work_item_type')
      .select('work_item_type', knex.raw('COUNT(*) as count'));

    return results.reduce((acc: any, item: any) => {
      acc[item.work_item_type] = parseInt(item.count);
      return acc;
    }, {} as Record<string, number>);
  }

  private async getEntriesByStatus(query: Knex.QueryBuilder, context: ServiceContext): Promise<Record<string, number>> {
    const { knex } = await this.getKnex();
    const results = await query
      .groupBy('approval_status')
      .select('approval_status', knex.raw('COUNT(*) as count'));

    return results.reduce((acc: any, item: any) => {
      acc[item.approval_status] = parseInt(item.count);
      return acc;
    }, {} as Record<string, number>);
  }

  private async getEntriesByUser(query: Knex.QueryBuilder, context: ServiceContext): Promise<Record<string, number>> {
    const { knex } = await this.getKnex();
    const results = await query
      .join('users', `${this.tableName}.user_id`, 'users.user_id')
      .groupBy('users.user_id', 'users.first_name', 'users.last_name')
      .select(
        knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as user_name`),
        knex.raw('COUNT(*) as count')
      )
      .limit(10);

    return results.reduce((acc: any, item: any) => {
      acc[item.user_name] = parseInt(item.count);
      return acc;
    }, {} as Record<string, number>);
  }

  private async getEntriesByService(query: Knex.QueryBuilder, context: ServiceContext): Promise<Record<string, number>> {
    const { knex } = await this.getKnex();
    const results = await query
      .leftJoin('services', this.tableName + '.service_id', 'services.service_id')
      .groupBy('services.service_name')
      .select('services.service_name', knex.raw('COUNT(*) as count'))
      .limit(10);

    return results.reduce((acc: any, item: any) => {
      const serviceName = item.service_name || 'No Service';
      acc[serviceName] = parseInt(item.count);
      return acc;
    }, {} as Record<string, number>);
  }

  private async getTopWorkItems(query: Knex.QueryBuilder, context: ServiceContext): Promise<any[]> {
    const { knex } = await this.getKnex();
    const results = await query
      .whereNotNull('work_item_id')
      .groupBy('work_item_id', 'work_item_type')
      .select(
        'work_item_id',
        'work_item_type',
        knex.raw('SUM(billable_duration) / 60.0 as total_hours'),
        knex.raw('COUNT(*) as entry_count')
      )
      .orderBy('total_hours', 'desc')
      .limit(5);

    // Get work item titles
    return Promise.all(results.map(async (item: any) => {
      const workItem = await this.getWorkItemDetails(item.work_item_id, item.work_item_type, context);
      return {
        work_item_id: item.work_item_id,
        work_item_title: workItem?.title || 'Unknown',
        total_hours: parseFloat(item.total_hours),
        entry_count: parseInt(item.entry_count)
      };
    }));
  }
}
