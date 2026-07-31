'use server'

import { createTenantKnex, tenantDb, withTransaction } from "@alga-psa/db";
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { actionError, permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionMessageError, ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { assertBoardScopedTicketStatusSelection } from '@shared/lib/boardScopedTicketStatusValidation';
import { CONTRACT_CADENCE_ROLLOUT_BLOCK_MESSAGE } from '@shared/billingClients/cadenceOwnerRollout';
import { updateClientBillingSettings as updateClientBillingSettingsShared } from '@shared/billingClients/billingSettings';
import type { CadenceOwner } from '@alga-psa/types';

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  tenant: string,
  table: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

type RenewalMode = 'none' | 'manual' | 'auto';
type RenewalDueDateActionPolicy = 'queue_only' | 'create_ticket';
type RecurringCadenceRolloutState = 'mixed_enabled';

const DEFAULT_RENEWAL_MODE: RenewalMode = 'manual';
const DEFAULT_NOTICE_PERIOD_DAYS = 30;
const DEFAULT_RENEWAL_DUE_DATE_ACTION_POLICY: RenewalDueDateActionPolicy = 'create_ticket';
const DEFAULT_RECURRING_CADENCE_OWNER: CadenceOwner = 'client';
const DEFAULT_RECURRING_CADENCE_ROLLOUT_STATE: RecurringCadenceRolloutState = 'mixed_enabled';
type BillingSettingsActionError = ActionMessageError | ActionPermissionError;
const requireBillingSettingsUpdatePermission = async (user: unknown): Promise<ActionPermissionError | null> => {
  if (!await hasPermission(user as any, 'billing_settings', 'update')) {
    return permissionError('Permission denied: Cannot update billing settings');
  }
  return null;
};

export interface BillingSettings {
  zeroDollarInvoiceHandling: 'normal' | 'finalized';
  suppressZeroDollarInvoices: boolean;
  defaultCurrencyCode?: string;
  enableCreditExpiration?: boolean;
  creditExpirationDays?: number;
  creditExpirationNotificationDays?: number[];
  /** The customer holds a credit balance in the external accounting system (e.g. QBO). */
  hasExternalCredit?: boolean;
  /** Free-text shown alongside the flag (e.g. "Paid through Dec 2026 by check"). */
  externalCreditNote?: string | null;
  defaultRenewalMode?: RenewalMode;
  defaultNoticePeriodDays?: number;
  renewalDueDateActionPolicy?: RenewalDueDateActionPolicy;
  renewalTicketBoardId?: string;
  renewalTicketStatusId?: string;
  renewalTicketPriority?: string;
  renewalTicketAssigneeId?: string;
  defaultRecurringCadenceOwner?: CadenceOwner;
  recurringCadenceRolloutState?: RecurringCadenceRolloutState;
  recurringCadenceRolloutMessage?: string;
}

export const getDefaultBillingSettings = withAuth(async (
  user,
  { tenant }
): Promise<BillingSettings | BillingSettingsActionError> => {
  if (!await hasPermission(user as any, 'billing_settings', 'read')) {
    return permissionError('Permission denied: Cannot read billing settings');
  }
  const { knex } = await createTenantKnex();

  const settings = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await tenantScopedTable(trx, tenant, 'default_billing_settings')
      .first();
  });

  if (!settings) {
    // Return default settings if none exist
    return {
      zeroDollarInvoiceHandling: 'normal',
      suppressZeroDollarInvoices: false,
      defaultCurrencyCode: 'USD',
      enableCreditExpiration: true,
      creditExpirationDays: 365,
      creditExpirationNotificationDays: [30, 7, 1],
      defaultRenewalMode: DEFAULT_RENEWAL_MODE,
      defaultNoticePeriodDays: DEFAULT_NOTICE_PERIOD_DAYS,
      renewalDueDateActionPolicy: DEFAULT_RENEWAL_DUE_DATE_ACTION_POLICY,
      renewalTicketBoardId: undefined,
      renewalTicketStatusId: undefined,
      renewalTicketPriority: undefined,
      renewalTicketAssigneeId: undefined,
      defaultRecurringCadenceOwner: DEFAULT_RECURRING_CADENCE_OWNER,
      recurringCadenceRolloutState: DEFAULT_RECURRING_CADENCE_ROLLOUT_STATE,
      recurringCadenceRolloutMessage: CONTRACT_CADENCE_ROLLOUT_BLOCK_MESSAGE,
    };
  }

  const renewalMode =
    settings.default_renewal_mode === 'none' ||
    settings.default_renewal_mode === 'manual' ||
    settings.default_renewal_mode === 'auto'
      ? settings.default_renewal_mode
      : DEFAULT_RENEWAL_MODE;

  const renewalDueDateActionPolicy =
    settings.renewal_due_date_action_policy === 'queue_only' ||
    settings.renewal_due_date_action_policy === 'create_ticket'
      ? settings.renewal_due_date_action_policy
      : DEFAULT_RENEWAL_DUE_DATE_ACTION_POLICY;

  return {
    zeroDollarInvoiceHandling: settings.zero_dollar_invoice_handling,
    suppressZeroDollarInvoices: settings.suppress_zero_dollar_invoices,
    defaultCurrencyCode: settings.default_currency_code ?? 'USD',
    enableCreditExpiration: settings.enable_credit_expiration ?? true,
    creditExpirationDays: settings.credit_expiration_days ?? 365,
    creditExpirationNotificationDays: settings.credit_expiration_notification_days ?? [30, 7, 1],
    defaultRenewalMode: renewalMode,
    defaultNoticePeriodDays: settings.default_notice_period_days ?? DEFAULT_NOTICE_PERIOD_DAYS,
    renewalDueDateActionPolicy,
    renewalTicketBoardId: settings.renewal_ticket_board_id ?? undefined,
    renewalTicketStatusId: settings.renewal_ticket_status_id ?? undefined,
    renewalTicketPriority: settings.renewal_ticket_priority ?? undefined,
    renewalTicketAssigneeId: settings.renewal_ticket_assignee_id ?? undefined,
    defaultRecurringCadenceOwner: DEFAULT_RECURRING_CADENCE_OWNER,
    recurringCadenceRolloutState: DEFAULT_RECURRING_CADENCE_ROLLOUT_STATE,
    recurringCadenceRolloutMessage: CONTRACT_CADENCE_ROLLOUT_BLOCK_MESSAGE,
  };
});

export const updateDefaultBillingSettings = withAuth(async (
  user,
  { tenant },
  data: Partial<BillingSettings>
): Promise<{ success: boolean } | BillingSettingsActionError> => {
  const denied = await requireBillingSettingsUpdatePermission(user);
  if (denied) return denied;

  const { knex } = await createTenantKnex();
  // The billing settings page's sections save independently against this one
  // row; only keys present in `data` are written, so one section's save can't
  // clobber another section's just-saved values with its stale snapshot.
  const has = (key: keyof BillingSettings) => Object.prototype.hasOwnProperty.call(data, key);

  try {
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      const existingSettings = await tenantScopedTable(trx, tenant, 'default_billing_settings')
        .first();

    if (has('renewalTicketBoardId') || has('renewalTicketStatusId')) {
      await assertBoardScopedTicketStatusSelection({
        trx,
        tenant,
        boardId: (has('renewalTicketBoardId') ? data.renewalTicketBoardId : existingSettings?.renewal_ticket_board_id) ?? null,
        statusId: (has('renewalTicketStatusId') ? data.renewalTicketStatusId : existingSettings?.renewal_ticket_status_id) ?? null,
        statusLabel: 'Renewal ticket status',
      });
    }

    const renewalMode =
      data.defaultRenewalMode === 'none' ||
      data.defaultRenewalMode === 'manual' ||
      data.defaultRenewalMode === 'auto'
        ? data.defaultRenewalMode
        : DEFAULT_RENEWAL_MODE;

    const noticePeriodDays =
      Number.isInteger(data.defaultNoticePeriodDays) && (data.defaultNoticePeriodDays as number) >= 0
        ? data.defaultNoticePeriodDays
        : DEFAULT_NOTICE_PERIOD_DAYS;

    const renewalDueDateActionPolicy =
      data.renewalDueDateActionPolicy === 'queue_only' ||
      data.renewalDueDateActionPolicy === 'create_ticket'
        ? data.renewalDueDateActionPolicy
        : DEFAULT_RENEWAL_DUE_DATE_ACTION_POLICY;

    const columnValues: Record<string, unknown> = {};
    if (has('defaultCurrencyCode')) columnValues.default_currency_code = data.defaultCurrencyCode || 'USD';
    if (has('defaultRenewalMode')) columnValues.default_renewal_mode = renewalMode;
    if (has('defaultNoticePeriodDays')) columnValues.default_notice_period_days = noticePeriodDays;
    if (has('renewalDueDateActionPolicy')) columnValues.renewal_due_date_action_policy = renewalDueDateActionPolicy;
    if (has('renewalTicketBoardId')) columnValues.renewal_ticket_board_id = data.renewalTicketBoardId ?? null;
    if (has('renewalTicketStatusId')) columnValues.renewal_ticket_status_id = data.renewalTicketStatusId ?? null;
    if (has('renewalTicketPriority')) columnValues.renewal_ticket_priority = data.renewalTicketPriority ?? null;
    if (has('renewalTicketAssigneeId')) columnValues.renewal_ticket_assignee_id = data.renewalTicketAssigneeId ?? null;
    if (has('zeroDollarInvoiceHandling')) columnValues.zero_dollar_invoice_handling = data.zeroDollarInvoiceHandling;
    if (has('suppressZeroDollarInvoices')) columnValues.suppress_zero_dollar_invoices = data.suppressZeroDollarInvoices;
    if (has('enableCreditExpiration')) columnValues.enable_credit_expiration = data.enableCreditExpiration;
    if (has('creditExpirationDays')) columnValues.credit_expiration_days = data.creditExpirationDays;
    if (has('creditExpirationNotificationDays')) columnValues.credit_expiration_notification_days = data.creditExpirationNotificationDays;

    if (existingSettings) {
      if (Object.keys(columnValues).length === 0) return;
      return await tenantScopedTable(trx, tenant, 'default_billing_settings')
        .update({
          ...columnValues,
          updated_at: trx.fn.now()
        });
    } else {
      return await tenantScopedTable(trx, tenant, 'default_billing_settings').insert({
        tenant,
        zero_dollar_invoice_handling: data.zeroDollarInvoiceHandling ?? 'normal',
        suppress_zero_dollar_invoices: data.suppressZeroDollarInvoices ?? false,
        enable_credit_expiration: data.enableCreditExpiration ?? true,
        credit_expiration_days: data.creditExpirationDays ?? 365,
        credit_expiration_notification_days: data.creditExpirationNotificationDays ?? [30, 7, 1],
        default_currency_code: data.defaultCurrencyCode || 'USD',
        default_renewal_mode: renewalMode,
        default_notice_period_days: noticePeriodDays,
        renewal_due_date_action_policy: renewalDueDateActionPolicy,
        renewal_ticket_board_id: data.renewalTicketBoardId ?? null,
        renewal_ticket_status_id: data.renewalTicketStatusId ?? null,
        renewal_ticket_priority: data.renewalTicketPriority ?? null,
        renewal_ticket_assignee_id: data.renewalTicketAssigneeId ?? null,
      });
    }
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'BoardScopedTicketStatusSelectionError') {
      return actionError(error.message);
    }
    throw error;
  }

  return { success: true };
});

export const getClientContractLineSettings = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<BillingSettings | null | BillingSettingsActionError> => {
  if (!await hasPermission(user as any, 'billing_settings', 'read')) {
    return permissionError('Permission denied: Cannot read client billing settings');
  }
  const { knex } = await createTenantKnex();

  const settings = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await tenantScopedTable(trx, tenant, 'client_billing_settings')
      .where({
        client_id: clientId
      })
      .first();
  });

  if (!settings) {
    return null;
  }

  return {
    zeroDollarInvoiceHandling: settings.zero_dollar_invoice_handling,
    suppressZeroDollarInvoices: settings.suppress_zero_dollar_invoices,
    enableCreditExpiration: settings.enable_credit_expiration,
    creditExpirationDays: settings.credit_expiration_days,
    creditExpirationNotificationDays: settings.credit_expiration_notification_days,
    hasExternalCredit: settings.has_external_credit,
    externalCreditNote: settings.external_credit_note,
    defaultRecurringCadenceOwner: DEFAULT_RECURRING_CADENCE_OWNER,
    recurringCadenceRolloutState: DEFAULT_RECURRING_CADENCE_ROLLOUT_STATE,
    recurringCadenceRolloutMessage: CONTRACT_CADENCE_ROLLOUT_BLOCK_MESSAGE,
  };
});

export const updateClientContractLineSettings = withAuth(async (
  user,
  { tenant },
  clientId: string,
  data: BillingSettings | null // null to remove override
): Promise<{ success: boolean } | BillingSettingsActionError> => {
  if (!await hasPermission(user as any, 'billing_settings', 'update')) {
    return permissionError('Permission denied: Cannot update client billing settings');
  }
  const { knex } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await updateClientBillingSettingsShared(
      trx,
      tenant,
      clientId,
      data
        ? {
            zeroDollarInvoiceHandling: data.zeroDollarInvoiceHandling,
            suppressZeroDollarInvoices: data.suppressZeroDollarInvoices,
            enableCreditExpiration: data.enableCreditExpiration,
            creditExpirationDays: data.creditExpirationDays,
            creditExpirationNotificationDays: data.creditExpirationNotificationDays,
            hasExternalCredit: data.hasExternalCredit,
            externalCreditNote: data.externalCreditNote,
          }
        : null
    );
  });

  return { success: true };
});
