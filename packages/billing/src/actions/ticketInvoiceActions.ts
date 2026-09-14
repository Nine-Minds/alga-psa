'use server';

import type { Knex } from 'knex';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import type { InvoiceTimeEntrySnapshot, ManualInvoiceSourceLink } from '@alga-psa/types';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  generateManualInvoice,
  type ManualInvoiceItem,
  type ManualInvoiceResult,
} from './manualInvoiceActions';

/**
 * Quick invoice a ticket.
 *
 * A biller picks unbilled ticket items — approved billable time entries and
 * unbilled ticket products (materials) — and creates one manual invoice tied
 * to the ticket. The invoice is produced by the existing manual-invoice
 * service, so authorization, tenant isolation, tax, totals, numbering, and
 * analytics are unchanged.
 *
 * The server is the authority on eligibility: the dialog is only ever a view
 * of `getTicketBillableItems`, and `generateTicketInvoice` re-reads the
 * selection inside the invoice transaction. Each selected source record is
 * claimed with a conditional update (`invoiced = false` / `is_billed = false`),
 * so a stale or concurrent selection aborts the whole invoice instead of
 * double-billing.
 */

export type TicketInvoiceActionError = ActionMessageError | ActionPermissionError;

export interface TicketBillableTimeItem {
  kind: 'time_entry';
  /** time_entries.entry_id */
  id: string;
  serviceId: string | null;
  serviceName: string | null;
  entryDate: string | null;
  billableMinutes: number;
  /** Hours; the quantity the manual charge is written with. */
  quantity: number;
  /** Cents per hour. */
  rate: number;
  /** Cents; round(hours × rate), matching manual charge net_amount. */
  amount: number;
}

export interface TicketBillableMaterialItem {
  kind: 'ticket_material';
  /** ticket_materials.ticket_material_id */
  id: string;
  serviceId: string;
  serviceName: string | null;
  quantity: number;
  /** Cents per unit. */
  rate: number;
  amount: number;
  description: string | null;
}

export interface TicketBillableItems {
  ticketId: string;
  clientId: string;
  currencyCode: string;
  ticketNumber: string | null;
  ticketTitle: string | null;
  timeItems: TicketBillableTimeItem[];
  materialItems: TicketBillableMaterialItem[];
}

export interface TicketInvoiceSummary {
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  totalAmount: number;
  currencyCode: string;
  invoiceDate: string;
}

export interface GenerateTicketInvoiceInput {
  ticketId: string;
  timeEntryIds: string[];
  materialIds: string[];
}

export type GenerateTicketInvoiceResult = ManualInvoiceResult;

interface TicketRow {
  ticket_id: string;
  client_id: string;
  ticket_number: string | null;
  title: string | null;
}

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function dedupe(ids: string[] | undefined): string[] {
  return Array.from(new Set((ids ?? []).filter((id) => typeof id === 'string' && id.length > 0)));
}

async function resolveClientCurrency(knex: Knex, tenant: string, clientId: string): Promise<string> {
  const db = tenantDb(knex, tenant);
  const client = await db
    .table('clients')
    .where({ client_id: clientId })
    .first('default_currency_code');
  if (client?.default_currency_code) {
    return client.default_currency_code;
  }
  const settings = await db
    .table('default_billing_settings')
    .select('default_currency_code')
    .first();
  return settings?.default_currency_code || 'USD';
}

async function loadTicket(knex: Knex, tenant: string, ticketId: string): Promise<TicketRow | null> {
  return tenantDb(knex, tenant)
    .table('tickets')
    .where({ ticket_id: ticketId })
    .first('ticket_id', 'client_id', 'ticket_number', 'title');
}

/**
 * Unbilled, billable ticket items for the quick-invoice dialog.
 *
 * Time: approved, positively-billable, unbilled entries tied to this ticket.
 * Products: unbilled `ticket_materials` for this ticket.
 */
export const getTicketBillableItems = withAuth(async (
  user,
  { tenant },
  ticketId: string,
): Promise<TicketBillableItems | TicketInvoiceActionError> => {
  try {
    if (!(await hasPermission(user, 'billing', 'read'))) {
      return permissionError('Permission denied: Cannot read ticket billable items');
    }
    const { knex } = await createTenantKnex();
    const ticket = await loadTicket(knex, tenant, ticketId);
    if (!ticket) {
      return actionError('That ticket no longer exists.', 'msp/invoicing:quickInvoice.errors.ticketNotFound');
    }

    const db = tenantDb(knex, tenant);

    const timeQuery = db.table('time_entries as te');
    db.tenantJoin(timeQuery, 'service_catalog as sc', 'sc.service_id', 'te.service_id', { type: 'left' });
    const timeRows = await timeQuery
      .where({
        'te.work_item_type': 'ticket',
        'te.work_item_id': ticketId,
        'te.invoiced': false,
        'te.approval_status': 'APPROVED',
      })
      .where('te.billable_duration', '>', 0)
      .whereNotNull('te.service_id')
      .orderBy('te.start_time', 'asc')
      .select(
        'te.entry_id',
        'te.service_id',
        'te.start_time',
        'te.billable_duration',
        'sc.service_name',
        'sc.default_rate',
      );

    const materialQuery = db.table('ticket_materials as tm');
    db.tenantJoin(materialQuery, 'service_catalog as sc', 'sc.service_id', 'tm.service_id', { type: 'left' });
    const materialRows = await materialQuery
      .where({ 'tm.ticket_id': ticketId, 'tm.is_billed': false })
      .orderBy('tm.created_at', 'asc')
      .select(
        'tm.ticket_material_id',
        'tm.service_id',
        'tm.quantity',
        'tm.rate',
        'tm.description',
        'sc.service_name',
      );

    const timeItems: TicketBillableTimeItem[] = timeRows.map((row: any) => {
      const billableMinutes = Number(row.billable_duration) || 0;
      const rate = Math.max(0, Math.round(Number(row.default_rate) || 0));
      const quantity = billableMinutes / 60;
      return {
        kind: 'time_entry',
        id: row.entry_id,
        serviceId: row.service_id ?? null,
        serviceName: row.service_name ?? null,
        entryDate: toIsoDate(row.start_time),
        billableMinutes,
        quantity,
        rate,
        amount: Math.round(quantity * rate),
      };
    });

    const materialItems: TicketBillableMaterialItem[] = materialRows.map((row: any) => {
      const quantity = Number(row.quantity) || 0;
      const rate = Math.max(0, Math.round(Number(row.rate) || 0));
      return {
        kind: 'ticket_material',
        id: row.ticket_material_id,
        serviceId: row.service_id,
        serviceName: row.service_name ?? null,
        quantity,
        rate,
        amount: Math.round(quantity * rate),
        description: row.description ?? null,
      };
    });

    return {
      ticketId,
      clientId: ticket.client_id,
      currencyCode: await resolveClientCurrency(knex, tenant, ticket.client_id),
      ticketNumber: ticket.ticket_number ?? null,
      ticketTitle: ticket.title ?? null,
      timeItems,
      materialItems,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('Permission denied')) {
      return permissionError(error.message);
    }
    throw error;
  }
});

function buildTimeSnapshot(params: {
  ticket: TicketRow;
  entry: {
    entry_id: string;
    service_id: string | null;
    service_name: string | null;
    start_time: unknown;
    billable_duration: number | string;
  };
  rate: number;
}): InvoiceTimeEntrySnapshot {
  const billedMinutes = Math.round(Number(params.entry.billable_duration) || 0);
  const netAmount = Math.round((billedMinutes / 60) * params.rate);
  return {
    version: 2,
    rateKind: billedMinutes > 0 ? 'uniform' : 'unknown',
    uniformRate: billedMinutes > 0 ? params.rate : null,
    workItemType: 'ticket',
    workItemId: params.ticket.ticket_id,
    ticketNumber: params.ticket.ticket_number ?? null,
    title: params.ticket.title ?? null,
    description: null,
    entryDate: toIsoDate(params.entry.start_time),
    billedMinutes,
    rate: params.rate,
    netAmount,
    serviceId: params.entry.service_id,
    serviceName: params.entry.service_name,
  };
}

/**
 * Create a manual invoice from selected unbilled ticket items.
 *
 * Re-reads every selected id under the ticket before building charges. A
 * selection that is empty, foreign to the ticket, unapproved, already billed,
 * or removed is rejected before any invoice row is written. The per-charge
 * conditional claim inside the manual-invoice transaction closes the remaining
 * race.
 */
export const generateTicketInvoice = withAuth(async (
  user,
  { tenant },
  input: GenerateTicketInvoiceInput,
): Promise<GenerateTicketInvoiceResult> => {
  if (!(await hasPermission(user, 'billing', 'create'))) {
    return {
      success: false,
      code: 'PERMISSION_DENIED',
      message: 'Permission denied: billing create required',
      error: 'Permission denied: billing create required',
    };
  }

  const { knex } = await createTenantKnex();
  const ticket = await loadTicket(knex, tenant, input.ticketId);
  if (!ticket) {
    return {
      success: false,
      code: 'CLIENT_NOT_FOUND',
      message: 'That ticket no longer exists.',
      error: 'That ticket no longer exists.',
    };
  }

  const timeEntryIds = dedupe(input.timeEntryIds);
  const materialIds = dedupe(input.materialIds);
  if (timeEntryIds.length === 0 && materialIds.length === 0) {
    return {
      success: false,
      code: 'INVALID_QUANTITY',
      message: 'Select at least one billable item to invoice.',
      error: 'Select at least one billable item to invoice.',
    };
  }

  const db = tenantDb(knex, tenant);

  const timeQuery = db.table('time_entries as te');
  db.tenantJoin(timeQuery, 'service_catalog as sc', 'sc.service_id', 'te.service_id', { type: 'left' });
  const timeRows: any[] = timeEntryIds.length === 0
    ? []
    : await timeQuery
        .whereIn('te.entry_id', timeEntryIds)
        .where({
          'te.work_item_type': 'ticket',
          'te.work_item_id': input.ticketId,
          'te.invoiced': false,
          'te.approval_status': 'APPROVED',
        })
        .where('te.billable_duration', '>', 0)
        .whereNotNull('te.service_id')
        .select(
          'te.entry_id',
          'te.service_id',
          'te.start_time',
          'te.billable_duration',
          'sc.service_name',
          'sc.default_rate',
        );

  const materialRows: any[] = materialIds.length === 0
    ? []
    : await db
        .table('ticket_materials as tm')
        .whereIn('tm.ticket_material_id', materialIds)
        .where({ 'tm.ticket_id': input.ticketId, 'tm.is_billed': false })
        .select('tm.ticket_material_id', 'tm.service_id', 'tm.quantity', 'tm.rate', 'tm.description');

  if (timeRows.length !== timeEntryIds.length || materialRows.length !== materialIds.length) {
    return {
      success: false,
      code: 'SOURCE_ALREADY_BILLED',
      params: {
        recordId: `${timeEntryIds.length - timeRows.length} time item(s), ${materialIds.length - materialRows.length} product item(s)`,
      },
      message:
        'Some selected items are no longer billable (already invoiced, not approved, or removed). Refresh and try again.',
      error:
        'Some selected items are no longer billable (already invoiced, not approved, or removed). Refresh and try again.',
    };
  }

  const items: ManualInvoiceItem[] = [];

  for (const row of timeRows) {
    const billableMinutes = Number(row.billable_duration) || 0;
    const rate = Math.max(0, Math.round(Number(row.default_rate) || 0));
    const snapshot = buildTimeSnapshot({ ticket, entry: row, rate });
    const sourceLink: ManualInvoiceSourceLink = {
      kind: 'time_entry',
      entryId: row.entry_id,
      snapshot,
    };
    items.push({
      service_id: row.service_id,
      quantity: billableMinutes / 60,
      rate,
      description: row.service_name || 'Billable time',
      source_link: sourceLink,
    });
  }

  for (const row of materialRows) {
    const sourceLink: ManualInvoiceSourceLink = {
      kind: 'ticket_material',
      materialId: row.ticket_material_id,
    };
    items.push({
      service_id: row.service_id,
      quantity: Number(row.quantity) || 0,
      rate: Math.max(0, Math.round(Number(row.rate) || 0)),
      description: row.description || 'Product',
      source_link: sourceLink,
    });
  }

  return generateManualInvoice({
    clientId: ticket.client_id,
    items,
    ticket_id: ticket.ticket_id,
  });
});

/** Invoices already associated with this ticket, newest first. */
export const getTicketInvoices = withAuth(async (
  user,
  { tenant },
  ticketId: string,
): Promise<TicketInvoiceSummary[] | TicketInvoiceActionError> => {
  try {
    if (!(await hasPermission(user, 'billing', 'read'))) {
      return permissionError('Permission denied: Cannot read ticket invoices');
    }
    const { knex } = await createTenantKnex();
    const rows = await tenantDb(knex, tenant)
      .table('invoices')
      .where({ ticket_id: ticketId })
      .orderBy('invoice_date', 'desc')
      .select('invoice_id', 'invoice_number', 'status', 'total_amount', 'currency_code', 'invoice_date');

    return rows.map((row: any) => ({
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      status: row.status,
      totalAmount: Number(row.total_amount) || 0,
      currencyCode: row.currency_code,
      invoiceDate: toIsoDate(row.invoice_date) ?? '',
    }));
  } catch (error) {
    if (error instanceof Error && error.message.includes('Permission denied')) {
      return permissionError(error.message);
    }
    throw error;
  }
});
