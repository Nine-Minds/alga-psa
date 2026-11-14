/**
 * Paging for a filter the server cannot express.
 *
 * The v1 list routes take one status at a time, but the Projects and Assets
 * filter sheets are multi-select, so the extra statuses are narrowed on the
 * device. Narrowing one server page can leave nothing to render while matches
 * wait on later pages — and an empty list has no end for FlatList to reach, so
 * the list would sit there empty. This walks past server pages that narrow to
 * nothing and reports no total while narrowing, because the server's total
 * counts the unfiltered set.
 */

export type PageSlice<T> = {
  items: T[];
  page: number;
  hasNext: boolean;
  total: number;
};

/** Server pages one call will walk before giving the list what it has. */
const MAX_PAGES_PER_CALL = 5;

export async function collectFilteredPage<T>(params: {
  startPage: number;
  /** Resolves null when the caller has handled a failure or the request was aborted. */
  loadPage: (page: number) => Promise<PageSlice<T> | null>;
  /** Omitted when the server did all the filtering, in which case its total is exact. */
  keep?: (item: T) => boolean;
  maxPages?: number;
}): Promise<{ items: T[]; page: number; hasNext: boolean; total: number | null } | null> {
  const { keep } = params;
  const limit = params.maxPages ?? MAX_PAGES_PER_CALL;
  const items: T[] = [];
  let page = params.startPage;
  let hasNext = false;
  let total: number | null = null;

  for (let fetched = 0; fetched < limit; fetched += 1) {
    const slice = await params.loadPage(page);
    if (!slice) return null;

    items.push(...(keep ? slice.items.filter(keep) : slice.items));
    page = slice.page;
    hasNext = slice.hasNext;
    total = keep ? null : slice.total;

    // Out of budget: report the last page actually fetched, so the list's next
    // request resumes from it rather than skipping a page.
    if (!keep || !hasNext || items.length > 0 || fetched + 1 >= limit) break;
    page += 1;
  }

  return { items, page, hasNext, total };
}
