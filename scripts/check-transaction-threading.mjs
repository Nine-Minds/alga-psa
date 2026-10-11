#!/usr/bin/env node
/**
 * Find functions that accept a caller's database handle and then open a second
 * connection anyway.
 *
 * The failure this prevents (fixed in cb65a3444d for StorageService.deleteFile):
 * a function takes an optional `Knex.Transaction`, ignores it, calls
 * `createTenantKnex()` and opens its own transaction on a *fresh pool
 * connection*. When the caller already holds a `FOR UPDATE` lock on a row the
 * callee touches, the second connection blocks on the caller's own lock while
 * the caller awaits the callee -- a self-deadlock with no lock timeout. In that
 * incident the caller ran inside `initializeApp()` during instrumentation
 * `register()`, so every boot after the 24h draft grace wedged all HTTP
 * requests forever.
 *
 * `withTransaction` (and `withCoManagedOperationalTransaction` through it)
 * reuses a supplied trx as a nested savepoint frame, so the fix is always to
 * thread the caller's handle: `const db = transaction ?? knex`.
 *
 * Exemptions live in TRANSACTION_THREADING_EXEMPTIONS below. Each one needs a
 * reason: post-commit effects genuinely need an independent connection.
 *
 * Usage: node scripts/check-transaction-threading.mjs [--json] [--roots=a,b]
 *
 * `--roots` replaces the directories scanned. It exists so the contract test can
 * point the detector at a throwaway fixture and prove it still *detects* -- a
 * checker that silently stopped matching would otherwise report a green
 * `violations: []` forever and the suite would never notice.
 */
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require(resolvePath(REPO_ROOT, 'node_modules/typescript'));

/**
 * `<file>::<function>` -> why an independent connection is correct there.
 * Anything not listed must thread the caller's handle.
 */
const TRANSACTION_THREADING_EXEMPTIONS = {};

const DEFAULT_SEARCH_ROOTS = ['packages', 'server/src', 'shared', 'ee', 'services'];
const rootsFlag = process.argv.find((arg) => arg.startsWith('--roots='));
const SEARCH_ROOTS = rootsFlag
  ? rootsFlag.slice('--roots='.length).split(',').filter(Boolean)
  : DEFAULT_SEARCH_ROOTS;

/** A parameter that hands us the caller's database handle. */
function isDbHandleParam(param) {
  const type = param.type ? param.type.getText() : '';
  const name = param.name.getText?.() ?? '';
  if (/Knex\.Transaction/.test(type)) return true;
  if (/^Knex$/.test(type.replace(/\s*\|\s*undefined/, '').trim())) return true;
  if (/Knex\.Transaction/.test(type) || /\bKnex\b/.test(type)) {
    return /trx|transaction|db|knex|conn/i.test(name);
  }
  return false;
}

function functionsIn(sourceFile) {
  const found = [];
  const visit = (node) => {
    const isFn =
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node);
    if (isFn && node.body && node.parameters?.length) {
      const dbParams = node.parameters.filter(isDbHandleParam);
      if (dbParams.length > 0) {
        let name = node.name?.getText?.();
        if (!name && node.parent && (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent))) {
          name = node.parent.name.getText();
        }
        found.push({
          name: name ?? '(anonymous)',
          params: dbParams.map((p) => p.name.getText()),
          node,
          body: node.body.getText(),
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

const files = execSync(
  `grep -rl 'createTenantKnex' --include=*.ts --include=*.tsx ${SEARCH_ROOTS.filter((r) => existsSync(resolvePath(REPO_ROOT, r))).join(' ')} 2>/dev/null | grep -v node_modules`,
  { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256e6 },
)
  .trim()
  .split('\n')
  .filter(Boolean)
  .filter((f) => !/\.(test|spec)\.tsx?$/.test(f) && !/__tests__|\/tests\//.test(f));

/** Identifier names that appear in real code inside this function's body.
 * Uses AST nodes rather than a text search so a parameter named only in a
 * comment does not read as "threaded" -- the reverted deleteFile fix left the
 * word `transaction` in a nearby comment and fooled exactly that check. */
function identifiersUsedIn(fnNode) {
  const names = new Set();
  const visit = (n) => {
    if (ts.isIdentifier(n)) names.add(n.getText());
    ts.forEachChild(n, visit);
  };
  visit(fnNode.body);
  return names;
}

const OPENERS = new Set(['withTransaction', 'withCoManagedOperationalTransaction', 'withAdminTransaction']);

/** `const db = transaction ?? knex` -> { db: 'transaction ?? knex' }, so the
 * argument actually handed to the opener can be traced back to a parameter. */
function localAliases(fnNode) {
  const aliases = new Map();
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name)) {
      aliases.set(n.name.getText(), n.initializer.getText());
    }
    ts.forEachChild(n, visit);
  };
  visit(fnNode.body);
  return aliases;
}

function expandAliases(text, aliases) {
  let out = text;
  for (let depth = 0; depth < 4; depth++) {
    const next = out.replace(/\b[A-Za-z_$][\w$]*\b/g, (id) => (aliases.has(id) ? `(${aliases.get(id)})` : id));
    if (next === out) break;
    out = next;
  }
  return out;
}

/** First argument of every transaction-opening call inside this function's own
 * body (nested function bodies are skipped -- they are separately analysed). */
function openerArguments(fnNode) {
  const args = [];
  const visit = (n) => {
    if (n !== fnNode && (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isFunctionExpression(n))) return;
    if (ts.isCallExpression(n) && n.arguments.length > 0) {
      const callee = n.expression.getText().split('.').pop();
      if (OPENERS.has(callee)) args.push(n.arguments[0].getText());
    }
    ts.forEachChild(n, visit);
  };
  visit(fnNode.body);
  return args;
}

const violations = [];
for (const file of files) {
  const abs = resolvePath(REPO_ROOT, file);
  const sourceFile = ts.createSourceFile(abs, readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true);
  for (const fn of functionsIn(sourceFile)) {
    // Nested arrow callbacks inherit the enclosing body text; only flag a
    // function whose own body opens the connection.
    if (!/\bcreateTenantKnex\s*\(/.test(fn.body)) continue;

    // Calling createTenantKnex() is not itself the defect -- the post-fix
    // deleteFile still does, to learn the tenant. The defect is what reaches the
    // transaction opener: if the first argument cannot be traced back to a
    // parameter the caller supplied, this opens a second pool connection while
    // the caller may hold locks. Matching on the argument rather than on
    // "is the parameter mentioned somewhere" is deliberate: the reverted fix
    // left the word `transaction` in a nearby comment, which a text search
    // happily accepted.
    const aliases = localAliases(fn.node);
    const opened = openerArguments(fn.node);
    if (opened.length === 0) continue;

    const unthreaded = opened.filter((arg) => {
      const expanded = expandAliases(arg, aliases);
      return !fn.params.some((param) => new RegExp(`\\b${param.replace(/[^\w$]/g, '')}\\b`).test(expanded));
    });
    if (unthreaded.length === 0) continue;

    // `trx ? cleanup(trx) : withTransaction(knex, cleanup)` opens on `knex` and
    // is still correct: the supplied handle is used directly on the other
    // branch. So a bare opener argument is only a defect when the parameter is
    // never used in code at all.
    const used = identifiersUsedIn(fn.node);
    const ignored = fn.params.filter((param) => !used.has(param));
    if (ignored.length === 0) continue;

    const key = `${file}::${fn.name}`;
    if (key in TRANSACTION_THREADING_EXEMPTIONS) continue;
    violations.push({ file, line: fn.line, name: fn.name, params: ignored, opened: unthreaded });
  }
}

// Innermost function wins: an outer function containing a nested offender
// reports the same body text, so keep the deepest (largest line number) per name.
const byKey = new Map();
for (const v of violations) {
  const key = `${v.file}::${v.name}`;
  const prev = byKey.get(key);
  if (!prev || v.line > prev.line) byKey.set(key, v);
}
const unique = [...byKey.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ violations: unique, scanned: files.length }, null, 2));
} else if (unique.length === 0) {
  console.log(`OK: ${files.length} files scanned, no transaction-accepting function opens its own connection.`);
} else {
  console.error(`${unique.length} function(s) accept a caller database handle but call createTenantKnex():`);
  console.error('');
  for (const v of unique) {
    console.error(`  ${v.file}:${v.line}  ${v.name}(${v.params.join(', ')})`);
    console.error(`      opens on: ${v.opened.join(' | ')}`);
  }
  console.error('');
  console.error('Thread the caller handle (`const db = transaction ?? knex`) or add a reasoned');
  console.error('entry to TRANSACTION_THREADING_EXEMPTIONS in this script.');
}
process.exit(unique.length === 0 ? 0 : 1);
