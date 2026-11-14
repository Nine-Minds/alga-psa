import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequests, decideSelection, judgeCandidates } from '../lib/jev-test-selection.mjs';
import { digestTestFile } from '../lib/test-digest.mjs';

const change = { title: 'Alter invoices', files: [{ path: 'server/migrations/x.cjs', kind: 'migration', database_tables: ['invoices'] }] };
const suite = (file, body) => ({ id: file, file, digest: digestTestFile(file, body) });
const suites = [
  suite('server/src/test/integration/a.test.ts', "it('generates invoices', async () => { await db('invoices'); });"),
  suite('server/src/test/integration/b.test.ts', "it('pauses sla', async () => { await db('sla_policies'); });"),
  suite('server/src/test/integration/c.test.ts', "it('c', () => {});"),
];

test('requests batch candidates over one change state with a question per candidate', () => {
  const requests = buildRequests({ change, candidates: suites, kind: 'suite', chunkSize: 2 });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].keys, [['c0', suites[0].id], ['c1', suites[1].id]]);
  assert.deepEqual(requests[1].keys, [['c2', suites[2].id]]);
  assert.equal(requests[0].state.change, change);
  assert.deepEqual(requests[0].state.candidates.c0.database_tables, ['invoices']);
  assert.equal(requests[0].questions.c1.type, 'noul');
  assert.match(requests[0].questions.c1.instructions.question, /`candidates\.c1`/);
  assert.match(requests[0].questions.c1.instructions.compare, /`change`/);
  assert.ok(requests[0].questions.c1.criteria.true.what && requests[0].questions.c1.criteria.false.not_for);
  assert.throws(() => buildRequests({ change, candidates: suites, kind: 'unit' }), /Unknown candidate kind/);
});

test('browser candidates carry the test title and drop sibling test titles', () => {
  const digest = digestTestFile('e2e-tests/tests/x.spec.ts', "test('one', async ({ page }) => { await page.goto('/msp/a'); });\ntest('two', async () => {});");
  const candidates = digest.tests.map(t => ({ id: `${digest.file}::${t.title}`, file: digest.file, title: t.title, digest }));
  const [request] = buildRequests({ change, candidates, kind: 'browser-test' });
  assert.equal(request.state.candidates.c0.test, 'one');
  assert.equal(request.state.candidates.c0.tests, undefined);
  assert.deepEqual(request.state.candidates.c0.routes_visited, ['/msp/a']);
  assert.match(request.questions.c1.instructions.question, /browser test in `candidates\.c1`/);
});

test('judgments map answers back to candidates and reject missing answers', async () => {
  const client = { systemOne: async ({ questions }) => ({ answers: Object.fromEntries(Object.keys(questions).map((key, i) => [key, { type: 'noul', noul: key === 'c1' ? 0.1 : 0.9 }])) }) };
  const judgments = await judgeCandidates({ client, change, candidates: suites, kind: 'suite', chunkSize: 2 });
  assert.deepEqual(judgments.map(j => [j.file, j.probability]), [[suites[0].file, 0.9], [suites[1].file, 0.1], [suites[2].file, 0.9]]);
  const broken = { systemOne: async () => ({ answers: {} }) };
  await assert.rejects(judgeCandidates({ client: broken, change, candidates: suites, kind: 'suite' }), /No noul answer/);
});

test('policy runs forced identities and confident candidates, defers the rest, and runs everything when unavailable', () => {
  const judgments = [
    { id: 'a', file: 'a.test.ts', probability: 0.9 },
    { id: 'b', file: 'b.test.ts', probability: 0.2 },
    { id: 'c', file: 'c.test.ts', probability: 0.5 },
    { id: 'd', file: 'x.spec.ts', title: 'journey', probability: 0.05 },
  ];
  const decision = decideSelection({ judgments, always: ['b.test.ts', 'x.spec.ts::journey'], threshold: 0.5 });
  assert.deepEqual(decision.run.map(j => [j.id, j.reason]), [['a', 'p=0.90 >= 0.5'], ['b', 'always'], ['c', 'p=0.50 >= 0.5'], ['d', 'always']]);
  assert.deepEqual(decision.defer, []);
  const strict = decideSelection({ judgments, threshold: 0.7 });
  assert.deepEqual(strict.run.map(j => j.id), ['a']);
  assert.deepEqual(strict.defer.map(j => j.id), ['b', 'c', 'd']);
  const unavailable = decideSelection({ judgments, threshold: 0.7, available: false });
  assert.equal(unavailable.run.length, 4);
  assert.ok(unavailable.run.every(j => j.reason === 'judgments unavailable'));
});

test('batches pack by serialized size under the budget and never lose a candidate', () => {
  const big = Array.from({ length: 12 }, (_, i) => suite(`server/src/test/integration/big${i}.test.ts`, `it('${'title '.repeat(200)}${i}', () => {});`));
  const requests = buildRequests({ change, candidates: big, kind: 'suite', budgetChars: 9000 });
  assert.ok(requests.length > 1 && requests.length < 12, `expected several packed batches, got ${requests.length}`);
  assert.deepEqual(requests.flatMap(r => r.keys.map(([, id]) => id)), big.map(c => c.id));
  for (const request of requests) assert.ok(JSON.stringify({ state: request.state, questions: request.questions }).length <= 9000 + 3000);
  const alone = buildRequests({ change, candidates: big.slice(0, 1), kind: 'suite', budgetChars: 10 });
  assert.equal(alone.length, 1, 'an oversized candidate still goes alone');
});

test('a batch rejected for its token count is halved and retried until it fits', async () => {
  const seen = [];
  const client = { systemOne: async ({ questions }) => {
    const keys = Object.keys(questions);
    seen.push(keys.length);
    if (keys.length > 1) { const error = new Error('TypeSafe responded 400'); error.body = '{"detail":{"error_type":"max_tokens_exceeded"}}'; throw error; }
    return { answers: { [keys[0]]: { type: 'noul', noul: 0.7 } } };
  } };
  const judgments = await judgeCandidates({ client, change, candidates: suites, kind: 'suite' });
  assert.deepEqual(judgments.map(j => [j.file, j.probability]), suites.map(s => [s.file, 0.7]));
  assert.deepEqual(seen.sort((a, b) => b - a), [3, 2, 1, 1, 1]);
  const other = { systemOne: async () => { const error = new Error('TypeSafe responded 422'); error.body = 'bad'; throw error; } };
  await assert.rejects(judgeCandidates({ client: other, change, candidates: suites, kind: 'suite' }), /suite batch 1\/1 .*422 bad/);
});
