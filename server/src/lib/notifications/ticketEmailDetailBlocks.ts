/**
 * Pre-rendered ticket-detail blocks for ticket emails (assets, materials, time
 * usage, remaining prepaid hour-block balance).
 *
 * The `*Html` blocks are convenience tables with fixed columns: column headers,
 * relationship labels, Yes/No, duration units, dates and money are localized to
 * the email locale, but the layout and colors are not author-editable. Templates
 * that need their own markup should iterate `ticket.assets` instead.
 *
 * Time and materials tables carry technician names, non-billable time, material
 * rates and billed state, so they are internal-only. Callers that build a
 * customer-facing context must pass the blocks through
 * `clientFacingDetailBlocks()`.
 *
 * Variable-name contract is documented in
 * `docs/plans/2026-07-17-email-template-variables-inventory.json` (ticket-closed-client
 * and ticket-closed-internal).
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  formatCurrencyFromMinorUnits,
  formatMinutesAsHoursAndMinutes,
  isSupportedCurrency,
  workedMinutes,
  type DurationLabels,
} from '@alga-psa/core';
import { LOCALE_CONFIG, normalizeLocale, type SupportedLocale } from '@alga-psa/core/i18n/config';
import { SYSTEM_DATE_FORMAT, type CountryDateFormat } from '@alga-psa/core/i18n/countryDateFormat';
import logger from '@alga-psa/core/logger';
import { getAvailableHourBlockMinutes } from '@alga-psa/shared/billingClients/hourBlockService';
import { formatDateValue } from '@alga-psa/ui/lib/i18n/formatDateValue';

export interface TicketEmailDetailBlocks {
  assets: TicketEmailAsset[];
  /** HTML table of associated assets, headers localized; '' when the ticket has none. */
  assetsHtml: string;
  /** Internal only. HTML table of materials/services used, localized; '' when none. */
  materialsHtml: string;
  /** Internal only. Money-formatted total of all material line amounts; '' when none. */
  materialsTotal: string;
  /** Internal only. HTML table of time entries (worked vs billable), localized; '' when none. */
  timeHtml: string;
  /** Sum of worked minutes across the ticket's time entries, formatted. */
  totalTimeWorked: string;
  /** Sum of billable_duration across the ticket's time entries, formatted. */
  totalTimeBillable: string;
  /** Client's available prepaid hour-block minutes at send time, formatted. */
  remainingBlockHours: string;
}

export interface TicketEmailAsset {
  assetTag: string;
  name: string;
  assetType: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  status: string;
  location: string;
  relationship: string;
}

interface AssetRow {
  asset_tag: string | null;
  name: string | null;
  asset_type: string | null;
  asset_type_name: string | null;
  manufacturer: string | null;
  model: string | null;
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

const EMAIL_DETAIL_NAMESPACE = 'email';

interface DetailLabels {
  assetTag: string;
  name: string;
  serialNumber: string;
  status: string;
  relationship: string;
  affected: string;
  related: string;
  item: string;
  quantity: string;
  rate: string;
  amount: string;
  billed: string;
  yes: string;
  no: string;
  material: string;
  technician: string;
  date: string;
  worked: string;
  billable: string;
  unknown: string;
  duration: DurationLabels;
}

async function loadDetailLabels(locale: SupportedLocale): Promise<DetailLabels> {
  const { getServerTranslation } = await import('@alga-psa/ui/lib/i18n/serverOnly');
  const { t, i18n } = await getServerTranslation(locale, EMAIL_DETAIL_NAMESPACE);
  if (!i18n.hasResourceBundle(locale, EMAIL_DETAIL_NAMESPACE)) {
    throw new Error(`Missing ${EMAIL_DETAIL_NAMESPACE} translations for locale ${locale}`);
  }
  const translate = (key: string): string => {
    if (typeof i18n.getResource(locale, EMAIL_DETAIL_NAMESPACE, key) !== 'string') {
      throw new Error(`Missing ${EMAIL_DETAIL_NAMESPACE} translation: ${key}`);
    }
    return String(t(key));
  };
  return {
    assetTag: translate('ticketDetails.assets.columns.assetTag'),
    name: translate('ticketDetails.assets.columns.name'),
    serialNumber: translate('ticketDetails.assets.columns.serialNumber'),
    status: translate('ticketDetails.assets.columns.status'),
    relationship: translate('ticketDetails.assets.columns.relationship'),
    affected: translate('ticketDetails.relationship.affected'),
    related: translate('ticketDetails.relationship.related'),
    item: translate('ticketDetails.materials.columns.item'),
    quantity: translate('ticketDetails.materials.columns.quantity'),
    rate: translate('ticketDetails.materials.columns.rate'),
    amount: translate('ticketDetails.materials.columns.amount'),
    billed: translate('ticketDetails.materials.columns.billed'),
    yes: translate('ticketDetails.yes'),
    no: translate('ticketDetails.no'),
    material: translate('ticketDetails.materials.fallback'),
    technician: translate('ticketDetails.time.columns.technician'),
    date: translate('ticketDetails.time.columns.date'),
    worked: translate('ticketDetails.time.columns.worked'),
    billable: translate('ticketDetails.time.columns.billable'),
    unknown: translate('ticketDetails.time.unknownTechnician'),
    duration: {
      hr: translate('ticketDetails.duration.hr'),
      hrs: translate('ticketDetails.duration.hrs'),
      min: translate('ticketDetails.duration.min'),
    },
  };
}

/**
 * Format a money amount stored in cents with the row's currency code.
 * Without a usable currency code the amount renders as a plain localized number.
 */
export function formatCentsAmount(
  cents: number,
  currencyCode: string | null | undefined,
  locale: string = LOCALE_CONFIG.defaultLocale,
): string {
  const intlLocale = normalizeLocale(locale) ?? LOCALE_CONFIG.defaultLocale;
  const code = safeString(currencyCode).toUpperCase();
  if (isSupportedCurrency(code)) {
    return formatCurrencyFromMinorUnits(cents, intlLocale, code);
  }
  logger.warn('[TicketEmailDetailBlocks] Missing or unsupported currency code; rendering an unlabelled amount', { currencyCode: code });
  return new Intl.NumberFormat(intlLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
}

function formatEntryDate(
  value: Date | string | null,
  timeZone: string,
  locale: string,
  dateFormat: CountryDateFormat,
): string {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return formatDateValue(date, locale, {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }, dateFormat);
}

function relationshipLabel(type: string | null | undefined, labels: DetailLabels): string {
  const value = safeString(type);
  if (value === 'affected') return labels.affected;
  if (value === 'related') return labels.related;
  return value;
}

async function fetchTicketAssets(db: Knex, tenantId: string, ticketId: string): Promise<AssetRow[]> {
  const dbScoped = tenantDb(db, tenantId);
  const query = dbScoped.table('asset_associations as aa')
    .select(
      'a.asset_tag',
      'a.name',
      'a.asset_type',
      'atr.name as asset_type_name',
      'a.manufacturer',
      'a.model',
      'a.serial_number',
      'a.status',
      'a.location',
      'aa.relationship_type'
    );
  dbScoped.tenantJoin(query, 'assets as a', 'aa.asset_id', 'a.asset_id');
  dbScoped.tenantJoin(query, 'asset_type_registry as atr', 'a.asset_type', 'atr.slug', { type: 'left' });
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

function renderAssetsTable(rows: AssetRow[], labels: DetailLabels): string {
  return renderTable(
    [labels.assetTag, labels.name, labels.serialNumber, labels.status, labels.relationship],
    rows.map((row) => [
      escapeHtml(safeString(row.asset_tag) || '—'),
      escapeHtml(safeString(row.name) || '—'),
      escapeHtml(safeString(row.serial_number) || '—'),
      escapeHtml(safeString(row.status) || '—'),
      escapeHtml(relationshipLabel(safeString(row.relationship_type), labels) || '—'),
    ]),
  );
}

function renderMaterialsTable(rows: MaterialRow[], locale: string, labels: DetailLabels): string {
  return renderTable(
    [labels.item, labels.quantity, labels.rate, labels.amount, labels.billed],
    rows.map((row) => {
      const quantity = toNumberOrNull(row.quantity) ?? 0;
      const rate = toNumberOrNull(row.rate) ?? 0;
      const currency = row.currency_code;
      const label = safeString(row.item_name) || safeString(row.description) || labels.material;
      return [
        escapeHtml(label),
        escapeHtml(new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(quantity)),
        escapeHtml(formatCentsAmount(rate, currency, locale)),
        escapeHtml(formatCentsAmount(rate * quantity, currency, locale)),
        escapeHtml(row.is_billed ? labels.yes : labels.no),
      ];
    }),
  );
}

// Grouped per currency so mixed-currency tickets never sum across currencies.
function formatMaterialsTotal(rows: MaterialRow[], locale: string): string {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const quantity = toNumberOrNull(row.quantity) ?? 0;
    const rate = toNumberOrNull(row.rate) ?? 0;
    const code = safeString(row.currency_code).toUpperCase();
    totals.set(code, (totals.get(code) ?? 0) + rate * quantity);
  }
  return Array.from(totals.entries())
    .map(([code, cents]) => formatCentsAmount(cents, code || null, locale))
    .join(' + ');
}

function renderTimeTable(
  rows: TimeEntryRow[],
  timeZone: string,
  locale: string,
  labels: DetailLabels,
  dateFormat: CountryDateFormat,
): string {
  return renderTable(
    [labels.technician, labels.date, labels.worked, labels.billable],
    rows.map((row) => [
      escapeHtml(safeString(row.technician_name) || labels.unknown),
      escapeHtml(formatEntryDate(row.start_time, timeZone, locale, dateFormat) || '—'),
      escapeHtml(formatMinutesAsHoursAndMinutes(workedMinutes(row), labels.duration)),
      escapeHtml(formatMinutesAsHoursAndMinutes(toNumberOrNull(row.billable_duration) ?? 0, labels.duration)),
    ]),
  );
}

/** All-empty blocks, used when the detail lookup fails so the base email still sends. */
export function emptyTicketEmailDetailBlocks(): TicketEmailDetailBlocks {
  return {
    assets: [],
    assetsHtml: '',
    materialsHtml: '',
    materialsTotal: '',
    timeHtml: '',
    totalTimeWorked: '',
    totalTimeBillable: '',
    remainingBlockHours: '',
  };
}

/** Strips internal-only data (technician time rows, material rates) for customer-facing emails. */
export function clientFacingDetailBlocks(blocks: TicketEmailDetailBlocks): TicketEmailDetailBlocks {
  return { ...blocks, timeHtml: '', materialsHtml: '', materialsTotal: '' };
}

/**
 * Build the ticket-detail email blocks for one ticket.
 *
 * `clientId` may be null/empty, in which case remaining hours are zero.
 * Remaining hours reflect live `hour_blocks.remaining_minutes` at send time
 * (even-time usage already deducted, invoicing state irrelevant).
 */
export async function buildTicketEmailDetailBlocks(
  db: Knex,
  tenantId: string,
  ticketId: string,
  clientId: string | null | undefined,
  timeZone: string = 'UTC',
  locale: string = LOCALE_CONFIG.defaultLocale,
  dateFormat: CountryDateFormat = SYSTEM_DATE_FORMAT,
): Promise<TicketEmailDetailBlocks> {
  if (!ticketId) {
    throw new Error('buildTicketEmailDetailBlocks: ticketId is required');
  }
  const resolvedLocale = normalizeLocale(locale) ?? LOCALE_CONFIG.defaultLocale;
  const labels = await loadDetailLabels(resolvedLocale);

  const [assetRows, materialRows, timeRows] = await Promise.all([
    fetchTicketAssets(db, tenantId, ticketId),
    fetchTicketMaterials(db, tenantId, ticketId),
    fetchTicketTimeEntries(db, tenantId, ticketId),
  ]);

  const totalMinutes = timeRows.reduce((sum, row) => sum + workedMinutes(row), 0);
  const billableMinutes = timeRows.reduce((sum, row) => sum + (toNumberOrNull(row.billable_duration) ?? 0), 0);

  const remainingMinutes = clientId && safeString(clientId)
    ? await getAvailableHourBlockMinutes(db, tenantId, safeString(clientId))
    : 0;

  return {
    assets: assetRows.map((row) => ({
      assetTag: safeString(row.asset_tag),
      name: safeString(row.name),
      assetType: safeString(row.asset_type_name) || safeString(row.asset_type),
      manufacturer: safeString(row.manufacturer),
      model: safeString(row.model),
      serialNumber: safeString(row.serial_number),
      status: safeString(row.status),
      location: safeString(row.location),
      relationship: relationshipLabel(safeString(row.relationship_type), labels),
    })),
    assetsHtml: renderAssetsTable(assetRows, labels),
    materialsHtml: renderMaterialsTable(materialRows, resolvedLocale, labels),
    materialsTotal: formatMaterialsTotal(materialRows, resolvedLocale),
    timeHtml: renderTimeTable(timeRows, timeZone, resolvedLocale, labels, dateFormat),
    totalTimeWorked: formatMinutesAsHoursAndMinutes(totalMinutes, labels.duration),
    totalTimeBillable: formatMinutesAsHoursAndMinutes(billableMinutes, labels.duration),
    remainingBlockHours: formatMinutesAsHoursAndMinutes(remainingMinutes, labels.duration),
  };
}
