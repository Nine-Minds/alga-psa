import process from 'node:process';

import {
  requireNonNegativeBigint,
  requirePositiveBigint,
  type BigintValue,
} from '../db/bigint.js';

const TOKENS_PER_RATE_UNIT = 1_000n;

export interface PricingRecord {
  pricingId: string;
  modelPattern: string;
  inputCreditsPer1kTokens: BigintValue;
  outputCreditsPer1kTokens: BigintValue;
  effectiveFrom: Date;
}

export interface DefaultPricingRate {
  inputCreditsPer1kTokens: BigintValue;
  outputCreditsPer1kTokens: BigintValue;
}

export interface ResolvedPricingRate {
  inputCreditsPer1kTokens: bigint;
  outputCreditsPer1kTokens: bigint;
  source: 'configured' | 'default';
  pricingId: string | null;
  modelPattern: string | null;
}

export interface TokenUsage {
  promptTokens: BigintValue;
  completionTokens: BigintValue;
}

interface PatternSpecificity {
  literalCharacters: number;
  wildcardCharacters: number;
}

function escapeRegularExpression(character: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}

function modelPatternToRegularExpression(pattern: string): RegExp {
  let source = '^';
  for (const character of pattern) {
    if (character === '*') {
      source += '.*';
    } else if (character === '?') {
      source += '.';
    } else {
      source += escapeRegularExpression(character);
    }
  }
  return new RegExp(`${source}$`);
}

function getPatternSpecificity(pattern: string): PatternSpecificity {
  let literalCharacters = 0;
  let wildcardCharacters = 0;
  for (const character of pattern) {
    if (character === '*' || character === '?') {
      wildcardCharacters += 1;
    } else {
      literalCharacters += 1;
    }
  }
  return { literalCharacters, wildcardCharacters };
}

function compareSpecificity(left: PricingRecord, right: PricingRecord): number {
  const leftSpecificity = getPatternSpecificity(left.modelPattern);
  const rightSpecificity = getPatternSpecificity(right.modelPattern);

  if (leftSpecificity.literalCharacters !== rightSpecificity.literalCharacters) {
    return rightSpecificity.literalCharacters - leftSpecificity.literalCharacters;
  }
  if (leftSpecificity.wildcardCharacters !== rightSpecificity.wildcardCharacters) {
    return leftSpecificity.wildcardCharacters - rightSpecificity.wildcardCharacters;
  }

  const effectiveDateDifference = right.effectiveFrom.getTime() - left.effectiveFrom.getTime();
  if (effectiveDateDifference !== 0) {
    return effectiveDateDifference;
  }

  return left.pricingId.localeCompare(right.pricingId);
}

function normalizeRate(rate: DefaultPricingRate, context: string): DefaultPricingRate & {
  inputCreditsPer1kTokens: bigint;
  outputCreditsPer1kTokens: bigint;
} {
  return {
    inputCreditsPer1kTokens: requirePositiveBigint(
      rate.inputCreditsPer1kTokens,
      `${context}.inputCreditsPer1kTokens`,
    ),
    outputCreditsPer1kTokens: requirePositiveBigint(
      rate.outputCreditsPer1kTokens,
      `${context}.outputCreditsPer1kTokens`,
    ),
  };
}

export function resolvePricingRate(
  records: readonly PricingRecord[],
  model: string,
  now: Date,
  defaultRate: DefaultPricingRate,
): ResolvedPricingRate {
  if (!model) {
    throw new Error('model is required');
  }

  const configuredRate = records
    .filter(
      (record) =>
        record.modelPattern.length > 0 &&
        record.effectiveFrom.getTime() <= now.getTime() &&
        modelPatternToRegularExpression(record.modelPattern).test(model),
    )
    .sort(compareSpecificity)[0];

  if (!configuredRate) {
    const normalizedDefault = normalizeRate(defaultRate, 'defaultRate');
    return {
      ...normalizedDefault,
      source: 'default',
      pricingId: null,
      modelPattern: null,
    };
  }

  const normalizedConfiguredRate = normalizeRate(configuredRate, 'configuredRate');
  return {
    ...normalizedConfiguredRate,
    source: 'configured',
    pricingId: configuredRate.pricingId,
    modelPattern: configuredRate.modelPattern,
  };
}

export function calculateCredits(usage: TokenUsage, rate: DefaultPricingRate): bigint {
  const promptTokens = requireNonNegativeBigint(usage.promptTokens, 'usage.promptTokens');
  const completionTokens = requireNonNegativeBigint(
    usage.completionTokens,
    'usage.completionTokens',
  );
  const normalizedRate = normalizeRate(rate, 'rate');

  const numerator =
    promptTokens * normalizedRate.inputCreditsPer1kTokens +
    completionTokens * normalizedRate.outputCreditsPer1kTokens;

  if (numerator === 0n) {
    return 0n;
  }

  return (numerator + TOKENS_PER_RATE_UNIT - 1n) / TOKENS_PER_RATE_UNIT;
}

export function loadDefaultPricingRateFromEnvironment(): DefaultPricingRate {
  const inputRate = process.env.AI_GATEWAY_DEFAULT_INPUT_CREDITS_PER_1K_TOKENS;
  const outputRate = process.env.AI_GATEWAY_DEFAULT_OUTPUT_CREDITS_PER_1K_TOKENS;

  if (!inputRate || !outputRate) {
    throw new Error(
      'AI_GATEWAY_DEFAULT_INPUT_CREDITS_PER_1K_TOKENS and ' +
        'AI_GATEWAY_DEFAULT_OUTPUT_CREDITS_PER_1K_TOKENS are required before metered traffic is enabled',
    );
  }

  return normalizeRate(
    {
      inputCreditsPer1kTokens: inputRate,
      outputCreditsPer1kTokens: outputRate,
    },
    'defaultPricingEnvironment',
  );
}
