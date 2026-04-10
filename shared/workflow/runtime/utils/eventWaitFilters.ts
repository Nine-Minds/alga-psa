import type { EventWaitFilter } from '../types';

type Scalar = string | number | boolean | null;

const isScalar = (value: unknown): value is Scalar =>
  value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

const getPayloadPathValue = (payload: unknown, path: string): { found: boolean; value: unknown } => {
  const trimmed = String(path ?? '').trim();
  if (!trimmed) return { found: false, value: undefined };

  const parts = trimmed.split('.').map((part) => part.trim()).filter(Boolean);
  let cursor: unknown = payload;

  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
      return { found: false, value: undefined };
    }
    if (!Object.prototype.hasOwnProperty.call(cursor, part)) {
      return { found: false, value: undefined };
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }

  return { found: true, value: cursor };
};

const asComparableScalar = (value: unknown): string | number | null => {
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (value === null) return null;
  return null;
};

const evaluateFilterClause = (payload: unknown, filter: EventWaitFilter): boolean => {
  const { found, value } = getPayloadPathValue(payload, filter.path);

  if (filter.op === 'exists') {
    return found && isScalar(value);
  }
  if (filter.op === 'not_exists') {
    return !found || !isScalar(value);
  }

  if (!found || !isScalar(value)) {
    return false;
  }

  if (filter.op === 'in' || filter.op === 'not_in') {
    if (!Array.isArray(filter.value)) return false;
    const includes = filter.value.some((item) => item === value);
    return filter.op === 'in' ? includes : !includes;
  }

  if (filter.op === '=' || filter.op === '!=') {
    const matches = value === filter.value;
    return filter.op === '=' ? matches : !matches;
  }

  if (filter.op === 'contains') {
    return typeof value === 'string' && typeof filter.value === 'string' && value.includes(filter.value);
  }

  if (filter.op === 'starts_with') {
    return typeof value === 'string' && typeof filter.value === 'string' && value.startsWith(filter.value);
  }

  if (filter.op === 'ends_with') {
    return typeof value === 'string' && typeof filter.value === 'string' && value.endsWith(filter.value);
  }

  const left = asComparableScalar(value);
  const right = asComparableScalar(filter.value);
  if (left === null || right === null || typeof left !== typeof right) {
    return false;
  }

  switch (filter.op) {
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    default:
      return false;
  }
};

export const evaluateEventWaitFilters = (payload: unknown, filters: EventWaitFilter[] | undefined): boolean => {
  if (!filters?.length) {
    return true;
  }
  return filters.every((filter) => evaluateFilterClause(payload, filter));
};
