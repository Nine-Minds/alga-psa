import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeTestFile } from './test-execution-evidence.mjs';

// Collection must execute the runner's module loading, not just duplicate its
// include globs. Compare file discovery with registered cases to catch empty
// files and collection errors without running test bodies or starting services.
export function collectVitestInventory({ root, runner, output, env = process.env }) {
  if (!runner.owner?.trim() || !runner.runtime?.trim()) throw new Error(`Missing runner ownership/runtime: ${runner.runner}`);
  if (runner.mandatory === false) {
    const expiry = runner.expires;
    if (!runner.reason?.trim() || !runner.issue?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(expiry ?? '')
      || !Number.isFinite(Date.parse(`${expiry}T00:00:00Z`))
      || new Date(`${expiry}T00:00:00Z`).toISOString().slice(0, 10) !== expiry
      || expiry <= new Date().toISOString().slice(0, 10)) {
      throw new Error(`Manual runner requires a reason, tracking issue and unexpired review: ${runner.runner}`);
    }
  }
  const directory = path.join(output, runner.runner);
  mkdirSync(directory, { recursive: true });
  const collect = (name, args) => {
    const report = path.join(directory, `${name}.json`);
    writeFileSync(report, '');
    const child = spawnSync(process.execPath, [path.resolve(root, runner.cli), 'list',
      '--config', runner.config, ...(runner.filters ?? []), ...args, `--json=${report}`], {
      cwd: path.resolve(root, runner.cwd), encoding: 'utf8', timeout: 300_000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...env, ...runner.env },
    });
    writeFileSync(path.join(directory, `${name}.log`),
      `${child.stdout ?? ''}\n${child.stderr ?? ''}\n${child.error?.message ?? ''}`);
    if (child.status !== 0) throw new Error(`${runner.runner} ${name} collection exited ${child.status ?? 'without an exit code'}`);
    const entries = JSON.parse(readFileSync(report, 'utf8'));
    if (!Array.isArray(entries) || !entries.length) throw new Error(`Empty ${runner.runner} ${name} collection`);
    return entries;
  };
  const files = collect('collected', ['--filesOnly']).map(entry =>
    normalizeTestFile(typeof entry === 'string' ? entry : entry.file, root));
  const cases = collect('collected-tests', []);
  const caseFiles = [...new Set(cases.map(entry => {
    if (typeof entry.name !== 'string' || !entry.name.trim()) throw new Error(`Invalid case identity: ${runner.runner}`);
    return normalizeTestFile(entry.file, root);
  }))];
  const failures = [];
  if (new Set(files).size !== files.length) failures.push(`Duplicate file collection: ${runner.runner}`);
  for (const file of files) if (!caseFiles.includes(file)) failures.push(`No registered test cases: ${file}`);
  for (const file of caseFiles) if (!files.includes(file)) failures.push(`Case outside file collection: ${file}`);
  return { runner: runner.runner, owner: runner.owner, runtime: runner.runtime,
    mandatory: runner.mandatory ?? true, status: failures.length ? 'failed' : 'passed', files: caseFiles,
    ...(runner.mandatory === false ? { reason: runner.reason, issue: runner.issue, expires: runner.expires } : {}),
    collectedTests: cases.length, failures, collectionDirectory: directory };
}
