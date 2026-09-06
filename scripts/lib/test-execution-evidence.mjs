import path from 'node:path';

export function normalizeTestFile(file, root) {
  if (typeof file !== 'string' || !file) throw new Error('Missing test file identity');
  return path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
}

export function reconcileExecution({ collected, report, root, suite, revision, exitCode }) {
  const failures = [];
  const expected = collected.map((entry) => normalizeTestFile(typeof entry === 'string' ? entry : entry.file, root));
  if (!expected.length) failures.push('Required collection is empty');
  if (new Set(expected).size !== expected.length) failures.push('Duplicate collected file identities');
  if (exitCode !== 0) failures.push(`Runner exited with ${exitCode ?? 'no exit code'}`);
  if (!report || !Array.isArray(report.testResults)) failures.push('Missing execution report');
  if (report?.success !== true) failures.push('Runner did not report success');
  const actual = new Map();
  const counts = { passed: 0, failed: 0, skipped: 0, todo: 0, pending: 0 };
  for (const file of report?.testResults ?? []) {
    const name = normalizeTestFile(file.name, root);
    if (actual.has(name)) failures.push(`Duplicate executed file: ${name}`);
    actual.set(name, file);
    if (!expected.includes(name)) failures.push(`Unexpected executed file: ${name}`);
    if (file.status === 'failed' || file.message) failures.push(`File failed: ${name}`);
    let executed = 0;
    for (const assertion of file.assertionResults ?? []) {
      const status = assertion.status;
      if (!(status in counts)) failures.push(`Unknown assertion status ${status}: ${name}`);
      else counts[status]++;
      if (status === 'passed' || status === 'failed') executed++;
      if (status === 'pending' || status === 'failed') failures.push(`${status}: ${name} > ${assertion.fullName}`);
    }
    // A suite whose setup silently skips every test does not provide DB
    // coverage, even if the runner exits successfully.
    if (!executed) failures.push(`No executed assertions: ${name}`);
  }
  for (const file of expected) if (!actual.has(file)) failures.push(`Missing executed file: ${file}`);
  const assertions = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (report && report.numTotalTests !== assertions) failures.push('Reported total differs from assertion inventory');
  if (report?.numRuntimeErrorTestSuites > 0) failures.push('Runtime/collection errors reported');
  return {
    schemaVersion: 1, suite, revision,
    status: failures.length ? 'failed' : 'passed',
    expectedFiles: expected, executedFiles: [...actual.keys()], counts, failures,
  };
}
