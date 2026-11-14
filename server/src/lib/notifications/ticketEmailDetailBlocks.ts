import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  formatCurrencyFromMinorUnits,
  formatMinutesAsHoursAndMinutes,
  isSupportedCurrency,
  workedMinutes,
} from '@alga-psa/core';
import { getAvailableHourBlockMinutes } from '@alga-psa/shared/billingClients/hourBlockService';
import { LOCALE_CONFIG } from '@alga-psa/core/i18n/config';

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

export interface TicketEmailTimeEntry {
  date: string;
  technician: string;
  worked: string;
  billable: string;
}

export interface TicketEmailMaterial {
  name: string;
  description: string;
  quantity: number;
  rate: string;
  amount: string;
  currencyCode: string;
  billed: boolean;
}

export interface TicketEmailDetailBlocks {
  assets: TicketEmailAsset[];
  materials: TicketEmailMaterial[];
  materialsTotal: string;
  timeEntries: TicketEmailTimeEntry[];
  totalTimeWorked: string;
  totalTimeBillable: string;
  remainingBlockHours: string;
}

/** Fallback blocks when detail building fails; templates render empty sections. */
export function emptyTicketEmailDetailBlocks(): TicketEmailDetailBlocks {
  return {
    assets: [],
    materials: [],
    materialsTotal: '',
    timeEntries: [],
    totalTimeWorked: formatMinutesAsHoursAndMinutes(0),
    totalTimeBillable: formatMinutesAsHoursAndMinutes(0),
    remainingBlockHours: formatMinutesAsHoursAndMinutes(0),
  };
}

export type HourBlockMinutesResolver = (clientId: string) => Promise<number>;

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
  quantity: number | string;
  rate: number | string;
  currency_code: string;
  is_billed: boolean;
}

export interface TimeEntryRow {
  entry_id: string;
  start_time: Date | string | null;
  end_time: Date | string | null;
  billable_duration: number | string | null;
  technician_name: string | null;
}

function text(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function number(value: number | string, field: string): number {
  const parsed = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Ticket email details: ${field} must be a finite number`);
  }
  return parsed;
}

function money(amount: number, currencyCode: string): string {
  if (!isSupportedCurrency(currencyCode)) {
    throw new Error(`Ticket email details: unsupported material currency "${currencyCode}"`);
  }
  return formatCurrencyFromMinorUnits(amount, LOCALE_CONFIG.defaultLocale, currencyCode);
}

function timestamp(value: Date | string | null): number {
  if (value === null) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) {
    throw new Error('Ticket email details: invalid time-entry work date');
  }
  return parsed;
}

export function sortTimeEntriesChronologically(rows: TimeEntryRow[]): TimeEntryRow[] {
  return [...rows].sort((a, b) => {
    const difference = timestamp(a.start_time) - timestamp(b.start_time);
    if (difference && !Number.isNaN(difference)) return difference;
    return text(a.technician_name).localeCompare(text(b.technician_name))
      || a.entry_id.localeCompare(b.entry_id);
  });
}

export interface TicketDetailRows {
  assets: AssetRow[];
  materials: MaterialRow[];
  timeEntries: TimeEntryRow[];
}

function groupByTicket<T extends { ticket_id: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.ticket_id);
    if (list) list.push(row);
    else grouped.set(row.ticket_id, [row]);
  }
  return grouped;
}

async function fetchAssets(knex: Knex, tenant: string, ticketIds: string[]) {
  const db = tenantDb(knex, tenant);
  const query = db.table('asset_associations as aa').select(
    'aa.entity_id as ticket_id',
    'a.asset_tag', 'a.name', 'a.asset_type', 'atr.name as asset_type_name',
    'a.manufacturer', 'a.model', 'a.serial_number', 'a.status', 'a.location',
    'aa.relationship_type',
  );
  db.tenantJoin(query, 'assets as a', 'aa.asset_id', 'a.asset_id');
  db.tenantJoin(query, 'asset_type_registry as atr', 'a.asset_type', 'atr.slug', { type: 'left' });
  const rows: Array<AssetRow & { ticket_id: string }> = await query
    .whereIn('aa.entity_id', ticketIds)
    .where({ 'aa.entity_type': 'ticket' })
    .orderBy('a.asset_tag', 'asc');
  return groupByTicket(rows);
}

async function fetchMaterials(knex: Knex, tenant: string, ticketIds: string[]) {
  const db = tenantDb(knex, tenant);
  const query = db.table('ticket_materials as tm').select(
    'tm.ticket_id', 'sc.service_name as item_name', 'tm.description', 'tm.quantity',
    'tm.rate', 'tm.currency_code', 'tm.is_billed',
  );
  db.tenantJoin(query, 'service_catalog as sc', 'tm.service_id', 'sc.service_id', { type: 'left' });
  const rows: Array<MaterialRow & { ticket_id: string }> = await query
    .whereIn('tm.ticket_id', ticketIds)
    .orderBy('tm.created_at', 'asc');
  return groupByTicket(rows);
}

async function fetchTimeEntries(knex: Knex, tenant: string, ticketIds: string[]) {
  const db = tenantDb(knex, tenant);
  const query = db.table('time_entries as te').select(
    'te.work_item_id as ticket_id', 'te.entry_id', 'te.start_time', 'te.end_time', 'te.billable_duration',
    knex.raw("TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) as technician_name"),
  );
  db.tenantJoin(query, 'users as u', 'te.user_id', 'u.user_id', { type: 'left' });
  const rows: Array<TimeEntryRow & { ticket_id: string }> = await query
    .whereIn('te.work_item_id', ticketIds)
    .where({ 'te.work_item_type': 'ticket' })
    .orderBy([{ column: 'te.start_time', order: 'asc' }, { column: 'te.entry_id', order: 'asc' }]);
  return groupByTicket(rows);
}

/** One query per detail section for the whole set of tickets, grouped by ticket ID. */
export async function fetchTicketEmailDetailRows(
  knex: Knex,
  tenant: string,
  ticketIds: string[],
): Promise<Map<string, TicketDetailRows>> {
  if (!tenant || ticketIds.length === 0 || ticketIds.some((id) => !id)) {
    throw new Error('Ticket email details require a tenant and ticket ID');
  }
  const [assets, materials, timeEntries] = await Promise.all([
    fetchAssets(knex, tenant, ticketIds),
    fetchMaterials(knex, tenant, ticketIds),
    fetchTimeEntries(knex, tenant, ticketIds),
  ]);
  return new Map(ticketIds.map((ticketId) => [ticketId, {
    assets: assets.get(ticketId) ?? [],
    materials: materials.get(ticketId) ?? [],
    timeEntries: timeEntries.get(ticketId) ?? [],
  }]));
}

function buildMaterialsSection(rows: MaterialRow[]) {
  const totalsByCurrency = new Map<string, number>();
  const materials = rows.map((row) => {
    const quantity = number(row.quantity, 'material quantity');
    const rate = number(row.rate, 'material rate');
    const amount = quantity * rate;
    const currencyCode = text(row.currency_code).toUpperCase();
    totalsByCurrency.set(currencyCode, (totalsByCurrency.get(currencyCode) ?? 0) + amount);
    return {
      name: text(row.item_name) || text(row.description),
      description: text(row.description),
      quantity,
      rate: money(rate, currencyCode),
      amount: money(amount, currencyCode),
      currencyCode,
      billed: row.is_billed,
    };
  });
  return {
    materials,
    materialsTotal: [...totalsByCurrency].map(([currency, amount]) => money(amount, currency)).join(' + '),
  };
}

function buildTimeSection(rows: TimeEntryRow[], dateFormatter: Intl.DateTimeFormat) {
  let totalWorked = 0;
  let totalBillable = 0;
  const timeEntries = sortTimeEntriesChronologically(rows).map((row) => {
    const worked = workedMinutes(row);
    const billable = number(row.billable_duration ?? 0, 'billable duration');
    totalWorked += worked;
    totalBillable += billable;
    return {
      date: row.start_time === null ? '' : dateFormatter.format(new Date(row.start_time)),
      technician: text(row.technician_name),
      worked: formatMinutesAsHoursAndMinutes(worked),
      billable: formatMinutesAsHoursAndMinutes(billable),
    };
  });
  return {
    timeEntries,
    totalTimeWorked: formatMinutesAsHoursAndMinutes(totalWorked),
    totalTimeBillable: formatMinutesAsHoursAndMinutes(totalBillable),
  };
}

/**
 * Data only: templates own their markup, column selection and labels.
 * Builds one ticket's blocks from rows fetched by `fetchTicketEmailDetailRows`.
 * `resolveHourBlockMinutes` lets callers share one hour-block lookup per client
 * across a ticket bundle.
 */
export async function buildTicketEmailDetailBlocksFromRows(
  ticketId: string,
  clientId: string | null | undefined,
  rowsByTicket: Map<string, TicketDetailRows>,
  timeZone: string,
  resolveHourBlockMinutes: HourBlockMinutesResolver,
): Promise<TicketEmailDetailBlocks> {
  const rows = rowsByTicket.get(ticketId);
  if (!rows) {
    throw new Error(`Ticket email details: no detail rows were fetched for ticket ${ticketId}`);
  }
  const dateFormatter = new Intl.DateTimeFormat(LOCALE_CONFIG.defaultLocale, {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const remainingMinutes = clientId ? await resolveHourBlockMinutes(clientId) : 0;
  return {
    assets: rows.assets.map((row) => ({
      assetTag: text(row.asset_tag),
      name: text(row.name),
      assetType: text(row.asset_type_name) || text(row.asset_type),
      manufacturer: text(row.manufacturer),
      model: text(row.model),
      serialNumber: text(row.serial_number),
      status: text(row.status),
      location: text(row.location),
      relationship: text(row.relationship_type),
    })),
    ...buildMaterialsSection(rows.materials),
    ...buildTimeSection(rows.timeEntries, dateFormatter),
    remainingBlockHours: formatMinutesAsHoursAndMinutes(remainingMinutes),
  };
}

export async function buildTicketEmailDetailBlocks(
  knex: Knex,
  tenant: string,
  ticketId: string,
  clientId: string | null | undefined,
  timeZone = 'UTC',
  resolveHourBlockMinutes: HourBlockMinutesResolver = (id) =>
    getAvailableHourBlockMinutes(knex, tenant, id),
): Promise<TicketEmailDetailBlocks> {
  const rowsByTicket = await fetchTicketEmailDetailRows(knex, tenant, [ticketId]);
  return buildTicketEmailDetailBlocksFromRows(
    ticketId, clientId, rowsByTicket, timeZone, resolveHourBlockMinutes,
  );
}
