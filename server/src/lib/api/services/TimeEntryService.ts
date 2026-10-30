/**
 * Time Entry API Service
 * Handles all time entry-related database operations for the REST API
 */

import { delegateRest } from '@alga-psa/scheduling/lib/timeSource';
import { assertHumanWorkAssignee, assertHumanWorkOwner } from '@alga-psa/shared/lib/humanWork/assertHumanWorkAssignee';
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
import { buildTimeEntryApprovedPayload, toWorkflowTimeEntryWorkItemType } from '@alga-psa/workflow-streams';
import { buildTicketTimeEntryAddedWorkflowEvent } from './timeEntryWorkflowEvents';
import { hasPermission } from '../../auth/rbac';
import type { IUser } from '@alga-psa/types';
import {
  StopwatchConflictError,
  discardSession,
  getOpenSession,
  getSession,
  logSession,
  startSession,
  type StopwatchSessionView,
} from '@alga-psa/scheduling/lib/stopwatch/stopwatchCore';
import { mapStopwatchError, publishLoggedSessionEvents } from './StopwatchApiService';
import {
  getWorkItemBillingContext,
  deleteTimeEntryCore,
  persistTimeEntry,
  publishPersistedTimeEntryEvents,
  type PersistedTimeEntry,
} from '@alga-psa/scheduling/lib/timeEntryWriteCore';
import { getEligibleContractLines } from '@alga-psa/scheduling/lib/contractLineDisambiguation';
import { resolveDeterministicContractLineSelection } from '@alga-psa/scheduling/lib/contractLineDisambiguation.shared';
import { saveTimeEntryParamsSchema, type SaveTimeEntryParams } from '@alga-psa/scheduling/actions/timeEntrySchemas';
import {
  CONTRACT_LINE_SOURCE_BY_SELECTION_REASON,
  type ContractLineSource,
} from '@alga-psa/types';

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

  /**
   * Range keys the time-entry list accepts: the common created_ and updated_
   * keys, the start/end instants, and `date_*` (mapped to the work_date calendar
   * column). Any other `_from`/`_to` key is rejected by `applyRangeFilters`.
   */
  protected rangeFilterColumns(): Record<string, string> {
    return {
      ...super.rangeFilterColumns(),
      created_from: `${this.tableName}.created_at`,
      created_to: `${this.tableName}.created_at`,
      updated_from: `${this.tableName}.updated_at`,
      updated_to: `${this.tableName}.updated_at`,
      start_time_from: `${this.tableName}.start_time`,
      start_time_to: `${this.tableName}.start_time`,
      end_time_from: `${this.tableName}.end_time`,
      end_time_to: `${this.tableName}.end_time`,
      date_from: `${this.tableName}.work_date`,
      date_to: `${this.tableName}.work_date`,
    };
  }

  // A PostgreSQL DATE is a calendar date, not an instant. Project it as text
  // before pg hydrates it into a Date in the Node process's timezone.
  private workDateProjection(knex: Knex): Knex.Raw {
    return knex.raw("to_char(??, 'YYYY-MM-DD') as ??", [`${this.tableName}.work_date`, 'work_date']);
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

    // Created/updated plus start_time/end_time/date windows. Unsupported range
    // keys throw instead of silently returning unfiltered entries.
    this.applyRangeFilters(query, filters);

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
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'entries', 'list', [options, context]);
    if (delegated.handled) return delegated.value;
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
        this.workDateProjection(knex),
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

  async getById(id: string, context: ServiceContext): Promise<any | null> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'entries', 'getById', [id, context]);
    if (delegated.handled) return delegated.value;
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
        this.workDateProjection(knex),
        knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as user_name`),
        'service_catalog.service_name',
        knex.raw(`ROUND(${this.tableName}.billable_duration / 60.0, 2) as duration_hours`),
        knex.raw(`CASE WHEN ${this.tableName}.billable_duration > 0 THEN true ELSE false END as is_billable`)
      )
      .first();

    return timeEntry || null;
  }

  async getWithDetails(id: string, context: ServiceContext): Promise<any | null> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'entries', 'getWithDetails', [id, context]);
    if (delegated.handled) return delegated.value;
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
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId, workItemType: data.work_item_type, workItemId: data.work_item_id }, 'entries', 'create', [data, context]);
    if (delegated.handled) return delegated.value;
    const { knex } = await this.getKnex();

    this.assertServiceIdPresent(data.service_id);

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

    // Human-work guard: the entry owner is the (effective) caller and must be a licensed user.
    await assertHumanWorkOwner(knex, context.tenant, context.userId, 'user_id');

    const userTimeZone = await resolveUserTimeZone(knex, context.tenant, context.userId);
    const { work_date, work_timezone } = computeWorkDateFields(data.start_time, userTimeZone);
    
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

    const isBillable = data.is_billable !== false;

    // Linkage is decided before anything is written so an ambiguous or ineligible
    // line is a 400 and not a half-saved entry. Non-billable time carries none.
    const contractLine = isBillable
      ? await this.resolveContractLineForWrite(knex, context, {
          workItemType: data.work_item_type,
          workItemId: data.work_item_id ?? null,
          serviceId: data.service_id,
          workDate: work_date,
          explicitContractLineId: data.contract_line_id ?? null,
        })
      : { id: null, source: null };

    const nowIso = new Date().toISOString();
    const entry = this.buildSaveParams({
      entry_id: null,
      work_item_id: data.work_item_id,
      work_item_type: data.work_item_type,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      created_at: nowIso,
      updated_at: nowIso,
      // 0 is the explicit non-billable marker the core honours.
      billable_duration: isBillable ? billableDuration : 0,
      notes: data.notes ?? '',
      user_id: context.userId, // Always use authenticated user
      time_sheet_id: timeSheetId,
      approval_status: 'DRAFT',
      service_id: data.service_id,
      tax_region: data.tax_region,
      tax_rate_id: data.tax_rate_id ?? undefined,
    });

    const persisted = await this.persistViaWriteCore(knex, context, entry, contractLine);
    const timeEntry = persisted.entry;

    // Post-commit events (search event + ticket-time-entry-added workflow event),
    // exactly as the stopwatch log endpoint publishes them.
    await publishLoggedSessionEvents(persisted, context);

    return this.getWithDetails(timeEntry.entry_id as string, context);
  }

  async update(id: string, data: UpdateTimeEntryData, context: ServiceContext): Promise<any> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'entries', 'update', [id, data, context]);
    if (delegated.handled) return delegated.value;
    const { knex } = await this.getKnex();
    const existing = await this.getById(id, context);
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

    this.assertServiceIdPresent(data.service_id ?? existing.service_id);

    // Human-work guard: only when this write changes the owner.
    const requestedOwner = (data as { user_id?: string | null }).user_id;
    if (requestedOwner && requestedOwner !== existing.user_id) {
      await assertHumanWorkAssignee(knex, context.tenant, [requestedOwner]);
    }

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

    // Merge the patch over the stored row: the write core saves a whole entry.
    const merged = { ...existing, ...dataWithoutBillable };
    const startIso = new Date(updateData.start_time ?? existing.start_time).toISOString();
    const endIso = new Date(updateData.end_time ?? existing.end_time).toISOString();
    const billableDuration: number = updateData.billable_duration ?? existing.billable_duration ?? 0;
    const isBillable = billableDuration > 0;
    const workDate: string = updateData.work_date ?? existing.work_date;

    const contractLine = await this.resolveContractLineForUpdate(knex, context, existing, {
      isBillable,
      workItemType: merged.work_item_type,
      workItemId: merged.work_item_id ?? null,
      serviceId: merged.service_id,
      workDate,
      explicitContractLineId: data.contract_line_id ?? null,
      linkageInputsChanged:
        (data.service_id !== undefined && data.service_id !== existing.service_id) ||
        (data.work_item_id !== undefined && data.work_item_id !== existing.work_item_id) ||
        (data.work_item_type !== undefined && data.work_item_type !== existing.work_item_type) ||
        workDate !== existing.work_date ||
        !(existing.billable_duration > 0),
    });

    const nowIso = new Date().toISOString();
    const entry = this.buildSaveParams({
      entry_id: id,
      work_item_id: merged.work_item_id ?? undefined,
      work_item_type: merged.work_item_type,
      start_time: startIso,
      end_time: endIso,
      created_at: new Date(existing.created_at ?? Date.now()).toISOString(),
      updated_at: nowIso,
      billable_duration: billableDuration,
      notes: merged.notes ?? '',
      user_id: existing.user_id,
      time_sheet_id: existing.time_sheet_id ?? undefined,
      approval_status: existing.approval_status,
      service_id: merged.service_id,
      // undefined leaves the stored value untouched (the write core's update skips undefined).
      tax_region: data.tax_region ?? undefined,
      tax_rate_id: data.tax_rate_id,
    });

    const persisted = await this.persistViaWriteCore(knex, context, entry, contractLine);

    // Post-commit search event, as saveTimeEntry publishes it.
    await publishPersistedTimeEntryEvents(persisted);

    return this.getById(id, context);
  }

  async delete(id: string, context: ServiceContext): Promise<void> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'entries', 'delete', [id, context]);
    if (delegated.handled) return delegated.value;
    const { knex } = await this.getKnex();
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
      // Shared with the UI deleteTimeEntry action: reverses the bucket draw and
      // hour-block burn, deletes the row and recalculates project-task hours.
      await deleteTimeEntryCore(trx, context.tenant, id);
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
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'entries', 'bulkCreateTimeEntries', [data, context]);
    if (delegated.handled) return delegated.value;
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
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'entries', 'bulkUpdateTimeEntries', [data, context]);
    if (delegated.handled) return delegated.value;
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
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'entries', 'bulkDeleteTimeEntries', [data, context]);
    if (delegated.handled) return delegated.value;
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
  //
  // LEGACY ADAPTERS (plan D7). Installed mobile builds still call start-tracking / stop-tracking /
  // active-session. These keep the old response shapes but run on the server-side stopwatch
  // (stopwatchCore); `session_id` is the stopwatch session id and `start_time` the first segment start.
  // Pauses are not representable in the legacy shape: a paused session is reported with
  // status 'paused' and elapsed_minutes = active minutes.

  /** Old `time_entries`-row-shaped session payload (activeTimeSessionResponseSchema plus entry columns). */
  private async toLegacySession(view: StopwatchSessionView, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();
    const startTime = new Date(view.segments[0]?.started_at ?? view.created_at);
    const userTimeZone = await resolveUserTimeZone(knex, context.tenant, view.user_id);
    const { work_date, work_timezone } = computeWorkDateFields(startTime, userTimeZone);
    return {
      session_id: view.session_id,
      entry_id: view.session_id,
      tenant: context.tenant,
      work_item_id: view.work_item_id,
      work_item_type: view.work_item_type,
      service_id: view.service_id,
      user_id: view.user_id,
      start_time: startTime.toISOString(),
      end_time: null,
      work_date,
      work_timezone,
      notes: view.notes,
      billable_duration: 0,
      approval_status: 'DRAFT',
      created_at: view.created_at,
      updated_at: view.updated_at,
      status: view.status === 'paused' ? 'paused' : 'active',
      elapsed_minutes: Math.round(view.active_ms / 60_000),
      work_item_title: view.work_item_title,
      service_name: view.service_name,
    };
  }

  async startTimeTracking(data: StartTimeTrackingData, context: ServiceContext): Promise<any> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId, workItemType: data.work_item_type, workItemId: data.work_item_id }, 'entries', 'startTimeTracking', [data, context]);
    if (delegated.handled) return delegated.value;
    const { knex } = await this.getKnex();

    this.assertServiceIdPresent(data.service_id);

    let view: StopwatchSessionView;
    try {
      view = await knex.transaction((trx) =>
        startSession(
          trx,
          context.tenant,
          context.userId,
          {
            workItemType: data.work_item_type,
            workItemId: data.work_item_id ?? null,
            serviceId: data.service_id,
            notes: data.notes || '',
          },
          { allowLegacyWorkItemTypes: true },
        ),
      );
    } catch (error) {
      if (error instanceof StopwatchConflictError) {
        throw new ConflictError('Active time tracking session already exists. Please stop the current session first.');
      }
      throw mapStopwatchError(error);
    }

    return this.toLegacySession(view, context);
  }

  async stopTimeTracking(sessionId: string, data: StopTimeTrackingData, context: ServiceContext): Promise<any> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'entries', 'stopTimeTracking', [sessionId, data, context]);
    if (delegated.handled) return delegated.value;
    const { knex } = await this.getKnex();

    let result;
    try {
      result = await knex.transaction(async (trx) => {
        // Only an open (running or paused) session of the caller can be stopped.
        const session = await getSession(trx, context.tenant, context.userId, sessionId);
        if (!session || (session.status !== 'running' && session.status !== 'paused')) {
          throw new NotFoundError('Active session not found');
        }
        this.assertServiceIdPresent(data.service_id ?? session.service_id);
        return logSession(trx, context.tenant, context.user as IUser, sessionId, {
          end_time: data.end_time,
          notes: data.notes || undefined,
          service_id: data.service_id,
          is_billable: data.is_billable,
        });
      });
    } catch (error) {
      throw mapStopwatchError(error);
    }

    await publishLoggedSessionEvents(result.persisted, context);

    return this.getById(result.persisted.entry.entry_id, context);
  }

  /** Abandon the caller's own timer without writing effort (REST cancel-tracking). */
  async cancelTimeTracking(sessionId: string, context: ServiceContext): Promise<any> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'entries', 'cancelTimeTracking', [sessionId, context]);
    if (delegated.handled) return delegated.value;
    const { knex } = await this.getKnex();
    try {
      // discardSession scopes to the caller's own session: another user's id is simply "not found".
      const view = await knex.transaction((trx) => discardSession(trx, context.tenant, context.userId, sessionId));
      return { session_id: view.session_id, status: view.status };
    } catch (error) {
      throw mapStopwatchError(error);
    }
  }

  async getActiveSession(userId: string, context: ServiceContext): Promise<any | null> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'entries', 'getActiveSession', [userId, context]);
    if (delegated.handled) return delegated.value;
    const { knex } = await this.getKnex();

    if (!await hasPermission(context.user, 'time_entry', 'read', knex)) {
      throw new ForbiddenError('Permission denied: Cannot read time entries');
    }

    // Legacy endpoint: only the caller's own session (never another user's).
    const view = await knex.transaction((trx) => getOpenSession(trx, context.tenant, userId));
    if (!view) return null;
    return this.toLegacySession(view, context);
  }

  // Templates
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
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'entries', 'exportTimeEntries', [exportQuery, context]);
    if (delegated.handled) return delegated.value;
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
        this.workDateProjection(knex),
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

  // Approval operations
  async approveTimeEntries(data: ApproveTimeEntriesData, context: ServiceContext): Promise<any> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'entries', 'approveTimeEntries', [data, context]);
    if (delegated.handled) return delegated.value;
    const { knex } = await this.getKnex();
    const results: { success: boolean; error?: string; entry_id: string }[] = [];

    // Human-work guard: approval requires a human approver. Checked before the per-entry
    // loop, whose catch would otherwise swallow the error into a per-entry failure.
    await assertHumanWorkOwner(knex, context.tenant, context.userId, 'approved_by');

    for (const entryId of data.entry_ids) {
      try {
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
        const timestamp = new Date().toISOString();
        const workItemType = toWorkflowTimeEntryWorkItemType(entry.work_item_type);
        if (workItemType && entry.user_id && entry.work_item_id && context.userId) {
          await publishWorkflowEvent({
            eventType: 'TIME_ENTRY_APPROVED',
            payload: buildTimeEntryApprovedPayload({
              timeEntryId: entryId,
              userId: entry.user_id,
              workItemId: entry.work_item_id,
              workItemType,
              approvedBy: context.userId,
              timestamp,
            }),
            ctx: {
              tenantId: context.tenant,
              actor: { actorType: 'USER', actorUserId: context.userId },
            },
          });
        } else {
          // Ad-hoc / interaction / non-billable time has no workflow representation.
          await publishEvent({
            eventType: 'TIME_ENTRY_UPDATED',
            payload: {
              tenantId: context.tenant,
              timeEntryId: entryId,
              approvedBy: context.userId,
              timestamp,
            },
          });
        }
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
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'entries', 'requestChanges', [data, context]);
    if (delegated.handled) return delegated.value;
    const { knex } = await this.getKnex();
    const results: { success: boolean; error?: string; entry_id: string }[] = [];
    
    for (const entryId of data.entry_ids) {
      try {
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
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'entries', 'searchTimeEntries', [searchData, context]);
    if (delegated.handled) return delegated.value;
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
        this.workDateProjection(knex),
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
        this.workDateProjection(knex),
        knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as user_name`),
        'service_catalog.service_name'
      )
      .limit(searchData.limit || 25);

    return query;
  }

  // Statistics
  async getTimeEntryStatistics(filters: TimeEntryFilterData | undefined, context: ServiceContext): Promise<any> {
    // Time-source seam: a registered non-native source may own this call; native falls through untouched (0 statements).
    const delegated = await delegateRest({ tenant: context.tenant, userId: context.userId }, 'entries', 'getTimeEntryStatistics', [filters, context]);
    if (delegated.handled) return delegated.value;
    const stats = await this.getStatistics(context, filters);
    return {
      total_hours: stats.total_billable_hours + stats.total_non_billable_hours,
      billable_hours: stats.total_billable_hours,
      non_billable_hours: stats.total_non_billable_hours,
      total_entries: stats.total_entries,
      ...stats
    };
  }
  
  async getStatistics(context: ServiceContext, filters?: TimeEntryFilterData): Promise<any> {
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

    // Check for existing time sheet
    let timeSheet = await tenantDb(knex, context.tenant).table('time_sheets')
      .where('period_id', period.period_id)
      .where('user_id', userId)
      .first();

    if (!timeSheet) {
      // Create new time sheet
      // Human-work guard (R5.3): never create a time sheet for a non-internal user.
      await assertHumanWorkAssignee(knex, context.tenant, [userId]);
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

  /**
   * Validate and shape an entry for the shared write core. The core's caller
   * contract requires saveTimeEntryParamsSchema; that schema types work_item_id as
   * a required string, but the REST API has always accepted ad_hoc /
   * non_billable_category entries without one (stored as NULL), so the schema is
   * satisfied with a placeholder and the real (absent) value is restored.
   */
  private buildSaveParams(input: Record<string, unknown>): SaveTimeEntryParams {
    const parsed = saveTimeEntryParamsSchema.safeParse({
      ...input,
      work_item_id: input.work_item_id ?? '',
    });
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })));
    }
    return { ...parsed.data, work_item_id: (input.work_item_id ?? null) as string } as SaveTimeEntryParams;
  }

  /**
   * Run the write core inside a transaction this service owns (core caller contract
   * steps 3-4; the controller has already checked the time_entry permission).
   * Expected failures (locked sheet, invoiced entry, bucket problems, ...) become
   * 4xx API errors through the same mapping the stopwatch endpoints use.
   */
  private async persistViaWriteCore(
    knex: Knex,
    context: ServiceContext,
    entry: SaveTimeEntryParams,
    contractLine: { id: string | null; source: ContractLineSource | null },
  ): Promise<PersistedTimeEntry> {
    if (!context.user) {
      throw new ForbiddenError('Permission denied: Missing user context');
    }
    try {
      return await knex.transaction((trx) =>
        persistTimeEntry(trx, {
          tenant: context.tenant,
          actor: context.user as IUser,
          entry,
          contractLine,
          // The sheet was resolved from work_date (getOrCreateTimeSheetForWorkDate),
          // so the period is checked against the same date the bucketing used.
          sheetPeriodCheck: 'work_date',
        }),
      );
    } catch (error) {
      throw mapStopwatchError(error);
    }
  }

  /**
   * Contract-line linkage for a billable REST write, decided before anything is saved.
   *
   *  - caller named a line: it must be one of the eligible lines, else 400;
   *  - several lines eligible and the resolver cannot narrow them (billing
   *    profile, bucket overlay): 400 listing the candidates. The UI saves such an
   *    entry as 'unresolved' for the review queue, but an API caller can resend
   *    with a choice, and guessing could post to the wrong line;
   *  - otherwise the resolver's pick (or none) with the same provenance the UI records.
   *
   * Client and billing profile come from the work item exactly as the write core
   * derives them (getWorkItemBillingContext).
   */
  private async resolveContractLineForWrite(
    knex: Knex,
    context: ServiceContext,
    input: {
      workItemType: string;
      workItemId: string | null;
      serviceId: string;
      workDate: string;
      explicitContractLineId: string | null;
    },
  ): Promise<{ id: string | null; source: ContractLineSource | null }> {
    const eligible = await this.loadEligibleContractLines(knex, context, input);
    return this.chooseContractLine(eligible.lines, eligible.billingProfileId, input.explicitContractLineId);
  }

  /**
   * PATCH linkage. An existing line is never nulled just because the entry was
   * edited: it is kept (with its recorded provenance) unless the edit changed what
   * the line depends on AND the line is no longer eligible, in which case the
   * linkage is re-resolved like a create (including the ambiguity 400). A caller-
   * supplied line is validated like on create. Entries that are (now) non-billable
   * carry no linkage.
   */
  private async resolveContractLineForUpdate(
    knex: Knex,
    context: ServiceContext,
    existing: any,
    input: {
      isBillable: boolean;
      workItemType: string;
      workItemId: string | null;
      serviceId: string;
      workDate: string;
      explicitContractLineId: string | null;
      linkageInputsChanged: boolean;
    },
  ): Promise<{ id: string | null; source: ContractLineSource | null }> {
    if (!input.isBillable) {
      return { id: null, source: null };
    }

    const existingLine: { id: string | null; source: ContractLineSource | null } = {
      id: existing.contract_line_id ?? null,
      source: existing.contract_line_source ?? null,
    };

    if (!input.explicitContractLineId && !input.linkageInputsChanged) {
      // Notes, duration, tax... nothing the linkage depends on moved; leave it
      // exactly as stored (including a legacy null: no ambiguity 400 on a notes edit).
      return existingLine;
    }

    const eligible = await this.loadEligibleContractLines(knex, context, input);

    if (
      !input.explicitContractLineId &&
      existingLine.id &&
      eligible.lines.some((line) => line.client_contract_line_id === existingLine.id)
    ) {
      return existingLine;
    }

    return this.chooseContractLine(eligible.lines, eligible.billingProfileId, input.explicitContractLineId);
  }

  private async loadEligibleContractLines(
    knex: Knex,
    context: ServiceContext,
    input: { workItemType: string; workItemId: string | null; serviceId: string; workDate: string },
  ): Promise<{ lines: Awaited<ReturnType<typeof getEligibleContractLines>>; billingProfileId: string | null }> {
    const { clientId, billingProfileId } = await getWorkItemBillingContext(
      tenantDb(knex, context.tenant),
      input.workItemType,
      input.workItemId,
    );
    const lines = clientId
      ? await getEligibleContractLines(knex, context.tenant, clientId, input.serviceId, input.workDate)
      : [];
    return { lines, billingProfileId };
  }

  private chooseContractLine(
    lines: Awaited<ReturnType<typeof getEligibleContractLines>>,
    billingProfileId: string | null,
    explicitContractLineId: string | null,
  ): { id: string | null; source: ContractLineSource | null } {
    const candidates = lines.map((line) => ({
      contract_line_id: line.client_contract_line_id,
      contract_line_name: line.contract_line_name ?? null,
      contract_line_type: line.contract_line_type,
      contract_id: line.contract_id ?? null,
      contract_name: line.contract_name ?? null,
      has_bucket: Boolean(line.bucket_overlay?.config_id),
    }));

    if (explicitContractLineId) {
      if (!lines.some((line) => line.client_contract_line_id === explicitContractLineId)) {
        throw new ValidationError(
          'contract_line_id is not an eligible contract line for this client, service and work date',
          {
            reason: 'contract_line_not_eligible',
            contract_line_id: explicitContractLineId,
            eligible_contract_lines: candidates,
          },
        );
      }
      return { id: explicitContractLineId, source: 'explicit' };
    }

    // LEVERAGE: pattern contract-line-resolution — eligibility + deterministic selection composed
    // here a second time; the write core composes it through resolveContractLineSelection, which
    // needs a session user. A resolver taking (knex, tenant) explicitly would be the one layer.
    const selection = resolveDeterministicContractLineSelection(lines, { billingProfileId });

    if (selection.reason === 'ambiguous') {
      throw new ValidationError(
        'Multiple contract lines are eligible for this time entry; resend with contract_line_id set to one of eligible_contract_lines',
        {
          reason: 'contract_line_ambiguous',
          eligible_contract_lines: candidates,
        },
      );
    }

    return {
      id: selection.selectedContractLineId,
      source: CONTRACT_LINE_SOURCE_BY_SELECTION_REASON[selection.reason],
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
