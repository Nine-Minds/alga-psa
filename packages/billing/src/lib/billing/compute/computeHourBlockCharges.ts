import type { IHourBlockCharge, ISO8601String } from "@alga-psa/types";

/**
 * Pure compute for prepaid-hour-block informational lines. No I/O — the caller
 * loads the per-block burn aggregates for the invoice window and this module
 * turns them into zero-dollar `hour_block` charges that invoiceService can
 * persist and use to mark fully-covered time entries invoiced.
 */

export interface HourBlockBurnAggregate {
  block_id: string;
  service_id: string;
  service_name: string;
  /** Hours consumed from this block within the invoice window. */
  hours_used: number;
  /** Hours remaining on the block after the window. */
  hours_remaining: number;
  /** Time-entry ids fully covered by this block in the window. */
  covered_entry_ids: string[];
}

export interface HourBlockChargeComputeInputs {
  billingPeriod: { startDate: ISO8601String; endDate: ISO8601String };
  blocks: HourBlockBurnAggregate[];
}

export interface HourBlockChargeComputeResult {
  charges: IHourBlockCharge[];
}

export interface HourBlockBurnRow {
  block_id: string;
  service_id: string;
  service_name?: string | null;
  remaining_minutes: number;
  time_entry_id: string;
  minutes: number;
  billable_duration: number;
}

/**
 * Aggregates raw burn rows into per-block sums. Covered-entry detection sums
 * each entry's allocations across ALL of its blocks before comparing against
 * the entry's billable duration, so an entry spanning several blocks (4h + 5h)
 * is recognized as fully covered even though no single allocation row covers
 * it. Fully-covered entries are attributed to the FIRST block they drew from
 * (row order = FIFO query order) so each entry rides exactly one info line.
 */
export function aggregateHourBlockBurnRows(rows: HourBlockBurnRow[]): HourBlockBurnAggregate[] {
  const allocatedByEntry = new Map<string, number>();
  const entryDurations = new Map<string, number>();
  const firstBlockByEntry = new Map<string, string>();
  const byBlock = new Map<
    string,
    {
      block_id: string;
      service_id: string;
      service_name: string;
      remaining_minutes: number;
      minutesUsed: number;
      coveredEntryIds: Set<string>;
    }
  >();

  for (const row of rows) {
    let aggregate = byBlock.get(row.block_id);
    if (!aggregate) {
      aggregate = {
        block_id: row.block_id,
        service_id: row.service_id,
        service_name: row.service_name || "Prepaid hour block",
        remaining_minutes: Math.max(0, Number(row.remaining_minutes) || 0),
        minutesUsed: 0,
        coveredEntryIds: new Set<string>(),
      };
      byBlock.set(row.block_id, aggregate);
    }
    const allocated = Math.max(0, Number(row.minutes) || 0);
    aggregate.minutesUsed += allocated;
    allocatedByEntry.set(row.time_entry_id, (allocatedByEntry.get(row.time_entry_id) ?? 0) + allocated);
    entryDurations.set(row.time_entry_id, Math.max(0, Number(row.billable_duration) || 0));
    if (!firstBlockByEntry.has(row.time_entry_id)) {
      firstBlockByEntry.set(row.time_entry_id, row.block_id);
    }
  }

  for (const [entryId, allocated] of allocatedByEntry) {
    if (allocated >= (entryDurations.get(entryId) ?? 0)) {
      const firstBlockId = firstBlockByEntry.get(entryId);
      const aggregate = firstBlockId ? byBlock.get(firstBlockId) : undefined;
      aggregate?.coveredEntryIds.add(entryId);
    }
  }

  return Array.from(byBlock.values()).map((aggregate) => ({
    block_id: aggregate.block_id,
    service_id: aggregate.service_id,
    service_name: aggregate.service_name,
    hours_used: aggregate.minutesUsed / 60,
    hours_remaining: aggregate.remaining_minutes / 60,
    covered_entry_ids: Array.from(aggregate.coveredEntryIds),
  }));
}

export function computeHourBlockCharges(
  inputs: HourBlockChargeComputeInputs,
): HourBlockChargeComputeResult {
  const charges: IHourBlockCharge[] = [];

  for (const block of inputs.blocks) {
    if (block.hours_used <= 0) continue;
    charges.push({
      type: "hour_block",
      block_id: block.block_id,
      serviceId: block.service_id,
      serviceName: block.service_name,
      hoursUsed: block.hours_used,
      hoursRemaining: block.hours_remaining,
      coveredEntryIds: block.covered_entry_ids,
      rate: 0,
      total: 0,
      tax_amount: 0,
      tax_rate: 0,
      is_taxable: false,
      servicePeriodStart: inputs.billingPeriod.startDate,
      servicePeriodEnd: inputs.billingPeriod.endDate,
      billingTiming: "arrears",
    });
  }

  return { charges };
}
