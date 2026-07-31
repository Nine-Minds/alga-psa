import process from 'node:process';

import type { Knex } from 'knex';

import { requireNonNegativeBigint, requirePositiveBigint } from '../db/bigint.js';

const BASIS_POINTS_DENOMINATOR = 10_000n;

export interface TopupPack {
  priceId: string;
  credits: bigint;
}

export interface TierConfig {
  monthlyIncludedCredits: bigint;
  gracePercentBasisPoints: bigint;
  topupPacks: TopupPack[];
  lowBalanceThreshold: bigint;
}

export type TierConfigLoader = () => Promise<TierConfig>;

interface TierConfigRow {
  monthly_included_credits: string;
  grace_percent_basis_points: number;
  topup_packs: unknown;
  low_balance_threshold: string;
}

function requireObject(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function creditIntegerString(value: unknown, context: string): string {
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  throw new Error(`${context} must be an integer string or bigint`);
}

function basisPointsIntegerString(value: unknown, context: string): string {
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return value;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value.toString();
  }
  throw new Error(`${context} must be an integer string or safe integer number`);
}

function parseTopupPacks(value: unknown, context: string): TopupPack[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }
  const seenPriceIds = new Set<string>();
  return value.map((rawPack, index) => {
    const pack = requireObject(rawPack, `${context}[${index}]`);
    const priceId = typeof pack.priceId === 'string' ? pack.priceId.trim() : '';
    if (!priceId) {
      throw new Error(`${context}[${index}].priceId is required`);
    }
    if (seenPriceIds.has(priceId)) {
      throw new Error(`${context} contains duplicate priceId ${priceId}`);
    }
    seenPriceIds.add(priceId);
    return {
      priceId,
      credits: requirePositiveBigint(
        creditIntegerString(pack.credits, `${context}[${index}].credits`),
        `${context}[${index}].credits`,
      ),
    };
  });
}

export function parseTierConfig(value: unknown, context = 'tier config'): TierConfig {
  const config = requireObject(value, context);
  const monthlyIncludedCredits = requirePositiveBigint(
    creditIntegerString(config.monthlyIncludedCredits, `${context}.monthlyIncludedCredits`),
    `${context}.monthlyIncludedCredits`,
  );
  const gracePercentBasisPoints = requireNonNegativeBigint(
    basisPointsIntegerString(config.gracePercentDefault, `${context}.gracePercentDefault`),
    `${context}.gracePercentDefault`,
  );
  if (gracePercentBasisPoints > BASIS_POINTS_DENOMINATOR) {
    throw new Error(`${context}.gracePercentDefault must be at most 10000 basis points`);
  }
  return {
    monthlyIncludedCredits,
    gracePercentBasisPoints,
    topupPacks: parseTopupPacks(config.topupPacks, `${context}.topupPacks`),
    lowBalanceThreshold: requireNonNegativeBigint(
      creditIntegerString(
        config.lowBalanceThresholdDefault,
        `${context}.lowBalanceThresholdDefault`,
      ),
      `${context}.lowBalanceThresholdDefault`,
    ),
  };
}

function parseEnvironmentTierConfig(value: string | undefined): TierConfig {
  if (!value?.trim()) {
    throw new Error('AI_GATEWAY_TIER_CONFIG is required when tier_config has no row');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('AI_GATEWAY_TIER_CONFIG must be valid JSON');
  }
  return parseTierConfig(parsed, 'AI_GATEWAY_TIER_CONFIG');
}

function parseTierConfigRow(row: TierConfigRow): TierConfig {
  return parseTierConfig(
    {
      monthlyIncludedCredits: row.monthly_included_credits,
      gracePercentDefault: row.grace_percent_basis_points,
      topupPacks: row.topup_packs,
      lowBalanceThresholdDefault: row.low_balance_threshold,
    },
    'tier_config row',
  );
}

export async function loadTierConfig(
  database: Knex,
  environmentValue = process.env.AI_GATEWAY_TIER_CONFIG,
): Promise<TierConfig> {
  const rows = await database<TierConfigRow>('tier_config')
    .orderBy('updated_at', 'desc')
    .limit(2);
  if (rows.length > 1) {
    throw new Error('tier_config must contain at most one row for the single-tier gateway');
  }
  const row = rows[0];
  return row ? parseTierConfigRow(row) : parseEnvironmentTierConfig(environmentValue);
}

export function calculateGraceLimit(config: TierConfig): bigint {
  return (
    (config.monthlyIncludedCredits * config.gracePercentBasisPoints) /
    BASIS_POINTS_DENOMINATOR
  );
}

export function resolveTopupPack(config: TierConfig, priceId: string): TopupPack {
  const pack = config.topupPacks.find((candidate) => candidate.priceId === priceId);
  if (!pack) {
    throw new Error(`Top-up price ${priceId} is not configured in the active tier`);
  }
  return pack;
}
