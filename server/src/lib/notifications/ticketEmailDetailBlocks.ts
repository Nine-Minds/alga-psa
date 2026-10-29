/**
 * Pre-rendered ticket-detail blocks for ticket emails (assets, materials, time
 * usage, remaining prepaid hour-block balance).
 *
 * The blocks are fixed-layout inline-styled HTML tables plus formatted scalar
 * summaries so template authors can drop them into Handlebars templates with
 * `{{{ticket.assetsHtml}}}` (guard emptiness with `{{#if ticket.assetsHtml}}`)
 * without needing per-row `{{#each}}` plumbing.
 *
 * Variable-name contract is documented in
 * `docs/plans/2026-07-17-email-template-variables-inventory.json` (ticket-closed).
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { formatMinutesAsHoursAndMinutes, workedMinutes } from '@alga-psa/core';
import { getAvailableHourBlockMinutes } from '@alga-psa/shared/billingClients/hourBlockService';

export interface TicketEmailDetailBlocks {
  /** HTML table of associated assets; '' when the ticket has none. */
  assetsHtml: string;
  /** HTML table of materials/services used; '' when none. */
  materialsHtml: string;
  /** Currency-formatted total of all material line amounts. */
  materialsTotal: string;
  /** HTML table of time entries (worked vs billable); '' when none. */
  timeHtml: string;
  /** Sum of worked minutes across the ticket's time entries, formatted. */
  totalTimeWorked: string;
  /** Sum of billable_duration across the ticket's time entries, formatted. */
  totalTimeBillable: string;
  /** Client's available prepaid hour-block minutes at send time, formatted. */
  remainingBlockHours: string;
}

interface AssetRow {
  asset_tag: string | null;
  name: string | null;
  serial_number: string | null;
  status: string | null;
  location: string | null;
  relationship_type: string | null;
}

interface MaterialRow {
  item_name: string | null;
  description: string | null;
  quantity: number | string | null;
  rate: number | string | null;
  currency_code: string | null;
  is_billed: boolean | null;
}

interface TimeEntryRow {
  entry_id: string;
  start_time: Date | string | null;
  end_time: Date | string | null;
  billable_duration: number | string | null;
  technician_name: string | null;
}

/**
 * HTML-escape a string for safe interpolation into the email body.
 * Mirrors the subscriber's private escapeHtml convention.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

const DETAIL_TABLE_STYLE = 'border-collapse:collapse;width:100%;margin:0;font-size:13px;';
const DETAIL_TH_STYLE = 'text-align:left;padding:6px 10px;border-bottom:2px solid rgba(146,64,14,0.25);font-weight:600;color:#1f2933;white-space:nowrap;';
const DETAIL_TD_STYLE = 'padding:6px 10px;border-bottom:1px solid rgba(146,64,14,0.15);color:#1f2933;word-break:break-word;';

/**
 * Render a fixed-layout table. `cells` are pre-escaped (or trusted-safe) HTML
 * strings; returns '' when there are no data rows so templates can guard.
 */
function renderTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) {
    return '';
  }
  const headerHtml = headers.map((header) => `<th style="${DETAIL_TH_STYLE}">${escapeHtml(header)}</th>`).join('');
  const bodyHtml = rows
    .map((row) => `<tr>${row.map((cell) => `<td style="${DETAIL_TD_STYLE}">${cell}</td>`).join('')}</tr>`)
    .join('');
  return `<table style="${DETAIL_TABLE_STYLE}"><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
}

/**
 * Format a money amount stored in cents with the row's currency code.
 */
export function formatCentsAmount(cents: number, currencyCode: string | null | undefined, locale: string = 'en'): string {
  const code = safeString(currencyCode) || 'USD';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
    }).format(cents / 100);
  } catch {
    // Malformed currency code (Intl rejects codes that aren't well-formed
    // ISO-4217-shaped strings) — fall back to a plain number so the email renders.
    return (cents / 100).toFixed(2);
  }
}

function formatEntryDate(value: Date | string | null, timeZone: string, locale: string): string {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString(locale, {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const RELATIONSHIP_LABELS: Record<string, string> = {
  affected: 'Affected',
  related: 'Related',
};

async function fetchTicketAssets(db: Knex, tenantId: string, ticketId: string): Promise<AssetRow[]> {
  const dbScoped = tenantDb(db, tenantId);
  const query = dbScoped.table('asset_associations as aa')
    .select(
      'a.asset_tag',
      'a.name',
      'a.serial_number',
      'a.status',
      'a.location',
      'aa.relationship_type'
    );
  dbScoped.tenantJoin(query, 'assets as a', 'aa.asset_id', 'a.asset_id');
  return query
    .where({ 'aa.entity_id': ticketId, 'aa.entity_type': 'ticket' })
    .orderBy('a.asset_tag', 'asc');
}

async function fetchTicketMaterials(db: Knex, tenantId: string, ticketId: string): Promise<MaterialRow[]> {
  const dbScoped = tenantDb(db, tenantId);
  const query = dbScoped.table('ticket_materials as tm')
    .select(
      'sc.service_name as item_name',
      'tm.description',
      'tm.quantity',
      'tm.rate',
      'tm.currency_code',
      'tm.is_billed'
    );
  dbScoped.tenantJoin(query, 'service_catalog as sc', 'tm.service_id', 'sc.service_id', { type: 'left' });
  return query
    .where({ 'tm.ticket_id': ticketId })
    .orderBy('tm.created_at', 'asc');
}

async function fetchTicketTimeEntries(db: Knex, tenantId: string, ticketId: string): Promise<TimeEntryRow[]> {
  const dbScoped = tenantDb(db, tenantId);
  const query = dbScoped.table('time_entries as te')
    .select(
      'te.entry_id',
      'te.start_time',
      'te.end_time',
      'te.billable_duration',
      db.raw("TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) as technician_name")
    );
  dbScoped.tenantJoin(query, 'users as u', 'te.user_id', 'u.user_id', { type: 'left' });
  return query
    .where({ 'te.work_item_id': ticketId, 'te.work_item_type': 'ticket' })
    .orderBy('te.start_time', 'asc');
}

function renderAssetsTable(rows: AssetRow[]): string {
  return renderTable(
    ['Asset Tag', 'Name', 'Serial #', 'Status', 'Relationship'],
    rows.map((row) => [
      escapeHtml(safeString(row.asset_tag) || '—'),
      escapeHtml(safeString(row.name) || '—'),
      escapeHtml(safeString(row.serial_number) || '—'),
      escapeHtml(safeString(row.status) || '—'),
      escapeHtml(RELATIONSHIP_LABELS[safeString(row.relationship_type)] || safeString(row.relationship_type) || '—'),
    ]),
  );
}

function renderMaterialsTable(rows: MaterialRow[], locale: string): string {
  return renderTable(
    ['Item', 'Qty', 'Rate', 'Amount', 'Billed'],
    rows.map((row) => {
      const quantity = toNumberOrNull(row.quantity) ?? 0;
      const rate = toNumberOrNull(row.rate) ?? 0;
      const currency = row.currency_code;
      const label = safeString(row.item_name) || safeString(row.description) || 'Material';
      return [
        escapeHtml(label),
        escapeHtml(String(quantity)),
        escapeHtml(formatCentsAmount(rate, currency, locale)),
        escapeHtml(formatCentsAmount(rate * quantity, currency, locale)),
        escapeHtml(row.is_billed ? 'Yes' : 'No'),
      ];
    }),
  );
}

function materialsTotalCents(rows: MaterialRow[]): { cents: number; currencyCode: string | null } {
  let cents = 0;
  let currencyCode: string | null = null;
  for (const row of rows) {
    const quantity = toNumberOrNull(row.quantity) ?? 0;
    const rate = toNumberOrNull(row.rate) ?? 0;
    cents += rate * quantity;
    if (!currencyCode && safeString(row.currency_code)) {
      currencyCode = safeString(row.currency_code);
    }
  }
  return { cents, currencyCode };
}

function renderTimeTable(rows: TimeEntryRow[], timeZone: string, locale: string): string {
  return renderTable(
    ['Technician', 'Date', 'Worked', 'Billable'],
    rows.map((row) => [
      escapeHtml(safeString(row.technician_name) || 'Unknown'),
      escapeHtml(formatEntryDate(row.start_time, timeZone, locale) || '—'),
      escapeHtml(formatMinutesAsHoursAndMinutes(workedMinutes(row))),
      escapeHtml(formatMinutesAsHoursAndMinutes(toNumberOrNull(row.billable_duration) ?? 0)),
    ]),
  );
}

/**
 * Build the ticket-detail email blocks for one ticket.
 *
 * `clientId` may be null/empty — remaining block hours then reports "0 hrs".
 * Remaining hours reflect live `hour_blocks.remaining_minutes` at send time
 * (even-time usage already deducted, invoicing state irrelevant).
 */
export async function buildTicketEmailDetailBlocks(
  db: Knex,
  tenantId: string,
  ticketId: string,
  clientId: string | null | undefined,
  timeZone: string = 'UTC',
  locale: string = 'en',
): Promise<TicketEmailDetailBlocks> {
  if (!ticketId) {
    throw new Error('buildTicketEmailDetailBlocks: ticketId is required');
  }

  const [assetRows, materialRows, timeRows] = await Promise.all([
    fetchTicketAssets(db, tenantId, ticketId),
    fetchTicketMaterials(db, tenantId, ticketId),
    fetchTicketTimeEntries(db, tenantId, ticketId),
  ]);

  const totalMinutes = timeRows.reduce((sum, row) => sum + workedMinutes(row), 0);
  const billableMinutes = timeRows.reduce((sum, row) => sum + (toNumberOrNull(row.billable_duration) ?? 0), 0);

  const { cents, currencyCode } = materialsTotalCents(materialRows);

  const remainingMinutes = clientId && safeString(clientId)
    ? await getAvailableHourBlockMinutes(db, tenantId, safeString(clientId))
    : 0;

  return {
    assetsHtml: renderAssetsTable(assetRows),
    materialsHtml: renderMaterialsTable(materialRows, locale),
    materialsTotal: formatCentsAmount(cents, currencyCode, locale),
    timeHtml: renderTimeTable(timeRows, timeZone, locale),
    totalTimeWorked: formatMinutesAsHoursAndMinutes(totalMinutes),
    totalTimeBillable: formatMinutesAsHoursAndMinutes(billableMinutes),
    remainingBlockHours: formatMinutesAsHoursAndMinutes(remainingMinutes),
  };
}
