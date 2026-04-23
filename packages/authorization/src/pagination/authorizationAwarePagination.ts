type PageResult<T> = {
  data: T[];
  total: number;
};

export async function buildAuthorizationAwarePage<T>(input: {
  page: number;
  limit: number;
  fetchPage: (page: number, limit: number) => Promise<PageResult<T>>;
  authorizeRecord: (record: T) => Promise<boolean>;
  scanLimit?: number;
}): Promise<PageResult<T>> {
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

    const allowedByRow = await Promise.all(pageResult.data.map((row) => input.authorizeRecord(row)));

    for (let index = 0; index < pageResult.data.length; index += 1) {
      if (!allowedByRow[index]) {
        continue;
      }

      if (authorizedTotal >= pageOffset && authorizedTotal < pageUpperBoundExclusive) {
        authorizedRowsForPage.push(pageResult.data[index] as T);
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
