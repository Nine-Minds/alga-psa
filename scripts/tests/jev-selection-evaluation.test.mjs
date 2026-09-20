import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSelection, executedBrowserTests, executedSuites, renderEvaluationMarkdown } from '../lib/jev-selection-evaluation.mjs';

const runner = '/home/runner/work/alga-psa/alga-psa/server/';
const vitestReport = (entries) => ({ testResults: entries.map(([file, status]) => ({ name: runner + file, status, assertionResults: [{ status }] })) });
const playwrightReport = {
  config: { rootDir: '/x/e2e-tests/tests' },
  suites: [{ title: 'login.spec.ts', specs: [
    { title: 'signs in', file: 'login.spec.ts', tests: [{ status: 'expected', results: [{ status: 'passed', duration: 4000 }] }] },
    { title: 'rejects', file: 'login.spec.ts', tests: [{ status: 'unexpected', results: [{ status: 'failed', duration: 9000 }] }] },
  ] }, { title: 'qbo.spec.ts', specs: [
    { title: 'exports case 1', file: 'qbo.spec.ts', tests: [{ status: 'expected', results: [{ status: 'passed', duration: 30000 }] }] },
  ] }],
};
const selection = {
  status: 'judged', head: 'abc', always: ['server/src/test/integration/floor.test.ts'],
  integration: { judgments: [
    { file: 'server/src/test/integration/floor.test.ts', probability: 0.1 },
    { file: 'server/src/test/integration/relevant.test.ts', probability: 0.8 },
    { file: 'server/src/test/integration/missed.test.ts', probability: 0.4 },
    { file: 'server/src/test/integration/unrelated.test.ts', probability: 0.05 },
  ] },
  browser: { judgments: [
    { file: 'e2e-tests/tests/login.spec.ts', title: 'signs in', probability: 0.2 },
    { file: 'e2e-tests/tests/login.spec.ts', title: 'rejects', probability: 0.6 },
    { file: 'e2e-tests/tests/qbo.spec.ts', title: 'exports ${case}', probability: 0.9 },
  ] },
};

test('executed suites merge shards and executed browser tests flatten nested suites', () => {
  const suites = executedSuites([vitestReport([['src/test/integration/a.test.ts', 'passed']]), vitestReport([['src/test/integration/a.test.ts', 'failed'], ['src/test/integration/b.test.ts', 'passed']])]);
  assert.deepEqual(suites.map(s => [s.file.slice(runner.length), s.failed]), [['src/test/integration/a.test.ts', true], ['src/test/integration/b.test.ts', false]]);
  const tests = executedBrowserTests(playwrightReport);
  assert.deepEqual(tests.map(t => [t.title, t.failed, t.duration]), [['signs in', false, 4000], ['rejects', true, 9000], ['exports case 1', false, 30000]]);
});

test('evaluation reports recall and deferred share per threshold, honors forced suites, and falls back to file judgments for expanded titles', () => {
  const integrationReports = [vitestReport([
    ['src/test/integration/floor.test.ts', 'failed'], ['src/test/integration/relevant.test.ts', 'failed'],
    ['src/test/integration/missed.test.ts', 'failed'], ['src/test/integration/unrelated.test.ts', 'passed'],
    ['src/test/integration/unjudged.test.ts', 'passed'],
  ])];
  const evaluation = evaluateSelection({ selection, integrationReports, browserReports: [playwrightReport], thresholds: [0.3, 0.5] });
  assert.equal(evaluation.selection_status, 'judged');
  const integration = evaluation.integration;
  assert.equal(integration.executed, 5);
  assert.equal(integration.judged, 4);
  assert.deepEqual(integration.unjudged, [runner + 'src/test/integration/unjudged.test.ts']);
  const [low, mid] = integration.by_threshold;
  assert.deepEqual([low.would_run, low.would_defer, low.failures_caught, low.recall], [3, 1, 3, 1]);
  assert.deepEqual([mid.would_run, mid.would_defer, mid.failures_caught, mid.recall], [2, 2, 2, 0.667]);
  assert.deepEqual(mid.missed, [{ identity: runner + 'src/test/integration/missed.test.ts', probability: 0.4 }]);
  const browser = evaluation.browser;
  assert.equal(browser.judged, 3, 'the expanded parameterized title matched through its file');
  const [, bmid] = browser.by_threshold;
  assert.deepEqual([bmid.would_run, bmid.would_defer, bmid.deferred_duration_ms, bmid.failures_caught, bmid.recall], [2, 1, 4000, 1, 1]);
  const markdown = renderEvaluationMarkdown(evaluation);
  assert.match(markdown, /### Integration suites/);
  assert.match(markdown, /\| 0\.5 \| 2 \| 2 \| 0\.5 \| 0\.0 \| 2\/3 \| 0\.667 \|/);
  assert.match(markdown, /Failures Jev would have deferred/);
});

test('an unavailable selection evaluates to its reason without scoring', () => {
  const evaluation = evaluateSelection({ selection: { status: 'unavailable', reason: 'no key' }, integrationReports: [], browserReports: [] });
  assert.equal(evaluation.selection_status, 'unavailable');
  assert.equal(evaluation.integration, undefined);
  assert.match(renderEvaluationMarkdown(evaluation), /unavailable.*no key/);
  assert.match(renderEvaluationMarkdown(evaluateSelection({ selection: null })), /missing/);
});

test('missing reports are recorded as missing inputs, never scored as zero executions', () => {
  const evaluation = evaluateSelection({ selection, integrationReports: [], browserReports: [playwrightReport] });
  assert.deepEqual(evaluation.integration, { missing_inputs: true, reason: 'No integration shard reports were available' });
  assert.equal(evaluation.browser.executed, 3);
  const markdown = renderEvaluationMarkdown(evaluation);
  assert.match(markdown, /Integration suites\n\n\*\*Not scored:\*\* No integration shard reports/);
  assert.match(markdown, /Shadow mode: non-gating/);
});
