import { NextRequest } from 'next/server';

export interface FieldRangeRequest {
  selector: string;
  start: number;
  end: number;
}

export interface TruncatedFieldMetadata {
  selector: string;
  total_bytes: number;
  returned_bytes: number;
  requested_range_start: number;
  requested_range_end: number;
  actual_range_start: number;
  actual_range_end: number | null;
  truncated: boolean;
  has_more: boolean;
  encoding: 'utf-8';
}

interface ApplyFieldRangeResult<T> {
  data: T;
  truncatedFields?: Record<string, TruncatedFieldMetadata>;
}

const FIELD_RANGES_PARAM = /^field_ranges\[(.+)\]$/;
const BYTE_RANGE_PATTERN = /^(\d+)-(\d+)$/;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

function parseRangeSpec(range: string): { start: number; end: number } | null {
  const match = BYTE_RANGE_PATTERN.exec(range.trim());
  if (!match) {
    return null;
  }

  const start = Number.parseInt(match[1] ?? '', 10);
  const end = Number.parseInt(match[2] ?? '', 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    return null;
  }

  return { start, end };
}

function readSearchParams(source?: NextRequest | URL | string): URLSearchParams | null {
  if (!source) {
    return null;
  }

  if (source instanceof NextRequest) {
    return source.nextUrl.searchParams;
  }

  if (source instanceof URL) {
    return source.searchParams;
  }

  try {
    return new URL(source).searchParams;
  } catch {
    return null;
  }
}

export function parseFieldRangeRequests(
  source?: NextRequest | URL | string,
): FieldRangeRequest[] {
  const searchParams = readSearchParams(source);
  if (!searchParams) {
    return [];
  }

  const requests = new Map<string, FieldRangeRequest>();

  for (const [key, value] of searchParams.entries()) {
    const range = parseRangeSpec(value);
    if (!range) {
      continue;
    }

    const bracketMatch = FIELD_RANGES_PARAM.exec(key);
    if (!bracketMatch) {
      continue;
    }

    const selector = (bracketMatch[1] ?? '').trim();
    if (!selector) {
      continue;
    }

    requests.set(selector, { selector, ...range });
  }

  const selector = searchParams.get('field')?.trim();
  const rangeValue = searchParams.get('range');
  if (selector && rangeValue) {
    const range = parseRangeSpec(rangeValue);
    if (range) {
      requests.set(selector, { selector, ...range });
    }
  }

  return Array.from(requests.values());
}

function cloneContainer<T>(value: T): T {
  if (Array.isArray(value)) {
    return [...value] as T;
  }

  if (value && typeof value === 'object') {
    return { ...(value as Record<string, unknown>) } as T;
  }

  return value;
}

function selectorMatches(selector: string, pathSegments: string[]): boolean {
  const normalizedPath = pathSegments.filter((segment) => !/^\d+$/.test(segment));
  if (normalizedPath.length === 0) {
    return false;
  }

  const selectorSegments = selector
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (selectorSegments.length === 0) {
    return false;
  }

  if (selectorSegments.length === 1) {
    return normalizedPath[normalizedPath.length - 1] === selectorSegments[0];
  }

  if (selectorSegments.length > normalizedPath.length) {
    return false;
  }

  const startIndex = normalizedPath.length - selectorSegments.length;
  return selectorSegments.every((segment, index) => normalizedPath[startIndex + index] === segment);
}

function toResponsePath(pathSegments: string[]): string {
  if (pathSegments.length === 0) {
    return 'data';
  }

  let rendered = 'data';
  for (const segment of pathSegments) {
    rendered += /^\d+$/.test(segment) ? `[${segment}]` : `.${segment}`;
  }
  return rendered;
}

function decodeRange(buffer: Buffer, start: number, endInclusive: number): {
  text: string;
  actualStart: number;
  actualEnd: number | null;
} {
  if (buffer.length === 0 || start >= buffer.length) {
    return { text: '', actualStart: Math.min(start, buffer.length), actualEnd: null };
  }

  const clampedStart = Math.max(0, start);
  const clampedEndExclusive = Math.min(buffer.length, endInclusive + 1);
  if (clampedEndExclusive <= clampedStart) {
    return { text: '', actualStart: clampedStart, actualEnd: null };
  }

  for (let startOffset = 0; startOffset < 4 && clampedStart + startOffset < clampedEndExclusive; startOffset += 1) {
    const candidateStart = clampedStart + startOffset;
    for (let endOffset = 0; endOffset < 4 && clampedEndExclusive - endOffset > candidateStart; endOffset += 1) {
      const candidateEndExclusive = clampedEndExclusive - endOffset;
      try {
        const text = utf8Decoder.decode(buffer.subarray(candidateStart, candidateEndExclusive));
        return {
          text,
          actualStart: candidateStart,
          actualEnd: candidateEndExclusive - 1,
        };
      } catch {
        // Try a narrower byte window until we land on valid UTF-8 boundaries.
      }
    }
  }

  return { text: '', actualStart: clampedStart, actualEnd: null };
}

function truncateString(
  value: string,
  request: FieldRangeRequest,
): { value: string; metadata: TruncatedFieldMetadata } {
  const buffer = Buffer.from(value, 'utf8');
  const totalBytes = buffer.length;
  const decoded = decodeRange(buffer, request.start, request.end);
  const returnedBytes = Buffer.byteLength(decoded.text, 'utf8');
  const truncated =
    totalBytes > returnedBytes ||
    decoded.actualStart !== 0 ||
    (decoded.actualEnd ?? -1) < totalBytes - 1;

  return {
    value: decoded.text,
    metadata: {
      selector: request.selector,
      total_bytes: totalBytes,
      returned_bytes: returnedBytes,
      requested_range_start: request.start,
      requested_range_end: request.end,
      actual_range_start: decoded.actualStart,
      actual_range_end: decoded.actualEnd,
      truncated,
      has_more: totalBytes > 0 && ((decoded.actualEnd ?? -1) < totalBytes - 1),
      encoding: 'utf-8',
    },
  };
}

function applyRequestsRecursively(
  value: unknown,
  requests: FieldRangeRequest[],
  pathSegments: string[],
  truncatedFields: Record<string, TruncatedFieldMetadata>,
): unknown {
  if (typeof value === 'string') {
    const matchingRequest = requests.find((request) => selectorMatches(request.selector, pathSegments));
    if (!matchingRequest) {
      return value;
    }

    const truncated = truncateString(value, matchingRequest);
    truncatedFields[toResponsePath(pathSegments)] = truncated.metadata;
    return truncated.value;
  }

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item, index) => {
      const updated = applyRequestsRecursively(item, requests, [...pathSegments, String(index)], truncatedFields);
      if (!Object.is(updated, item)) {
        changed = true;
      }
      return updated;
    });
    return changed ? next : value;
  }

  if (value && typeof value === 'object') {
    let changed = false;
    const clone = cloneContainer(value as Record<string, unknown>);
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const updated = applyRequestsRecursively(child, requests, [...pathSegments, key], truncatedFields);
      if (!Object.is(updated, child)) {
        changed = true;
        (clone as Record<string, unknown>)[key] = updated;
      }
    }
    return changed ? clone : value;
  }

  return value;
}

export function applyFieldRangeRequests<T>(
  data: T,
  source?: NextRequest | URL | string,
): ApplyFieldRangeResult<T> {
  const requests = parseFieldRangeRequests(source);
  if (requests.length === 0) {
    return { data };
  }

  const truncatedFields: Record<string, TruncatedFieldMetadata> = {};
  const nextData = applyRequestsRecursively(data, requests, [], truncatedFields) as T;

  if (Object.keys(truncatedFields).length === 0) {
    return { data: nextData };
  }

  return {
    data: nextData,
    truncatedFields,
  };
}
