import { requirePositiveBigint, type BigintValue } from '../db/bigint.js';
import type { LedgerBucket, LedgerEntryType } from '../db/types.js';

export interface BalanceMovement {
  entryType: LedgerEntryType;
  bucket: LedgerBucket;
  credits: bigint;
  balanceAfter: bigint;
}

export interface BalancePlan {
  includedBalance: bigint;
  topupBalance: bigint;
  movements: BalanceMovement[];
}

function minimum(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

export function planUsageDebit(
  includedBalance: bigint,
  topupBalance: bigint,
  creditsToDebit: BigintValue,
): BalancePlan {
  let nextIncludedBalance = includedBalance;
  let nextTopupBalance = topupBalance;
  let remainingDebit = requirePositiveBigint(creditsToDebit, 'creditsToDebit');
  const movements: BalanceMovement[] = [];

  if (nextIncludedBalance > 0n) {
    const includedDebit = minimum(nextIncludedBalance, remainingDebit);
    nextIncludedBalance -= includedDebit;
    remainingDebit -= includedDebit;
    movements.push({
      entryType: 'usage_debit',
      bucket: 'included',
      credits: -includedDebit,
      balanceAfter: nextIncludedBalance + nextTopupBalance,
    });
  }

  if (remainingDebit > 0n) {
    nextTopupBalance -= remainingDebit;
    movements.push({
      entryType: 'usage_debit',
      bucket: 'topup',
      credits: -remainingDebit,
      balanceAfter: nextIncludedBalance + nextTopupBalance,
    });
  }

  return {
    includedBalance: nextIncludedBalance,
    topupBalance: nextTopupBalance,
    movements,
  };
}

export function planMonthlyRenewal(
  includedBalance: bigint,
  topupBalance: bigint,
  monthlyAllotment: BigintValue,
): BalancePlan {
  const allotment = requirePositiveBigint(monthlyAllotment, 'monthlyAllotment');
  let nextIncludedBalance = includedBalance;
  const movements: BalanceMovement[] = [];

  if (nextIncludedBalance > 0n) {
    const expiredCredits = nextIncludedBalance;
    nextIncludedBalance = 0n;
    movements.push({
      entryType: 'expiry',
      bucket: 'included',
      credits: -expiredCredits,
      balanceAfter: topupBalance,
    });
  }

  nextIncludedBalance += allotment;
  movements.push({
    entryType: 'grant_included',
    bucket: 'included',
    credits: allotment,
    balanceAfter: nextIncludedBalance + topupBalance,
  });

  return {
    includedBalance: nextIncludedBalance,
    topupBalance,
    movements,
  };
}
