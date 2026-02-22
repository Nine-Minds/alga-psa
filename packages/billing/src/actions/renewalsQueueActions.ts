'use server';

import { randomUUID } from 'node:crypto';
import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { RenewalWorkItemStatus } from '@alga-psa/types';
import { normalizeClientContract } from '@alga-psa/shared/billingClients/clientContracts';
import { TicketModel } from '@shared/models/ticketModel';

const DEFAULT_RENEWALS_HORIZON_DAYS = 90;
const RENEWAL_WORK_ITEM_STATUSES: RenewalWorkItemStatus[] = [
  'pending',
  'renewing',
  'non_renewing',
  'snoozed',
  'completed',
];
const DEFAULT_RENEWAL_DUE_DATE_ACTION_POLICY = 'create_ticket' as const;
const RENEWAL_TICKET_SOURCE = 'renewal_due_date_manual_retry';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUIRED_RENEWAL_SCHEMA_COLUMNS = {
  client_contracts: [
    'decision_due_date',
    'status',
    'renewal_cycle_start',
    'renewal_cycle_end',
    'renewal_cycle_key',
    'snoozed_until',
    'assigned_to',
    'last_action',
    'last_action_by',
    'last_action_at',
    'last_action_note',
    'created_draft_contract_id',
    'created_ticket_id',
    'automation_error',
    'renewal_mode',
    'notice_period_days',
    'renewal_term_months',
    'use_tenant_renewal_defaults',
    'renewal_due_date_action_policy',
    'renewal_ticket_board_id',
    'renewal_ticket_status_id',
    'renewal_ticket_priority',
    'renewal_ticket_assignee_id',
  ],
  default_billing_settings: [
    'default_renewal_mode',
    'default_notice_period_days',
    'renewal_due_date_action_policy',
    'renewal_ticket_board_id',
    'renewal_ticket_status_id',
    'renewal_ticket_priority',
    'renewal_ticket_assignee_id',
  ],
} as const;

const isRenewalWorkItemStatus = (value: unknown): value is RenewalWorkItemStatus =>
  typeof value === 'string' && RENEWAL_WORK_ITEM_STATUSES.includes(value as RenewalWorkItemStatus);
const toRenewalWorkItemStatus = (value: unknown): RenewalWorkItemStatus =>
  isRenewalWorkItemStatus(value) ? value : 'pending';
const getTodayDateOnly = (): string => new Date().toISOString().slice(0, 10);
const requireBillingReadPermission = (user: unknown): void => {
  if (!hasPermission(user as any, 'billing', 'read')) {
    throw new Error('Permission denied: Cannot read renewals queue');
  }
};
const requireBillingUpdatePermission = (user: unknown): void => {
  if (!hasPermission(user as any, 'billing', 'update')) {
    throw new Error('Permission denied: Cannot update renewals queue');
  }
};
const resolveActorUserId = (user: unknown): string | null => {
  const candidate = (user as { user_id?: unknown } | null | undefined)?.user_id;
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
};
const withActionActor = (
  updateData: Record<string, unknown>,
  actorUserId: string | null
): Record<string, unknown> => (
  { ...updateData, last_action_by: actorUserId }
);
const withActionTimestamp = (
  updateData: Record<string, unknown>,
  actionAt: string
): Record<string, unknown> => (
  { ...updateData, last_action_at: actionAt }
);
const sanitizeActionNoteText = (value: string): string => (
  value
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);
const normalizeActionNote = (note: string | null | undefined): string | null => {
  if (typeof note !== 'string') {
    return null;
  }
  const trimmed = sanitizeActionNoteText(note);
  return trimmed.length > 0 ? trimmed : null;
};
const withActionNote = (
  updateData: Record<string, unknown>,
  note: string | null
): Record<string, unknown> => (
  note
    ? { ...updateData, last_action_note: note }
    : updateData
);
const withActionLabel = (
  updateData: Record<string, unknown>,
  actionLabel: string
): Record<string, unknown> => (
  { ...updateData, last_action: actionLabel }
);
const normalizeOptionalUuid = (value: unknown): string | null => (
  typeof value === 'string' && UUID_PATTERN.test(value)
    ? value
    : null
);
const resolveOptionalRenewalDueDateActionPolicy = (value: unknown): 'queue_only' | 'create_ticket' | null => (
  value === 'queue_only' || value === 'create_ticket'
    ? value
    : null
);
const resolveRenewalDueDateActionPolicy = (value: unknown): 'queue_only' | 'create_ticket' => (
  resolveOptionalRenewalDueDateActionPolicy(value) ?? DEFAULT_RENEWAL_DUE_DATE_ACTION_POLICY
);
const buildRenewalTicketIdempotencyKey = (params: {
  tenantId: string;
  clientContractId: string;
  cycleKey: string;
}): string => `renewal-ticket:${params.tenantId}:${params.clientContractId}:${params.cycleKey}`;
const buildRenewalTicketTitle = (row: Record<string, unknown>, decisionDueDate: string): string => {
  const clientName = typeof row.client_name === 'string' && row.client_name.trim().length > 0
    ? row.client_name.trim()
    : 'Client';
  const contractName = typeof row.contract_name === 'string' && row.contract_name.trim().length > 0
    ? row.contract_name.trim()
    : 'Contract';
  return `Renewal Decision Due ${decisionDueDate}: ${clientName} / ${contractName}`;
};
const buildRenewalTicketDescription = (
  row: Record<string, unknown>,
  normalized: Record<string, unknown>,
  decisionDueDate: string
): string => {
  const renewalMode = typeof normalized.effective_renewal_mode === 'string'
    ? normalized.effective_renewal_mode
    : 'manual';
  const noticePeriod = typeof normalized.effective_notice_period_days === 'number'
    ? normalized.effective_notice_period_days
    : 'unknown';
  const cycleKey = typeof normalized.renewal_cycle_key === 'string'
    ? normalized.renewal_cycle_key
    : 'unknown';
  const contractId = typeof row.contract_id === 'string' ? row.contract_id : 'unknown';

  return [
    'Contract renewal decision is due.',
    `Decision due date: ${decisionDueDate}`,
    `Renewal mode: ${renewalMode}`,
    `Notice period (days): ${noticePeriod}`,
    `Renewal cycle: ${cycleKey}`,
    `Source contract: ${contractId}`,
  ].join('\n');
};
const getMissingRenewalSchemaColumns = async (knex: any): Promise<string[]> => {
  const schema = knex?.schema as any;
  if (!schema?.hasTable || !schema?.hasColumn) {
    return [];
  }

  const missing: string[] = [];
  for (const [tableName, columns] of Object.entries(REQUIRED_RENEWAL_SCHEMA_COLUMNS)) {
    const tableExists = await schema.hasTable(tableName);
    if (!tableExists) {
      missing.push(`${tableName} (table)`);
      continue;
    }

    const columnChecks = await Promise.all(
      columns.map(async (columnName) => ({
        columnName,
        exists: await schema.hasColumn(tableName, columnName),
      }))
    );

    for (const check of columnChecks) {
      if (!check.exists) {
        missing.push(`${tableName}.${check.columnName}`);
      }
    }
  }

  return missing;
};
const assertRenewalSchemaReady = async (knex: any): Promise<void> => {
  const missing = await getMissingRenewalSchemaColumns(knex);
  if (missing.length === 0) {
    return;
  }

  throw new Error(
    `Renewal schema is not ready. Missing required columns: ${missing.join(', ')}. ` +
    'Run the latest server database migrations, then retry this renewals operation.'
  );
};

export type RenewalQueueRow = {
  client_contract_id: string;
  contract_id: string;
  contract_name?: string | null;
  client_id: string;
  client_name?: string | null;
  assigned_to?: string | null;
  status?: RenewalWorkItemStatus;
  contract_type: 'fixed-term' | 'evergreen';
  effective_renewal_mode?: 'none' | 'manual' | 'auto';
  decision_due_date?: string;
  days_until_due?: number;
  renewal_cycle_key?: string;
  evergreen_cycle_anchor_date?: string;
  created_draft_contract_id?: string | null;
  created_ticket_id?: string | null;
  automation_error?: string | null;
  available_actions: RenewalQueueAction[];
};

export type RenewalQueueAction =
  | 'mark_renewing'
  | 'mark_non_renewing'
  | 'create_renewal_draft'
  | 'snooze'
  | 'assign_owner';

export type RenewalQueueMutationResult = {
  client_contract_id: string;
  previous_status: RenewalWorkItemStatus;
  status: RenewalWorkItemStatus;
  updated_at: string;
};

export type RenewalDraftCreationResult = {
  client_contract_id: string;
  created_draft_contract_id: string;
  draft_client_contract_id: string;
};

export type RenewalSnoozeResult = RenewalQueueMutationResult & {
  snoozed_until: string;
};

export type RenewalAssignmentResult = {
  client_contract_id: string;
  status: RenewalWorkItemStatus;
  assigned_to: string | null;
  updated_at: string;
};

export type RenewalCompletionResult = RenewalQueueMutationResult & {
  activated_contract_id: string;
};

export type RenewalTicketRetryResult = {
  client_contract_id: string;
  created_ticket_id: string | null;
  automation_error: string | null;
  retried: boolean;
};

const getAvailableActionsForStatus = (status: RenewalWorkItemStatus): RenewalQueueAction[] => {
  if (status === 'pending') {
    return ['mark_renewing', 'mark_non_renewing', 'create_renewal_draft', 'snooze', 'assign_owner'];
  }
  if (status === 'renewing') {
    return ['mark_non_renewing', 'create_renewal_draft', 'snooze', 'assign_owner'];
  }
  if (status === 'non_renewing') {
    return ['mark_renewing', 'assign_owner'];
  }
  if (status === 'snoozed') {
    return ['mark_renewing', 'mark_non_renewing', 'create_renewal_draft', 'assign_owner'];
  }
  return ['assign_owner'];
};

export const listRenewalQueueRows = withAuth(async (
  user,
  { tenant },
  horizonDays: number = DEFAULT_RENEWALS_HORIZON_DAYS
): Promise<RenewalQueueRow[]> => {
  requireBillingReadPermission(user);

  const { knex } = await createTenantKnex();
  await assertRenewalSchemaReady(knex);
  const resolvedHorizonDays =
    Number.isInteger(horizonDays) && horizonDays > 0
      ? Math.trunc(horizonDays)
      : DEFAULT_RENEWALS_HORIZON_DAYS;

  await knex('client_contracts')
    .where({
      tenant,
      is_active: true,
      status: 'snoozed',
    })
    .andWhereNot('status', 'completed')
    .whereNotNull('snoozed_until')
    .andWhere('snoozed_until', '<=', getTodayDateOnly())
    .update({
      status: 'pending',
      snoozed_until: null,
      updated_at: new Date().toISOString(),
    });

  const defaultSelections: string[] = [
    'dbs.default_renewal_mode as tenant_default_renewal_mode',
    'dbs.default_notice_period_days as tenant_default_notice_period_days',
  ];

  let query = knex('client_contracts as cc')
    .leftJoin('contracts as c', function joinContracts() {
      this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
    })
    .leftJoin('clients as cl', function joinClients() {
      this.on('cc.client_id', '=', 'cl.client_id').andOn('cc.tenant', '=', 'cl.tenant');
    })
    .where({ 'cc.tenant': tenant, 'cc.is_active': true })
    .select([
      'cc.*',
      'c.contract_name',
      'c.status as contract_status',
      'cl.client_name',
      ...defaultSelections,
    ]);

  query = query.leftJoin('default_billing_settings as dbs', function joinDefaultBillingSettings() {
    this.on('cc.tenant', '=', 'dbs.tenant');
  });

  const rows = await query;

  return rows
    .map(normalizeClientContract)
    .filter(
      (row) =>
        Boolean(row.decision_due_date) &&
        typeof row.days_until_due === 'number' &&
        row.days_until_due >= 0 &&
        row.days_until_due <= resolvedHorizonDays
    )
    .map((row) => ({
      client_contract_id: row.client_contract_id,
      contract_id: row.contract_id,
      contract_name: (row as any).contract_name ?? null,
      client_id: row.client_id,
      client_name: (row as any).client_name ?? null,
      assigned_to: (row as any).assigned_to ?? null,
      status: toRenewalWorkItemStatus((row as any).status),
      contract_type: row.end_date ? ('fixed-term' as const) : ('evergreen' as const),
      effective_renewal_mode: row.effective_renewal_mode,
      decision_due_date: row.decision_due_date ?? undefined,
      days_until_due: row.days_until_due,
      renewal_cycle_key: row.renewal_cycle_key,
      evergreen_cycle_anchor_date:
        row.end_date
          ? undefined
          : (row as any).evergreen_review_anchor_date ?? row.renewal_cycle_end ?? undefined,
      created_draft_contract_id: (row as any).created_draft_contract_id ?? null,
      created_ticket_id: (row as any).created_ticket_id ?? null,
      automation_error: (row as any).automation_error ?? null,
      available_actions: getAvailableActionsForStatus(toRenewalWorkItemStatus((row as any).status)),
    }))
    .sort((a, b) => (a.decision_due_date ?? '').localeCompare(b.decision_due_date ?? ''));
});

export const markRenewalQueueItemRenewing = withAuth(async (
  user,
  { tenant },
  clientContractId: string,
  note?: string
): Promise<RenewalQueueMutationResult> => {
  requireBillingUpdatePermission(user);

  if (typeof clientContractId !== 'string' || clientContractId.trim().length === 0) {
    throw new Error('Client contract id is required');
  }

  const { knex } = await createTenantKnex();
  await assertRenewalSchemaReady(knex);
  const actorUserId = resolveActorUserId(user);
  const normalizedNote = normalizeActionNote(note);

  return knex.transaction(async (trx) => {
    const row = await trx('client_contracts')
      .where({
        tenant,
        client_contract_id: clientContractId,
        is_active: true,
      })
      .select('client_contract_id', 'status')
      .first();

    if (!row) {
      throw new Error('Renewal work item not found');
    }

    const previousStatus = toRenewalWorkItemStatus((row as any).status);
    if (previousStatus !== 'pending' && previousStatus !== 'non_renewing' && previousStatus !== 'snoozed') {
      throw new Error(
        `Only pending, non_renewing, or snoozed renewal work items can transition to renewing (current: ${previousStatus})`
      );
    }

    const updatedAt = new Date().toISOString();
    await trx('client_contracts')
      .where({
        tenant,
        client_contract_id: clientContractId,
      })
      .update(
        withActionTimestamp(
          withActionNote(
            withActionActor(
              withActionLabel({
                status: 'renewing',
                updated_at: updatedAt,
              }, 'mark_renewing'), actorUserId
            ), normalizedNote
          ), updatedAt
        )
      );

    return {
      client_contract_id: clientContractId,
      previous_status: previousStatus,
      status: 'renewing',
      updated_at: updatedAt,
    };
  });
});

export const markRenewalQueueItemNonRenewing = withAuth(async (
  user,
  { tenant },
  clientContractId: string,
  note?: string
): Promise<RenewalQueueMutationResult> => {
  requireBillingUpdatePermission(user);

  if (typeof clientContractId !== 'string' || clientContractId.trim().length === 0) {
    throw new Error('Client contract id is required');
  }

  const { knex } = await createTenantKnex();
  await assertRenewalSchemaReady(knex);
  const actorUserId = resolveActorUserId(user);
  const normalizedNote = normalizeActionNote(note);

  return knex.transaction(async (trx) => {
    const row = await trx('client_contracts')
      .where({
        tenant,
        client_contract_id: clientContractId,
        is_active: true,
      })
      .select('client_contract_id', 'status')
      .first();

    if (!row) {
      throw new Error('Renewal work item not found');
    }

    const previousStatus = toRenewalWorkItemStatus((row as any).status);
    if (previousStatus !== 'pending' && previousStatus !== 'renewing' && previousStatus !== 'snoozed') {
      throw new Error(
        `Only pending, renewing, or snoozed renewal work items can transition to non_renewing (current: ${previousStatus})`
      );
    }

    const updatedAt = new Date().toISOString();
    await trx('client_contracts')
      .where({
        tenant,
        client_contract_id: clientContractId,
      })
      .update(
        withActionTimestamp(
          withActionNote(
            withActionActor(
              withActionLabel({
                status: 'non_renewing',
                updated_at: updatedAt,
              }, 'mark_non_renewing'), actorUserId
            ), normalizedNote
          ), updatedAt
        )
      );

    return {
      client_contract_id: clientContractId,
      previous_status: previousStatus,
      status: 'non_renewing',
      updated_at: updatedAt,
    };
  });
});

export const createRenewalDraftForQueueItem = withAuth(async (
  user,
  { tenant },
  clientContractId: string,
  note?: string
): Promise<RenewalDraftCreationResult> => {
  requireBillingUpdatePermission(user);

  if (typeof clientContractId !== 'string' || clientContractId.trim().length === 0) {
    throw new Error('Client contract id is required');
  }

  const { knex } = await createTenantKnex();
  await assertRenewalSchemaReady(knex);
  const schema = knex.schema as any;
  const hasTemplateContractIdColumn = await (schema?.hasColumn?.('client_contracts', 'template_contract_id') ?? false);
  const actorUserId = resolveActorUserId(user);
  const normalizedNote = normalizeActionNote(note);

  return knex.transaction(async (trx) => {
    const source = await trx('client_contracts as cc')
      .join('contracts as c', function joinContract() {
        this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
      })
      .where({
        'cc.tenant': tenant,
        'cc.client_contract_id': clientContractId,
        'cc.is_active': true,
      })
      .select([
        'cc.client_contract_id',
        'cc.client_id',
        'cc.contract_id',
        'cc.start_date',
        'cc.end_date',
        'cc.status',
        'cc.created_draft_contract_id',
        ...(hasTemplateContractIdColumn ? ['cc.template_contract_id'] : []),
        'cc.renewal_mode',
        'cc.notice_period_days',
        'cc.renewal_term_months',
        'cc.use_tenant_renewal_defaults',
        'c.contract_name',
        'c.contract_description',
        'c.billing_frequency',
        'c.currency_code',
      ])
      .first();

    if (!source) {
      throw new Error('Renewal work item not found');
    }

    const currentStatus = toRenewalWorkItemStatus((source as any).status);
    if (currentStatus !== 'pending' && currentStatus !== 'renewing') {
      throw new Error(`Renewal draft can only be created for pending or renewing work items (current: ${currentStatus})`);
    }

    if (typeof (source as any).created_draft_contract_id === 'string' && (source as any).created_draft_contract_id.length > 0) {
      const existingDraft = await trx('contracts')
        .where({
          tenant,
          contract_id: (source as any).created_draft_contract_id,
          status: 'draft',
        })
        .first('contract_id');

      if (existingDraft) {
        const existingDraftAssignment = await trx('client_contracts')
          .where({
            tenant,
            contract_id: existingDraft.contract_id,
          })
          .first('client_contract_id');

        return {
          client_contract_id: clientContractId,
          created_draft_contract_id: existingDraft.contract_id,
          draft_client_contract_id: existingDraftAssignment?.client_contract_id ?? '',
        };
      }
    }

    const nowIso = new Date().toISOString();
    const draftContractId = randomUUID();
    const draftClientContractId = randomUUID();

    await trx('contracts').insert({
      tenant,
      contract_id: draftContractId,
      contract_name: `${(source as any).contract_name ?? (source as any).contract_id} (Renewal Draft)`,
      contract_description: (source as any).contract_description ?? null,
      billing_frequency: (source as any).billing_frequency ?? 'monthly',
      currency_code: (source as any).currency_code ?? 'USD',
      is_active: false,
      status: 'draft',
      is_template: false,
      created_at: nowIso,
      updated_at: nowIso,
    });

    const clientContractInsert: Record<string, unknown> = {
      tenant,
      client_contract_id: draftClientContractId,
      client_id: (source as any).client_id,
      contract_id: draftContractId,
      start_date: (source as any).end_date ?? (source as any).start_date,
      end_date: (source as any).end_date ?? null,
      is_active: false,
      created_at: nowIso,
      updated_at: nowIso,
      po_required: false,
      po_number: null,
      po_amount: null,
    };

    if (hasTemplateContractIdColumn) {
      clientContractInsert.template_contract_id = (source as any).template_contract_id ?? null;
    }
    clientContractInsert.renewal_mode = (source as any).renewal_mode ?? null;
    clientContractInsert.notice_period_days = (source as any).notice_period_days ?? null;
    clientContractInsert.renewal_term_months = (source as any).renewal_term_months ?? null;
    clientContractInsert.use_tenant_renewal_defaults = (source as any).use_tenant_renewal_defaults ?? true;

    await trx('client_contracts').insert(clientContractInsert);

    const sourceWorkItemUpdate: Record<string, unknown> = {
      updated_at: nowIso,
    };
    sourceWorkItemUpdate.created_draft_contract_id = draftContractId;

    await trx('client_contracts')
      .where({
        tenant,
        client_contract_id: clientContractId,
      })
      .update(
        withActionTimestamp(
          withActionNote(
            withActionActor(
              withActionLabel(sourceWorkItemUpdate, 'create_renewal_draft'), actorUserId
            ), normalizedNote
          ), nowIso
        )
      );

    return {
      client_contract_id: clientContractId,
      created_draft_contract_id: draftContractId,
      draft_client_contract_id: draftClientContractId,
    };
  });
});

export const snoozeRenewalQueueItem = withAuth(async (
  user,
  { tenant },
  clientContractId: string,
  snoozedUntil: string,
  note?: string
): Promise<RenewalSnoozeResult> => {
  requireBillingUpdatePermission(user);

  if (typeof clientContractId !== 'string' || clientContractId.trim().length === 0) {
    throw new Error('Client contract id is required');
  }
  if (typeof snoozedUntil !== 'string' || snoozedUntil.trim().length === 0) {
    throw new Error('Snooze target date is required');
  }

  const { knex } = await createTenantKnex();
  await assertRenewalSchemaReady(knex);
  const actorUserId = resolveActorUserId(user);
  const normalizedNote = normalizeActionNote(note);

  const normalizedSnoozedUntil = snoozedUntil.trim().slice(0, 10);
  const parsedSnoozeDate = new Date(normalizedSnoozedUntil);
  if (Number.isNaN(parsedSnoozeDate.getTime())) {
    throw new Error('Snooze target date is invalid');
  }
  if (normalizedSnoozedUntil <= getTodayDateOnly()) {
    throw new Error('Snooze target date must be in the future');
  }

  return knex.transaction(async (trx) => {
    const row = await trx('client_contracts')
      .where({
        tenant,
        client_contract_id: clientContractId,
        is_active: true,
      })
      .select('client_contract_id', 'status')
      .first();

    if (!row) {
      throw new Error('Renewal work item not found');
    }

    const previousStatus = toRenewalWorkItemStatus((row as any).status);
    if (previousStatus === 'completed' || previousStatus === 'non_renewing') {
      throw new Error(`Cannot snooze renewal work item from status ${previousStatus}`);
    }

    const updatedAt = new Date().toISOString();
    await trx('client_contracts')
      .where({
        tenant,
        client_contract_id: clientContractId,
      })
      .update(
        withActionTimestamp(
          withActionNote(
            withActionActor(
              withActionLabel({
                status: 'snoozed',
                snoozed_until: normalizedSnoozedUntil,
                updated_at: updatedAt,
              }, 'snooze'), actorUserId
            ), normalizedNote
          ), updatedAt
        )
      );

    return {
      client_contract_id: clientContractId,
      previous_status: previousStatus,
      status: 'snoozed',
      updated_at: updatedAt,
      snoozed_until: normalizedSnoozedUntil,
    };
  });
});

export const assignRenewalQueueItemOwner = withAuth(async (
  user,
  { tenant },
  clientContractId: string,
  assignedTo: string | null,
  note?: string
): Promise<RenewalAssignmentResult> => {
  requireBillingUpdatePermission(user);

  if (typeof clientContractId !== 'string' || clientContractId.trim().length === 0) {
    throw new Error('Client contract id is required');
  }
  if (assignedTo !== null && typeof assignedTo !== 'string') {
    throw new Error('Assigned owner must be a user id string or null');
  }

  const { knex } = await createTenantKnex();
  await assertRenewalSchemaReady(knex);
  const actorUserId = resolveActorUserId(user);
  const normalizedNote = normalizeActionNote(note);

  const normalizedAssignedTo = typeof assignedTo === 'string' && assignedTo.trim().length > 0
    ? assignedTo.trim()
    : null;

  return knex.transaction(async (trx) => {
    if (normalizedAssignedTo) {
      const ownerInTenant = await trx('users')
        .where({
          tenant,
          user_id: normalizedAssignedTo,
        })
        .first('user_id');
      if (!ownerInTenant) {
        const ownerInAnotherTenant = await trx('users')
          .where({ user_id: normalizedAssignedTo })
          .whereNot({ tenant })
          .first('user_id');
        if (ownerInAnotherTenant) {
          throw new Error('Cross-tenant owner identifier is not allowed');
        }
        throw new Error('Assigned owner was not found in this tenant');
      }
    }

    const row = await trx('client_contracts')
      .where({
        tenant,
        client_contract_id: clientContractId,
        is_active: true,
      })
      .select('client_contract_id', 'status')
      .first();

    if (!row) {
      throw new Error('Renewal work item not found');
    }

    const currentStatus = toRenewalWorkItemStatus((row as any).status);
    const updatedAt = new Date().toISOString();
    await trx('client_contracts')
      .where({
        tenant,
        client_contract_id: clientContractId,
      })
      .update(
        withActionTimestamp(
          withActionNote(
            withActionActor(
              withActionLabel({
                assigned_to: normalizedAssignedTo,
                updated_at: updatedAt,
              }, 'assign_owner'), actorUserId
            ), normalizedNote
          ), updatedAt
        )
      );

    return {
      client_contract_id: clientContractId,
      status: currentStatus,
      assigned_to: normalizedAssignedTo,
      updated_at: updatedAt,
    };
  });
});

export const completeRenewalQueueItemForActivation = withAuth(async (
  user,
  { tenant },
  clientContractId: string,
  activatedContractId?: string,
  note?: string
): Promise<RenewalCompletionResult> => {
  requireBillingUpdatePermission(user);

  if (typeof clientContractId !== 'string' || clientContractId.trim().length === 0) {
    throw new Error('Client contract id is required');
  }

  const { knex } = await createTenantKnex();
  await assertRenewalSchemaReady(knex);
  const actorUserId = resolveActorUserId(user);
  const normalizedNote = normalizeActionNote(note);

  return knex.transaction(async (trx) => {
    const sourceRow = await trx('client_contracts')
      .where({
        tenant,
        client_contract_id: clientContractId,
        is_active: true,
      })
      .select([
        'client_contract_id',
        'status',
        'created_draft_contract_id',
      ])
      .first();

    if (!sourceRow) {
      throw new Error('Renewal work item not found');
    }

    const previousStatus = toRenewalWorkItemStatus((sourceRow as any).status);
    if (previousStatus !== 'renewing') {
      throw new Error(`Only renewing work items can be completed after activation (current: ${previousStatus})`);
    }

    const resolvedActivatedContractId =
      typeof activatedContractId === 'string' && activatedContractId.trim().length > 0
        ? activatedContractId.trim()
        : (sourceRow as any).created_draft_contract_id;

    if (typeof resolvedActivatedContractId !== 'string' || resolvedActivatedContractId.length === 0) {
      throw new Error('Activated renewal contract id is required');
    }

    const crossTenantActivatedContract = await trx('contracts')
      .where({
        contract_id: resolvedActivatedContractId,
      })
      .whereNot({
        tenant,
      })
      .first('contract_id');
    if (crossTenantActivatedContract) {
      throw new Error('Cross-tenant activated contract identifier is not allowed');
    }

    const activeRenewalContract = await trx('contracts')
      .where({
        tenant,
        contract_id: resolvedActivatedContractId,
        status: 'active',
      })
      .first('contract_id');

    if (!activeRenewalContract) {
      throw new Error('Activated renewal contract was not found in active status');
    }

    const updatedAt = new Date().toISOString();
    await trx('client_contracts')
      .where({
        tenant,
        client_contract_id: clientContractId,
      })
      .update(
        withActionTimestamp(
          withActionNote(
            withActionActor(
              withActionLabel({
                status: 'completed',
                updated_at: updatedAt,
              }, 'complete_after_activation'), actorUserId
            ), normalizedNote
          ), updatedAt
        )
      );

    return {
      client_contract_id: clientContractId,
      previous_status: previousStatus,
      status: 'completed',
      updated_at: updatedAt,
      activated_contract_id: resolvedActivatedContractId,
    };
  });
});

export const completeRenewalQueueItemForNonRenewal = withAuth(async (
  user,
  { tenant },
  clientContractId: string,
  note?: string
): Promise<RenewalQueueMutationResult> => {
  requireBillingUpdatePermission(user);

  if (typeof clientContractId !== 'string' || clientContractId.trim().length === 0) {
    throw new Error('Client contract id is required');
  }

  const { knex } = await createTenantKnex();
  await assertRenewalSchemaReady(knex);
  const actorUserId = resolveActorUserId(user);
  const normalizedNote = normalizeActionNote(note);

  return knex.transaction(async (trx) => {
    const sourceRow = await trx('client_contracts')
      .where({
        tenant,
        client_contract_id: clientContractId,
        is_active: true,
      })
      .select('client_contract_id', 'status')
      .first();

    if (!sourceRow) {
      throw new Error('Renewal work item not found');
    }

    const previousStatus = toRenewalWorkItemStatus((sourceRow as any).status);
    if (previousStatus !== 'non_renewing') {
      throw new Error(`Only non_renewing work items can be completed after non-renewal finalization (current: ${previousStatus})`);
    }

    const updatedAt = new Date().toISOString();
    await trx('client_contracts')
      .where({
        tenant,
        client_contract_id: clientContractId,
      })
      .update(
        withActionTimestamp(
          withActionNote(
            withActionActor(
              withActionLabel({
                status: 'completed',
                updated_at: updatedAt,
              }, 'complete_after_non_renewal'), actorUserId
            ), normalizedNote
          ), updatedAt
        )
      );

    return {
      client_contract_id: clientContractId,
      previous_status: previousStatus,
      status: 'completed',
      updated_at: updatedAt,
    };
  });
});

export const retryRenewalQueueTicketCreation = withAuth(async (
  user,
  { tenant },
  clientContractId: string
): Promise<RenewalTicketRetryResult> => {
  requireBillingUpdatePermission(user);

  if (typeof clientContractId !== 'string' || clientContractId.trim().length === 0) {
    throw new Error('Client contract id is required');
  }

  const { knex } = await createTenantKnex();
  await assertRenewalSchemaReady(knex);

  return knex.transaction(async (trx) => {
    const defaultSelections: string[] = [
      'dbs.renewal_due_date_action_policy as tenant_renewal_due_date_action_policy',
      'dbs.renewal_ticket_board_id as tenant_renewal_ticket_board_id',
      'dbs.renewal_ticket_status_id as tenant_renewal_ticket_status_id',
      'dbs.renewal_ticket_priority as tenant_renewal_ticket_priority',
      'dbs.renewal_ticket_assignee_id as tenant_renewal_ticket_assignee_id',
    ];

    let rowQuery = trx('client_contracts as cc')
      .leftJoin('contracts as c', function joinContracts() {
        this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
      })
      .leftJoin('clients as cl', function joinClients() {
        this.on('cc.client_id', '=', 'cl.client_id').andOn('cc.tenant', '=', 'cl.tenant');
      })
      .where({
        'cc.tenant': tenant,
        'cc.client_contract_id': clientContractId,
        'cc.is_active': true,
        'c.status': 'active',
      })
      .select([
        'cc.*',
        'c.contract_name',
        'c.status as contract_status',
        'cl.client_name',
        ...defaultSelections,
      ]);

    rowQuery = rowQuery.leftJoin('default_billing_settings as dbs', function joinDefaults() {
      this.on('cc.tenant', '=', 'dbs.tenant');
    });

    const sourceRow = await rowQuery.first();
    if (!sourceRow) {
      throw new Error('Renewal work item not found');
    }

    const existingTicketId = normalizeOptionalUuid((sourceRow as any).created_ticket_id);
    if (existingTicketId) {
      return {
        client_contract_id: clientContractId,
        created_ticket_id: existingTicketId,
        automation_error: null,
        retried: false,
      };
    }

    const normalized = normalizeClientContract(sourceRow as any) as unknown as Record<string, unknown>;
    const decisionDueDate = typeof normalized.decision_due_date === 'string' ? normalized.decision_due_date : null;
    if (!decisionDueDate || decisionDueDate > getTodayDateOnly()) {
      throw new Error('Manual retry is only available for due renewal cycles');
    }

    const useTenantRenewalDefaults = (sourceRow as any).use_tenant_renewal_defaults !== false;
    const tenantPolicy = resolveRenewalDueDateActionPolicy((sourceRow as any).tenant_renewal_due_date_action_policy);
    const contractPolicy = resolveOptionalRenewalDueDateActionPolicy((sourceRow as any).renewal_due_date_action_policy);
    const effectivePolicy = useTenantRenewalDefaults ? tenantPolicy : (contractPolicy ?? tenantPolicy);

    if (effectivePolicy !== 'create_ticket') {
      return {
        client_contract_id: clientContractId,
        created_ticket_id: null,
        automation_error: null,
        retried: false,
      };
    }

    const tenantBoardId = normalizeOptionalUuid((sourceRow as any).tenant_renewal_ticket_board_id);
    const tenantStatusId = normalizeOptionalUuid((sourceRow as any).tenant_renewal_ticket_status_id);
    const tenantPriorityId = normalizeOptionalUuid((sourceRow as any).tenant_renewal_ticket_priority);
    const tenantAssignedTo = normalizeOptionalUuid((sourceRow as any).tenant_renewal_ticket_assignee_id);
    const contractBoardId = normalizeOptionalUuid((sourceRow as any).renewal_ticket_board_id);
    const contractStatusId = normalizeOptionalUuid((sourceRow as any).renewal_ticket_status_id);
    const contractPriorityId = normalizeOptionalUuid((sourceRow as any).renewal_ticket_priority);
    const contractAssignedTo = normalizeOptionalUuid((sourceRow as any).renewal_ticket_assignee_id);

    const boardId = useTenantRenewalDefaults ? tenantBoardId : (contractBoardId ?? tenantBoardId);
    const statusId = useTenantRenewalDefaults ? tenantStatusId : (contractStatusId ?? tenantStatusId);
    const priorityId = useTenantRenewalDefaults ? tenantPriorityId : (contractPriorityId ?? tenantPriorityId);
    const assignedTo = useTenantRenewalDefaults ? tenantAssignedTo : (contractAssignedTo ?? tenantAssignedTo);
    const clientId = normalizeOptionalUuid((sourceRow as any).client_id);

    if (!clientId || !boardId || !statusId || !priorityId) {
      const missingDefaultsError = 'Missing renewal ticket routing defaults for create_ticket policy';
      await trx('client_contracts')
        .where({ tenant, client_contract_id: clientContractId })
        .update({ automation_error: missingDefaultsError, updated_at: new Date().toISOString() });
      return {
        client_contract_id: clientContractId,
        created_ticket_id: null,
        automation_error: missingDefaultsError,
        retried: false,
      };
    }

    const cycleKey = typeof normalized.renewal_cycle_key === 'string' && normalized.renewal_cycle_key.length > 0
      ? normalized.renewal_cycle_key
      : decisionDueDate;
    const idempotencyKey = buildRenewalTicketIdempotencyKey({
      tenantId: tenant,
      clientContractId,
      cycleKey,
    });
    const existingIdempotentTicket = await trx('tickets')
      .where({ tenant })
      .whereRaw("(attributes::jsonb ->> 'idempotency_key') = ?", [idempotencyKey])
      .first('ticket_id');
    const idempotentTicketId = normalizeOptionalUuid(existingIdempotentTicket?.ticket_id);

    if (idempotentTicketId) {
      await trx('client_contracts')
        .where({ tenant, client_contract_id: clientContractId })
        .update({
          created_ticket_id: idempotentTicketId,
          automation_error: null,
          updated_at: new Date().toISOString(),
        });
      return {
        client_contract_id: clientContractId,
        created_ticket_id: idempotentTicketId,
        automation_error: null,
        retried: true,
      };
    }

    const title = buildRenewalTicketTitle(sourceRow as Record<string, unknown>, decisionDueDate);
    const description = buildRenewalTicketDescription(sourceRow as Record<string, unknown>, normalized, decisionDueDate);

    try {
      const createdTicket = await TicketModel.createTicketWithRetry(
        {
          title,
          description,
          client_id: clientId,
          board_id: boardId,
          status_id: statusId,
          priority_id: priorityId,
          assigned_to: assignedTo ?? undefined,
          source: RENEWAL_TICKET_SOURCE,
          attributes: {
            renewal_cycle_key: cycleKey,
            decision_due_date: decisionDueDate,
            source_client_contract_id: clientContractId,
            idempotency_key: idempotencyKey,
          },
        },
        tenant,
        trx
      );

      await trx('client_contracts')
        .where({ tenant, client_contract_id: clientContractId })
        .update({
          created_ticket_id: createdTicket.ticket_id,
          automation_error: null,
          updated_at: new Date().toISOString(),
        });

      return {
        client_contract_id: clientContractId,
        created_ticket_id: createdTicket.ticket_id,
        automation_error: null,
        retried: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await trx('client_contracts')
        .where({ tenant, client_contract_id: clientContractId })
        .update({
          automation_error: errorMessage,
          updated_at: new Date().toISOString(),
        });

      return {
        client_contract_id: clientContractId,
        created_ticket_id: null,
        automation_error: errorMessage,
        retried: true,
      };
    }
  });
});
