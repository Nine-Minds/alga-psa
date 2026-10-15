import { normalizeTestFile } from './test-execution-evidence.mjs';

// Node has no side-effect-free collection phase for dynamically registered
// subtests. Compare repository files with actual file summaries, then reconcile
// registrations observed during execution with terminal test events. Do not
// label a filename scan or an empty file's wrapper as an executed test case.
export function reconcileNodeExecution({ root, files, events, exitCode, suite, revision }) {
  const failures = [];
  const expected = files.map((file) => normalizeTestFile(file, root));
  if (!expected.length) failures.push('Required Node test inventory is empty');
  if (new Set(expected).size !== expected.length) failures.push('Duplicate required Node test files');
  if (exitCode !== 0) failures.push(`Node runner exited with ${exitCode ?? 'no exit code'}`);
  const summaries = new Map();
  const registrations = new Map();
  const outcomes = new Map();
  const totals = [];
  let currentFile;
  const identity = (data) => JSON.stringify([currentFile, data.file, data.name, data.line, data.column, data.nesting]);
  const increment = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  const counts = { tests: 0, passed: 0, failed: 0, skipped: 0, todo: 0, cancelled: 0 };
  const cases = [];
  for (const { type, data } of events) {
    let wrapper = false;
    if (data.line === 1 && data.column === 1 && data.nesting === 0) {
      try { wrapper = normalizeTestFile(data.name, root) === normalizeTestFile(data.file, root); } catch { /* not a file identity */ }
    }
    if (type === 'test:dequeue' && wrapper) {
      currentFile = normalizeTestFile(data.file, root);
      if (!expected.includes(currentFile)) failures.push(`Unexpected executed file: ${currentFile}`);
      continue;
    }
    if (type === 'test:summary') {
      if (!data.file) { totals.push(data); continue; }
      const file = normalizeTestFile(data.file, root);
      if (!expected.includes(file)) failures.push(`Unexpected file summary: ${file}`);
      if (summaries.has(file)) failures.push(`Duplicate file summary: ${file}`);
      summaries.set(file, data);
      if (!data.success) failures.push(`File failed: ${file}`);
      if (!(data.counts?.tests > 0)) failures.push(`No executed test cases: ${file}`);
      for (const key of Object.keys(counts)) {
        const value = data.counts?.[key];
        if (!Number.isSafeInteger(value) || value < 0) failures.push(`Invalid ${key} count: ${file}`);
        else counts[key] += value;
      }
      continue;
    }
    if (wrapper || type === 'test:dequeue' || data.type === 'suite' || data.details?.type === 'suite') continue;
    if (!currentFile) { failures.push('Test event without owning file'); continue; }
    if (type === 'test:enqueue') increment(registrations, identity(data));
    if (type === 'test:pass' || type === 'test:fail') {
      increment(outcomes, identity(data));
      const status = data.skip ? 'skipped' : data.todo ? 'todo' : type === 'test:fail' ? 'failed' : 'passed';
      cases.push({ file: currentFile, sourceFile: data.file, name: data.name, line: data.line, column: data.column, nesting: data.nesting, status });
      if (status !== 'passed') failures.push(`${status}: ${currentFile} > ${data.name}`);
    }
  }
  for (const file of expected) {
    if (!summaries.has(file)) failures.push(`Missing completed file: ${file}`);
    if (!cases.some((entry) => entry.file === file)) failures.push(`No executed test cases: ${file}`);
  }
  for (const [key, count] of registrations) {
    if (outcomes.get(key) !== count) failures.push(`Registered/completed test count differs: ${key}`);
  }
  for (const key of outcomes.keys()) {
    if (!registrations.has(key)) failures.push(`Completed test was not registered: ${key}`);
  }
  if (totals.length !== 1 || totals[0]?.success !== true) failures.push('Missing, duplicate or unsuccessful final Node summary');
  for (const [key, value] of Object.entries(counts)) {
    if (totals[0]?.counts?.[key] !== value) failures.push(`File/global ${key} counts differ`);
    if (['failed', 'skipped', 'todo', 'cancelled'].includes(key) && value !== 0) failures.push(`Unexpected ${key} tests: ${value}`);
  }
  if (cases.length !== counts.tests) failures.push('Test identities differ from the reported test count');
  return {
    schemaVersion: 1, suite, revision, runtime: process.version,
    status: failures.length ? 'failed' : 'passed', failures,
    collectionMode: 'file inventory plus registrations observed during execution',
    expectedFiles: expected, executedFiles: [...summaries.keys()], counts, tests: cases,
  };
}
