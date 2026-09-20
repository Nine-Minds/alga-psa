// Shadow-mode scoring: given what Jev would have chosen and what the real run
// executed and failed, report recall against actual failures and the share of
// executed work that would have been deferred, at several thresholds.
import { REPORT_THRESHOLDS } from './jev-test-selection.mjs';

function matchesSuffix(absolute, relative) {
  const normalized = absolute.split('\\').join('/');
  return normalized === relative || normalized.endsWith(`/${relative}`);
}

/** Map an executed absolute path back to the repository-relative identity Jev judged. */
export function resolveJudged(absolutePath, judgments) {
  return judgments.find(judgment => matchesSuffix(absolutePath, judgment.file)) ?? null;
}

/** Vitest JSON reports (one per shard) → executed suites with pass/fail. */
export function executedSuites(reports) {
  const suites = new Map();
  for (const report of reports) {
    for (const file of report?.testResults ?? []) {
      const failed = file.status === 'failed' || (file.assertionResults ?? []).some(test => test.status === 'failed');
      const prior = suites.get(file.name);
      suites.set(file.name, { file: file.name, failed: Boolean(prior?.failed) || failed });
    }
  }
  return [...suites.values()];
}

/** Playwright JSON report → executed tests with pass/fail (retries count as a failure signal). */
export function executedBrowserTests(report) {
  const tests = [];
  function visit(suite, titles) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        tests.push({ file: spec.file, title: spec.title, titles: [...titles, spec.title],
          failed: test.status === 'unexpected' || results.some(result => result.status === 'failed' || result.status === 'timedOut'),
          flaky: test.status === 'flaky', duration: results.reduce((total, result) => total + (result.duration ?? 0), 0) });
      }
    }
    for (const child of suite.suites ?? []) visit(child, [...titles, child.title]);
  }
  for (const suite of report?.suites ?? []) visit(suite, []);
  return tests;
}

function score(executed, forced, thresholds) {
  const judged = executed.filter(entry => entry.judgment);
  const unjudged = executed.filter(entry => !entry.judgment).map(entry => entry.identity);
  const failed = judged.filter(entry => entry.failed);
  const byThreshold = thresholds.map(threshold => {
    const wouldRun = entry => forced.has(entry.judgment.file) || entry.judgment.probability >= threshold;
    const caught = failed.filter(wouldRun);
    const deferred = judged.filter(entry => !wouldRun(entry));
    return {
      threshold,
      would_run: judged.length - deferred.length,
      would_defer: deferred.length,
      deferred_share: judged.length ? Number((deferred.length / judged.length).toFixed(3)) : null,
      deferred_duration_ms: deferred.reduce((total, entry) => total + (entry.duration ?? 0), 0),
      failures: failed.length,
      failures_caught: caught.length,
      recall: failed.length ? Number((caught.length / failed.length).toFixed(3)) : null,
      missed: failed.filter(entry => !wouldRun(entry)).map(entry => ({ identity: entry.identity, probability: entry.judgment.probability })),
    };
  });
  return { executed: executed.length, judged: judged.length, unjudged, failed: failed.map(entry => ({ identity: entry.identity, probability: entry.judgment.probability })), by_threshold: byThreshold };
}

export function evaluateSelection({ selection, integrationReports = [], browserReports = [], thresholds = REPORT_THRESHOLDS }) {
  const status = selection?.status ?? 'missing';
  const result = { schemaVersion: 1, revision: selection?.head ?? null, selection_status: status, thresholds };
  if (status !== 'judged') {
    result.reason = selection?.reason ?? 'No judged selection to evaluate';
    return result;
  }
  const forced = new Set(selection.always ?? []);
  const suiteJudgments = selection.integration?.judgments ?? [];
  const integration = executedSuites(integrationReports).map(entry => ({
    identity: entry.file, failed: entry.failed, judgment: resolveJudged(entry.file, suiteJudgments),
  }));
  result.integration = score(integration, forced, thresholds);
  const browserJudgments = selection.browser?.judgments ?? [];
  const browser = browserReports.flatMap(report => executedBrowserTests(report)).map(entry => {
    const exact = browserJudgments.find(judgment => matchesSuffix(entry.file, judgment.file.replace(/^e2e-tests\/tests\//, '')) && judgment.title === entry.title)
      ?? browserJudgments.find(judgment => matchesSuffix(entry.file, judgment.file) && judgment.title === entry.title);
    // Parameterized titles expand at run time; fall back to the file's strongest judgment.
    const fallback = browserJudgments.filter(judgment => matchesSuffix(entry.file, judgment.file) || matchesSuffix(entry.file, judgment.file.replace(/^e2e-tests\/tests\//, '')))
      .sort((a, b) => b.probability - a.probability)[0] ?? null;
    return { identity: `${entry.file}::${entry.title}`, failed: entry.failed || entry.flaky, duration: entry.duration, judgment: exact ?? fallback };
  });
  result.browser = score(browser, forced, thresholds);
  return result;
}

export function renderEvaluationMarkdown(evaluation) {
  const lines = [`## Jev test selection (shadow)`, ''];
  if (evaluation.selection_status !== 'judged') {
    lines.push(`Selection status: **${evaluation.selection_status}**. ${evaluation.reason ?? ''}`);
    return lines.join('\n');
  }
  for (const [label, block] of [['Integration suites', evaluation.integration], ['Browser tests', evaluation.browser]]) {
    if (!block) continue;
    lines.push(`### ${label}`, '', `Executed ${block.executed}, judged ${block.judged}, failed ${block.failed.length}.`, '');
    lines.push('| threshold | would run | would defer | deferred share | deferred minutes | failures caught | recall |', '|---|---|---|---|---|---|---|');
    for (const row of block.by_threshold) {
      lines.push(`| ${row.threshold} | ${row.would_run} | ${row.would_defer} | ${row.deferred_share ?? 'n/a'} | ${(row.deferred_duration_ms / 60000).toFixed(1)} | ${row.failures_caught}/${row.failures} | ${row.recall ?? 'n/a'} |`);
    }
    const missed = block.by_threshold.flatMap(row => row.missed.map(miss => `- p=${miss.probability.toFixed(2)} at threshold ${row.threshold}: ${miss.identity}`));
    if (missed.length) lines.push('', '**Failures Jev would have deferred:**', ...[...new Set(missed)]);
    if (block.unjudged.length) lines.push('', `Executed but not judged (${block.unjudged.length}): ${block.unjudged.slice(0, 5).join(', ')}${block.unjudged.length > 5 ? ', …' : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}
