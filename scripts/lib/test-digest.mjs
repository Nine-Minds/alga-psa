// Derive a compact, code-extracted description of a test file: what it is
// titled, what it imports and mocks, which database tables and routes it
// touches. The digest is what a System One model judges when deciding whether
// a suite is relevant to a change. Nothing here is hand-authored; regenerate
// from source on every run so the description can never drift from the test.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const LIMITS = { header: 600, imports: 40, mocks: 20, tables: 30, routes: 20, tests: 80, suites: 20, title: 200 };

// `describe`, `it`, `test`, wrapper suites such as `describeDb(...)`, and the
// Playwright `test.describe(...)` chain, followed by a string-literal title.
const TITLE_CALL = /\b(describe\w*|it|test)((?:\.\w+)*)\s*\(\s*(['"`])((?:\\.|(?!\3)[^\\])*)\3/;
const IMPORT = /^\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/;
const REQUIRE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
const MOCK = /\b(?:vi|jest)\.mock\(\s*['"]([^'"]+)['"]/g;
const TABLE_CALL = /\b(?:knex|trx|db|tenantDb|adminDb|connection|database|tx)\(\s*['"]([a-z][a-z0-9_]*)['"]/g;
const TABLE_METHOD = /\.(?:from|into|table|withSchema|hasTable|createTable|alterTable|dropTable|dropTableIfExists|truncate)\(\s*['"]([a-z][a-z0-9_]*)['"]/g;
const TABLE_SQL = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE(?:\s+IF\s+(?:NOT\s+)?EXISTS)?)\s+(?:ONLY\s+)?"?([a-z][a-z0-9_]*)"?/g;
const ROUTE = /\.goto\(\s*[`'"]([^`'"?]+)/g;
const SQL_STOPWORDS = new Set(['the', 'a', 'an', 'this', 'that', 'which', 'each', 'all', 'its', 'it', 'our', 'your', 'their',
  'one', 'two', 'any', 'here', 'there', 'where', 'when', 'what', 'now', 'then', 'select', 'values', 'set', 'with', 'and',
  'or', 'not', 'null', 'true', 'false', 'unnest', 'json', 'jsonb', 'lateral', 'generate_series', 'pg_catalog', 'information_schema']);

function unique(values, limit) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function matchAll(source, pattern) {
  const found = [];
  for (const match of source.matchAll(pattern)) found.push(match[1]);
  return found;
}

function extractHeader(lines) {
  const header = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { if (header.length) break; continue; }
    if (/^(\/\*|\*|\/\/)/.test(trimmed)) {
      header.push(trimmed.replace(/^\/\*+\s?|^\*\/\s?|^\*\s?|^\/\/\s?/, '').replace(/\*\/\s*$/, '').trim());
      continue;
    }
    break;
  }
  return header.filter(Boolean).join(' ').slice(0, LIMITS.header);
}

function normalizeImport(specifier, file, root) {
  if (!specifier.startsWith('.')) return specifier;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  return resolved.replace(/\.[cm]?[jt]sx?$/, '');
}

function extractTables(source) {
  const tables = [...matchAll(source, TABLE_CALL), ...matchAll(source, TABLE_METHOD)];
  for (const name of matchAll(source, TABLE_SQL)) {
    if (name.length >= 4 && !SQL_STOPWORDS.has(name)) tables.push(name);
  }
  return tables;
}

/** Digest one test file. `file` is repository-relative with posix separators. */
export function digestTestFile(file, source) {
  if (typeof file !== 'string' || !file) throw new Error('Missing test file identity');
  if (typeof source !== 'string') throw new Error(`Missing source for ${file}`);
  const lines = source.split('\n');
  const suites = [];
  const tests = [];
  lines.forEach((line, index) => {
    const match = TITLE_CALL.exec(line);
    if (!match) return;
    const [, head, chain, , title] = match;
    if (!title.trim()) return;
    const isSuite = head.startsWith('describe') || /\.describe\b/.test(chain);
    if (isSuite) suites.push(title.slice(0, LIMITS.title));
    else tests.push({ title: title.slice(0, LIMITS.title), line: index + 1 });
  });
  const imports = lines.map(line => IMPORT.exec(line)?.[1]).filter(Boolean).concat(matchAll(source, REQUIRE));
  const kind = /\.spec\.[cm]?[jt]sx?$/.test(file) || /@playwright\/test|\.\.\/fixtures\//.test(imports.join('\n')) ? 'playwright' : 'vitest';
  return {
    file,
    kind,
    lines: lines.length,
    header: extractHeader(lines),
    suites: unique(suites, LIMITS.suites),
    tests: tests.slice(0, LIMITS.tests),
    imports: unique(imports.map(specifier => normalizeImport(specifier, file)), LIMITS.imports),
    mocks: unique(matchAll(source, MOCK).map(specifier => normalizeImport(specifier, file)), LIMITS.mocks),
    tables: unique(extractTables(source), LIMITS.tables),
    routes: unique(matchAll(source, ROUTE), LIMITS.routes),
  };
}

/** Read and digest a repository-relative test file. */
export function digestTestPath(root, file) {
  return digestTestFile(file, readFileSync(path.join(root, file), 'utf8'));
}

/** Walk a directory for test files without git or ripgrep; returns sorted posix-relative paths. */
export function findTestFiles(root, directories, pattern = /\.(test|spec)\.[cm]?[jt]sx?$/) {
  const found = [];
  const visit = (directory) => {
    let entries;
    try { entries = readdirSync(path.join(root, directory), { withFileTypes: true }); } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const relative = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) visit(relative);
      else if (entry.isFile() && pattern.test(entry.name)) found.push(relative);
    }
  };
  for (const directory of directories) {
    const stats = (() => { try { return statSync(path.join(root, directory)); } catch { return null; } })();
    if (stats?.isFile()) found.push(directory);
    else visit(directory);
  }
  return [...new Set(found)].sort();
}

/** The fields a judgment sees. Empty fields are omitted so the state stays small. */
export function renderDigest(digest, { includeTests = true } = {}) {
  const rendered = { file: digest.file };
  if (digest.header) rendered.description = digest.header;
  if (digest.suites.length) rendered.suites = digest.suites;
  if (includeTests && digest.tests.length) rendered.tests = digest.tests.map(test => test.title);
  if (digest.imports.length) rendered.imports = digest.imports;
  if (digest.mocks.length) rendered.mocked_modules = digest.mocks;
  if (digest.tables.length) rendered.database_tables = digest.tables;
  if (digest.routes.length) rendered.routes_visited = digest.routes;
  return rendered;
}
