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

async function getRunSteps({ db, runId }) {
  if (!db) throw new Error('getRunSteps requires db');
  if (!runId) throw new Error('getRunSteps requires runId');
  return db.query(
    `
      select
        step_id,
        run_id,
        step_path,
        definition_step_id,
        status,
        attempt,
        duration_ms,
        error_json,
        started_at,
        completed_at
      from workflow_run_steps
      where run_id = $1
      order by started_at asc, step_path asc
    `,
    [runId]
  );
}

async function getRunLogs({ db, runId, limit = 200 }) {
  if (!db) throw new Error('getRunLogs requires db');
  if (!runId) throw new Error('getRunLogs requires runId');
  return db.query(
    `
      select
        log_id,
        run_id,
        step_id,
        step_path,
        level,
        message,
        context_json,
        correlation_key,
        event_name,
        source,
        created_at
      from workflow_run_logs
      where run_id = $1
      order by created_at desc
      limit $2
    `,
    [runId, limit]
  );
}

function summarizeSteps(steps) {
  const counts = {};
  const failed = [];
  for (const s of steps) {
    const status = String(s.status || 'UNKNOWN');
    counts[status] = (counts[status] || 0) + 1;
    if (status === 'FAILED') {
      failed.push({
        stepPath: s.step_path,
        definitionStepId: s.definition_step_id,
        attempt: s.attempt,
        error: s.error_json ?? null
      });
    }
  }
  return { counts, failed };
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
  listRecentRuns,
  getRunSteps,
  getRunLogs,
  summarizeSteps
};
