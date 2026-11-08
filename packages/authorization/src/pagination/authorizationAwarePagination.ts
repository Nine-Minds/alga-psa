type PageResult<T> = {
  data: T[];
  total: number;
};

/**
 * Boolean-gate form. Only for callers that serialize nothing from the scanned rows; REST read paths that
 * serialize rows must use `buildProjectedPage` so what is returned is the redacted projection.
 */
export async function buildAuthorizationAwarePage<T>(input: {
  page: number;
  limit: number;
  fetchPage: (page: number, limit: number) => Promise<PageResult<T>>;
  authorizeRecord: (record: T) => Promise<boolean>;
  scanLimit?: number;
}): Promise<PageResult<T>> {
  return buildProjectedPage<T, T>({
    ...input,
    projectRecord: async (record) => ((await input.authorizeRecord(record)) ? record : null),
  });
}

/**
 * Pages over authorized rows where `projectRecord` returns the row to serialize, or null to drop it. Suppressed rows
 * are not counted in the returned total, so pagination never leaks how many rows were hidden.
 */
export async function buildProjectedPage<T, U>(input: {
  page: number;
  limit: number;
  fetchPage: (page: number, limit: number) => Promise<PageResult<T>>;
  projectRecord: (record: T) => Promise<U | null>;
  scanLimit?: number;
}): Promise<PageResult<U>> {
  const requestedPage = Number.isFinite(input.page) && input.page > 0 ? Math.floor(input.page) : 1;
  const requestedLimit = Number.isFinite(input.limit) && input.limit > 0 ? Math.floor(input.limit) : 25;
  const scanLimit = Math.max(requestedLimit, input.scanLimit ?? 100);
  const pageOffset = (requestedPage - 1) * requestedLimit;
  const pageUpperBoundExclusive = pageOffset + requestedLimit;

  const authorizedRowsForPage: U[] = [];
  let authorizedTotal = 0;
  let sourcePage = 1;
  let sourceTotal = 0;

  for (;;) {
    const pageResult = await input.fetchPage(sourcePage, scanLimit);
    sourceTotal = pageResult.total;

    if (!Array.isArray(pageResult.data) || pageResult.data.length === 0) {
      break;
    }

    const projectedByRow = await Promise.all(pageResult.data.map((row) => input.projectRecord(row)));

    for (let index = 0; index < pageResult.data.length; index += 1) {
      const projected = projectedByRow[index];
      if (projected === null || projected === undefined) {
        continue;
      }

      if (authorizedTotal >= pageOffset && authorizedTotal < pageUpperBoundExclusive) {
        authorizedRowsForPage.push(projected);
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
