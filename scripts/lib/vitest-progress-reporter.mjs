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

  onTestModuleCollected(module) {
    this.write('module-collected', { file: this.file(module) });
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
