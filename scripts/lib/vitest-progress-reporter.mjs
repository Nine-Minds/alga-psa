import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Diagnostic journal, not a substitute for the runner's final execution report.
// Write from the coordinator as events arrive: a stuck worker cannot prevent
// already received module/test identities from surviving a killed process.
export default class VitestProgressReporter {
  onInit(context) {
    this.root = context.config.root;
    this.output = path.resolve(process.env.TEST_PROGRESS_PATH || 'test-progress.jsonl');
    this.runId = randomUUID();
    this.sequence = 0;
    mkdirSync(path.dirname(this.output), { recursive: true });
    // One process owns this path; reruns must not inherit stale completion.
    writeFileSync(this.output, '');
    this.write('initialized', { root: this.root, revision: process.env.GITHUB_SHA || null });
  }

  write(event, data = {}) {
    appendFileSync(this.output, `${JSON.stringify({
      schemaVersion: 1, runId: this.runId, sequence: this.sequence++,
      timestamp: new Date().toISOString(), event, ...data,
    })}\n`);
  }

  file(module) {
    return path.relative(this.root, module.moduleId).split(path.sep).join('/');
  }

  onTestRunStart(specifications) {
    this.write('run-started', { files: specifications.map((spec) => this.file(spec)) });
  }

  onTestModuleQueued(module) {
    this.write('module-queued', { file: this.file(module) });
  }

  // The registrations each file reports for itself, the moment its fork has
  // imported it and before any of them runs. scripts/run-server-unit-shard.mjs
  // builds collected-tests.json from these instead of a separate `vitest list`
  // pass, which imported the whole partition a second time (about seven
  // minutes of every shard on CI). Events reach this reporter one at a time
  // over the coordinator's RPC channel, so the journal never interleaves.
  onTestModuleCollected(module) {
    const tests = [];
    for (const test of module.children.allTests()) tests.push({ name: test.fullName, mode: test.task?.mode ?? test.options?.mode ?? 'run' });
    this.write('module-collected', { file: this.file(module), projectName: module.project?.name ?? null, tests });
  }

  onTestModuleStart(module) {
    this.write('module-started', { file: this.file(module) });
  }

  onTestModuleEnd(module) {
    this.write('module-finished', { file: this.file(module), state: module.state() });
  }

  onTestCaseReady(test) {
    // Vitest also emits readiness for statically skipped cases; only the
    // result event tells whether assertions executed.
    this.write('test-ready', { file: this.file(test.module), id: test.id, name: test.fullName });
  }

  onTestCaseResult(test) {
    this.write('test-finished', {
      file: this.file(test.module), id: test.id, name: test.fullName, state: test.result().state,
    });
  }

  onTestRunEnd(modules, errors, reason) {
    this.write('run-finished', {
      reason, unhandledErrors: errors.length,
      modules: modules.map((module) => ({ file: this.file(module), state: module.state() })),
    });
  }
}

// The inventory `vitest list --json` used to produce, read back from the
// journal: one entry per runnable registration, keyed by absolute file. Static
// skip and todo registrations are left out exactly as `vitest list` left them
// out, so the execution verifier's registered-versus-executed comparison keeps
// its meaning. A file collected twice keeps its last report.
export function collectedTestsFromJournal(journal, { root: fallbackRoot } = {}) {
  const byFile = new Map();
  // Files are journaled relative to the config root the run announced in its
  // `initialized` event; a journal without one resolves against the caller's.
  let root = fallbackRoot;
  for (const line of String(journal).split('\n')) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    // A runner initialises the journal to `null`; a run that never started leaves it so.
    if (!event || typeof event !== 'object') continue;
    if (event.event === 'initialized' && typeof event.root === 'string' && event.root) { root = event.root; continue; }
    if (event.event !== 'module-collected' || typeof event.file !== 'string' || !Array.isArray(event.tests)) continue;
    if (typeof root !== 'string' || !root) throw new Error('Progress journal names no root to resolve collected files against');
    byFile.set(event.file, event.tests
      .filter((test) => typeof test?.name === 'string' && test.name && test.mode !== 'skip' && test.mode !== 'todo')
      .map((test) => ({ name: test.name, file: path.resolve(root, event.file), projectName: event.projectName || undefined })));
  }
  return [...byFile.values()].flat();
}
