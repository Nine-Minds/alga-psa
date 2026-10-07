import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Flaky journal for every sharded Vitest lane: unit, integration and
// infrastructure. Each runner passes --retry=1 and this reporter on the command
// line, so a fail-then-pass leaves the shard green and this file is the only
// place that retry survives: the JSON report and the merged blob never carried
// attempt counts.
//
// The lane identity arrives as constructor options for a programmatic reporter,
// or as FLAKY_SUITE / FLAKY_JOB / FLAKY_SHARD_INDEX / FLAKY_SHARD_TOTAL for the
// `--reporter=` form the runners use, which cannot pass options.
export default class VitestFlakyReporter {
  constructor(options) {
    this.options = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  }

  onInit(context) {
    this.root = context.config.root;
    this.output = path.resolve(process.env.FLAKY_TESTS_PATH || 'flaky-tests.json');
    this.tests = new Map();
    mkdirSync(path.dirname(this.output), { recursive: true });
    // One process owns this path; a rerun must not inherit stale flakes.
    this.save();
  }

  document() {
    const number = (value, fallback) => (Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback);
    const suite = this.options.suite || process.env.FLAKY_SUITE || 'unknown';
    const index = number(this.options.shard?.index ?? process.env.FLAKY_SHARD_INDEX, 1);
    const total = number(this.options.shard?.total ?? process.env.FLAKY_SHARD_TOTAL, 1);
    return {
      schemaVersion: 1, suite, job: this.options.job || process.env.FLAKY_JOB || `${suite} shard ${index}/${total}`,
      shard: { index, total }, revision: process.env.GITHUB_SHA || null,
      runId: process.env.GITHUB_RUN_ID || null, runAttempt: number(process.env.GITHUB_RUN_ATTEMPT, null),
      // Which lane produced the flake matters less than whether it was a merged
      // revision or somebody's branch, so the weekly report can count them apart.
      eventName: process.env.GITHUB_EVENT_NAME || null,
      branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || null,
      tests: [...this.tests.values()],
    };
  }

  save() {
    writeFileSync(this.output, JSON.stringify(this.document(), null, 2) + '\n');
  }

  onTestCaseResult(test) {
    const retryCount = test.diagnostic()?.retryCount ?? 0;
    if (!(retryCount > 0) || test.result().state !== 'passed') return;
    const file = path.relative(this.root, test.module.moduleId).split(path.sep).join('/');
    const testId = `${file} > ${test.fullName}`;
    const recorded = this.tests.get(testId);
    this.tests.set(testId, { testId, file, name: test.fullName, retryCount: Math.max(retryCount, recorded?.retryCount ?? 0) });
  }

  onTestRunEnd() {
    this.save();
  }
}
