import type { Knex } from 'knex';

import type { GatewayEventEmitter } from '../events/events.js';
import type { UsageDebitResult } from '../ledger/ledger.js';
import { resolveTopupPack, type TierConfigLoader } from '../tier/tierConfig.js';

export type PostDebitHandler = (result: UsageDebitResult) => Promise<void>;

async function enqueueAutoTopup(
  database: Knex,
  result: UsageDebitResult,
  getTierConfig: TierConfigLoader,
): Promise<void> {
  const transition = result.transition;
  if (
    !transition.autoTopupEnabled ||
    transition.autoTopupThresholdCredits === null ||
    transition.autoTopupPackPriceId === null ||
    transition.afterTotalBalance >= transition.autoTopupThresholdCredits
  ) {
    return;
  }

  resolveTopupPack(await getTierConfig(), transition.autoTopupPackPriceId);
  await database('auto_topup_jobs')
    .insert({
      account_id: transition.accountId,
      pack_price_id: transition.autoTopupPackPriceId,
      status: 'pending',
      attempt_count: 0,
      next_attempt_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    })
    .onConflict()
    .ignore();
}

function emitDebitTransitions(result: UsageDebitResult, events: GatewayEventEmitter): void {
  const transition = result.transition;
  const common = {
    accountId: transition.accountId,
    tenantId: transition.tenantId,
    deploymentType: transition.deploymentType,
  };
  const balanceDetails = {
    beforeBalanceCredits: transition.beforeTotalBalance.toString(),
    afterBalanceCredits: transition.afterTotalBalance.toString(),
  };

  if (
    transition.beforeTotalBalance > transition.lowBalanceThreshold &&
    transition.afterTotalBalance <= transition.lowBalanceThreshold
  ) {
    events.emit({
      type: 'low_balance_crossed',
      ...common,
      details: {
        ...balanceDetails,
        thresholdCredits: transition.lowBalanceThreshold.toString(),
      },
    });
  }
  if (transition.beforeTotalBalance > 0n && transition.afterTotalBalance <= 0n) {
    events.emit({ type: 'entered_grace', ...common, details: balanceDetails });
  }
  if (transition.beforeAvailableCredits > 0n && transition.afterAvailableCredits <= 0n) {
    events.emit({
      type: 'hard_stop',
      ...common,
      details: {
        ...balanceDetails,
        beforeAvailableCredits: transition.beforeAvailableCredits.toString(),
        afterAvailableCredits: transition.afterAvailableCredits.toString(),
      },
    });
  }
}

export function createPostDebitHandler(options: {
  database: Knex;
  getTierConfig: TierConfigLoader;
  events: GatewayEventEmitter;
}): PostDebitHandler {
  return async (result): Promise<void> => {
    emitDebitTransitions(result, options.events);
    await enqueueAutoTopup(options.database, result, options.getTierConfig);
  };
}

export { emitDebitTransitions, enqueueAutoTopup };
