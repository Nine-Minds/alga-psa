import { toCalendarDateString } from '@alga-psa/core';
import { computeRemainingBlockValueMinor } from '@alga-psa/shared/billingClients/hourBlockService';

import type { HourBlockUsage } from '../actions/contractReportActions';

/** One `hour_blocks` row as read by `getHourBlockUsageReport`. */
export interface HourBlockUsageQueryRow {
  block_id: string;
  client_id: string;
  client_name?: string | null;
  service_name?: string | null;
  line_name?: string | null;
  contract_name?: string | null;
  status: string;
  total_minutes?: number | string | null;
  remaining_minutes?: number | string | null;
  hourly_rate?: number | string | null;
  currency_code?: string | null;
  purchased_at?: string | Date | null;
  valid_from?: string | Date | null;
  expiration_date?: string | Date | null;
}

const minutesToHours = (minutes: number): number => Math.round((minutes / 60) * 100) / 100;

/**
 * Report row for one issued block (pure; no I/O) so the date handling is
 * testable without a database.
 *
 * `expiration_date` is a pg DATE, which node-postgres hydrates as LOCAL
 * midnight: `toISOString()` prints the previous day on any server east of UTC,
 * so it goes through the calendar-date helper. `purchased_at` is a timestamptz
 * instant and keeps this report's UTC date-only convention.
 */
export function mapHourBlockUsageRow(row: HourBlockUsageQueryRow): HourBlockUsage {
  const totalMinutes = Number(row.total_minutes ?? 0);
  const remainingMinutes = Math.max(0, Number(row.remaining_minutes ?? 0));
  const usedMinutes = Math.max(0, totalMinutes - remainingMinutes);
  return {
    block_id: row.block_id,
    client_id: row.client_id,
    client_name: row.client_name || 'Unknown Client',
    service_name: row.service_name || row.line_name || '—',
    contract_name: row.contract_name ?? null,
    status: row.status,
    total_hours: minutesToHours(totalMinutes),
    used_hours: minutesToHours(usedMinutes),
    remaining_hours: minutesToHours(remainingMinutes),
    utilization_percentage: totalMinutes > 0 ? Math.round((usedMinutes / totalMinutes) * 100) : 0,
    hourly_rate: Number(row.hourly_rate ?? 0),
    currency_code: row.currency_code || 'USD',
    remaining_value: row.status === 'active'
      ? computeRemainingBlockValueMinor({ remaining_minutes: remainingMinutes, hourly_rate: row.hourly_rate })
      : 0,
    purchased_at: row.purchased_at ? new Date(row.purchased_at).toISOString().slice(0, 10) : null,
    valid_from: toCalendarDateString(row.valid_from ?? null),
    expiration_date: toCalendarDateString(row.expiration_date ?? null),
  };
}
