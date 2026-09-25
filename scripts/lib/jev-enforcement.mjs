// Turn a recorded Jev judgment into what actually runs. Two pure policies:
// integration suites (file level, on top of the manifest floor and the import
// graph) and browser journeys (per test, on top of a provider-derived floor).
// Loading binds the judgment to the exact revision under test; anything else
// is "unavailable" and the caller runs everything.
import { readFileSync } from 'node:fs';

export const DEFAULT_PRUNE_THRESHOLD = 0.2;

export function loadJevSelection({ file, revision, mode = 'enforce' }) {
  let selection;
  try {
    selection = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { status: 'unavailable', reason: error.code === 'ENOENT' ? 'No jev-selection artifact' : `Unreadable jev-selection artifact: ${error.message}` };
  }
  if (selection?.schemaVersion !== 1) return { status: 'unavailable', reason: 'Unsupported jev-selection schema' };
  if (selection.status !== 'judged') return { status: 'unavailable', reason: `Judgment status ${selection.status}: ${selection.reason ?? ''}`.trim() };
  if (selection.mode !== mode) return { status: 'unavailable', reason: `Judgment recorded in ${selection.mode} mode` };
  if (selection.head !== revision) return { status: 'unavailable', reason: `Judgment is for ${String(selection.head).slice(0, 10)}, not ${String(revision).slice(0, 10)}` };
  return { status: 'applied', selection };
}

const byFile = judgments => new Map((judgments ?? []).map(judgment => [judgment.file, judgment.probability]));

/**
 * Integration policy. `floor` and `always` run unconditionally; `affected`
 * (the import graph's answer) runs unless Jev is confidently unrelated; any
 * other judged suite at or above `threshold` is added.
 */
export function applyIntegrationPolicy({ floor = [], affected = [], judgments = [], always = [], threshold, pruneThreshold = DEFAULT_PRUNE_THRESHOLD }) {
  const probability = byFile(judgments);
  const run = new Set([...floor, ...always]);
  const pruned = [];
  const graph = [];
  for (const file of affected) {
    if (run.has(file)) continue;
    const p = probability.get(file);
    if (p !== undefined && p < pruneThreshold) { pruned.push({ file, probability: p }); continue; }
    run.add(file);
    graph.push({ file, probability: p ?? null });
  }
  const added = [];
  for (const judgment of judgments) {
    if (run.has(judgment.file) || judgment.probability < threshold) continue;
    run.add(judgment.file);
    added.push({ file: judgment.file, probability: judgment.probability });
  }
  return { run: [...run].sort(), graph, added, pruned, threshold, pruneThreshold };
}

function judgmentFor(entry, judgments) {
  const title = entry.titles[entry.titles.length - 1];
  const exact = judgments.find(judgment => judgment.file === entry.file && judgment.title === title);
  if (exact) return exact.probability;
  // Parameterized titles expand at collection time; fall back to the file's strongest judgment.
  const same = judgments.filter(judgment => judgment.file === entry.file).map(judgment => judgment.probability);
  return same.length ? Math.max(...same) : null;
}

export const browserIdentity = entry => [entry.file, entry.projectId, entry.projectName, entry.titles];

/**
 * Browser policy over collected Playwright cases (playwrightTests output with
 * `line`). Floor files, changed spec files and unjudged cases always run.
 * Returns Playwright location filters relative to `cwdPrefix` (the directory
 * the CLI runs from), one per selected case.
 */
export function applyBrowserPolicy({ cases, judgments = [], floorFiles = [], changedFiles = [], threshold, cwdPrefix = 'e2e-tests/' }) {
  const forced = new Set([...floorFiles, ...changedFiles]);
  const selected = [];
  const deferred = [];
  for (const entry of cases) {
    const probability = judgmentFor(entry, judgments);
    let reason;
    if (forced.has(entry.file)) reason = 'floor';
    else if (probability === null) reason = 'unjudged';
    else if (probability >= threshold) reason = `p=${probability.toFixed(2)}`;
    if (reason) selected.push({ ...entry, probability, reason });
    else deferred.push({ identity: browserIdentity(entry), probability });
  }
  const filters = [...new Set(selected.map(entry => {
    if (!Number.isInteger(entry.line)) throw new Error(`Collected case has no location: ${entry.file}`);
    return `${entry.file.startsWith(cwdPrefix) ? entry.file.slice(cwdPrefix.length) : entry.file}:${entry.line}`;
  }))].sort();
  return { selected, deferred, filters, threshold };
}

/** Journeys the provider-readiness policy requires for an edition always run. */
export function providerFloorFiles(policy, edition) {
  const requirements = policy?.editions?.[edition]?.requirements ?? [];
  return [...new Set(requirements.map(requirement => requirement.identity?.[0]).filter(Boolean))].sort();
}
