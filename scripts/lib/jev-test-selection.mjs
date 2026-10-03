// Ask Jev, per candidate, whether a test would plausibly catch a regression
// from the change. One Noul per candidate, many candidates per request over the
// same change state, so the change is transmitted once per batch. Policy that
// turns probabilities into a run set lives in decideSelection and is pure.
import { renderDigest } from './test-digest.mjs';

export const DEFAULT_THRESHOLD = 0.5;
export const REPORT_THRESHOLDS = [0.3, 0.5, 0.7];
const CHUNK = 40;
// Measured 2026-09-20: TypeSafe rejects requests somewhere between 42k and 48k
// input tokens with max_tokens_exceeded, at about 3.3 chars per token. Pack
// each batch under 36k tokens estimated conservatively, and split on rejection.
export const BATCH_BUDGET_CHARS = 36_000 * 3.2;

const SHARED_SETUP = 'Shared setup that nearly every test performs (creating a tenant, seeding an admin user, signing in) '
  + 'is not overlap with the change. Judge the behavior the test actually asserts. '
  + 'The files in `change.files` are the evidence of what changed; `change.title` and `change.body` only state intent, '
  + 'and a test or feature merely mentioned there is not thereby affected.';

function suiteQuestion(key) {
  return {
    type: 'noul',
    instructions: {
      question: `If the code change in \`change\` introduced a bug, would the test suite in \`candidates.${key}\` plausibly fail because of it?`,
      inspect: `\`candidates.${key}\``,
      compare: '`change`',
      focus: `Compare the suite's tests, imports, database tables and routes with the files, symbols, tables and excerpts the change touches. ${SHARED_SETUP}`,
    },
    criteria: {
      true: {
        what: 'The suite exercises code paths, database tables, routes or business behavior that the change modifies, or that depend directly on what changed.',
        examples: [
          'A migration alters the invoices table and the suite generates and reads invoices.',
          'The change edits ticket close rules and the suite closes tickets.',
          'The change edits a shared billing calculation and the suite asserts invoice totals built on it.',
        ],
      },
      false: {
        what: 'The suite covers an unrelated feature area; the only overlap is generic infrastructure, shared fixtures, or a module it mocks out.',
        examples: [
          'A migration adds a column to quote items and the suite tests SLA pause configuration.',
          'The change edits a React component and the suite only tests scheduling database models.',
        ],
        not_for: 'Do not answer false merely because the dependency is indirect. Answer false when the suite would keep passing even if the changed code were broken.',
      },
    },
  };
}

function browserTestQuestion(key) {
  return {
    type: 'noul',
    instructions: {
      question: `If the code change in \`change\` introduced a bug, would the browser test in \`candidates.${key}\` plausibly fail because of it?`,
      inspect: `\`candidates.${key}\``,
      compare: '`change`',
      focus: `The candidate is one end-to-end browser journey: its title states what it asserts, and its file's routes, tables and fixtures show what it drives. ${SHARED_SETUP}`,
    },
    criteria: {
      true: {
        what: 'The journey drives screens, routes, or data that the change modifies, or asserts an outcome the changed code produces.',
        examples: [
          'The change edits the invoice generation action and the journey generates and downloads an invoice.',
          'A migration alters portal identity tables and the journey signs in through the client portal.',
        ],
      },
      false: {
        what: 'The journey covers a different area of the product; it would keep passing even if the changed code were broken.',
        examples: [
          'The change edits the QuickBooks export mapping and the journey tests Microsoft calendar OAuth.',
          'The change adds a column to ticket bundle tables and the journey only exercises Stripe checkout.',
        ],
      },
    },
  };
}

export const QUESTIONS = { suite: suiteQuestion, 'browser-test': browserTestQuestion };

function candidateState(candidate, kind) {
  if (kind === 'suite') return renderDigest(candidate.digest);
  const rendered = renderDigest(candidate.digest, { includeTests: false });
  return { test: candidate.title, ...rendered };
}

function makeRequest(change, entries) {
  const state = { change, candidates: {} };
  const questions = {};
  const keys = [];
  for (const entry of entries) {
    keys.push([entry.key, entry.candidate.id]);
    state.candidates[entry.key] = entry.state;
    questions[entry.key] = entry.question;
  }
  return { state, questions, keys };
}

/**
 * Pack candidates into batches over the same change, each under the request
 * budget (measured in serialized characters) and at most `chunkSize` long.
 * A candidate that cannot fit beside the change still goes alone.
 */
export function buildRequests({ change, candidates, kind, chunkSize = CHUNK, budgetChars = BATCH_BUDGET_CHARS }) {
  if (!QUESTIONS[kind]) throw new Error(`Unknown candidate kind: ${kind}`);
  const base = JSON.stringify({ state: { change, candidates: {} }, questions: {} }).length;
  const requests = [];
  let current = [];
  let size = base;
  for (const [index, candidate] of candidates.entries()) {
    const key = `c${index}`;
    const entry = { key, candidate, state: candidateState(candidate, kind), question: QUESTIONS[kind](key) };
    const cost = JSON.stringify(entry.state).length + JSON.stringify(entry.question).length + key.length * 2 + 8;
    if (current.length && (current.length >= chunkSize || size + cost > budgetChars)) {
      requests.push(makeRequest(change, current));
      current = [];
      size = base;
    }
    current.push(entry);
    size += cost;
  }
  if (current.length) requests.push(makeRequest(change, current));
  return requests;
}

function splitRequest(request) {
  const half = Math.ceil(request.keys.length / 2);
  return [request.keys.slice(0, half), request.keys.slice(half)].map(keys => ({
    keys,
    state: { change: request.state.change, candidates: Object.fromEntries(keys.map(([key]) => [key, request.state.candidates[key]])) },
    questions: Object.fromEntries(keys.map(([key]) => [key, request.questions[key]])),
  }));
}

function isTokenLimit(error) {
  return /max_tokens_exceeded/.test(String(error.body ?? error.message ?? ''));
}

async function judgeRequest({ client, request, kind, label, byId }) {
  let response;
  try {
    response = await client.systemOne({ state: request.state, questions: request.questions });
  } catch (error) {
    // The token ceiling is not documented; halve the batch and try again.
    if (isTokenLimit(error) && request.keys.length > 1) {
      const halves = splitRequest(request);
      const results = await Promise.all(halves.map((half, i) => judgeRequest({ client, request: half, kind, label: `${label}.${i + 1}`, byId })));
      return results.flat();
    }
    const detail = error.body ? ` ${String(error.body).slice(0, 500)}` : '';
    throw new Error(`${kind} batch ${label} (${request.keys.length} candidates, ${JSON.stringify(request.state).length} chars): ${error.message}${detail}`);
  }
  return request.keys.map(([key, id]) => {
    const answer = response.answers?.[key];
    if (!answer || typeof answer.noul !== 'number') throw new Error(`No noul answer for ${id}`);
    const candidate = byId.get(id);
    return { id, file: candidate.file, ...(candidate.title ? { title: candidate.title } : {}), probability: answer.noul };
  });
}

/** Judge every candidate; returns [{ id, file, title?, probability }] in candidate order. */
export async function judgeCandidates({ client, change, candidates, kind, chunkSize = CHUNK, budgetChars = BATCH_BUDGET_CHARS }) {
  const requests = buildRequests({ change, candidates, kind, chunkSize, budgetChars });
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const results = await Promise.all(requests.map((request, index) => judgeRequest({ client, request, kind, label: `${index + 1}/${requests.length}`, byId })));
  return results.flat();
}

/**
 * Pure policy. `always` are identities that run regardless (manifest floor,
 * changed test files). Judgments at or above the threshold run; the rest defer
 * to the nightly full run. When judgments are unavailable, everything runs.
 */
export function decideSelection({ judgments, always = [], threshold = DEFAULT_THRESHOLD, available = true }) {
  const forced = new Set(always);
  const run = [];
  const defer = [];
  for (const judgment of judgments) {
    const identity = judgment.title ? `${judgment.file}::${judgment.title}` : judgment.file;
    let reason;
    if (!available) reason = 'judgments unavailable';
    else if (forced.has(judgment.file) || forced.has(identity)) reason = 'always';
    else if (judgment.probability >= threshold) reason = `p=${judgment.probability.toFixed(2)} >= ${threshold}`;
    if (reason) run.push({ ...judgment, reason });
    else defer.push({ ...judgment, reason: `p=${judgment.probability.toFixed(2)} < ${threshold}` });
  }
  return { threshold, run, defer };
}
