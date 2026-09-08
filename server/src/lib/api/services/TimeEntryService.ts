/**
 * Time Entry API Service
 * Handles all time entry-related database operations for the REST API
 */

import { Knex } from 'knex';
import { BaseService, ServiceContext, ListOptions, ListResult, tenantDb } from '@alga-psa/db';
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
import { publishEvent, publishWorkflowEvent } from 'server/src/lib/eventBus/publishers';
import { ConflictError, ForbiddenError, NotFoundError, NotImplementedError, ValidationError } from '../middleware/apiMiddleware';
import { computeWorkDateFields, resolveUserTimeZone, truncateToMinute } from 'server/src/lib/utils/workDate';
import { buildTicketTimeEntryAddedWorkflowEvent } from './timeEntryWorkflowEvents';
import { hasPermission } from '../../auth/rbac';
import { recalculateProjectTaskActualHoursForEntryChange, withTransaction, registerAfterCommit } from '@alga-psa/db';
import { lockTimeEntryBillingMode, operationalTimeEntryFields, admitCoManagedNativeTimeSave, lockCoManagedLocalAuthentication, assertCoManagedTimeSaveFields,
  CoManagedSharedWorkError, TimeEntryBillingModeError, startNativeTimeTracking, stopNativeTimeTracking, getNativeActiveTimeTracking,
  NativeTimeTrackingError, NativeTimeDeletionError, NativeTimeReviewError, reviewCoManagedNativeTimeEntry, openCoManagedNativeTimeSheet, deleteCoManagedNativeTimeEntry, readCoManagedNativeTimeEntry, readCoManagedNativeTimeEntries, cancelNativeTimeTracking, admitCoManagedNativeTimeSource, type CoManagedNativeTimeAccess } from '@alga-psa/co-managed';
import { CoManagedLifecycleError } from '@alga-psa/licensing';
import { hasCoManagedConversationOwnership } from '@alga-psa/co-managed/nativeConversationEvents';

import { filterVisibleTimeEntries, sortVisibleTimeEntries, visibleTimeEntryStatistics, visibleTimeEntriesCsv } from './timeEntryCollection';
import { reverseDeletedTimeEntryBilling } from '@alga-psa/scheduling/lib/timeEntryDeletionBilling';

interface TimeApiAdmission {
  entryId?: string; operational: boolean; access: CoManagedNativeTimeAccess | null; existing: any; source: any;
  fields: ReturnType<typeof operationalTimeEntryFields> | null;
}

export class TimeEntryService extends BaseService<any> {
  constructor(private readonly retainedConnection?: { knex: Knex.Transaction; tenant: string }) {
    super({
      tableName: 'time_entries',
      primaryKey: 'entry_id',
      tenantColumn: 'tenant',
      searchableFields: ['notes'],
      defaultSort: 'start_time',
      defaultOrder: 'desc'
    });
  }

  protected async getKnex(): Promise<{ knex: Knex; tenant: string }> {
    return this.retainedConnection ?? super.getKnex();
  }

  async create(data: CreateTimeEntryData, context: ServiceContext): Promise<any> {
    return this.withTimeWrite(undefined, data, context, (service, admission, payload, home) => service.createAdmitted(payload, home, admission));
  }
  async update(id: string, data: UpdateTimeEntryData, context: ServiceContext): Promise<any> {
    return this.withTimeWrite(id, data, context, (service, admission, payload, home) => service.updateAdmitted(id, payload, home, admission));
  }
  /** Each mutation has a fresh connection-bound service. Native helper queries
   * and after-commit events cannot escape the transaction or mutate a shared
   * service instance used concurrently by another request. */
  private async withTimeWrite(id: string | undefined, input: any, inputContext: ServiceContext,
    work: (service: TimeEntryService, admission: TimeApiAdmission, data: any, context: ServiceContext) => Promise<any>) {
    const context = { ...inputContext, user: inputContext.user ? { ...inputContext.user } : undefined }, data = { ...input };
    const { knex } = await this.getKnex();
    return this.withTimeErrors(() => withTransaction(knex, async trx => {
        const currentMode = await lockTimeEntryBillingMode(trx, context.tenant), owner = tenantDb(trx, context.tenant);
        const existing = id ? await owner.table('time_entries').where('entry_id', id).first() : null;
        if (id && !existing) throw new NotFoundError('Time entry not found');
        const guarded = data.work_item_type === 'co_managed' || existing?.work_item_type === 'co_managed' || currentMode === 'operational' || existing?.billing_mode === 'operational' || await hasCoManagedConversationOwnership(trx, context.tenant);
        const service = new TimeEntryService({ knex: trx, tenant: context.tenant });
        let access: CoManagedNativeTimeAccess | null = null, source: any = null;
        if (guarded) {
          if (!context.apiKeyId || context.user?.user_id !== context.userId || context.user?.tenant !== context.tenant || context.user?.user_type !== 'internal') throw new CoManagedSharedWorkError();
          // Serializes the API's overlap and automatic-sheet checks
          // before taking shared identity locks. It never locks a foreign user.
          if (!await owner.table('users').where({ user_id: context.userId, user_type: 'internal', is_inactive: false }).forUpdate().first('user_id')) throw new CoManagedSharedWorkError();
          const actor = { kind: 'api_key' as const, tenant: context.tenant, userId: context.userId, apiKeyId: context.apiKeyId };
          const credential = await lockCoManagedLocalAuthentication(trx, actor);
          source = { ...existing, ...data, entry_id: id, user_id: existing?.user_id || context.userId, approval_status: existing?.approval_status || 'DRAFT' };
          if (source.user_id !== context.userId) throw new CoManagedSharedWorkError();
          source.start_time = truncateToMinute(source.start_time);
          source.end_time = truncateToMinute(source.end_time);
          if (!(source.end_time > source.start_time)) throw new ValidationError('End time must be after start time');
          const zone = await resolveUserTimeZone(trx, context.tenant, source.user_id);
          Object.assign(source, computeWorkDateFields(source.start_time, zone));
          if (!source.time_sheet_id || data.start_time) source.time_sheet_id = await service.getOrCreateTimeSheetForWorkDate(source.work_date, source.user_id, context);
          const workId = source.work_item_type === 'non_billable_category' && !source.work_item_id ? '__non_billable__' : source.work_item_id;
          access = await admitCoManagedNativeTimeSave(trx, actor, { ...source, work_item_id: workId });
          assertCoManagedTimeSaveFields(access, source.work_item_type);
          source.work_item_id = workId === '__non_billable__' ? null : workId;
          await service.assertTimeSheetPeriod(source, context);
          await credential.assertCurrent();
        }
        const mode = await lockTimeEntryBillingMode(trx, context.tenant, id), operational = mode === 'operational';
        const fields = operational ? operationalTimeEntryFields(data) : null;
        const result = await work(service, { existing, source, access, operational, fields }, data, context);
        await access?.assertCurrent();
        return result;
      }));
  }

  private async withTimeErrors<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); } catch (error) {
      if (error instanceof NativeTimeReviewError) {
        if (error.code === 'TIME_REVIEW_NOT_FOUND') throw new NotFoundError(error.message);
        throw new ConflictError(error.message);
      }
      if (error instanceof NativeTimeDeletionError) {
        if (error.code === 'TIME_DELETE_NOT_FOUND') throw new NotFoundError(error.message);
        throw new ConflictError(error.message);
      }
      if (error instanceof NativeTimeTrackingError) {
        if (error.code === 'TIMER_NOT_FOUND') throw new NotFoundError('Time tracking session not found');
        if (error.code === 'TIMER_ALREADY_ACTIVE') throw new ConflictError('An active time tracking session already exists');
        if (error.code === 'TIMER_STOP_CONFLICT') throw new ConflictError('This timer was already stopped with a different request');
        if (error.code === 'TIMER_SERVICE_REQUIRED') throw new ValidationError('A current service is required for commercial time tracking');
        throw new ValidationError('Invalid time tracking input');
      }
      if (error instanceof CoManagedLifecycleError) throw Object.assign(new ForbiddenError(error.message), { code: error.code });
      if (error instanceof CoManagedSharedWorkError) throw new ForbiddenError('Permission denied: Cannot access this time entry');
      if (error instanceof TimeEntryBillingModeError) {
        if (error.code === 'OPERATIONAL_TIME_COMMERCIAL_FIELDS') throw new ValidationError('Operational time cannot include billing selections');
        if (error.code === 'TIME_ENTRY_NOT_FOUND') throw new NotFoundError('Time entry not found');
        throw new ForbiddenError('Time entry is not available for this product');
      }
      throw error;
    }
  }

  private async assertTimeSheetPeriod(source: any, context: ServiceContext) {
    const { knex } = await this.getKnex(), owner = tenantDb(knex, context.tenant);
    const sheet = owner.table('time_sheets as sheet').where('sheet.id', source.time_sheet_id);
    owner.tenantJoin(sheet, 'time_periods as period', 'sheet.period_id', 'period.period_id');
    const period = await sheet.first('period.start_date', 'period.end_date');
    const dateOnly = (value: Date | string) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
    const endDate = computeWorkDateFields(source.end_time, source.work_timezone).work_date;
    if (!period || source.work_date < dateOnly(period.start_date) || source.work_date >= dateOnly(period.end_date) ||
      endDate < dateOnly(period.start_date) || endDate >= dateOnly(period.end_date)) throw new ValidationError('Time entry must fall within the time sheet period');
  }

  private admittedPersistFields(admission: TimeApiAdmission) {
    const { start_time, end_time, work_date, work_timezone, time_sheet_id, work_item_id, work_item_type } = admission.source;
    return { start_time, end_time, work_date, work_timezone, time_sheet_id, work_item_id, work_item_type,
      co_managed_work_reference_id: work_item_type === 'co_managed' ? work_item_id : null };
  }

  private presentAdmittedTime(entry: any, admission: TimeApiAdmission) {
    const item = admission.access!.workItem;
    const minutes = entry.end_time ? Math.max(0, Math.round((new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime()) / 60000)) : 0;
    return { ...entry, duration_hours: Math.round(minutes / 60 * 100) / 100, is_billable: entry.billable_duration > 0,
      work_item: { id: entry.work_item_id, type: entry.work_item_type, title: item.name }, work_item_title: item.name };
  }

  private async afterTimeCommit(work: () => Promise<void>) {
    if (!this.retainedConnection) throw new Error('Time mutation events require their owning transaction');
    registerAfterCommit(this.retainedConnection.knex, work, 'api-time-entry');
  }

  private assertServiceIdPresent(serviceId: string | null | undefined): void {
    if (!serviceId) {
      throw new ValidationError('Validation failed', [
        {
          path: ['service_id'],
          message: 'service_id is required for time entries',
        },
      ]);
    }
  }

  protected applyFilters(query: Knex.QueryBuilder, filters: Record<string, any>, knex?: Knex, tenant?: string): Knex.QueryBuilder {
    if (!filters) return query;
    
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
      query.where(`${this.tableName}.work_date`, '>=', filters.date_from);
    }
    if (filters.date_to) {
      query.where(`${this.tableName}.work_date`, '<=', filters.date_to);
    }
    if (filters.time_sheet_id) {
      query.where(`${this.tableName}.time_sheet_id`, filters.time_sheet_id);
    }
    if (filters.contract_line_id) {
      query.where(`${this.tableName}.contract_line_id`, filters.contract_line_id);
    }
    if (filters.client_id) {
      if (!knex || !tenant) {
        throw new Error('TimeEntryService.applyFilters requires knex and tenant for client_id filtering');
      }
      const scopedDb = tenantDb(knex, tenant);
      scopedDb.tenantJoin(query, 'tickets', 'time_entries.work_item_id', 'tickets.ticket_id', {
        type: 'left',
        on(join) {
          join.andOn('time_entries.work_item_type', '=', knex.raw('?', ['ticket']));
        },
      });
      scopedDb.tenantJoin(query, 'project_tasks', 'time_entries.work_item_id', 'project_tasks.task_id', {
        type: 'left',
        on(join) {
          join.andOn('time_entries.work_item_type', '=', knex.raw('?', ['project_task']));
        },
      });
      scopedDb.tenantJoin(query, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id', { type: 'left' });
      scopedDb.tenantJoin(query, 'projects', 'project_phases.project_id', 'projects.project_id', { type: 'left' });
      query.where(function() {
        this.where('tickets.client_id', filters.client_id!)
          .orWhere('projects.client_id', filters.client_id!);
      });
    }
    if (filters.duration_min !== undefined) {
      query.where(`${this.tableName}.billable_duration`, '>=', filters.duration_min);
    }
    if (filters.duration_max !== undefined) {
      query.where(`${this.tableName}.billable_duration`, '<=', filters.duration_max);
    }
    
    return query;
  }

  async list(options: ListOptions, context: ServiceContext): Promise<ListResult<any>> {
    const current = await this.readCurrentTimeEntries(context);
    if (current.handled) {
      const entries = sortVisibleTimeEntries(filterVisibleTimeEntries(current.entries, options.filters), options.sort, options.order);
      const { page = 1, limit = 25 } = options;
      return { data: entries.slice((page - 1) * limit, page * limit), total: entries.length };
    }
    const { knex } = await this.getKnex();
    const query = this.buildTenantScopedQuery(knex, context);

    // Extract filters from options
    const filters = options.filters as TimeEntryFilterData;
    
    // Apply filters
    this.applyFilters(query, filters, knex, context.tenant);

    // Add joins for additional data
    const scopedDb = tenantDb(knex, context.tenant);
    scopedDb.tenantJoin(query, 'users', 'time_entries.user_id', 'users.user_id', { type: 'left' });
    scopedDb.tenantJoin(query, 'service_catalog', 'time_entries.service_id', 'service_catalog.service_id', { type: 'left' });
    scopedDb.tenantJoin(query, 'time_sheets', 'time_entries.time_sheet_id', 'time_sheets.id', { type: 'left' });
    query
      .select(
        `${this.tableName}.*`,
        knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as user_name`),
        'service_catalog.service_name',
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

    // Get total count - need to apply same filters to count query
    const countQuery = this.buildTenantScopedQuery(knex, context);
    
    // Apply same filters to count query
    this.applyFilters(countQuery, filters, knex, context.tenant);
    
    const [data, [{ count }]] = await Promise.all([
      query,
      countQuery.count('* as count')
    ]);

    return {
      data,
      total: parseInt(count as string)
    };
  }

  private async readCurrentTimeEntries(context: ServiceContext) {
    const { knex } = await this.getKnex();
    return this.withTimeErrors(() => readCoManagedNativeTimeEntries(knex, context.tenant, async () => this.timeActor(context)));
  }

  private async readCurrentTimeEntry(id: string, context: ServiceContext) {
    const { knex } = await this.getKnex();
    return this.withTimeErrors(async () => {
      const current = await readCoManagedNativeTimeEntry(knex, context.tenant, id, async () => this.timeActor(context));
      if (!current.handled || !current.entry) return current;
      const { workItem, ...entry } = current.entry;
      return { handled: true as const, entry: { ...entry, work_item_title: workItem.name,
        work_item: { id: entry.work_item_id, type: entry.work_item_type, title: workItem.name } } };
    });
  }

  async getById(id: string, context: ServiceContext): Promise<any | null> {
    const current = await this.readCurrentTimeEntry(id, context);
    if (current.handled) return current.entry;
    const { knex } = await this.getKnex();
    const scopedDb = tenantDb(knex, context.tenant);
    const query = this.buildTenantScopedQuery(knex, context);
    scopedDb.tenantJoin(query, 'users', 'time_entries.user_id', 'users.user_id', { type: 'left' });
    scopedDb.tenantJoin(query, 'service_catalog', 'time_entries.service_id', 'service_catalog.service_id', { type: 'left' });
    scopedDb.tenantJoin(query, 'time_sheets', 'time_entries.time_sheet_id', 'time_sheets.id', { type: 'left' });
    const timeEntry = await query
      .where(`${this.tableName}.${this.primaryKey}`, id)
      .select(
        `${this.tableName}.*`,
        knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as user_name`),
        'service_catalog.service_name',
        knex.raw(`ROUND(${this.tableName}.billable_duration / 60.0, 2) as duration_hours`),
        knex.raw(`CASE WHEN ${this.tableName}.billable_duration > 0 THEN true ELSE false END as is_billable`)
      )
      .first();

    return timeEntry || null;
  }

  async getWithDetails(id: string, context: ServiceContext): Promise<any | null> {
    const current = await this.readCurrentTimeEntry(id, context);
    if (current.handled) return current.entry;
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

  private async createAdmitted(data: CreateTimeEntryData, context: ServiceContext, admission: TimeApiAdmission): Promise<any> {
    const { knex } = await this.getKnex();

    if (!admission.operational) this.assertServiceIdPresent(data.service_id);

    if (data.work_item_type === 'ticket') {
      if (!data.work_item_id) {
        throw new ValidationError('Validation failed', [
          {
            path: ['work_item_id'],
            message: 'work_item_id is required when work_item_type is ticket',
          },
        ]);
      }

      if (!context.user) {
        throw new ForbiddenError('Permission denied: Missing user context');
      }

      const canReadTickets = await hasPermission(context.user, 'ticket', 'read', knex);
      if (!canReadTickets) {
        throw new ForbiddenError('Permission denied: Cannot read tickets');
      }

      const ticketExists = await tenantDb(knex, context.tenant).table('tickets')
        .where('ticket_id', data.work_item_id)
        .first('ticket_id');

      if (!ticketExists) {
        throw new ValidationError('Validation failed', [
          {
            path: ['work_item_id'],
            message: 'Ticket not found',
          },
        ]);
      }
    }

    if (data.work_item_type === 'project_task' && !data.work_item_id) {
      throw new ValidationError('Validation failed', [
        {
          path: ['work_item_id'],
          message: 'work_item_id is required when work_item_type is project_task',
        },
      ]);
    }

    const userTimeZone = await resolveUserTimeZone(knex, context.tenant, context.userId);
    const { work_date, work_timezone } = admission.source ?? computeWorkDateFields(data.start_time, userTimeZone);
    
    // Calculate billable duration
    // LEVERAGE: pattern time-entry-duration-persist — normalize-to-minute + Math.round duration
    // is duplicated across this service (create/update/stop) and timeEntryCrudActions; a shared
    // "normalize and persist a time entry" layer would own this once.
    const startTime = truncateToMinute(data.start_time);
    const endTime = truncateToMinute(data.end_time);
    const durationMs = endTime.getTime() - startTime.getTime();
    const billableDuration = Math.round(durationMs / (1000 * 60)); // minutes

    // Check for overlapping time entries
    const overlapping = await this.buildTenantScopedQuery(knex, context)
      .where('user_id', context.userId)
      .where(function() {
        this.where(function() {
          // New entry starts during existing entry
          this.where('start_time', '<=', startTime)
            .where('end_time', '>', startTime);
        })
        .orWhere(function() {
          // New entry ends during existing entry
          this.where('start_time', '<', endTime)
            .where('end_time', '>=', endTime);
        })
        .orWhere(function() {
          // New entry completely contains existing entry
          this.where('start_time', '>=', startTime)
            .where('end_time', '<=', endTime);
        });
      })
      .first();

    if (overlapping) {
      throw new ConflictError('Time entry overlaps with existing entry');
    }

    // Get or create time sheet for the period
    const timeSheetId = await this.getOrCreateTimeSheetForWorkDate(work_date, context.userId, context);

    const { is_billable, ...dataWithoutBillable } = data;
    const timeEntryData = {
      ...dataWithoutBillable,
      user_id: context.userId, // Always use authenticated user
      start_time: startTime, // persist minute-truncated instants, not the caller's seconds
      end_time: endTime,
      work_date,
      work_timezone,
      billable_duration: is_billable !== false ? billableDuration : 0,
      time_sheet_id: timeSheetId,
      approval_status: 'DRAFT',
      tenant: context.tenant,
      created_at: new Date(),
      updated_at: new Date()
    };

    if (admission.source) Object.assign(timeEntryData, this.admittedPersistFields(admission));
    if (admission.fields) Object.assign(timeEntryData, admission.fields);
    if (admission.entryId) Object.assign(timeEntryData, { entry_id: admission.entryId });

    // Get billing information if billable
    if (!admission.operational && data.is_billable !== false) {
      const billingInfo = await this.calculateBillingInfo(timeEntryData, context);
      Object.assign(timeEntryData, billingInfo);
    }

    const timeEntry = await withTransaction(knex, async (trx) => {
      const [created] = await tenantDb(trx, context.tenant).table('time_entries')
        .insert(timeEntryData)
        .returning('*');
      await recalculateProjectTaskActualHoursForEntryChange(trx, context.tenant, null, created);
      return created;
    });

    // Publish event
    await this.afterTimeCommit(() => publishEvent({
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
    }));

    const ticketTimeEntryAdded = buildTicketTimeEntryAddedWorkflowEvent({
      workItemType: timeEntry.work_item_type,
      workItemId: timeEntry.work_item_id,
      timeEntryId: timeEntry.entry_id,
      minutes: billableDuration,
      billable: timeEntry.billable_duration > 0,
      createdAt: timeEntry.created_at,
    });
    if (ticketTimeEntryAdded) {
      await this.afterTimeCommit(() => publishWorkflowEvent({
        eventType: ticketTimeEntryAdded.eventType,
        payload: ticketTimeEntryAdded.payload,
        ctx: {
          tenantId: context.tenant,
          occurredAt: timeEntry.created_at,
          actor: { actorType: 'USER', actorUserId: context.userId },
        },
      }));
    }

    return admission.access ? this.presentAdmittedTime(timeEntry, admission) : this.getWithDetails(timeEntry.entry_id, context);
  }

  private async updateAdmitted(id: string, data: UpdateTimeEntryData, context: ServiceContext, admission: TimeApiAdmission): Promise<any> {
    const { knex } = await this.getKnex();
    const existing = admission.existing;
    if (!existing) {
      return null;
    }

    // Check if user can update this entry
    if (existing.user_id !== context.userId && !await this.canManageTimeEntries(context)) {
      throw new ForbiddenError('Permission denied: Cannot update this time entry');
    }

    // Check if entry is approved (prevent modification)
    if (existing.approval_status === 'APPROVED') {
      throw new ConflictError('Cannot modify approved time entries');
    }

    if (!admission.operational) this.assertServiceIdPresent(data.service_id ?? existing.service_id);

    // Extract is_billable from data as it's not a database column
    const { is_billable, ...dataWithoutBillable } = data;
    const updateData: any = {
      ...dataWithoutBillable,
      updated_at: new Date()
    };

    // Persist minute-truncated instants, not the caller's seconds.
    if (data.start_time) updateData.start_time = truncateToMinute(data.start_time);
    if (data.end_time) updateData.end_time = truncateToMinute(data.end_time);

    // work_date/work_timezone are server-controlled; recompute when start_time changes.
    if (data.start_time) {
      const userTimeZone = await resolveUserTimeZone(knex, context.tenant, context.userId);
      const { work_date, work_timezone } = computeWorkDateFields(data.start_time, userTimeZone);
      updateData.work_date = work_date;
      updateData.work_timezone = work_timezone;
    }

    // Recalculate duration if times changed
    if (data.start_time || data.end_time) {
      // LEVERAGE: pattern time-entry-duration-persist — same normalize-to-minute + round shape.
      const startTime = truncateToMinute(data.start_time || existing.start_time);
      const endTime = truncateToMinute(data.end_time || existing.end_time);
      const durationMs = endTime.getTime() - startTime.getTime();
      const totalDuration = Math.round(durationMs / (1000 * 60));

      // If is_billable is explicitly set, use it; otherwise keep existing billable status
      if (is_billable !== undefined) {
        updateData.billable_duration = is_billable ? totalDuration : 0;
      } else {
        // Keep the same billable/non-billable ratio
        const wasBillable = existing.billable_duration > 0;
        updateData.billable_duration = wasBillable ? totalDuration : 0;
      }
    } else if (is_billable !== undefined) {
      // is_billable changed but times didn't - recalculate billable_duration
      const startTime = truncateToMinute(existing.start_time);
      const endTime = truncateToMinute(existing.end_time);
      const durationMs = endTime.getTime() - startTime.getTime();
      const totalDuration = Math.round(durationMs / (1000 * 60));
      updateData.billable_duration = is_billable ? totalDuration : 0;
    }

    // Recalculate billing if relevant fields changed
    if (!admission.operational && (data.service_id !== undefined || updateData.billable_duration !== undefined)) {
      const billingInfo = await this.calculateBillingInfo({ ...existing, ...updateData }, context);
      Object.assign(updateData, billingInfo);
    }

    if (admission.source) Object.assign(updateData, this.admittedPersistFields(admission));
    if (admission.fields) Object.assign(updateData, admission.fields);
    const saved = await withTransaction(knex, async (trx) => {
      const [updated] = await tenantDb(trx, context.tenant).table('time_entries')
        .where({ [this.primaryKey]: id })
        .update(updateData)
        .returning('*');
      if (!updated) throw new NotFoundError('Time entry not found');
      await recalculateProjectTaskActualHoursForEntryChange(trx, context.tenant, existing, updated);
      return updated;
    });

    // Publish event
    await this.afterTimeCommit(() => publishEvent({
      eventType: 'TIME_ENTRY_UPDATED',
      payload: {
        tenantId: context.tenant,
        timeEntryId: id,
        userId: context.userId,
        changes: admission.access ? undefined : data,
        timestamp: new Date().toISOString()
      }
    }));

    return admission.access ? this.presentAdmittedTime(saved, admission) : this.getById(id, context);
  }

  async delete(id: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();
    const handled = await this.withTimeErrors(() => deleteCoManagedNativeTimeEntry(knex, context.tenant, id, async () => this.timeActor(context),
      (trx, entry) => reverseDeletedTimeEntryBilling(trx, context.tenant, entry),
      event => publishEvent({ eventType: 'TIME_ENTRY_DELETED', payload: { ...event, timestamp: new Date().toISOString() } })));
    if (handled) return;
    const existing = await this.getById(id, context);
    if (!existing) {
      throw new NotFoundError('Time entry not found');
    }

    // Check permissions
    if (existing.user_id !== context.userId && !await this.canManageTimeEntries(context)) {
      throw new ForbiddenError('Permission denied: Cannot delete this time entry');
    }

    // Check if entry is approved
    if (existing.approval_status === 'APPROVED') {
      throw new ConflictError('Cannot delete approved time entries');
    }

    await knex.transaction(async (trx) => {
      await tenantDb(trx, context.tenant).table('time_entries')
        .where({ [this.primaryKey]: id })
        .del();
      await recalculateProjectTaskActualHoursForEntryChange(trx, context.tenant, existing, null);
    });

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
    const results: { success: boolean; data?: any; error?: string }[] = [];
    
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
    const results: { success: boolean; data?: any; error?: string; entry_id?: string }[] = [];
    
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
    const results: { success: boolean; error?: string; entry_id: string }[] = [];
    
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
  private timeActor(context: ServiceContext) {
    if (!context.apiKeyId || context.user?.user_id !== context.userId || context.user?.tenant !== context.tenant || context.user?.user_type !== 'internal') throw new CoManagedSharedWorkError();
    return { kind: 'api_key' as const, tenant: context.tenant, userId: context.userId, apiKeyId: context.apiKeyId };
  }

  async startTimeTracking(data: StartTimeTrackingData, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();
    return this.withTimeErrors(() => startNativeTimeTracking(knex, this.timeActor(context), data));
  }

  async stopTimeTracking(sessionId: string, data: StopTimeTrackingData, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();
    return this.withTimeErrors(() => stopNativeTimeTracking(knex, this.timeActor(context), sessionId, data, async completion => {
      const { trx, actor, clock, endTime, billingMode, serviceId, notes, billable } = completion;
      const service = new TimeEntryService({ knex: trx, tenant: context.tenant });
      const startTime = new Date(clock.start_time), workDate = clock.work_date instanceof Date ? clock.work_date.toISOString().slice(0, 10) : clock.work_date;
      const timeSheetId = await service.getOrCreateTimeSheetForWorkDate(workDate, clock.user_id, context);
      const source = { work_item_id: clock.work_item_id, work_item_type: clock.work_item_type, start_time: startTime,
        end_time: endTime, work_date: workDate, work_timezone: clock.work_timezone, time_sheet_id: timeSheetId };
      const access = await admitCoManagedNativeTimeSource(trx, actor, { ...source, entry_id: clock.session_id,
        work_item_id: clock.work_item_id || '__non_billable__', user_id: clock.user_id, approval_status: 'DRAFT' }, 'update');
      await service.assertTimeSheetPeriod(source, context);
      const operational = billingMode === 'operational';
      const result = await service.createAdmitted({ work_item_id: clock.work_item_id ?? undefined, work_item_type: clock.work_item_type,
        start_time: startTime.toISOString(), end_time: endTime.toISOString(), notes, service_id: serviceId, is_billable: billable }, context,
        { entryId: clock.session_id, source, access, operational, fields: operational ? operationalTimeEntryFields({}) : null, existing: null });
      await access.assertCurrent();
      return result;
    }));
  }

  async cancelTimeTracking(sessionId: string, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();
    return this.withTimeErrors(() => cancelNativeTimeTracking(knex, this.timeActor(context), sessionId));
  }

  async getActiveSession(userId: string, context: ServiceContext): Promise<any | null> {
    const { knex } = await this.getKnex();
    return this.withTimeErrors(() => {
      if (userId !== context.userId) throw new CoManagedSharedWorkError();
      return getNativeActiveTimeTracking(knex, this.timeActor(context));
    });
  }

  async createTemplate(data: CreateTimeTemplateData, context: ServiceContext): Promise<any> {
    // TODO: Implement time_entry_templates table and functionality
    // For now, throw error indicating feature is not implemented
    throw new NotImplementedError('Time entry templates feature is not yet implemented');
  }

  async getTemplates(context: ServiceContext): Promise<any[]> {
    // TODO: Implement time_entry_templates table and functionality
    // For now, return empty array to avoid errors
    return [];
  }
  
  async getTimeEntryTemplates(context: ServiceContext): Promise<any[]> {
    return this.getTemplates(context);
  }
  
  async exportTimeEntries(exportQuery: TimeEntryExportQuery, context: ServiceContext): Promise<any> {
    const current = await this.readCurrentTimeEntries(context);
    if (current.handled) {
      const entries = sortVisibleTimeEntries(filterVisibleTimeEntries(current.entries, exportQuery));
      if (exportQuery.format === 'xlsx') throw new NotImplementedError('XLSX time export is not supported; use CSV or JSON');
      return exportQuery.format === 'csv' ? visibleTimeEntriesCsv(entries) : entries;
    }
    const { knex } = await this.getKnex();
    
    // Build query with filters
    let query = this.buildTenantScopedQuery(knex, context);
    
    // Apply filters from exportQuery
    const filters: TimeEntryFilterData = {
      user_id: exportQuery.user_id,
      work_item_id: exportQuery.work_item_id,
      work_item_type: exportQuery.work_item_type,
      service_id: exportQuery.service_id,
      approval_status: exportQuery.approval_status,
      is_billable: exportQuery.is_billable,
      date_from: exportQuery.date_from,
      date_to: exportQuery.date_to,
      start_time_from: exportQuery.start_time_from,
      start_time_to: exportQuery.start_time_to
    };
    
    this.applyFilters(query, filters, knex, context.tenant);
    
    // Add joins for complete data
    const scopedDb = tenantDb(knex, context.tenant);
    scopedDb.tenantJoin(query, 'users', 'time_entries.user_id', 'users.user_id', { type: 'left' });
    scopedDb.tenantJoin(query, 'service_catalog', 'time_entries.service_id', 'service_catalog.service_id', { type: 'left' });
    scopedDb.tenantJoin(query, 'tickets', 'time_entries.work_item_id', 'tickets.ticket_id', {
      type: 'left',
      on(join) {
        join.andOn('time_entries.work_item_type', '=', knex.raw('?', ['ticket']));
      },
    });
    scopedDb.tenantJoin(query, 'project_tasks', 'time_entries.work_item_id', 'project_tasks.task_id', {
      type: 'left',
      on(join) {
        join.andOn('time_entries.work_item_type', '=', knex.raw('?', ['project_task']));
      },
    });
    query
      .select(
        `${this.tableName}.*`,
        knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as user_name`),
        'service_catalog.service_name',
        knex.raw(`CASE WHEN tickets.ticket_id IS NOT NULL THEN tickets.title ELSE project_tasks.task_name END as work_item_title`),
        knex.raw(`ROUND(${this.tableName}.billable_duration / 60.0, 2) as duration_hours`),
        knex.raw(`CASE WHEN ${this.tableName}.billable_duration > 0 THEN true ELSE false END as is_billable`)
      )
      .orderBy(`${this.tableName}.start_time`, 'desc');
    
    const data = await query;
    
    if (exportQuery.format === 'csv') {
      // Convert to CSV format
      const headers = [
        'Date',
        'User',
        'Work Item',
        'Service',
        'Start Time',
        'End Time',
        'Duration (Hours)',
        'Billable',
        'Notes',
        'Approval Status'
      ];
      
      const rows = data.map(entry => [
        new Date(entry.start_time).toLocaleDateString(),
        entry.user_name,
        entry.work_item_title || 'N/A',
        entry.service_name || 'N/A',
        new Date(entry.start_time).toLocaleTimeString(),
        new Date(entry.end_time).toLocaleTimeString(),
        entry.duration_hours,
        entry.is_billable ? 'Yes' : 'No',
        entry.notes || '',
        entry.approval_status
      ]);
      
      // Create CSV string
      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n');
      
      return csvContent;
    } else {
      // Return JSON format
      return data;
    }
  }

  private async reviewCurrentTimeEntry(entryId: string, approvalStatus: 'APPROVED' | 'CHANGES_REQUESTED', comment: string | undefined, context: ServiceContext) {
    const { knex } = await this.getKnex();
    return this.withTimeErrors(() => reviewCoManagedNativeTimeEntry(knex, context.tenant, { entryId, approvalStatus, comment },
      async () => this.timeActor(context), event => publishEvent(event)));
  }

  // Approval operations
  async approveTimeEntries(data: ApproveTimeEntriesData, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();
    const results: { success: boolean; error?: string; entry_id: string }[] = [];
    
    for (const entryId of data.entry_ids) {
      try {
        if (await this.reviewCurrentTimeEntry(entryId, 'APPROVED', undefined, context)) {
          results.push({ success: true, entry_id: entryId }); continue;
        }
        // First check if the entry exists
        const entry = await this.buildTenantScopedQuery(knex, context)
          .where('entry_id', entryId)
          .first();
          
        if (!entry) {
          results.push({ success: false, error: 'Time entry not found', entry_id: entryId });
          continue;
        }
        
        // Check if it's in a valid status for approval
        if (!['SUBMITTED', 'CHANGES_REQUESTED'].includes(entry.approval_status)) {
          results.push({ success: false, error: `Time entry is in ${entry.approval_status} status and cannot be approved`, entry_id: entryId });
          continue;
        }
        
        await this.buildTenantScopedQuery(knex, context)
          .where('entry_id', entryId)
          .update({
            approval_status: 'APPROVED',
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

    const approvedCount = results.filter(r => r.success).length;
    
    // If all operations failed, throw an error
    if (approvedCount === 0 && results.length > 0) {
      throw new ValidationError('No time entries could be approved', results);
    }
    
    return { approved_count: approvedCount, results };
  }

  async requestChanges(data: RequestTimeEntryChangesData, context: ServiceContext): Promise<any[]> {
    const { knex } = await this.getKnex();
    const results: { success: boolean; error?: string; entry_id: string }[] = [];
    
    for (const entryId of data.entry_ids) {
      try {
        if (await this.reviewCurrentTimeEntry(entryId, 'CHANGES_REQUESTED', [data.change_reason, data.detailed_feedback].filter(Boolean).join('\n\n'), context)) {
          results.push({ success: true, entry_id: entryId }); continue;
        }
        await this.buildTenantScopedQuery(knex, context)
          .where('entry_id', entryId)
          .where('approval_status', 'SUBMITTED')
          .update({
            approval_status: 'CHANGES_REQUESTED',
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
  async searchTimeEntries(searchData: TimeEntrySearchData, context: ServiceContext): Promise<{ data: any[], total: number }> {
    const current = await this.readCurrentTimeEntries(context);
    if (current.handled) {
      const entries = sortVisibleTimeEntries(filterVisibleTimeEntries(current.entries, searchData, searchData));
      return { data: entries.slice(0, searchData.limit || 25), total: entries.length };
    }
    const { knex } = await this.getKnex();
    const query = this.buildTenantScopedQuery(knex, context);

    // Build search query
    const tableName = this.tableName;
    if (searchData.query) {
      query.where(function() {
        this.where(`${tableName}.notes`, 'ilike', `%${searchData.query}%`);
      });
    }

    // Apply filters if provided
    const filters: TimeEntryFilterData = {
      user_id: searchData.user_ids?.[0],
      work_item_type: searchData.work_item_types?.[0],
      service_id: searchData.service_ids?.[0],
      approval_status: searchData.approval_statuses?.[0],
      is_billable: searchData.billable_only,
      date_from: searchData.date_from,
      date_to: searchData.date_to
    };
    
    this.applyFilters(query, filters, knex, context.tenant);

    // Add joins
    const scopedDb = tenantDb(knex, context.tenant);
    scopedDb.tenantJoin(query, 'users', 'time_entries.user_id', 'users.user_id', { type: 'left' });
    scopedDb.tenantJoin(query, 'service_catalog', 'time_entries.service_id', 'service_catalog.service_id', { type: 'left' });
    query
      .select(
        `${this.tableName}.*`,
        knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as user_name`),
        'service_catalog.service_name',
        knex.raw(`CASE WHEN ${this.tableName}.billable_duration > 0 THEN true ELSE false END as is_billable`)
      );

    // Apply sorting
    const sortField = this.defaultSort;
    const sortOrder = this.defaultOrder;
    query.orderBy(`${this.tableName}.${sortField}`, sortOrder);

    // Apply pagination
    const page = 1;
    const limit = searchData.limit || 25;
    const offset = (page - 1) * limit;
    query.limit(limit).offset(offset);

    // Get total count
    const countQuery = this.buildTenantScopedQuery(knex, context);
    
    if (searchData.query) {
      countQuery.where(`${this.tableName}.notes`, 'ilike', `%${searchData.query}%`);
    }
    
    this.applyFilters(countQuery, filters, knex, context.tenant);
    
    const [data, [{ count }]] = await Promise.all([
      query,
      countQuery.count('* as count')
    ]);

    return {
      data,
      total: parseInt(count as string)
    };
  }
  
  async search(searchData: TimeEntrySearchData, context: ServiceContext): Promise<any[]> {
    const current = await this.readCurrentTimeEntries(context);
    if (current.handled) return sortVisibleTimeEntries(filterVisibleTimeEntries(current.entries, searchData, searchData)).slice(0, searchData.limit || 25);
    const { knex } = await this.getKnex();
    const query = this.buildTenantScopedQuery(knex, context);

    // Build search query
    if (searchData.fields && searchData.fields.length > 0) {
      query.where(function() {
        searchData.fields!.forEach(field => {
          if (field === 'user_name') {
            this.orWhere(knex.raw(`CONCAT(users.first_name, ' ', users.last_name)`), 'ilike', `%${searchData.query}%`);
          } else if (field === 'service_name') {
            this.orWhere('service_catalog.service_name', 'ilike', `%${searchData.query}%`);
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
      query.where(`${this.tableName}.work_date`, '>=', searchData.date_from);
    }
    if (searchData.date_to) {
      query.where(`${this.tableName}.work_date`, '<=', searchData.date_to);
    }
    if (searchData.billable_only) {
      query.where(`${this.tableName}.billable_duration`, '>', 0);
    }

    // Add joins
    const scopedDb = tenantDb(knex, context.tenant);
    scopedDb.tenantJoin(query, 'users', 'time_entries.user_id', 'users.user_id', { type: 'left' });
    scopedDb.tenantJoin(query, 'service_catalog', 'time_entries.service_id', 'service_catalog.service_id', { type: 'left' });
    query
      .select(
        `${this.tableName}.*`,
        knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as user_name`),
        'service_catalog.service_name'
      )
      .limit(searchData.limit || 25);

    return query;
  }

  // Statistics
  async getTimeEntryStatistics(filters: TimeEntryFilterData | undefined, context: ServiceContext): Promise<any> {
    const stats = await this.getStatistics(context, filters);
    return {
      total_hours: stats.total_hours ?? stats.total_billable_hours + stats.total_non_billable_hours,
      billable_hours: stats.total_billable_hours,
      non_billable_hours: stats.total_non_billable_hours,
      total_entries: stats.total_entries,
      ...stats
    };
  }
  
  async getStatistics(context: ServiceContext, filters?: TimeEntryFilterData): Promise<any> {
    const current = await this.readCurrentTimeEntries(context);
    if (current.handled) return visibleTimeEntryStatistics(filterVisibleTimeEntries(current.entries, filters));
    const { knex } = await this.getKnex();
    let query = this.buildTenantScopedQuery(knex, context);

    // Apply date filters if provided
    if (filters?.date_from) {
      query = query.where(`${this.tableName}.work_date`, '>=', filters.date_from);
    }
    if (filters?.date_to) {
      query = query.where(`${this.tableName}.work_date`, '<=', filters.date_to);
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
  private async getOrCreateTimeSheetForWorkDate(workDate: string, userId: string, context: ServiceContext): Promise<string> {
    const { knex } = await this.getKnex();
    
    const period = await this.getTimePeriodForWorkDate(workDate, context);
    
    if (!period) {
      throw new ValidationError('No time period found for this date');
    }

    const current = await openCoManagedNativeTimeSheet(knex, context.tenant, { userId, periodId: period.period_id }, async () => this.timeActor(context));
    if (current.handled) return current.sheet.id;

    // Check for existing time sheet
    let timeSheet = await tenantDb(knex, context.tenant).table('time_sheets')
      .where('period_id', period.period_id)
      .where('user_id', userId)
      .first();

    if (!timeSheet) {
      // Create new time sheet
      const [newTimeSheet] = await tenantDb(knex, context.tenant).table('time_sheets')
        .insert({
          period_id: period.period_id,
          user_id: userId,
          approval_status: 'DRAFT',
          tenant: context.tenant
        })
        .returning('*');
      
      timeSheet = newTimeSheet;
    }

    return timeSheet.id;
  }

  private async getTimePeriodForWorkDate(workDate: string, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();
    return tenantDb(knex, context.tenant).table('time_periods')
      .where('start_date', '<=', workDate)
      .where('end_date', '>', workDate)
      .first();
  }

  private async calculateBillingInfo(timeEntry: any, context: ServiceContext): Promise<any> {
    // This would integrate with billing system
    // For now, return basic structure
    return {
      contract_line_id: null,
      tax_rate_id: null,
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
    return tenantDb(knex, context.tenant).table('users')
      .where('user_id', userId)
      .select('user_id', 'first_name', 'last_name', 'email')
      .first();
  }

  private async getWorkItemDetails(workItemId: string | null, workItemType: string, context: ServiceContext): Promise<any> {
    if (!workItemId) return null;

    const { knex } = await this.getKnex();
    
    switch (workItemType) {
      case 'ticket':
        return tenantDb(knex, context.tenant).table('tickets')
          .where('ticket_id', workItemId)
          .select('ticket_id as id', 'title', knex.raw('? as type', [workItemType]), 'client_id')
          .first();
      case 'project_task':
        return tenantDb(knex, context.tenant).table('project_tasks')
          .modify((q) => tenantDb(knex, context.tenant).tenantJoin(q, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id'))
          .modify((q) => tenantDb(knex, context.tenant).tenantJoin(q, 'projects', 'project_phases.project_id', 'projects.project_id'))
          .where('project_tasks.task_id', workItemId)
          .select(
            'project_tasks.task_id as id', 
            'project_tasks.task_name as title', 
            knex.raw('? as type', [workItemType]),
            'projects.client_id',
            'projects.project_id'
          )
          .first();
      default:
        return { id: workItemId, title: 'Unknown Work Item', type: workItemType };
    }
  }

  private async getServiceDetails(serviceId: string, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();
    return tenantDb(knex, context.tenant).table('service_catalog')
      .where('service_id', serviceId)
      .select('service_id', 'service_name', 'default_rate', 'unit_of_measure')
      .first();
  }

  private async getTimeSheetDetails(timeSheetId: string, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();
    return tenantDb(knex, context.tenant).table('time_sheets')
      .where('id', timeSheetId)
      .select('id', 'period_id', 'approval_status', 'submitted_at', 'approved_at')
      .first();
  }

  private async getBillingInfo(timeEntry: any, context: ServiceContext): Promise<any> {
    // Calculate billing information
    return {
      contract_line_id: timeEntry.contract_line_id,
      contract_line_name: null, // Would join with contract lines
      rate: null, // Would calculate from service/contract line
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
      .modify((q) => tenantDb(knex, context.tenant).tenantJoin(q, 'users', 'time_entries.user_id', 'users.user_id'))
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
      .modify((q) => tenantDb(knex, context.tenant).tenantJoin(q, 'service_catalog', 'time_entries.service_id', 'service_catalog.service_id', { type: 'left' }))
      .groupBy('service_catalog.service_name')
      .select('service_catalog.service_name', knex.raw('COUNT(*) as count'))
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
