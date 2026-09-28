import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Flaky journal for the sharded unit lane. scripts/run-server-unit-shard.mjs
// passes --retry=1 and this reporter on the command line, so a fail-then-pass
// leaves the shard green and this file is the only place that retry survives:
// the JSON report and the merged blob never carried attempt counts.
export default class VitestFlakyReporter {
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
    const index = number(process.env.SERVER_UNIT_SHARD_INDEX, 1);
    const total = number(process.env.SERVER_UNIT_SHARD_TOTAL, 1);
    return {
      schemaVersion: 1, suite: 'server-unit', job: `server-unit shard ${index}/${total}`,
      shard: { index, total }, revision: process.env.GITHUB_SHA || null,
      runId: process.env.GITHUB_RUN_ID || null, runAttempt: number(process.env.GITHUB_RUN_ATTEMPT, null),
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
