/**
 * Pure Prepaid Block timeline for the contract simulator (plan section 8).
 *
 * Models, in memory and per invoice period, what the live system does for a
 * Prepaid Block line (an Hourly line plus a block config overlay):
 *  - the first block is issued in the period containing the contract start;
 *  - synthetic hourly demand draws the live blocks oldest-first;
 *  - a follow-on block is issued in the same period when the balance crosses
 *    the exhaustion / threshold trigger (at most one open follow-on at a time,
 *    like the live "one open follow-on per line" invariant);
 *  - a block expires on its anniversary (`issue date + expiry_months`), the
 *    unused balance is forfeited, and the expiry trigger issues the next block
 *    on that date;
 *  - demand that no block can absorb is returned as overage minutes, which the
 *    caller prices at the line's hourly rate.
 *
 * No I/O and no billing math beyond block bookkeeping; pricing and tax happen
 * in the loader. Date arithmetic and the threshold boundary are the same
 * helpers the live engine uses so the two cannot drift.
 */

import { Temporal } from "@js-temporal/polyfill";
import { computePrepaidBlockAnniversaryDate } from "@alga-psa/billing/lib/prepaidBlockDates";
import { prepaidBlockThresholdReached } from "@alga-psa/billing/lib/prepaidBalanceAlerts";

export type SimulatedBlockTrigger =
  | "contract_start"
  | "exhaustion"
  | "threshold"
  | "expiry";

export interface PrepaidBlockTimelineConfig {
  block_minutes: number;
  expiry_months: number | null;
  trigger_on_exhaustion: boolean;
  trigger_threshold_percent: number | null;
  trigger_on_expiry: boolean;
}

export interface PrepaidBlockTimelinePeriod {
  index: number;
  /** Inclusive ISO date. */
  startDate: string;
  /** Exclusive ISO date. */
  endDateExclusive: string;
}

export interface PrepaidBlockIssue {
  periodIndex: number;
  /** 1-based, in issue order. */
  blockOrdinal: number;
  issueDate: string;
  trigger: SimulatedBlockTrigger;
  /** Last usable day, or null when the block never expires. */
  expirationDate: string | null;
}

export interface PrepaidBlockDraw {
  periodIndex: number;
  blockOrdinal: number;
  minutes: number;
  /** Balance of this block at the end of the period. */
  remainingMinutes: number;
}

export interface PrepaidBlockForfeiture {
  periodIndex: number;
  blockOrdinal: number;
  date: string;
  minutes: number;
}

export interface PrepaidBlockTimeline {
  issues: PrepaidBlockIssue[];
  draws: PrepaidBlockDraw[];
  forfeitures: PrepaidBlockForfeiture[];
  /** Demand no block absorbed, by period index (minutes). */
  overageMinutesByPeriod: Map<number, number>;
}

interface SimBlock {
  ordinal: number;
  totalMinutes: number;
  remainingMinutes: number;
  anniversary: string | null;
  thresholdFired: boolean;
  exhaustionFired: boolean;
  expired: boolean;
  /** Issued in the current period: the live "pending" follow-on. */
  pendingThisPeriod: boolean;
}

function dayCount(from: string, to: string): number {
  return Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to), {
    largestUnit: "days",
  }).days;
}

export function simulatePrepaidBlockTimeline(input: {
  config: PrepaidBlockTimelineConfig;
  periods: PrepaidBlockTimelinePeriod[];
  /** Inclusive ISO date; null starts at the first period. */
  contractStartDate: string | null;
  /** Inclusive ISO date; null = open ended. */
  contractEndDate: string | null;
  /** Total synthetic hourly demand (minutes) per period index. */
  demandMinutesByPeriod: ReadonlyMap<number, number>;
}): PrepaidBlockTimeline {
  const { config, contractStartDate, contractEndDate } = input;
  const timeline: PrepaidBlockTimeline = {
    issues: [],
    draws: [],
    forfeitures: [],
    overageMinutesByPeriod: new Map(),
  };
  if (!(config.block_minutes > 0)) return timeline;

  const blocks: SimBlock[] = [];
  let ordinalCounter = 0;
  let periodIssues: PrepaidBlockIssue[] = [];
  const drawnByBlock = new Map<number, number>();

  const withinContract = (date: string): boolean =>
    contractEndDate == null || date <= contractEndDate;

  const canIssueFollowOn = (date: string): boolean =>
    withinContract(date) && !blocks.some((block) => block.pendingThisPeriod);

  const issueBlock = (
    period: PrepaidBlockTimelinePeriod,
    issueDate: string,
    trigger: SimulatedBlockTrigger,
  ): SimBlock => {
    ordinalCounter += 1;
    const anniversary =
      config.expiry_months != null
        ? computePrepaidBlockAnniversaryDate(issueDate, config.expiry_months)
        : null;
    const block: SimBlock = {
      ordinal: ordinalCounter,
      totalMinutes: config.block_minutes,
      remainingMinutes: config.block_minutes,
      anniversary,
      thresholdFired: false,
      exhaustionFired: false,
      expired: false,
      pendingThisPeriod: trigger !== "contract_start",
    };
    blocks.push(block);
    const issue: PrepaidBlockIssue = {
      periodIndex: period.index,
      blockOrdinal: block.ordinal,
      issueDate,
      trigger,
      expirationDate: anniversary
        ? Temporal.PlainDate.from(anniversary).subtract({ days: 1 }).toString()
        : null,
    };
    timeline.issues.push(issue);
    periodIssues.push(issue);
    return block;
  };

  const evaluateTriggers = (
    period: PrepaidBlockTimelinePeriod,
    block: SimBlock,
    date: string,
  ): void => {
    const observation = {
      totalMinutes: block.totalMinutes,
      remainingMinutes: block.remainingMinutes,
      triggerOnExhaustion: config.trigger_on_exhaustion,
      thresholdPercent: config.trigger_threshold_percent,
    };
    if (
      !block.thresholdFired &&
      prepaidBlockThresholdReached(observation)
    ) {
      block.thresholdFired = true;
      if (canIssueFollowOn(date)) issueBlock(period, date, "threshold");
    }
    if (
      !block.exhaustionFired &&
      config.trigger_on_exhaustion &&
      block.remainingMinutes <= 0
    ) {
      block.exhaustionFired = true;
      if (canIssueFollowOn(date)) issueBlock(period, date, "exhaustion");
    }
  };

  /** Draws `minutes` oldest-first; returns the demand no block absorbed. */
  const draw = (
    period: PrepaidBlockTimelinePeriod,
    minutes: number,
    date: string,
  ): number => {
    let left = minutes;
    // Blocks can be appended while drawing (follow-on issued mid-draw), so
    // re-scan for the next block with balance each pass.
    for (let guard = 0; left > 0 && guard < 1000; guard += 1) {
      const block = blocks.find(
        (candidate) => !candidate.expired && candidate.remainingMinutes > 0,
      );
      if (!block) break;
      const take = Math.min(left, block.remainingMinutes);
      block.remainingMinutes -= take;
      left -= take;
      drawnByBlock.set(
        block.ordinal,
        (drawnByBlock.get(block.ordinal) ?? 0) + take,
      );
      evaluateTriggers(period, block, date);
    }
    return left;
  };

  const sortedPeriods = [...input.periods].sort((a, b) => a.index - b.index);
  for (const period of sortedPeriods) {
    if (
      contractEndDate != null &&
      period.startDate > contractEndDate
    ) {
      break;
    }
    if (
      contractStartDate != null &&
      period.endDateExclusive <= contractStartDate
    ) {
      continue;
    }

    periodIssues = [];
    drawnByBlock.clear();
    for (const block of blocks) block.pendingThisPeriod = false;

    // First block: issued on the contract start date, in its own period.
    if (ordinalCounter === 0) {
      const issueDate =
        contractStartDate != null && contractStartDate > period.startDate
          ? contractStartDate
          : period.startDate;
      if (withinContract(issueDate)) {
        issueBlock(period, issueDate, "contract_start");
      }
    }

    const demand = Math.max(
      0,
      Math.round(input.demandMinutesByPeriod.get(period.index) ?? 0),
    );
    const periodDays = Math.max(
      1,
      dayCount(period.startDate, period.endDateExclusive),
    );

    // Segments are cut at block anniversaries falling strictly inside the
    // period; an anniversary on the period start expires at the first segment.
    const cuts = Array.from(
      new Set(
        blocks
          .filter(
            (block) =>
              !block.expired &&
              block.anniversary != null &&
              block.anniversary > period.startDate &&
              block.anniversary < period.endDateExclusive,
          )
          .map((block) => block.anniversary as string),
      ),
    ).sort();
    const boundaries = [period.startDate, ...cuts, period.endDateExclusive];

    let demandAssigned = 0;
    let overage = 0;
    for (let i = 0; i < boundaries.length - 1; i += 1) {
      const segmentStart = boundaries[i];
      const segmentEnd = boundaries[i + 1];

      // Expire every block whose anniversary has arrived; the expiry trigger
      // issues the next block on that date.
      const expiring = blocks.filter(
        (block) =>
          !block.expired &&
          block.anniversary != null &&
          block.anniversary <= segmentStart,
      );
      for (const block of expiring) {
        block.expired = true;
        if (block.remainingMinutes > 0) {
          timeline.forfeitures.push({
            periodIndex: period.index,
            blockOrdinal: block.ordinal,
            date: block.anniversary as string,
            minutes: block.remainingMinutes,
          });
        }
        if (
          config.trigger_on_expiry &&
          config.expiry_months != null &&
          canIssueFollowOn(block.anniversary as string)
        ) {
          issueBlock(period, block.anniversary as string, "expiry");
        }
      }

      const isLast = i === boundaries.length - 2;
      const segmentDemand = isLast
        ? demand - demandAssigned
        : Math.round((demand * dayCount(segmentStart, segmentEnd)) / periodDays);
      demandAssigned += segmentDemand;
      if (segmentDemand > 0) {
        overage += draw(period, segmentDemand, segmentStart);
      }
    }

    for (const [ordinal, minutes] of drawnByBlock) {
      const block = blocks.find((candidate) => candidate.ordinal === ordinal);
      timeline.draws.push({
        periodIndex: period.index,
        blockOrdinal: ordinal,
        minutes,
        remainingMinutes: block?.remainingMinutes ?? 0,
      });
    }
    if (overage > 0) timeline.overageMinutesByPeriod.set(period.index, overage);
  }

  return timeline;
}
