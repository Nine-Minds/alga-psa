import { BROWSER_HEADER } from '../record-browser-metrics.mjs';
// Read-only remote evidence collection. Test identities come from GitHub, never
// from the scorecard that is being reconciled against those identities.
export async function collectBrowserMetricExecutions({ repository, runId, revision, sheetId,
  githubToken, sheetsToken, request = fetch, timeoutMs = 60_000, maxJobPages = 10, maxSheetRows = 10_000,
} = {}) {
  let phase = 'configuration';
  const require = condition => { if (!condition) throw new Error('Invalid collection evidence'); };
  try {
    require(typeof repository === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository));
    require(/^[1-9][0-9]*$/.test(String(runId ?? '')) && /^[a-f0-9]{40}$/.test(revision ?? ''));
    require(/^[A-Za-z0-9_-]+$/.test(sheetId ?? '') && githubToken && sheetsToken);
    require(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120_000);
    require(Number.isSafeInteger(maxJobPages) && maxJobPages > 0 && maxJobPages <= 20);
    require(Number.isSafeInteger(maxSheetRows) && maxSheetRows > 0 && maxSheetRows <= 50_000);
    repository = repository.toLowerCase();
    const deadline = Date.now() + timeoutMs;
    const get = async (url, token) => {
      const remaining = deadline - Date.now();
      require(remaining > 0);
      const response = await request(url, { method: 'GET', redirect: 'error',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(remaining) });
      require(response.status === 200);
      const text = await response.text();
      require(text.length <= 16 * 1024 * 1024 && Date.now() < deadline);
      return JSON.parse(text);
    };
    const github = `https://api.github.com/repos/${repository}`;
    const runUrl = `${github}/actions/runs/${runId}`;
    const validateRun = run => {
      require(String(run?.id) === String(runId) && typeof run.repository?.full_name === 'string' && run.repository.full_name.toLowerCase() === repository);
      require(run.path === '.github/workflows/production-regression.yml');
      require(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0 && /^[a-f0-9]{40}$/.test(run.head_sha ?? ''));
      require(['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending'].includes(run.status));
      require(typeof run.event === 'string' && run.event.length > 0);
    };
    phase = 'run';
    const run = await get(runUrl, githubToken);
    validateRun(run);
    phase = 'revision';
    if (run.event === 'pull_request') {
      require(Array.isArray(run.pull_requests) && run.pull_requests.length === 1);
      // Historical run PR metadata follows the current PR head/base. Only the
      // run head is immutable here; the other merge parent is not independently
      // bound to the historical base snapshot.
      const commit = await get(`${github}/git/commits/${revision}`, githubToken);
      require(commit.sha === revision && Array.isArray(commit.parents) && commit.parents.length === 2);
      const parents = commit.parents.map(parent => parent.sha);
      require(parents.every(parent => /^[a-f0-9]{40}$/.test(parent ?? ''))
        && new Set(parents).size === 2 && parents.includes(run.head_sha));
    } else {
      require(revision === run.head_sha);
    }
    phase = 'jobs';
    const jobs = [], seen = new Set();
    let expectedCount;
    for (let page = 1; ; page++) {
      require(page <= maxJobPages);
      const response = await get(`${github}/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`, githubToken);
      require(Number.isSafeInteger(response.total_count) && response.total_count >= 0 && response.total_count <= maxJobPages * 100);
      if (expectedCount === undefined) expectedCount = response.total_count;
      require(response.total_count === expectedCount && Array.isArray(response.jobs) && response.jobs.length <= 100);
      for (const job of response.jobs) {
        require(Number.isSafeInteger(job.id) && job.id > 0 && !seen.has(job.id));
        require(String(job.run_id) === String(runId) && job.run_attempt === run.run_attempt && job.head_sha === run.head_sha && typeof job.name === 'string');
        seen.add(job.id); jobs.push(job);
      }
      require(jobs.length <= expectedCount);
      if (jobs.length === expectedCount) break;
      require(response.jobs.length === 100);
    }
    const expectedExecutions = ['community', 'enterprise'].map(edition => {
      const matching = jobs.filter(job => job.name === `browser / Production browser (${edition})`);
      require(matching.length <= 1);
      const job = matching[0];
      if (job) {
        require(['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending'].includes(job.status));
        require(job.conclusion === null || ['success', 'failure', 'cancelled', 'skipped', 'timed_out', 'action_required', 'neutral', 'stale', 'startup_failure'].includes(job.conclusion));
      }
      require(job?.steps === undefined || Array.isArray(job.steps));
      const recorders = (job?.steps ?? []).filter(step => step.name === 'Record browser journey readiness');
      require(recorders.length <= 1);
      const recorder = recorders[0];
      if (recorder) require(['queued', 'in_progress', 'completed', 'pending'].includes(recorder.status)
        && (recorder.status === 'completed'
          ? ['success', 'failure', 'cancelled', 'timed_out', 'skipped', 'neutral'].includes(recorder.conclusion)
          : recorder.conclusion === null));
      return { repository, revision, runId: String(runId), runAttempt: run.run_attempt, edition,
        eventName: run.event, runStatus: job?.status ?? (run.status === 'completed' ? 'completed' : 'pending'),
        conclusion: job ? job.conclusion : (run.conclusion === 'cancelled' ? 'cancelled' : null),
        recorderStatus: recorder?.status ?? null, recorderConclusion: recorder?.conclusion ?? null };
    });
    phase = 'sheet-metadata';
    const sheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
    const metadata = await get(`${sheetUrl}?fields=spreadsheetId,sheets.properties`, sheetsToken);
    require(metadata.spreadsheetId === sheetId && Array.isArray(metadata.sheets));
    const tabs = metadata.sheets.filter(sheet => sheet.properties?.title === 'browser_readiness');
    require(tabs.length <= 1);
    const missingTab = tabs.length === 0;
    const grid = missingTab ? { rowCount: 0, columnCount: 25 } : tabs[0].properties.gridProperties;
    // Refuse a larger grid instead of silently overlooking rows beyond a cap.
    require(Number.isSafeInteger(grid?.rowCount) && (missingTab || grid.rowCount > 0) && grid.rowCount <= maxSheetRows);
    require(Number.isSafeInteger(grid.columnCount) && grid.columnCount >= 18);
    phase = 'sheet-values';
    const allRows = missingTab ? [[...BROWSER_HEADER]] : [];
    const lastColumn = String.fromCharCode(64 + Math.min(25, grid.columnCount));
    // Each request is at most 2,000 rows x 25 columns (50,000 cells).
    // Sheets trims trailing empty rows per range; restore their absolute offsets
    // before joining chunks so internal blank rows cannot shift later evidence.
    for (let start = 1; start <= grid.rowCount; start += 2000) {
      const end = Math.min(start + 1999, grid.rowCount);
      const range = encodeURIComponent(`'browser_readiness'!A${start}:${lastColumn}${end}`);
      const values = await get(`${sheetUrl}/values/${range}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`, sheetsToken);
      const rows = values.values ?? [];
      require(values.majorDimension === 'ROWS' && Array.isArray(rows) && rows.length <= end - start + 1);
      require(rows.every(row => Array.isArray(row) && row.length <= 25 && row.every(cell => ['string', 'number', 'boolean'].includes(typeof cell))));
      allRows.push(...rows);
      for (let missing = rows.length; missing < end - start + 1; missing++) allRows.push([]);
    }
    while (allRows.length && allRows.at(-1).length === 0) allRows.pop();
    const [header, ...rows] = allRows;
    require(Array.isArray(header) && [18, 20, 25].includes(header.length) && header.every(cell => typeof cell === 'string'));
    phase = 'run-stability';
    const after = await get(runUrl, githubToken);
    validateRun(after);
    for (const key of ['id', 'run_attempt', 'status', 'conclusion', 'head_sha', 'event', 'path']) require(after[key] === run[key]);
    return { schemaVersion: 1, expectedExecutions, exportedRows: { header, rows },
      collectionMetadata: { testedRevisionSource: 'operator-supplied',
        revisionValidation: run.event === 'pull_request' ? 'merge-run-head-parent-verified' : 'run-head-verified',
        checkoutIndependentlyVerified: false,
        sheetObservation: missingTab ? 'missing-tab' : header.length < 25 ? 'legacy-header' : 'current-header' } };
  } catch {
    throw new Error(`Browser metric collection failed (${phase})`);
  }
}
