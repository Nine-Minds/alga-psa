type PageResult<T> = {
  data: T[];
  total: number;
};

type ReadDecision = { allowed: boolean; redactedFields: readonly string[] };

function isAllowed(decision: boolean | ReadDecision): boolean {
  return typeof decision === 'boolean' ? decision : decision.allowed;
}

type AuthorizedPageInput<T> = {
  page: number;
  limit: number;
  fetchPage: (page: number, limit: number) => Promise<PageResult<T>>;
  scanLimit?: number;
} & (
  | { authorizeRecord: (record: T) => Promise<boolean>; projectRecord?: never }
  | {
      authorizeRecord: (record: T) => Promise<ReadDecision>;
      projectRecord: (record: T, redactedFields: readonly string[]) => T | null;
    }
);

export async function buildAuthorizationAwarePage<T>(input: AuthorizedPageInput<T>): Promise<PageResult<T>> {
  const requestedPage = Number.isFinite(input.page) && input.page > 0 ? Math.floor(input.page) : 1;
  const requestedLimit = Number.isFinite(input.limit) && input.limit > 0 ? Math.floor(input.limit) : 25;
  const scanLimit = Math.max(requestedLimit, input.scanLimit ?? 100);
  const pageOffset = (requestedPage - 1) * requestedLimit;
  const pageUpperBoundExclusive = pageOffset + requestedLimit;

  const authorizedRowsForPage: T[] = [];
  let authorizedTotal = 0;
  let sourcePage = 1;
  let sourceTotal = 0;

  for (;;) {
    const pageResult = await input.fetchPage(sourcePage, scanLimit);
    sourceTotal = pageResult.total;

    if (!Array.isArray(pageResult.data) || pageResult.data.length === 0) {
      break;
    }

    const decisions = await Promise.all(pageResult.data.map((row) => input.authorizeRecord(row)));

    for (let index = 0; index < pageResult.data.length; index += 1) {
      const decision = decisions[index];
      if (!isAllowed(decision)) {
        continue;
      }

      if (typeof decision !== 'boolean' && !input.projectRecord) {
        throw new Error('Authorization decisions with field policies require a record projector');
      }
      const projected = typeof decision !== 'boolean'
        ? input.projectRecord!(pageResult.data[index], decision.redactedFields)
        : pageResult.data[index];
      if (projected === null) continue;

      if (authorizedTotal >= pageOffset && authorizedTotal < pageUpperBoundExclusive) {
        authorizedRowsForPage.push(projected as T);
      }
      authorizedTotal += 1;
    }

    const scannedRows = sourcePage * scanLimit;
    const sourceExhausted = scannedRows >= sourceTotal || pageResult.data.length < scanLimit;
    if (sourceExhausted) {
      break;
    }

    sourcePage += 1;
  }

  return {
    data: authorizedRowsForPage,
    total: authorizedTotal,
  };
}

/**
 * Scan source pages until the requested output page is full, counting only rows that survive authorization and
 * projection. This is the projection boundary used by REST controllers; the lower-level action API above remains
 * available for call sites that already receive decision records.
 */
export async function buildProjectedPage<T, P>(input: {
  page: number;
  limit: number;
  fetchPage: (page: number, limit: number) => Promise<PageResult<T>>;
  projectRecord: (record: T) => Promise<P | null>;
  scanLimit?: number;
}): Promise<PageResult<P>> {
  const requestedPage = Number.isFinite(input.page) && input.page > 0 ? Math.floor(input.page) : 1;
  const requestedLimit = Number.isFinite(input.limit) && input.limit > 0 ? Math.floor(input.limit) : 25;
  const scanLimit = Math.max(requestedLimit, input.scanLimit ?? 100);
  const pageOffset = (requestedPage - 1) * requestedLimit;
  const pageEnd = pageOffset + requestedLimit;
  const data: P[] = [];
  let total = 0;
  let sourcePage = 1;

  for (;;) {
    const result = await input.fetchPage(sourcePage, scanLimit);
    if (!Array.isArray(result.data) || result.data.length === 0) break;
    for (const record of result.data) {
      const projected = await input.projectRecord(record);
      if (projected === null) continue;
      if (total >= pageOffset && total < pageEnd) data.push(projected);
      total += 1;
    }
    if (sourcePage * scanLimit >= result.total || result.data.length < scanLimit) break;
    sourcePage += 1;
  }
  return { data, total };
}
