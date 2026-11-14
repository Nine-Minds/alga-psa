#!/usr/bin/env node
// Judge every integration suite and browser test against the change with Jev
// and record the result. In shadow mode (the default) nothing downstream reads
// the decision; scripts/evaluate-jev-selection.mjs scores it against what the
// real run executed and failed. Enforcing mode is gated on that evidence.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readChangedFiles } from './lib/integration-selection.mjs';
import { digestChange, readChangeContext, readUnifiedDiff } from './lib/change-digest.mjs';
import { digestTestPath, findTestFiles } from './lib/test-digest.mjs';
import { createTypeSafeClient } from './lib/typesafe-client.mjs';
import { buildRequests, decideSelection, judgeCandidates, DEFAULT_THRESHOLD } from './lib/jev-test-selection.mjs';
import { providerFloorFiles } from './lib/jev-enforcement.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INTEGRATION_DIRS = ['server/src/test/integration', 'ee/temporal-workflows/src/__tests__/integration'];
const BROWSER_DIRS = ['e2e-tests/tests'];
const manifestPath = 'server/src/test/integration/tier1.manifest.json';
const providerPolicyPath = 'scripts/browser-provider-requirements.json';
// Sign-in is the boot smoke for the browser lane; everything else the browser
// floor contains is what provider readiness already requires.
const BROWSER_FLOOR = ['e2e-tests/tests/login.spec.ts'];
const mode = process.env.JEV_SELECTION_MODE || 'shadow';
const dryRun = process.env.JEV_DRY_RUN === '1';
const threshold = Number(process.env.JEV_THRESHOLD || DEFAULT_THRESHOLD);
const output = path.join(root, 'test-results/selection');
mkdirSync(output, { recursive: true });
const started = Date.now();

function warn(message) {
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : `WARNING: ${message}`);
}

function summarize(lines) {
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}

// The artifact carries the outcome; the job itself never fails, because a
// failed judgment must degrade to "run everything", not block the pipeline.
function finish(selection) {
  selection.elapsed_ms = Date.now() - started;
  writeFileSync(path.join(output, 'jev-selection.json'), JSON.stringify(selection, null, 2) + '\n');
  process.exit(0);
}

const base = process.env.JEV_BASE_SHA || process.env.TIER1_BASE_SHA || '';
const headRef = process.env.JEV_HEAD_SHA || process.env.TIER1_HEAD_SHA || 'HEAD';
// Record the resolved revision: the runners bind a judgment to the exact SHA they test.
const head = spawnSync('git', ['rev-parse', '--verify', '--end-of-options', `${headRef}^{commit}`], { cwd: root, encoding: 'utf8' }).stdout.trim() || headRef;
const selection = { schemaVersion: 1, mode, status: 'pending', base: base || null, head, threshold };

try {
  const changed = readChangedFiles({ cwd: root, base, head });
  if (changed === null) {
    selection.status = 'unavailable';
    selection.reason = 'Change evidence unavailable (missing base revision); every test runs';
    summarize([`Jev selection: ${selection.reason}`]);
    finish(selection);
  }
  const context = readChangeContext({ cwd: root, head });
  const change = digestChange({ files: readUnifiedDiff({ cwd: root, base, head }), title: context.title, body: context.body });
  selection.change = { title: context.title, number: context.number, source: context.source, file_counts: change.file_counts, changed_files: change.changed_files, rendered_chars: JSON.stringify(change).length };

  const suiteFiles = findTestFiles(root, INTEGRATION_DIRS, /\.test\.[cm]?[jt]sx?$/);
  const suites = suiteFiles.map(file => ({ id: file, file, digest: digestTestPath(root, file) }));
  const browser = findTestFiles(root, BROWSER_DIRS, /\.spec\.[cm]?[jt]sx?$/).flatMap(file => {
    const digest = digestTestPath(root, file);
    return digest.tests.map(test => ({ id: `${file}::${test.title}`, file, title: test.title, line: test.line, digest }));
  });

  // The manifest floor and any changed test file run regardless of judgment.
  const { paths } = JSON.parse(readFileSync(path.join(root, manifestPath), 'utf8'));
  const floor = paths.map(entry => path.posix.normalize(path.posix.join('server', entry)));
  const always = new Set(changed.filter(file => suiteFiles.includes(file) || file.startsWith('e2e-tests/tests/')));
  for (const file of suiteFiles) if (floor.some(entry => file === entry || file.startsWith(`${entry}/`))) always.add(file);
  const providerPolicy = JSON.parse(readFileSync(path.join(root, providerPolicyPath), 'utf8'));
  for (const edition of Object.keys(providerPolicy.editions ?? {})) for (const file of providerFloorFiles(providerPolicy, edition)) always.add(file);
  for (const file of BROWSER_FLOOR) always.add(file);
  selection.always = [...always].sort();

  const requests = { suite: buildRequests({ change, candidates: suites, kind: 'suite' }), 'browser-test': buildRequests({ change, candidates: browser, kind: 'browser-test' }) };
  selection.requests = Object.fromEntries(Object.entries(requests).map(([kind, batches]) => [kind, {
    batches: batches.length, candidates: batches.reduce((n, b) => n + b.keys.length, 0),
    chars: batches.reduce((n, b) => n + JSON.stringify({ state: b.state, questions: b.questions }).length, 0),
  }]));

  if (dryRun) {
    selection.status = 'dry-run';
    selection.reason = 'JEV_DRY_RUN=1: requests were built but not sent';
    writeFileSync(path.join(output, 'jev-requests.sample.json'), JSON.stringify({ suite: requests.suite[0], 'browser-test': requests['browser-test'][0] }, null, 2) + '\n');
    summarize([`Jev selection dry run: ${JSON.stringify(selection.requests)}`, `Change rendered as ${selection.change.rendered_chars} chars; always-run entries: ${selection.always.length}`]);
    finish(selection);
  }

  const client = createTypeSafeClient();
  if (!client.available) {
    selection.status = 'unavailable';
    selection.reason = 'TYPESAFE_API_KEY is not configured; every test runs';
    warn(selection.reason);
    summarize([`Jev selection: ${selection.reason}`]);
    finish(selection);
  }
  selection.model = client.model;
  const [suiteJudgments, browserJudgments] = await Promise.all([
    judgeCandidates({ client, change, candidates: suites, kind: 'suite' }),
    judgeCandidates({ client, change, candidates: browser, kind: 'browser-test' }),
  ]);
  selection.integration = { candidates: suites.length, judgments: suiteJudgments,
    decision: decideSelection({ judgments: suiteJudgments, always: selection.always, threshold }) };
  selection.browser = { candidates: browser.length, judgments: browserJudgments,
    decision: decideSelection({ judgments: browserJudgments, always: selection.always, threshold }) };
  selection.usage = client.usage;
  selection.status = 'judged';

  const top = (judgments, n) => [...judgments].sort((a, b) => b.probability - a.probability).slice(0, n)
    .map(j => `| ${j.probability.toFixed(2)} | ${j.title ? `${j.file} › ${j.title}` : j.file} |`);
  summarize([
    `## Jev test selection (${mode})`, '',
    ...(mode === 'shadow' ? ['Shadow mode: non-gating. These judgments change nothing that runs; an unavailable key or API failure runs everything.', ''] : []),
    `Change: ${context.title || '(untitled)'} — ${change.changed_files.length} files, rendered ${selection.change.rendered_chars} chars.`,
    `Integration: ${suites.length} suites judged; at threshold ${threshold} would run ${selection.integration.decision.run.length}, defer ${selection.integration.decision.defer.length} (${selection.always.length} always-run).`,
    `Browser: ${browser.length} tests judged; would run ${selection.browser.decision.run.length}, defer ${selection.browser.decision.defer.length}.`,
    `Usage: ${client.usage.requests} requests, ${client.usage.input_tokens} input tokens, ${client.usage.retries} retries.`, '',
    '| p | integration suite |', '|---|---|', ...top(suiteJudgments, 15), '',
    '| p | browser test |', '|---|---|', ...top(browserJudgments, 15), '',
  ]);
  finish(selection);
} catch (error) {
  selection.status = 'failed';
  selection.reason = error.message;
  warn(`Jev selection failed: ${error.message}`);
  finish(selection);
}
