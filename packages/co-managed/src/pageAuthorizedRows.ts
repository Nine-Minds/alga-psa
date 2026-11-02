/** Bounded keyset scan shared by native collection readers. Authorization and
 * projection stay at the call site; this layer owns the work budget and page. */
export const AUTHORIZED_ROW_WINDOW_SIZE = 50;
export const AUTHORIZED_ROW_MAX_WINDOWS = 4;
export const AUTHORIZED_ROW_MAX_PAGE = 10_000;

export interface AuthorizedPageResult<T> {
  rows: T[];
  total: number;
  totalExact: boolean;
  exhausted: boolean;
}

export async function pageAuthorizedRows<C, T>(options: {
  page: number;
  pageSize: number;
  maxWindows?: number;
  fetchCandidates: (after: C | null, limit: number) => Promise<C[]>;
  authorize: (candidate: C) => Promise<T | null>;
  matches: (row: T) => boolean;
  searchMatches?: (row: T) => boolean;
}): Promise<AuthorizedPageResult<T>> {
  if (!Number.isSafeInteger(options.page) || options.page < 1 || options.page > AUTHORIZED_ROW_MAX_PAGE ||
      !Number.isSafeInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 100) {
    throw new RangeError('Authorized row pages require page >= 1 and pageSize between 1 and 100');
  }
  const requestedWindows = options.maxWindows ?? AUTHORIZED_ROW_MAX_WINDOWS;
  if (!Number.isSafeInteger(requestedWindows) || requestedWindows < 1) {
    throw new RangeError('Authorized row window budget must be a positive integer');
  }
  // Callers may reserve less work for a phase, but can never raise the
  // request-wide ceiling by passing a larger value.
  const maxWindows = Math.min(requestedWindows, AUTHORIZED_ROW_MAX_WINDOWS);
  const target = (options.page - 1) * options.pageSize;
  if (!Number.isSafeInteger(target)) throw new RangeError('Authorized row page offset is too large');
  let after: C | null = null, windows = 0, exhausted = false, matched = 0;
  const rows: T[] = [];
  while (windows < maxWindows) {
    const candidates = await options.fetchCandidates(after, AUTHORIZED_ROW_WINDOW_SIZE);
    windows++;
    if (!candidates.length) { exhausted = true; break; }
    for (const candidate of candidates) {
      after = candidate;
      const row = await options.authorize(candidate);
      if (!row || !options.matches(row)) continue;
      if (options.searchMatches && !options.searchMatches(row)) continue;
      matched++;
      if (matched > target && rows.length < options.pageSize) rows.push(row);
    }
    if (candidates.length < AUTHORIZED_ROW_WINDOW_SIZE) { exhausted = true; break; }
  }
  return { rows, total: matched, totalExact: exhausted, exhausted };
}
