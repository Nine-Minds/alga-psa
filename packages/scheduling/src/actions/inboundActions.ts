import { computeWorkDateFields, createTenantKnex, resolveUserTimeZone, tenantDb, withTransaction } from '@alga-psa/db';
import { publishEvent } from '@alga-psa/event-bus/publishers';

import {
  registerAction,
  type InboundActionDefinition,
  type InboundActionResult,
} from '@alga-psa/shared/inboundWebhooks/actions/registry';
import { writeEntityMapping } from '@alga-psa/shared/inboundWebhooks/externalEntityMappings';

interface CreateTimeEntryMappedValues extends Record<string, unknown> {
  user_id: string;
  work_item_type: 'ticket' | 'project_task' | 'non_billable_category' | 'ad_hoc' | 'interaction';
  work_item_id?: string;
  service_id: string;
  start_time: string;
  duration_minutes: number;
  notes?: string;
  is_billable?: boolean;
  tax_region?: string;
  external_id?: string;
}

class ExpectedInboundActionFailure extends Error {
  constructor(readonly result: InboundActionResult) {
    super(result.message ?? 'Inbound action failed');
  }
}

function validationFailure(
  message: string,
  externalId?: string,
  metadata: Record<string, unknown> = {},
): ExpectedInboundActionFailure {
  return new ExpectedInboundActionFailure({
    success: false,
    entityType: 'time_entry',
    externalId,
    message,
    metadata: { code: 'VALIDATION_ERROR', ...metadata },
  });
}

function toExpectedInboundActionResult(error: unknown): InboundActionResult | null {
  return error instanceof ExpectedInboundActionFailure ? error.result : null;
}

const createTimeEntryAction: InboundActionDefinition<CreateTimeEntryMappedValues> = {
  name: 'createTimeEntry',
  entityType: 'time_entry',
  displayName: 'Create Time Entry',
  description: 'Create a time entry from an inbound webhook payload.',
  targetFields: [
    { name: 'user_id', type: 'ref', required: true, refEntityType: 'user', description: 'User to log time for' },
    {
      name: 'work_item_type',
      type: 'enum',
      required: true,
      description: 'Work item type',
      enumValues: ['ticket', 'project_task', 'non_billable_category', 'ad_hoc', 'interaction'],
    },
    { name: 'work_item_id', type: 'ref', required: false, refEntityType: 'work_item', description: 'Work item ID' },
    { name: 'service_id', type: 'ref', required: true, refEntityType: 'service', description: 'Service ID' },
    { name: 'start_time', type: 'string', required: true, description: 'Start timestamp' },
    { name: 'duration_minutes', type: 'int', required: true, description: 'Duration in minutes' },
    { name: 'notes', type: 'string', required: false, description: 'Time entry notes' },
    { name: 'is_billable', type: 'boolean', required: false, description: 'Whether the entry is billable' },
    { name: 'tax_region', type: 'string', required: false, description: 'Tax region' },
    { name: 'external_id', type: 'string', required: false, description: 'External time entry identifier to map' },
  ],
  async handle(ctx, mappedValues) {
    const { knex } = await createTenantKnex(ctx.tenant);
    let timeEntry;
    try {
      timeEntry = await withTransaction(knex, async (trx) => {
        const scopedDb = tenantDb(trx, ctx.tenant);
        const startTime = new Date(mappedValues.start_time);
        if (Number.isNaN(startTime.getTime())) {
          throw validationFailure(
            'VALIDATION_ERROR: start_time must be a valid timestamp',
            mappedValues.external_id,
            { field: 'start_time' },
          );
        }

        if (mappedValues.duration_minutes <= 0) {
          throw validationFailure(
            'VALIDATION_ERROR: duration_minutes must be greater than zero',
            mappedValues.external_id,
            { field: 'duration_minutes' },
          );
        }

        const endTime = new Date(startTime.getTime() + mappedValues.duration_minutes * 60_000);
        await assertTimeEntryReferences({
          trx,
          tenant: ctx.tenant,
          userId: mappedValues.user_id,
          serviceId: mappedValues.service_id,
          workItemType: mappedValues.work_item_type,
          workItemId: mappedValues.work_item_id,
          externalId: mappedValues.external_id,
        });

        const workTimezone = await resolveUserTimeZone(trx, ctx.tenant, mappedValues.user_id);
        const { work_date, work_timezone } = computeWorkDateFields(startTime, workTimezone);
        const timeSheetId = await getOrCreateTimeSheetForWorkDate(
          trx,
          ctx.tenant,
          mappedValues.user_id,
          work_date,
          mappedValues.external_id,
        );
        const billableDuration = mappedValues.is_billable === false ? 0 : mappedValues.duration_minutes;

        const [created] = await scopedDb.table('time_entries')
          .insert({
            tenant: ctx.tenant,
            user_id: mappedValues.user_id,
            work_item_id: mappedValues.work_item_id ?? null,
            work_item_type: mappedValues.work_item_type,
            service_id: mappedValues.service_id,
            start_time: startTime.toISOString(),
            end_time: endTime.toISOString(),
            work_date,
            work_timezone,
            billable_duration: billableDuration,
            notes: mappedValues.notes ?? '',
            time_sheet_id: timeSheetId,
            approval_status: 'DRAFT',
            tax_region: mappedValues.tax_region ?? null,
            invoiced: false,
            created_by: mappedValues.user_id,
            updated_by: mappedValues.user_id,
            created_at: trx.fn.now(),
            updated_at: trx.fn.now(),
          })
          .returning(['entry_id', 'work_item_id', 'work_item_type', 'billable_duration', 'created_at']);

        if (mappedValues.external_id) {
          await writeEntityMapping(ctx.tenant, ctx.webhookSlug, 'time_entry', created.entry_id, mappedValues.external_id, {
            knex: trx,
            metadata: { source: 'inbound_webhook', delivery_id: ctx.deliveryId },
          });
        }

        return created;
      });
    } catch (error) {
      const expectedResult = toExpectedInboundActionResult(error);
      if (expectedResult) {
        return expectedResult;
      }
      throw error;
    }

    await publishEvent({
      eventType: 'TIME_ENTRY_CREATED',
      payload: {
        tenantId: ctx.tenant,
        timeEntryId: timeEntry.entry_id,
        userId: mappedValues.user_id,
        workItemId: timeEntry.work_item_id,
        workItemType: timeEntry.work_item_type,
        duration: mappedValues.duration_minutes,
        timestamp: new Date().toISOString(),
      },
    });

    return {
      success: true,
      entityType: 'time_entry',
      entityId: timeEntry.entry_id,
      externalId: mappedValues.external_id,
      metadata: {
        billable_duration: timeEntry.billable_duration,
        work_item_type: timeEntry.work_item_type,
      },
    };
  },
};

registerAction(createTimeEntryAction);

export const timeEntryInboundActions = [createTimeEntryAction];

async function assertTimeEntryReferences(args: {
  trx: any;
  tenant: string;
  userId: string;
  serviceId: string;
  workItemType: CreateTimeEntryMappedValues['work_item_type'];
  workItemId?: string;
  externalId?: string;
}): Promise<void> {
  const scopedDb = tenantDb(args.trx, args.tenant);
  const user = await scopedDb.table('users').where({ user_id: args.userId }).first('user_id');
  if (!user) {
    throw validationFailure(`VALIDATION_ERROR: user_id "${args.userId}" does not exist`, args.externalId, {
      field: 'user_id',
    });
  }

  const service = await scopedDb.table('service_catalog')
    .where({ service_id: args.serviceId })
    .first('service_id');
  if (!service) {
    throw validationFailure(`VALIDATION_ERROR: service_id "${args.serviceId}" does not exist`, args.externalId, {
      field: 'service_id',
    });
  }

  if (args.workItemType === 'ad_hoc') {
    return;
  }

  if (!args.workItemId) {
    throw validationFailure(
      `VALIDATION_ERROR: work_item_id is required when work_item_type is ${args.workItemType}`,
      args.externalId,
      { field: 'work_item_id', work_item_type: args.workItemType },
    );
  }

  const workItemTable = workItemTableForType(args.workItemType);
  if (!workItemTable) {
    return;
  }

  const workItem = await scopedDb.table(workItemTable.table)
    .where({ [workItemTable.idColumn]: args.workItemId })
    .first(workItemTable.idColumn);
  if (!workItem) {
    throw validationFailure(
      `VALIDATION_ERROR: ${args.workItemType} work_item_id "${args.workItemId}" does not exist`,
      args.externalId,
      { field: 'work_item_id', work_item_type: args.workItemType },
    );
  }
}

function workItemTableForType(
  workItemType: CreateTimeEntryMappedValues['work_item_type'],
): { table: string; idColumn: string } | null {
  switch (workItemType) {
    case 'ticket':
      return { table: 'tickets', idColumn: 'ticket_id' };
    case 'project_task':
      return { table: 'project_tasks', idColumn: 'task_id' };
    case 'interaction':
      return { table: 'interactions', idColumn: 'interaction_id' };
    case 'non_billable_category':
      return null;
    case 'ad_hoc':
      return null;
    default:
      return null;
  }
}

async function getOrCreateTimeSheetForWorkDate(
  trx: any,
  tenant: string,
  userId: string,
  workDate: string,
  externalId?: string,
): Promise<string> {
  const scopedDb = tenantDb(trx, tenant);
  const period = await scopedDb.table('time_periods')
    .where('start_date', '<=', workDate)
    .where('end_date', '>', workDate)
    .first('period_id');

  if (!period) {
    throw validationFailure(`VALIDATION_ERROR: no time period found for work_date "${workDate}"`, externalId, {
      field: 'work_date',
    });
  }

  const existing = await scopedDb.table('time_sheets')
    .where({
      period_id: period.period_id,
      user_id: userId,
    })
    .first('id');

  if (existing) {
    return existing.id;
  }

  const [created] = await scopedDb.table('time_sheets')
    .insert({
      tenant,
      period_id: period.period_id,
      user_id: userId,
      approval_status: 'DRAFT',
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    })
    .returning('id');

  return created.id;
}
