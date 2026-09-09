const workflowPath = '.github/workflows/production-regression.yml';
const checkName = 'Production regression readiness';
const positive = value => Number.isSafeInteger(value) && value > 0;

export async function verifyPublishedReadiness({ revision, repository = 'Nine-Minds/alga-psa', token, fetchImpl = fetch }) {
  const failures = [];
  let selected;
  try {
    if (!/^[a-f0-9]{40}$/.test(revision ?? '') || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Explicit repository and full source commit are required');
    const get = async route => {
      const response = await fetchImpl(`https://api.github.com/repos/${repository}/${route}`, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        redirect: 'error', signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`GitHub readiness lookup failed: HTTP ${response.status}`);
      return response.json();
    };
    const list = async (route, key) => {
      const items = []; let total;
      for (let page = 1; page <= 20; page++) {
        const data = await get(`${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
        if (!Number.isSafeInteger(data.total_count) || data.total_count < 0 || !Array.isArray(data[key])) throw new Error('Malformed GitHub collection');
        if (total !== undefined && total !== data.total_count) throw new Error('GitHub collection changed during verification');
        total = data.total_count; items.push(...data[key]);
        if (items.length === total) return items;
        if (items.length > total || !data[key].length) throw new Error('Incomplete GitHub collection');
      }
      throw new Error('GitHub collection exceeds verification limit');
    };
    const runs = await list(`actions/workflows/production-regression.yml/runs?head_sha=${revision}&event=push`, 'workflow_runs');
    if (!runs.length) throw new Error('No published readiness run for this exact commit');
    const seen = new Set();
    for (const run of runs) {
      if (!positive(run.id) || !positive(run.run_number) || !positive(run.run_attempt) || seen.has(run.id)
        || run.head_sha !== revision || run.event !== 'push' || run.path?.split('@')[0] !== workflowPath
        || run.repository?.full_name?.toLowerCase() !== repository.toLowerCase()) throw new Error('Ambiguous or mismatched readiness run');
      seen.add(run.id);
    }
    selected = [...runs].sort((a, b) => b.run_number - a.run_number)[0];
    if (selected.status !== 'completed' || selected.conclusion !== 'success') throw new Error(`Latest readiness run is ${selected.status}/${selected.conclusion}; older success cannot substitute`);
    const jobs = await list(`actions/runs/${selected.id}/attempts/${selected.run_attempt}/jobs`, 'jobs');
    const checks = jobs.filter(job => job.name === checkName);
    if (checks.length !== 1 || checks[0].head_sha !== revision || checks[0].run_id !== selected.id
      || checks[0].status !== 'completed' || checks[0].conclusion !== 'success') throw new Error('Exact-commit readiness job is missing, ambiguous or unsuccessful');
    // Reject a rerun started while reading jobs rather than mixing attempts.
    const current = await get(`actions/runs/${selected.id}`);
    if (current.run_attempt !== selected.run_attempt || current.head_sha !== revision || current.status !== 'completed' || current.conclusion !== 'success') throw new Error('Readiness run changed during verification');
  } catch (error) { failures.push(error.message); }
  return { schemaVersion: 1, scope: 'published-production-readiness', repository, revision,
    status: failures.length ? 'failed' : 'passed', runId: selected?.id, runAttempt: selected?.run_attempt, failures };
}
