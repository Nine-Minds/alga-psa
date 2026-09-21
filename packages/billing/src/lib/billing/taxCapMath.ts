/**
 * Exact non-negative rational used for money math. Tax percentages, caps, and
 * net amounts are finite decimals, but floating-point sums of per-rate
 * contributions drift (325 * 1.1% + 325 * 2.9% lands on 13.000000000000002).
 * Rational arithmetic keeps capped sums and period proration exact; the
 * uncapped regional path still uses the original combined-rate expression so
 * its results stay bit-identical.
 */
interface Rational {
  n: bigint;
  d: bigint;
}

export function toRational(value: number | string): Rational {
  const text = (typeof value === 'number' ? value.toString() : value).trim();
  const match = text.match(/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  if (!match) {
    throw new Error(`Tax calculation cannot represent ${text} exactly`);
  }
  const sign = match[1] === '-' ? -1n : 1n;
  const fraction = match[3] ?? '';
  let numerator = BigInt(match[2] + fraction) * sign;
  let scale = fraction.length - (match[4] ? Number(match[4]) : 0);
  if (scale < 0) {
    numerator *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { n: numerator, d: 10n ** BigInt(scale) };
}

export function rationalInteger(value: number): Rational {
  return { n: BigInt(value), d: 1n };
}

export function multiplyRational(a: Rational, b: Rational): Rational {
  return { n: a.n * b.n, d: a.d * b.d };
}

export function divideRational(a: Rational, b: Rational): Rational {
  return { n: a.n * b.d, d: a.d * b.n };
}

function addRational(a: Rational, b: Rational): Rational {
  return { n: a.n * b.d + b.n * a.d, d: a.d * b.d };
}

/** Compares a/b. Denominators are positive. */
function compareRational(a: Rational, b: Rational): number {
  const left = a.n * b.d;
  const right = b.n * a.d;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Ceiling of a rational with a positive denominator. */
function ceilRational(value: Rational): number {
  const quotient = value.n / value.d;
  const remainder = value.n % value.d;
  return Number(remainder > 0n ? quotient + 1n : quotient);
}

/** Exact `value * percentage / 100`. */
function percentageOf(value: Rational, percentage: number | string): Rational {
  return divideRational(multiplyRational(value, toRational(percentage)), rationalInteger(100));
}

/**
 * Combined regional tax for one amount. With no binding cap it returns the
 * original `ceil(amount * combinedRate / 100)` expression (bit-identical to
 * the previous implementation); when a cap binds it sums the exact capped
 * contributions instead of relying on floating point or an epsilon.
 */
export function regionalTaxAmount(
  amount: number,
  amountRational: Rational,
  rates: { percentage: number; cap: number | null }[],
  combinedTaxRate: number,
): number {
  if (amount <= 0) return 0;
  const contributions = rates.map(({ percentage, cap }) => ({
    contribution: percentageOf(amountRational, percentage),
    cap: cap === null ? null : rationalInteger(cap),
  }));
  const anyCapBinds = contributions.some(
    ({ contribution, cap }) => cap !== null && compareRational(contribution, cap) > 0,
  );
  if (!anyCapBinds) {
    return Math.ceil((amount * combinedTaxRate) / 100);
  }
  const total = contributions.reduce((sum, { contribution, cap }) => {
    const bounded = cap !== null && compareRational(contribution, cap) > 0 ? cap : contribution;
    return addRational(sum, bounded);
  }, { n: 0n, d: 1n });
  return ceilRational(total);
}

/**
 * Validate a stored/supplied cap. `null`/`undefined` means uncapped; otherwise
 * the value must be a non-negative, finite, safely representable whole number
 * (numeric strings are accepted because PostgreSQL bigint hydrates as a
 * string). Malformed or negative values throw instead of silently disabling
 * the cap or producing negative tax.
 */
export function normalizeTaxCapAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && !/^\d+$/.test(value.trim()))) {
    throw new Error('Tax rate cap amount must be a non-negative whole number.');
  }
  const cap = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(cap) || cap < 0) {
    throw new Error('Tax rate cap amount must be a non-negative whole number.');
  }
  return cap;
}
