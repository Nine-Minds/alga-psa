function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getLatestRun({ db, workflowId, tenantId, startedAfter }) {
  const rows = await db.query(
    `
      select
        run_id,
        workflow_id,
        workflow_version,
        tenant_id,
        status,
        event_type,
        source_payload_schema_ref,
        trigger_mapping_applied,
        started_at,
        completed_at,
        updated_at,
        error_json
      from workflow_runs
      where workflow_id = $1
        and tenant_id = $2
        and started_at >= $3
      order by started_at desc
      limit 1
    `,
    [workflowId, tenantId, startedAfter]
  );
  return rows[0] ?? null;
}

async function listRecentRuns({ db, workflowId, tenantId, limit = 5 }) {
  return db.query(
    `
      select
        run_id,
        status,
        event_type,
        started_at,
        completed_at
      from workflow_runs
      where workflow_id = $1
        and tenant_id = $2
      order by started_at desc
      limit $3
    `,
    [workflowId, tenantId, limit]
  );
}

async function waitForRun({
  db,
  workflowId,
  tenantId,
  startedAfter,
  timeoutMs,
  pollMs = 500,
  terminalOnly = true
}) {
  if (!db) throw new Error('waitForRun requires db');
  if (!workflowId) throw new Error('waitForRun requires workflowId');
  if (!tenantId) throw new Error('waitForRun requires tenantId');
  if (!startedAfter) throw new Error('waitForRun requires startedAfter (ISO)');
  if (!timeoutMs || timeoutMs <= 0) throw new Error('waitForRun requires timeoutMs');

  const deadline = Date.now() + timeoutMs;
  let last = null;

  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    last = await getLatestRun({ db, workflowId, tenantId, startedAfter });
    if (last) {
      const status = String(last.status || '');
      const isTerminal = status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELED';
      if (!terminalOnly || isTerminal) return last;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(pollMs);
  }

  const recent = await listRecentRuns({ db, workflowId, tenantId, limit: 10 });
  const err = new Error(
    `Timed out waiting for workflow run (workflowId=${workflowId}, tenantId=${tenantId}, startedAfter=${startedAfter}).`
  );
  err.details = { lastSeen: last, recentRuns: recent };
  throw err;
}

module.exports = {
  waitForRun,
  listRecentRuns
};

