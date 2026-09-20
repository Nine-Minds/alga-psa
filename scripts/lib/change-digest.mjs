// Describe a change (a PR or push range) as structured facts a System One
// model can compare against test digests: what kind of file changed, which
// symbols and tables it touches, and a bounded excerpt of the changed lines.
// The raw diff is never sent whole; code selects the parts that carry signal.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const LIMITS = { body: 4000, excerptLines: 60, excerptChars: 2500, totalChars: 32000, symbols: 30, tables: 30, hunks: 8, files: 400 };

const KINDS = [
  ['migration', /^(?:server|ee\/server)\/migrations\//],
  ['seed', /^(?:server|ee\/server)\/seeds\//],
  ['test', /\.(test|spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__|test|tests|test-utils|fixtures)\//],
  ['workflow', /^\.github\//],
  ['lockfile', /(?:^|\/)package-lock\.json$/],
  ['config', /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|vitest[^/]*\.[cm]?[jt]s|playwright[^/]*\.[cm]?[jt]s|next\.config\.[cm]?[jt]s|\.env[^/]*)$|^(?:scripts|docker|helm|k8s)\//],
  ['docs', /\.(?:md|mdx|txt|png|jpg|jpeg|svg|pdf)$|^(?:docs|ee\/docs)\//],
  ['source', /\.[cm]?[jt]sx?$|\.(?:sql|css|scss|json|ya?ml)$/],
];

// Declarations that name behavior. Plain local `const`/`let` bindings are noise.
const SYMBOL = /\b(?:function\s*\*?|class|interface|enum)\s+([A-Za-z_$][\w$]*)|\bexport\s+(?:default\s+)?(?:async\s+)?(?:const|let|var|type)\s+([A-Za-z_$][\w$]*)/g;
const TABLE = /\b(?:createTable|alterTable|dropTable|dropTableIfExists|renameTable|hasTable|table|from|into|withSchema|truncate)\(\s*['"`]([a-z][a-z0-9_]*)['"`]|\b(?:FROM|JOIN|INTO|UPDATE|TABLE(?:\s+IF\s+(?:NOT\s+)?EXISTS)?)\s+(?:ONLY\s+)?"?([a-z][a-z0-9_]{3,})"?/g;
const CONST_TABLE = /\b(?:TABLE|TABLE_NAME|tableName)\s*=\s*['"`]([a-z][a-z0-9_]*)['"`]/g;

export function classifyChangedFile(file) {
  for (const [kind, pattern] of KINDS) if (pattern.test(file)) return kind;
  return 'other';
}

/** Parse `git diff --unified=0` output into per-file changed lines. */
export function parseUnifiedDiff(text, { maxLinesPerFile = 400 } = {}) {
  const files = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = /^diff --git a\/(.*?) b\/(.*)$/.exec(line);
      current = { path: match ? match[2] : line.slice(11), status: 'modified', binary: false, hunks: [], added: [], removed: [], addedCount: 0, removedCount: 0 };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('new file mode')) current.status = 'added';
    else if (line.startsWith('deleted file mode')) current.status = 'deleted';
    else if (line.startsWith('Binary files')) current.binary = true;
    else if (line.startsWith('@@')) {
      const context = line.replace(/^@@[^@]*@@\s?/, '').trim();
      if (context && current.hunks.length < LIMITS.hunks) current.hunks.push(context);
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      current.addedCount++;
      if (current.added.length < maxLinesPerFile) current.added.push(line.slice(1));
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      current.removedCount++;
      if (current.removed.length < maxLinesPerFile) current.removed.push(line.slice(1));
    }
  }
  return files;
}

export function readUnifiedDiff({ cwd, base, head = 'HEAD' }) {
  const result = spawnSync('git', ['diff', '--no-renames', '--no-color', '--unified=0', '--end-of-options', base, head, '--'],
    { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || 'git diff failed');
  return parseUnifiedDiff(result.stdout);
}

function unique(values, limit) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function collect(lines, pattern) {
  const found = [];
  for (const line of lines) for (const match of line.matchAll(pattern)) found.push(match[1] ?? match[2]);
  return found;
}

function excerptOf(file) {
  const lines = [];
  for (const line of file.removed.slice(0, LIMITS.excerptLines)) lines.push(`- ${line}`);
  for (const line of file.added.slice(0, LIMITS.excerptLines)) lines.push(`+ ${line}`);
  return lines.join('\n').slice(0, LIMITS.excerptChars);
}

function digestFile(file) {
  const kind = file.binary ? 'binary' : classifyChangedFile(file.path);
  const entry = { path: file.path, kind, status: file.status, added: file.addedCount, removed: file.removedCount };
  // Changed tests always run on their own account; their content is not evidence about other tests.
  if (kind === 'docs' || kind === 'lockfile' || kind === 'binary' || kind === 'test') return entry;
  const changed = [...file.removed, ...file.added];
  const symbols = unique([...collect(file.hunks, SYMBOL), ...collect(changed, SYMBOL)], LIMITS.symbols);
  const tables = unique([...collect(changed, CONST_TABLE), ...collect(changed, TABLE)], LIMITS.tables);
  if (file.hunks.length) entry.changed_in = unique(file.hunks, LIMITS.hunks);
  if (symbols.length) entry.symbols = symbols;
  if (tables.length) entry.database_tables = tables;
  const excerpt = excerptOf(file);
  if (excerpt) entry.excerpt = excerpt;
  return entry;
}

/** Title and body from the GitHub event when present, otherwise the head commit message. */
export function readChangeContext({ cwd, head = 'HEAD', eventPath = process.env.GITHUB_EVENT_PATH } = {}) {
  if (eventPath) {
    try {
      const event = JSON.parse(readFileSync(eventPath, 'utf8'));
      const pr = event.pull_request;
      if (pr?.title) return { title: pr.title, body: (pr.body ?? '').slice(0, LIMITS.body), number: pr.number ?? null, source: 'pull_request' };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const result = spawnSync('git', ['log', '-1', '--format=%s%n%n%b', '--end-of-options', head], { cwd, encoding: 'utf8' });
  if (result.status !== 0) return { title: '', body: '', number: null, source: 'unavailable' };
  const [title, ...rest] = result.stdout.split('\n');
  return { title: title.trim(), body: rest.join('\n').trim().slice(0, LIMITS.body), number: null, source: 'commit' };
}

/** Bound the rendered change so it fits comfortably beside a batch of candidates. */
export function digestChange({ files, title = '', body = '' }) {
  const entries = files.slice(0, LIMITS.files).map(digestFile);
  const kinds = {};
  for (const entry of entries) kinds[entry.kind] = (kinds[entry.kind] ?? 0) + 1;
  let size = JSON.stringify({ title, body, files: entries }).length;
  // Drop excerpts from the largest files first until the change fits its budget.
  const byExcerpt = [...entries].filter(e => e.excerpt).sort((a, b) => b.excerpt.length - a.excerpt.length);
  for (const entry of byExcerpt) {
    if (size <= LIMITS.totalChars) break;
    size -= entry.excerpt.length;
    delete entry.excerpt;
  }
  return {
    title, body, file_counts: kinds, truncated: files.length > LIMITS.files,
    files: entries,
    changed_files: files.map(file => file.path),
  };
}
