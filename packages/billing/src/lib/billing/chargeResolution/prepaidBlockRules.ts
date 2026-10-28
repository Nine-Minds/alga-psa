/**
 * The prepaid-block rules of the charge resolver. This is the only place that
 * decides which block issuances become charges and which allocation rows count
 * as consumption; both sources (engine database, simulator scenario) only
 * supply the data these functions read.
 */

import { Temporal } from "@js-temporal/polyfill";
import { nthCadenceBoundaryAfter } from "@alga-psa/shared/billingClients/cadenceBoundaryAdvance";
import type {
  CadencePrepaidBlockInput,
  HourBlockDrawRow,
  PrepaidBlockIssuanceInput,
} from "../compute";
import type {
  ResolvedBillingProfileAssignments,
  ResolvedBillingTiming,
  ResolvedContractLineFacts,
} from "../domain";
import type {
  CadencePrepaidBlockSupply,
  HourBlockDrawSupplyRow,
  PrepaidBlockIssuanceSupply,
  PrepaidCoverageRow,
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

/**
 * Whether the drawn block was valid on the entry's work date
 * (`validFrom <= workDate <= expirationDate`, a null bound is open). Time is
 * paid for by the block that was valid when the work happened, never by a
 * later block: late-approved November time cannot be absorbed by December's
 * block, nor can a block cover work dated after it lapsed. A row that carries
 * no dates is taken as valid.
 */
export function blockValidOnWorkDate(row: PrepaidCoverageRow): boolean {
  const workDate = row.workDate;
  if (!workDate) return true;
  if (row.blockValidFrom && row.blockValidFrom > workDate) return false;
  if (row.blockExpirationDate && row.blockExpirationDate < workDate) return false;
  return true;
}

/**
 * Overage subtraction for Prepaid Block lines (plan section 4).
 *
 * Minutes an entry drew from the line's `active` or `expired` blocks are
 * already paid for and are removed from what the hourly charge prices; the
 * remainder bills at the line's hourly rate. An entry with ANY minutes drawn
 * from a `pending` block is HELD: not priced, not marked invoiced. It surfaces
 * once the block activates (then it is covered or partially covered) or falls
 * back to overage if the block is voided. Fully covered entries drop out.
 * Entries with no rows pass through untouched. Only draws from a block valid
 * on the entry's work date count (see blockValidOnWorkDate), so late time is
 * covered by its own period's block and the rest bills as overage.
 */
export function applyPrepaidCoverage<
  A extends { sourceId: string; billableMinutes: number },
>(activity: readonly A[], rows: readonly PrepaidCoverageRow[]): A[] {
  if (rows.length === 0) return [...activity];
  const covered = new Map<string, number>();
  const held = new Set<string>();
  for (const row of rows) {
    const minutes = Number(row.minutes) || 0;
    if (minutes <= 0) continue;
    if (!blockValidOnWorkDate(row)) continue;
    if (row.blockStatus === "pending") {
      held.add(row.entryId);
    } else if (row.blockStatus === "active" || row.blockStatus === "expired") {
      covered.set(row.entryId, (covered.get(row.entryId) ?? 0) + minutes);
    }
  }
  const result: A[] = [];
  for (const entry of activity) {
    if (held.has(entry.sourceId)) continue;
    const drawn = covered.get(entry.sourceId) ?? 0;
    if (drawn <= 0) {
      result.push(entry);
      continue;
    }
    const remainder = Number(entry.billableMinutes) - drawn;
    if (remainder <= 0) continue;
    result.push({ ...entry, billableMinutes: remainder });
  }
  return result;
}

/**
 * Turns a line's cadence block terms into the block billed for one service
 * period. A block is valid from the first day of its period through the last
 * day of the period `rolloverPeriods` cadence periods later (inclusive), so
 * rollover counts whole cadence periods, never calendar months. A line whose
 * block cannot be sold (no sold-as service, no currency) is a refusal, never a
 * silently dropped charge.
 */
export function planCadenceBlock(
  supply: CadencePrepaidBlockSupply,
  line: ResolvedContractLineFacts,
  timing: ResolvedBillingTiming,
): CadencePrepaidBlockInput {
  if (!supply.soldAsServiceId) {
    throw new Error(
      `Prepaid block line ${supply.contractLineId} has no sold-as service configured.`,
    );
  }
  if (!line.currencyCode) {
    throw new Error(
      `Contract for prepaid block line ${supply.contractLineId} has no currency.`,
    );
  }
  const validUntilExclusive = nthCadenceBoundaryAfter(
    timing.servicePeriodStart,
    supply.rolloverPeriods + 1,
    supply.cadence,
  );
  return {
    contractLineId: supply.contractLineId,
    clientContractLineId: line.clientContractLineId,
    clientContractId: line.clientContractId,
    contractName: line.contractName,
    tenant: line.tenantId,
    blockMinutes: supply.blockMinutes,
    blockPrice: supply.blockPrice,
    rolloverPeriods: supply.rolloverPeriods,
    scopeServiceIds: supply.scopeServiceIds,
    soldAsServiceId: supply.soldAsServiceId,
    serviceName: supply.serviceName,
    soldAsTaxRateId: supply.soldAsTaxRateId,
    currencyCode: line.currencyCode,
    locationId: line.locationId,
    taxDate: timing.servicePeriodStart,
    servicePeriodStart: timing.servicePeriodStart,
    servicePeriodEnd: timing.servicePeriodEnd,
    servicePeriodRecordId: timing.servicePeriodRecordId ?? null,
    coverageRatio: timing.coverageRatio,
    enableProration: Boolean(line.enableProration),
    validFrom: timing.servicePeriodStart,
    expirationDate: Temporal.PlainDate.from(validUntilExclusive)
      .subtract({ days: 1 })
      .toString(),
  };
}
