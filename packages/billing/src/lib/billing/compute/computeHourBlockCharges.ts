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
