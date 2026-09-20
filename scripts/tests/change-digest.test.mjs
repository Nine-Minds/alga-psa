import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyChangedFile, digestChange, parseUnifiedDiff, readChangeContext, readUnifiedDiff } from '../lib/change-digest.mjs';

const DIFF = `diff --git a/server/migrations/20260901_add_quote_note.cjs b/server/migrations/20260901_add_quote_note.cjs
new file mode 100644
--- /dev/null
+++ b/server/migrations/20260901_add_quote_note.cjs
@@ -0,0 +1,6 @@
+const TABLE = 'quote_items';
+exports.up = async function up(knex) {
+  await knex.schema.alterTable(TABLE, (table) => { table.text('catalog_description'); });
+  await knex.raw('UPDATE quote_items SET catalog_description = name WHERE tenant = ?', [tenant]);
+};
+exports.down = async function down() {};
diff --git a/packages/billing/src/actions/quoteActions.ts b/packages/billing/src/actions/quoteActions.ts
--- a/packages/billing/src/actions/quoteActions.ts
+++ b/packages/billing/src/actions/quoteActions.ts
@@ -40,2 +40,3 @@ export async function updateQuoteItem(input) {
-  const description = input.description;
+  const description = input.catalogDescription ?? input.description;
+  const helper = 1;
diff --git a/docs/quotes.md b/docs/quotes.md
--- a/docs/quotes.md
+++ b/docs/quotes.md
@@ -1 +1 @@
-old
+new
diff --git a/server/src/test/unit/quotes.test.ts b/server/src/test/unit/quotes.test.ts
--- a/server/src/test/unit/quotes.test.ts
+++ b/server/src/test/unit/quotes.test.ts
@@ -1 +1 @@
-it('a')
+it('b')
diff --git a/logo.png b/logo.png
deleted file mode 100644
Binary files a/logo.png and /dev/null differ
`;

test('classification separates the kinds the policy treats differently', () => {
  assert.equal(classifyChangedFile('server/migrations/x.cjs'), 'migration');
  assert.equal(classifyChangedFile('ee/server/seeds/dev/x.cjs'), 'seed');
  assert.equal(classifyChangedFile('server/src/test/integration/a.test.ts'), 'test');
  assert.equal(classifyChangedFile('e2e-tests/fixtures/auth.ts'), 'test');
  assert.equal(classifyChangedFile('package-lock.json'), 'lockfile');
  assert.equal(classifyChangedFile('.github/workflows/ci.yml'), 'workflow');
  assert.equal(classifyChangedFile('server/vitest.config.ts'), 'config');
  assert.equal(classifyChangedFile('docs/a.md'), 'docs');
  assert.equal(classifyChangedFile('packages/billing/src/x.tsx'), 'source');
});

test('unified diff parsing keeps status, hunk context and changed lines per file', () => {
  const files = parseUnifiedDiff(DIFF);
  assert.deepEqual(files.map(f => [f.path, f.status, f.binary]), [
    ['server/migrations/20260901_add_quote_note.cjs', 'added', false],
    ['packages/billing/src/actions/quoteActions.ts', 'modified', false],
    ['docs/quotes.md', 'modified', false],
    ['server/src/test/unit/quotes.test.ts', 'modified', false],
    ['logo.png', 'deleted', true],
  ]);
  assert.deepEqual(files[1].hunks, ['export async function updateQuoteItem(input) {']);
  assert.equal(files[1].addedCount, 2);
  assert.equal(files[1].removedCount, 1);
});

test('digest extracts tables and behavior-naming symbols and withholds detail where it is noise', () => {
  const change = digestChange({ files: parseUnifiedDiff(DIFF), title: 'Add catalog description', body: 'Ticket 2354' });
  assert.deepEqual(change.file_counts, { migration: 1, source: 1, docs: 1, test: 1, binary: 1 });
  const [migration, source, docs, unit, binary] = change.files;
  assert.deepEqual(migration.database_tables, ['quote_items']);
  assert.deepEqual(migration.symbols, ['up', 'down']);
  assert.match(migration.excerpt, /alterTable\(TABLE/);
  assert.deepEqual(source.symbols, ['updateQuoteItem'], 'plain local const bindings are not symbols');
  assert.equal(docs.excerpt, undefined);
  assert.equal(unit.excerpt, undefined, 'changed tests run on their own; their content is not evidence about other tests');
  assert.equal(binary.kind, 'binary');
  assert.deepEqual(change.changed_files, change.files.map(f => f.path));
});

test('oversized changes shed excerpts from the largest files first', () => {
  const files = Array.from({ length: 30 }, (_, i) => ({
    path: `packages/p/src/f${i}.ts`, status: 'modified', binary: false, hunks: [], removed: [],
    added: Array.from({ length: 60 }, (_, j) => `line ${i}-${j} ${'x'.repeat(30 + (i % 3) * 10)}`), addedCount: 60, removedCount: 0,
  }));
  const change = digestChange({ files, title: '', body: '' });
  const withExcerpt = change.files.filter(f => f.excerpt);
  assert.ok(withExcerpt.length > 0 && withExcerpt.length < 30, `expected partial trimming, kept ${withExcerpt.length}`);
  assert.ok(JSON.stringify({ title: '', body: '', files: change.files }).length <= 32000 + 2500);
  assert.ok(change.files.every(f => f.symbols === undefined || Array.isArray(f.symbols)));
});

test('change context prefers the pull request event and falls back to the head commit', (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'change-digest-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.name', 'CI fixture'); git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(cwd, 'a.ts'), 'export const a = 1;\n');
  git('add', '.'); git('commit', '-qm', 'initial');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(path.join(cwd, 'a.ts'), 'export const a = 2;\nexport function b() {}\n');
  git('commit', '-qam', 'feat: change a\n\nLonger body here.');
  const diff = readUnifiedDiff({ cwd, base, head: 'HEAD' });
  assert.equal(diff.length, 1);
  assert.deepEqual(digestChange({ files: diff }).files[0].symbols, ['a', 'b'], 'exported bindings and functions are symbols');
  const event = path.join(cwd, 'event.json');
  writeFileSync(event, JSON.stringify({ pull_request: { number: 7, title: 'PR title', body: 'PR body' } }));
  const long = JSON.stringify({ pull_request: { number: 8, title: 'Long', body: 'intent. '.repeat(400) } });
  writeFileSync(path.join(cwd, 'long.json'), long);
  assert.equal(readChangeContext({ cwd, eventPath: path.join(cwd, 'long.json') }).body.length, 1200, 'only the opening of a long body is evidence of intent');
  assert.deepEqual(readChangeContext({ cwd, eventPath: event }), { title: 'PR title', body: 'PR body', number: 7, source: 'pull_request' });
  assert.deepEqual(readChangeContext({ cwd, eventPath: path.join(cwd, 'missing.json') }), { title: 'feat: change a', body: 'Longer body here.', number: null, source: 'commit' });
});
