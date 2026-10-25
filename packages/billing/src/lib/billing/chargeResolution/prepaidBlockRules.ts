/**
 * The prepaid-block rules of the charge resolver. This is the only place that
 * decides which block issuances become charges and which allocation rows count
 * as consumption; both sources (engine database, simulator scenario) only
 * supply the data these functions read.
 */

import type { HourBlockDrawRow, PrepaidBlockIssuanceInput } from "../compute";
import type { ResolvedBillingProfileAssignments } from "../domain";
import type {
  HourBlockDrawSupplyRow,
  PrepaidBlockIssuanceSupply,
} from "./types";

export interface IssuableBlock {
  issuance: PrepaidBlockIssuanceInput;
  billingProfile: ResolvedBillingProfileAssignments | null;
  dueDate: string;
}

/**
 * An issuance becomes a charge only when it is scheduled, due on the tenant's
 * business date (a date-triggered block, such as expiry or renewal, must not be
 * issued early: the new block's expiry clock would start while the old block
 * still has hours), and its line has a sold-as service and a currency. Anything
 * else is a refusal, never a silently dropped charge.
 */
export function selectIssuableBlocks(
  supplies: readonly PrepaidBlockIssuanceSupply[],
): IssuableBlock[] {
  return supplies.map((supply) => {
    if (supply.status !== "scheduled") {
      throw new Error(
        `Prepaid block issuance ${supply.issuanceId} is ${supply.status}, not scheduled; it cannot be invoiced.`,
      );
    }
    if (supply.dueDate > supply.readyAsOf) {
      throw new Error(
        `Prepaid block issuance ${supply.issuanceId} is not due until ${supply.dueDate}; it cannot be invoiced yet.`,
      );
    }
    if (!supply.soldAsServiceId) {
      throw new Error(
        `Prepaid block line ${supply.contractLineId} has no sold-as service configured.`,
      );
    }
    if (!supply.currencyCode) {
      throw new Error(
        `Contract for prepaid block line ${supply.contractLineId} has no currency.`,
      );
    }
    const { billingProfile, dueDate, status, readyAsOf, ...issuance } = supply;
    void status;
    void readyAsOf;
    return {
      issuance: {
        ...issuance,
        soldAsServiceId: supply.soldAsServiceId,
        currencyCode: supply.currencyCode,
      },
      billingProfile: billingProfile ?? null,
      dueDate,
    };
  });
}

/**
 * Which allocation rows are consumption of a line's blocks in the window. Only
 * allocations to `active` or `expired` blocks count. An entry with any
 * allocation to the line's `pending` block is held whole (it is not covered
 * until the block activates), so it contributes no consumption here either;
 * otherwise its minutes would be shown now and again once the block activates.
 * A row with no entry (a simulated draw) is never held.
 */
export function selectHourBlockDrawRows(
  allocations: readonly HourBlockDrawSupplyRow[],
): HourBlockDrawRow[] {
  const held = new Set<string>(
    allocations
      .filter((row) => row.block_status === "pending" && row.time_entry_id)
      .map((row) => row.time_entry_id as string),
  );
  return allocations
    .filter(
      (row) =>
        (row.time_entry_id === null || !held.has(row.time_entry_id)) &&
        (row.block_status === "active" || row.block_status === "expired"),
    )
    .map(({ block_status: _blockStatus, ...row }) => row);
}
