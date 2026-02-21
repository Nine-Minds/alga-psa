'use server';

import { randomUUID } from 'node:crypto';
import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import type { RenewalWorkItemStatus } from '@alga-psa/types';
import { normalizeClientContract } from '@alga-psa/shared/billingClients/clientContracts';

const DEFAULT_RENEWALS_HORIZON_DAYS = 90;
const RENEWAL_WORK_ITEM_STATUSES: RenewalWorkItemStatus[] = [
  'pending',
  'renewing',
  'non_renewing',
  'snoozed',
  'completed',
];

const isRenewalWorkItemStatus = (value: unknown): value is RenewalWorkItemStatus =>
  typeof value === 'string' && RENEWAL_WORK_ITEM_STATUSES.includes(value as RenewalWorkItemStatus);
const toRenewalWorkItemStatus = (value: unknown): RenewalWorkItemStatus =>
  isRenewalWorkItemStatus(value) ? value : 'pending';
const getTodayDateOnly = (): string => new Date().toISOString().slice(0, 10);
const resolveActorUserId = (user: unknown): string | null => {
  const candidate = (user as { user_id?: unknown } | null | undefined)?.user_id;
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
};
const withActionActor = (
  updateData: Record<string, unknown>,
  hasLastActionByColumn: boolean,
  actorUserId: string | null
): Record<string, unknown> => (
  hasLastActionByColumn
    ? { ...updateData, last_action_by: actorUserId }
    : updateData
);
const withActionTimestamp = (
  updateData: Record<string, unknown>,
  hasLastActionAtColumn: boolean,
  actionAt: string
): Record<string, unknown> => (
  hasLastActionAtColumn
    ? { ...updateData, last_action_at: actionAt }
    : updateData
);
const normalizeActionNote = (note: string | null | undefined): string | null => {
  if (typeof note !== 'string') {
    return null;
  }
  const trimmed = note.trim();
  return trimmed.length > 0 ? trimmed : null;
};
const withActionNote = (
  updateData: Record<string, unknown>,
  hasLastActionNoteColumn: boolean,
  note: string | null
): Record<string, unknown> => (
  hasLastActionNoteColumn && note
    ? { ...updateData, last_action_note: note }
    : updateData
);

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
  created_draft_contract_id?: string | null;
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

const getAvailableActionsForStatus = (status: RenewalWorkItemStatus): RenewalQueueAction[] => {
  if (status === 'pending') {
    return ['mark_renewing', 'mark_non_renewing', 'create_renewal_draft', 'snooze', 'assign_owner'];
  }
  if (status === 'renewing') {
    return ['create_renewal_draft', 'snooze', 'assign_owner'];
  }
  if (status === 'snoozed') {
    return ['mark_renewing', 'mark_non_renewing', 'create_renewal_draft', 'assign_owner'];
  }
  return ['assign_owner'];
};

export const listRenewalQueueRows = withAuth(async (
  _user,
  { tenant },
  horizonDays: number = DEFAULT_RENEWALS_HORIZON_DAYS
): Promise<RenewalQueueRow[]> => {
  const { knex } = await createTenantKnex();
  const resolvedHorizonDays =
    Number.isInteger(horizonDays) && horizonDays > 0
      ? Math.trunc(horizonDays)
      : DEFAULT_RENEWALS_HORIZON_DAYS;

  const schema = knex.schema as any;
  const [
    hasDefaultRenewalModeColumn,
    hasDefaultNoticePeriodColumn,
    hasStatusColumn,
    hasSnoozedUntilColumn,
  ] = await Promise.all([
    schema?.hasColumn?.('default_billing_settings', 'default_renewal_mode') ?? false,
    schema?.hasColumn?.('default_billing_settings', 'default_notice_period_days') ?? false,
    schema?.hasColumn?.('client_contracts', 'status') ?? false,
    schema?.hasColumn?.('client_contracts', 'snoozed_until') ?? false,
  ]);

  if (hasStatusColumn && hasSnoozedUntilColumn) {
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
  }

  const defaultSelections: string[] = [];
  if (hasDefaultRenewalModeColumn) {
    defaultSelections.push('dbs.default_renewal_mode as tenant_default_renewal_mode');
  }
  if (hasDefaultNoticePeriodColumn) {
    defaultSelections.push('dbs.default_notice_period_days as tenant_default_notice_period_days');
  }

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

  if (defaultSelections.length > 0) {
    query = query.leftJoin('default_billing_settings as dbs', function joinDefaultBillingSettings() {
      this.on('cc.tenant', '=', 'dbs.tenant');
    });
  }

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
      created_draft_contract_id: (row as any).created_draft_contract_id ?? null,
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
  if (typeof clientContractId !== 'string' || clientContractId.trim().length === 0) {
    throw new Error('Client contract id is required');
  }

  const { knex } = await createTenantKnex();
  const schema = knex.schema as any;
  const [hasStatusColumn, hasLastActionByColumn, hasLastActionAtColumn, hasLastActionNoteColumn] = await Promise.all([
    schema?.hasColumn?.('client_contracts', 'status') ?? false,
    schema?.hasColumn?.('client_contracts', 'last_action_by') ?? false,
    schema?.hasColumn?.('client_contracts', 'last_action_at') ?? false,
    schema?.hasColumn?.('client_contracts', 'last_action_note') ?? false,
  ]);
  const actorUserId = resolveActorUserId(user);
  const normalizedNote = normalizeActionNote(note);

  if (!hasStatusColumn) {
    throw new Error('Renewals queue status column is not available');
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
    if (previousStatus === 'non_renewing') {
      throw new Error('Cannot transition non_renewing work item to renewing without explicit override action');
    }
    if (previousStatus !== 'pending') {
      throw new Error(`Only pending renewal work items can transition to renewing (current: ${previousStatus})`);
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
            withActionActor({
              status: 'renewing',
              updated_at: updatedAt,
            }, hasLastActionByColumn, actorUserId),
            hasLastActionNoteColumn,
            normalizedNote
          ),
          hasLastActionAtColumn,
          updatedAt
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
  if (typeof clientContractId !== 'string' || clientContractId.trim().length === 0) {
    throw new Error('Client contract id is required');
  }

  const { knex } = await createTenantKnex();
  const schema = knex.schema as any;
  const [hasStatusColumn, hasLastActionByColumn, hasLastActionAtColumn, hasLastActionNoteColumn] = await Promise.all([
    schema?.hasColumn?.('client_contracts', 'status') ?? false,
    schema?.hasColumn?.('client_contracts', 'last_action_by') ?? false,
    schema?.hasColumn?.('client_contracts', 'last_action_at') ?? false,
    schema?.hasColumn?.('client_contracts', 'last_action_note') ?? false,
  ]);
  const actorUserId = resolveActorUserId(user);
  const normalizedNote = normalizeActionNote(note);

  if (!hasStatusColumn) {
    throw new Error('Renewals queue status column is not available');
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
    if (previousStatus !== 'pending') {
      throw new Error(`Only pending renewal work items can transition to non_renewing (current: ${previousStatus})`);
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
            withActionActor({
              status: 'non_renewing',
              updated_at: updatedAt,
            }, hasLastActionByColumn, actorUserId),
            hasLastActionNoteColumn,
            normalizedNote
          ),
          hasLastActionAtColumn,
          updatedAt
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
  if (typeof clientContractId !== 'string' || clientContractId.trim().length === 0) {
    throw new Error('Client contract id is required');
  }

  const { knex } = await createTenantKnex();
  const schema = knex.schema as any;
  const [
    hasStatusColumn,
    hasLastActionByColumn,
    hasLastActionAtColumn,
    hasLastActionNoteColumn,
    hasCreatedDraftColumn,
    hasTemplateContractIdColumn,
    hasRenewalModeColumn,
    hasNoticePeriodColumn,
    hasRenewalTermColumn,
    hasUseTenantDefaultsColumn,
  ] = await Promise.all([
    schema?.hasColumn?.('client_contracts', 'status') ?? false,
    schema?.hasColumn?.('client_contracts', 'last_action_by') ?? false,
    schema?.hasColumn?.('client_contracts', 'last_action_at') ?? false,
    schema?.hasColumn?.('client_contracts', 'last_action_note') ?? false,
    schema?.hasColumn?.('client_contracts', 'created_draft_contract_id') ?? false,
    schema?.hasColumn?.('client_contracts', 'template_contract_id') ?? false,
    schema?.hasColumn?.('client_contracts', 'renewal_mode') ?? false,
    schema?.hasColumn?.('client_contracts', 'notice_period_days') ?? false,
    schema?.hasColumn?.('client_contracts', 'renewal_term_months') ?? false,
    schema?.hasColumn?.('client_contracts', 'use_tenant_renewal_defaults') ?? false,
  ]);
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
        ...(hasStatusColumn ? ['cc.status'] : []),
        ...(hasCreatedDraftColumn ? ['cc.created_draft_contract_id'] : []),
        ...(hasTemplateContractIdColumn ? ['cc.template_contract_id'] : []),
        ...(hasRenewalModeColumn ? ['cc.renewal_mode'] : []),
        ...(hasNoticePeriodColumn ? ['cc.notice_period_days'] : []),
        ...(hasRenewalTermColumn ? ['cc.renewal_term_months'] : []),
        ...(hasUseTenantDefaultsColumn ? ['cc.use_tenant_renewal_defaults'] : []),
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

    if (hasCreatedDraftColumn && typeof (source as any).created_draft_contract_id === 'string' && (source as any).created_draft_contract_id.length > 0) {
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
    if (hasRenewalModeColumn) {
      clientContractInsert.renewal_mode = (source as any).renewal_mode ?? null;
    }
    if (hasNoticePeriodColumn) {
      clientContractInsert.notice_period_days = (source as any).notice_period_days ?? null;
    }
    if (hasRenewalTermColumn) {
      clientContractInsert.renewal_term_months = (source as any).renewal_term_months ?? null;
    }
    if (hasUseTenantDefaultsColumn) {
      clientContractInsert.use_tenant_renewal_defaults = (source as any).use_tenant_renewal_defaults ?? true;
    }

    await trx('client_contracts').insert(clientContractInsert);

    const sourceWorkItemUpdate: Record<string, unknown> = {
      updated_at: nowIso,
    };
    if (hasCreatedDraftColumn) {
      sourceWorkItemUpdate.created_draft_contract_id = draftContractId;
    }

    await trx('client_contracts')
      .where({
        tenant,
        client_contract_id: clientContractId,
      })
      .update(
        withActionTimestamp(
          withActionNote(
            withActionActor(sourceWorkItemUpdate, hasLastActionByColumn, actorUserId),
            hasLastActionNoteColumn,
            normalizedNote
          ),
          hasLastActionAtColumn,
          nowIso
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
  if (typeof clientContractId !== 'string' || clientContractId.trim().length === 0) {
    throw new Error('Client contract id is required');
  }
  if (typeof snoozedUntil !== 'string' || snoozedUntil.trim().length === 0) {
    throw new Error('Snooze target date is required');
  }

  const { knex } = await createTenantKnex();
  const schema = knex.schema as any;
  const [hasStatusColumn, hasSnoozedUntilColumn, hasLastActionByColumn, hasLastActionAtColumn, hasLastActionNoteColumn] = await Promise.all([
    schema?.hasColumn?.('client_contracts', 'status') ?? false,
    schema?.hasColumn?.('client_contracts', 'snoozed_until') ?? false,
    schema?.hasColumn?.('client_contracts', 'last_action_by') ?? false,
    schema?.hasColumn?.('client_contracts', 'last_action_at') ?? false,
    schema?.hasColumn?.('client_contracts', 'last_action_note') ?? false,
  ]);
  const actorUserId = resolveActorUserId(user);
  const normalizedNote = normalizeActionNote(note);

  if (!hasStatusColumn || !hasSnoozedUntilColumn) {
    throw new Error('Renewals queue snooze columns are not available');
  }

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
            withActionActor({
              status: 'snoozed',
              snoozed_until: normalizedSnoozedUntil,
              updated_at: updatedAt,
            }, hasLastActionByColumn, actorUserId),
            hasLastActionNoteColumn,
            normalizedNote
          ),
          hasLastActionAtColumn,
          updatedAt
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
  if (typeof clientContractId !== 'string' || clientContractId.trim().length === 0) {
    throw new Error('Client contract id is required');
  }
  if (assignedTo !== null && typeof assignedTo !== 'string') {
    throw new Error('Assigned owner must be a user id string or null');
  }

  const { knex } = await createTenantKnex();
  const schema = knex.schema as any;
  const [hasStatusColumn, hasAssignedToColumn, hasLastActionByColumn, hasLastActionAtColumn, hasLastActionNoteColumn] = await Promise.all([
    schema?.hasColumn?.('client_contracts', 'status') ?? false,
    schema?.hasColumn?.('client_contracts', 'assigned_to') ?? false,
    schema?.hasColumn?.('client_contracts', 'last_action_by') ?? false,
    schema?.hasColumn?.('client_contracts', 'last_action_at') ?? false,
    schema?.hasColumn?.('client_contracts', 'last_action_note') ?? false,
  ]);
  const actorUserId = resolveActorUserId(user);
  const normalizedNote = normalizeActionNote(note);

  if (!hasStatusColumn || !hasAssignedToColumn) {
    throw new Error('Renewals queue assignment columns are not available');
  }

  const normalizedAssignedTo = typeof assignedTo === 'string' && assignedTo.trim().length > 0
    ? assignedTo.trim()
    : null;

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
            withActionActor({
              assigned_to: normalizedAssignedTo,
              updated_at: updatedAt,
            }, hasLastActionByColumn, actorUserId),
            hasLastActionNoteColumn,
            normalizedNote
          ),
          hasLastActionAtColumn,
          updatedAt
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
