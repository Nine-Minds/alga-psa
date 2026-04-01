export type CssLengthUnit = 'px' | '%' | 'rem';

type CssLengthParseOptions = {
  allowedUnits?: CssLengthUnit[];
  defaultUnit?: CssLengthUnit;
};

export type ParsedCssLength = {
  value: number | null;
  unit: CssLengthUnit;
  isCustom: boolean;
  raw: string | undefined;
};

export type ParsedCssLengthBox = {
  top: number | null;
  right: number | null;
  bottom: number | null;
  left: number | null;
  unit: CssLengthUnit;
  isCustom: boolean;
  raw: string | undefined;
};

const DEFAULT_ALLOWED_UNITS: CssLengthUnit[] = ['px', '%', 'rem'];
const SINGLE_CSS_LENGTH_RE = /^([+-]?\d+(?:\.\d+)?)(px|%|rem)?$/;

const resolveAllowedUnits = (options?: CssLengthParseOptions): CssLengthUnit[] =>
  options?.allowedUnits && options.allowedUnits.length > 0 ? options.allowedUnits : DEFAULT_ALLOWED_UNITS;

const resolveDefaultUnit = (options?: CssLengthParseOptions): CssLengthUnit =>
  options?.defaultUnit ?? options?.allowedUnits?.[0] ?? 'px';

const formatNumericValue = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(value).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');

export const getCssLengthStep = (unit: CssLengthUnit): number => (unit === 'rem' ? 0.25 : 1);

export const parseCssLength = (
  raw: string | undefined,
  options?: CssLengthParseOptions
): ParsedCssLength => {
  const defaultUnit = resolveDefaultUnit(options);
  const allowedUnits = resolveAllowedUnits(options);
  const trimmed = raw?.trim();

  if (!trimmed) {
    return { value: null, unit: defaultUnit, isCustom: false, raw: undefined };
  }

  const match = trimmed.match(SINGLE_CSS_LENGTH_RE);
  if (!match) {
    return { value: null, unit: defaultUnit, isCustom: true, raw: trimmed };
  }

  const parsedValue = Number(match[1]);
  const parsedUnit = (match[2] as CssLengthUnit | undefined) ?? defaultUnit;
  if (!Number.isFinite(parsedValue) || !allowedUnits.includes(parsedUnit)) {
    return { value: null, unit: defaultUnit, isCustom: true, raw: trimmed };
  }

  return {
    value: parsedValue,
    unit: parsedUnit,
    isCustom: false,
    raw: trimmed,
  };
};

export const formatCssLength = (
  value: number | null | undefined,
  unit: CssLengthUnit
): string | undefined => {
  if (value === null || typeof value === 'undefined' || !Number.isFinite(value)) {
    return undefined;
  }
  return `${formatNumericValue(value)}${unit}`;
};

const expandCssBoxValues = (values: number[]): [number, number, number, number] => {
  if (values.length === 1) {
    return [values[0], values[0], values[0], values[0]];
  }
  if (values.length === 2) {
    return [values[0], values[1], values[0], values[1]];
  }
  if (values.length === 3) {
    return [values[0], values[1], values[2], values[1]];
  }
  return [values[0], values[1], values[2], values[3]];
};

export const parseCssLengthBox = (
  raw: string | undefined,
  options?: CssLengthParseOptions
): ParsedCssLengthBox => {
  const defaultUnit = resolveDefaultUnit(options);
  const trimmed = raw?.trim();

  if (!trimmed) {
    return {
      top: null,
      right: null,
      bottom: null,
      left: null,
      unit: defaultUnit,
      isCustom: false,
      raw: undefined,
    };
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 4) {
    return {
      top: null,
      right: null,
      bottom: null,
      left: null,
      unit: defaultUnit,
      isCustom: true,
      raw: trimmed,
    };
  }

  const parsedTokens = tokens.map((token) => parseCssLength(token, options));
  if (parsedTokens.some((token) => token.isCustom || token.value === null)) {
    return {
      top: null,
      right: null,
      bottom: null,
      left: null,
      unit: defaultUnit,
      isCustom: true,
      raw: trimmed,
    };
  }

  const unit = parsedTokens[0].unit;
  if (parsedTokens.some((token) => token.unit !== unit)) {
    return {
      top: null,
      right: null,
      bottom: null,
      left: null,
      unit: defaultUnit,
      isCustom: true,
      raw: trimmed,
    };
  }

  const [top, right, bottom, left] = expandCssBoxValues(parsedTokens.map((token) => token.value ?? 0));
  return {
    top,
    right,
    bottom,
    left,
    unit,
    isCustom: false,
    raw: trimmed,
  };
};

export const areCssLengthBoxValuesLinked = (box: Pick<ParsedCssLengthBox, 'top' | 'right' | 'bottom' | 'left'>): boolean =>
  box.top !== null &&
  box.top === box.right &&
  box.top === box.bottom &&
  box.top === box.left;

export const formatCssLengthBox = (
  values: { top: number | null; right: number | null; bottom: number | null; left: number | null },
  unit: CssLengthUnit
): string | undefined => {
  const { top, right, bottom, left } = values;
  if (
    top === null ||
    right === null ||
    bottom === null ||
    left === null ||
    !Number.isFinite(top) ||
    !Number.isFinite(right) ||
    !Number.isFinite(bottom) ||
    !Number.isFinite(left)
  ) {
    return undefined;
  }

  const topToken = formatCssLength(top, unit);
  const rightToken = formatCssLength(right, unit);
  const bottomToken = formatCssLength(bottom, unit);
  const leftToken = formatCssLength(left, unit);
  if (!topToken || !rightToken || !bottomToken || !leftToken) {
    return undefined;
  }

  if (top === right && top === bottom && top === left) {
    return topToken;
  }
  if (top === bottom && right === left) {
    return `${topToken} ${rightToken}`;
  }
  if (right === left) {
    return `${topToken} ${rightToken} ${bottomToken}`;
  }
  return `${topToken} ${rightToken} ${bottomToken} ${leftToken}`;
};
