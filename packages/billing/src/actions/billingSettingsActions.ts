'use server'

import { createTenantKnex } from "@alga-psa/db";
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';

type RenewalMode = 'none' | 'manual' | 'auto';
type RenewalDueDateActionPolicy = 'queue_only' | 'create_ticket';

const DEFAULT_RENEWAL_MODE: RenewalMode = 'manual';
const DEFAULT_NOTICE_PERIOD_DAYS = 30;
const DEFAULT_RENEWAL_DUE_DATE_ACTION_POLICY: RenewalDueDateActionPolicy = 'create_ticket';

export interface BillingSettings {
  zeroDollarInvoiceHandling: 'normal' | 'finalized';
  suppressZeroDollarInvoices: boolean;
  enableCreditExpiration?: boolean;
  creditExpirationDays?: number;
  creditExpirationNotificationDays?: number[];
  defaultRenewalMode?: RenewalMode;
  defaultNoticePeriodDays?: number;
  renewalDueDateActionPolicy?: RenewalDueDateActionPolicy;
  renewalTicketBoardId?: string;
  renewalTicketStatusId?: string;
  renewalTicketPriority?: string;
  renewalTicketAssigneeId?: string;
}

export const getDefaultBillingSettings = withAuth(async (
  user,
  { tenant }
): Promise<BillingSettings> => {
  const { knex } = await createTenantKnex();

  const settings = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('default_billing_settings')
      .where({ tenant })
      .first();
  });

  if (!settings) {
    // Return default settings if none exist
    return {
      zeroDollarInvoiceHandling: 'normal',
      suppressZeroDollarInvoices: false,
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
  };
});

export const updateDefaultBillingSettings = withAuth(async (
  user,
  { tenant },
  data: BillingSettings
): Promise<{ success: boolean }> => {
  const { knex } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    const [
      hasDefaultRenewalModeColumn,
      hasDefaultNoticePeriodColumn,
      hasRenewalDueDateActionPolicyColumn,
      hasRenewalTicketBoardColumn,
      hasRenewalTicketStatusColumn,
      hasRenewalTicketPriorityColumn,
      hasRenewalTicketAssigneeColumn,
    ] = await Promise.all([
      trx.schema.hasColumn('default_billing_settings', 'default_renewal_mode'),
      trx.schema.hasColumn('default_billing_settings', 'default_notice_period_days'),
      trx.schema.hasColumn('default_billing_settings', 'renewal_due_date_action_policy'),
      trx.schema.hasColumn('default_billing_settings', 'renewal_ticket_board_id'),
      trx.schema.hasColumn('default_billing_settings', 'renewal_ticket_status_id'),
      trx.schema.hasColumn('default_billing_settings', 'renewal_ticket_priority'),
      trx.schema.hasColumn('default_billing_settings', 'renewal_ticket_assignee_id'),
    ]);

    const existingSettings = await trx('default_billing_settings')
      .where({ tenant })
      .first();

    const renewalUpdates: Record<string, unknown> = {};
    if (hasDefaultRenewalModeColumn) {
      renewalUpdates.default_renewal_mode =
        data.defaultRenewalMode === 'none' ||
        data.defaultRenewalMode === 'manual' ||
        data.defaultRenewalMode === 'auto'
          ? data.defaultRenewalMode
          : DEFAULT_RENEWAL_MODE;
    }
    if (hasDefaultNoticePeriodColumn) {
      renewalUpdates.default_notice_period_days =
        Number.isInteger(data.defaultNoticePeriodDays) && (data.defaultNoticePeriodDays as number) >= 0
          ? data.defaultNoticePeriodDays
          : DEFAULT_NOTICE_PERIOD_DAYS;
    }
    if (hasRenewalDueDateActionPolicyColumn) {
      renewalUpdates.renewal_due_date_action_policy =
        data.renewalDueDateActionPolicy === 'queue_only' ||
        data.renewalDueDateActionPolicy === 'create_ticket'
          ? data.renewalDueDateActionPolicy
          : DEFAULT_RENEWAL_DUE_DATE_ACTION_POLICY;
    }
    if (hasRenewalTicketBoardColumn) {
      renewalUpdates.renewal_ticket_board_id = data.renewalTicketBoardId ?? null;
    }
    if (hasRenewalTicketStatusColumn) {
      renewalUpdates.renewal_ticket_status_id = data.renewalTicketStatusId ?? null;
    }
    if (hasRenewalTicketPriorityColumn) {
      renewalUpdates.renewal_ticket_priority = data.renewalTicketPriority ?? null;
    }
    if (hasRenewalTicketAssigneeColumn) {
      renewalUpdates.renewal_ticket_assignee_id = data.renewalTicketAssigneeId ?? null;
    }

    if (existingSettings) {
      return await trx('default_billing_settings')
        .where({ tenant })
        .update({
          zero_dollar_invoice_handling: data.zeroDollarInvoiceHandling,
          suppress_zero_dollar_invoices: data.suppressZeroDollarInvoices,
          enable_credit_expiration: data.enableCreditExpiration,
          credit_expiration_days: data.creditExpirationDays,
          credit_expiration_notification_days: data.creditExpirationNotificationDays,
          ...renewalUpdates,
          updated_at: trx.fn.now()
        });
    } else {
      return await trx('default_billing_settings').insert({
        tenant,
        zero_dollar_invoice_handling: data.zeroDollarInvoiceHandling,
        suppress_zero_dollar_invoices: data.suppressZeroDollarInvoices,
        enable_credit_expiration: data.enableCreditExpiration ?? true,
        credit_expiration_days: data.creditExpirationDays ?? 365,
        credit_expiration_notification_days: data.creditExpirationNotificationDays ?? [30, 7, 1],
        ...renewalUpdates,
        // created_at and updated_at will be set by default values
      });
    }
  });

  return { success: true };
});

export const getClientContractLineSettings = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<BillingSettings | null> => {
  const { knex } = await createTenantKnex();

  const settings = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('client_billing_settings')
      .where({
        client_id: clientId,
        tenant
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
  };
});

export const updateClientContractLineSettings = withAuth(async (
  user,
  { tenant },
  clientId: string,
  data: BillingSettings | null // null to remove override
): Promise<{ success: boolean }> => {
  const { knex } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    // If data is null, remove the client override
    if (data === null) {
      return await trx('client_billing_settings')
        .where({
          client_id: clientId,
          tenant
        })
        .delete();
    }

    const existingSettings = await trx('client_billing_settings')
      .where({
        client_id: clientId,
        tenant
      })
      .first();

    if (existingSettings) {
      return await trx('client_billing_settings')
        .where({
          client_id: clientId,
          tenant
        })
        .update({
          zero_dollar_invoice_handling: data.zeroDollarInvoiceHandling,
          suppress_zero_dollar_invoices: data.suppressZeroDollarInvoices,
          enable_credit_expiration: data.enableCreditExpiration,
          credit_expiration_days: data.creditExpirationDays,
          credit_expiration_notification_days: data.creditExpirationNotificationDays,
          updated_at: trx.fn.now()
        });
    } else {
      return await trx('client_billing_settings').insert({
        client_id: clientId,
        tenant,
        zero_dollar_invoice_handling: data.zeroDollarInvoiceHandling,
        suppress_zero_dollar_invoices: data.suppressZeroDollarInvoices,
        enable_credit_expiration: data.enableCreditExpiration,
        credit_expiration_days: data.creditExpirationDays,
        credit_expiration_notification_days: data.creditExpirationNotificationDays
        // created_at and updated_at will be set by default values
      });
    }
  });

  return { success: true };
});
