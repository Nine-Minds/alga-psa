import path from 'node:path';
import { realpathSync } from 'node:fs';

function canonicalPath(file) {
  try { return realpathSync(file); } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    return path.resolve(file);
  }
}

export function normalizeTestFile(file, root) {
  if (typeof file !== 'string' || !file) throw new Error('Missing test file identity');
  const relative = path.relative(canonicalPath(root), canonicalPath(path.resolve(root, file)));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Test identity is outside the repository: ${file}`);
  }
  return relative.split(path.sep).join('/');
}

// Bind a manifest's partition and assertion claims to independently recomputed
// raw report evidence. A passing report alone does not identify its partition.
export function compareExecutionEvidence(evidence, verified, label = 'Execution') {
  const failures = [];
  const canonical = values => JSON.stringify((values || []).map(value => JSON.stringify(value)).sort());
  for (const key of ['expectedFiles', 'executedFiles', 'expectedTests', 'executedTests']) {
    if (canonical(evidence[key]) !== canonical(verified[key])) failures.push(`${label} ${key} disagrees with its raw report`);
  }
  for (const [key, count] of Object.entries(verified.counts)) {
    if (evidence.counts?.[key] !== count) failures.push(`${label} ${key} count disagrees with its raw report`);
  }
  return failures;
}

export function reconcileExecution({ collected, report, root, suite, revision, exitCode, collectedTests }) {
  const failures = [];
  const expected = collected.map((entry) => normalizeTestFile(typeof entry === 'string' ? entry : entry.file, root));
  if (!expected.length) failures.push('Required collection is empty');
  if (new Set(expected).size !== expected.length) failures.push('Duplicate collected file identities');
  if (exitCode !== 0) failures.push(`Runner exited with ${exitCode ?? 'no exit code'}`);
  if (!report || !Array.isArray(report.testResults)) failures.push('Missing execution report');
  if (report?.success !== true) failures.push('Runner did not report success');
  const expectedTests = new Map();
  const executedTests = new Map();
  const identity = (file, name) => JSON.stringify([normalizeTestFile(file, root), name]);
  if (collectedTests !== undefined) {
    if (!Array.isArray(collectedTests) || !collectedTests.length) failures.push('Required test collection is empty');
    for (const entry of collectedTests ?? []) {
      if (typeof entry.name !== 'string' || !entry.name) {
        failures.push('Collected test has no name');
        continue;
      }
      const key = identity(entry.file, entry.name);
      expectedTests.set(key, (expectedTests.get(key) ?? 0) + 1);
    }
    for (const file of expected) {
      if (!(collectedTests ?? []).some((entry) => normalizeTestFile(entry.file, root) === file)) {
        failures.push(`No collected tests in required file: ${file}`);
      }
    }
  }
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
      const nameParts = [...(assertion.ancestorTitles ?? []), assertion.title].filter((part) => part !== undefined);
      const testName = nameParts.length ? nameParts.join(' > ') : assertion.fullName;
      const key = identity(file.name, testName);
      executedTests.set(key, (executedTests.get(key) ?? 0) + 1);
      if (!(status in counts)) failures.push(`Unknown assertion status ${status}: ${name}`);
      else counts[status]++;
      if (status === 'passed' || status === 'failed') executed++;
      if (['pending', 'failed', 'skipped', 'todo'].includes(status)) failures.push(`${status}: ${name} > ${assertion.fullName}`);
    }
    // A suite whose setup silently skips every test does not provide DB
    // coverage, even if the runner exits successfully.
    if (!executed) failures.push(`No executed assertions: ${name}`);
  }
  for (const file of expected) if (!actual.has(file)) failures.push(`Missing executed file: ${file}`);
  if (collectedTests !== undefined) {
    for (const [key, count] of expectedTests) {
      if (executedTests.get(key) !== count) failures.push(`Collected/executed test count differs: ${key}`);
    }
    for (const key of executedTests.keys()) {
      if (!expectedTests.has(key)) failures.push(`Unexpected executed test: ${key}`);
    }
  }
  const assertions = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (report && report.numTotalTests !== assertions) failures.push('Reported total differs from assertion inventory');
  if (report?.numRuntimeErrorTestSuites > 0) failures.push('Runtime/collection errors reported');
  return {
    schemaVersion: 1, suite, revision,
    status: failures.length ? 'failed' : 'passed',
    expectedFiles: expected, executedFiles: [...actual.keys()],
    expectedTests: [...expectedTests].map(([identity, count]) => ({ identity: JSON.parse(identity), count })),
    executedTests: [...executedTests].map(([identity, count]) => ({ identity: JSON.parse(identity), count })),
    counts, failures,
  };
}
