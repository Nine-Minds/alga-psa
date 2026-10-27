import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  RULES,
  lintMigrationSet,
  parseAnnotations,
  scanSql,
  splitSqlStatements,
} from '../lib/migration-lint.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, 'fixtures/migration-lint');
const CLI = path.resolve(here, '../ci/migration-lint.mjs');

// Fixtures never touch git: "existing" is injected (plan section 2).
const EXISTING_TABLES = new Set(['comments', 'time_entries', 'tenants', 'permissions', 'role_permissions']);
const EXISTING_FUNCTIONS = new Set(['existing_fn']);
const ctx = (extra = {}) => ({
  isExistingTable: (t) => EXISTING_TABLES.has(t),
  isExistingFunction: (n) => EXISTING_FUNCTIONS.has(n),
  ...extra,
});

function loadDir(dir) {
  const abs = path.join(FIXTURES, dir);
  return fs.readdirSync(abs).filter((f) => f.endsWith('.cjs')).sort()
    .map((f) => ({ name: `${dir}/${f}`, source: fs.readFileSync(path.join(abs, f), 'utf8') }));
}

function lintDir(dir, extra) {
  return lintMigrationSet(loadDir(dir), ctx(extra));
}

/** `lint-expect: N` marks the line above the offending line; `lint-expect-file: N` marks line 1. */
function expectations(files) {
  const out = [];
  for (const f of files) {
    f.source.split('\n').forEach((text, i) => {
      let m = /lint-expect:\s*(\w+)/.exec(text);
      if (m) out.push(`${f.name}:${i + 2}:${m[1]}`);
      m = /lint-expect-file:\s*(\w+)/.exec(text);
      if (m) out.push(`${f.name}:1:${m[1]}`);
    });
  }
  return out.sort();
}

const found = (r) => [...r.violations, ...r.undecided].map((v) => `${v.file}:${v.line}:${v.rule}`).sort();

const RULE_IDS = Object.keys(RULES).map(Number);
const rule6 = { baseMaxTimestamp: '20261023100000' };

test('meta: every rule 1..8 has a failing and a passing fixture', () => {
  assert.deepEqual(RULE_IDS, [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const id of RULE_IDS) {
    for (const side of ['fail', 'pass']) {
      const dir = path.join(FIXTURES, `rule-${id}`, side);
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.cjs')) : [];
      assert.ok(files.length > 0, `rule ${id} is missing its ${side}/ fixture`);
    }
  }
});

for (const id of RULE_IDS) {
  test(`rule ${id}: failing fixture reports exactly the marked rule/line pairs`, () => {
    const dir = `rule-${id}/fail`;
    const r = lintDir(dir, id === 6 ? rule6 : {});
    const expected = expectations(loadDir(dir));
    assert.ok(expected.length > 0, `rule ${id} fail fixture carries no lint-expect marker`);
    assert.ok(expected.every((e) => e.split(':')[2] === String(id)), `markers must all be rule ${id}`);
    assert.deepEqual(found(r), expected);
  });

  test(`rule ${id}: passing fixture is clean`, () => {
    const r = lintDir(`rule-${id}/pass`, id === 6 ? rule6 : {});
    assert.deepEqual(found(r), []);
    assert.deepEqual(r.stale, []);
  });
}

test('rule 8 passing fixture is clean only because of its annotation', () => {
  const r = lintDir('rule-8/pass');
  assert.equal(r.allowed.length, 1);
  assert.equal(r.allowed[0].rule, 8);
});

test('rule 2 pass case is a two-file case: dropping either file breaks it', () => {
  const files = loadDir('rule-2/pass');
  assert.equal(files.length, 2);
  const onlyNotValid = lintMigrationSet(files.filter((f) => f.name.includes('not-valid')), ctx());
  assert.equal(onlyNotValid.violations.length, 1);
  assert.equal(onlyNotValid.violations[0].rule, 2);
  const transactionalValidate = lintMigrationSet(
    [files[0], { ...files[1], source: files[1].source.replace('exports.config = { transaction: false };', '') }],
    ctx(),
  );
  assert.equal(transactionalValidate.violations.some((v) => v.rule === 2), true);
});

test('unresolved: dynamic table is an undecided finding, literal-only code resolves', () => {
  const bad = lintDir('unresolved/fail');
  assert.deepEqual(found(bad), expectations(loadDir('unresolved/fail')));
  assert.equal(bad.violations.length, 0);
  assert.equal(bad.undecided.length, 1);
  assert.deepEqual(found(lintDir('unresolved/pass')), []);
});

test('annotations: allowed / missing reason / wrong rule', () => {
  const allowed = lintDir('annotation/allowed');
  assert.deepEqual(found(allowed), []);
  assert.deepEqual(allowed.allowed.map((a) => a.rule), [3, 5]);
  assert.match(allowed.allowed[0].reason, /already guaranteed/);

  const missing = lintDir('annotation/missing-reason');
  assert.deepEqual(missing.violations.map((v) => String(v.rule)).sort(), ['3', 'ANNOTATION']);
  assert.equal(missing.allowed.length, 0);

  const wrong = lintDir('annotation/wrong-rule');
  assert.deepEqual(wrong.violations.map((v) => v.rule), [3]);
  assert.equal(wrong.stale.length, 1, 'the mismatched annotation is reported stale');
});

test('annotations: parsing rules', () => {
  const src = [
    '// migration-lint: allow 3 - twelve chars ok',
    '// migration-lint: allow 3 - short',
    '// migration-lint: allow all - blanket suppression is refused',
    '// migration-lint: allow 9 - unknown rule id is refused here',
    '-- migration-lint: allow UNRESOLVED — sql style comment with a real reason',
    '/* migration-lint: allow 1 - block comment with a real reason */',
  ].join('\n');
  const a = parseAnnotations(src);
  assert.deepEqual(a.map((x) => x.problems.length > 0), [false, true, true, true, false, false]);
  assert.equal(a[4].rule, 'UNRESOLVED');
  assert.equal(a[5].reason, 'block comment with a real reason');
});

test('annotation covers a statement from the call line, the line above, or a contiguous block above', () => {
  const src = [
    'exports.up = async function (knex) {',
    '  // migration-lint: allow 3 - reviewed first reason here',
    '  // migration-lint: allow 5 - reviewed second reason here',
    "  await knex.raw(`",
    '    ALTER TABLE time_entries ALTER COLUMN end_time SET NOT NULL',
    '  `);',
    '};',
  ].join('\n');
  const r = lintMigrationSet([{ name: 'x/20990101000000_a.cjs', source: src }], ctx());
  assert.deepEqual(found(r), []);
  assert.equal(r.allowed.length, 1);
  assert.equal(r.stale.length, 1, 'the unused rule-5 annotation is stale');
});

test('down() is never linted (it never runs in prod)', () => {
  const src = "exports.up = async function () {};\nexports.down = async function (knex) { await knex.raw('DROP TABLE comments'); };\n";
  assert.deepEqual(found(lintMigrationSet([{ name: 'a.cjs', source: src }], ctx())), []);
});

test('SQL splitter: dollar quotes, strings, comments', () => {
  const sql = [
    "SELECT 'a;b'; -- tail ; comment",
    '/* block ; /* nested ; */ still comment */ SELECT 2;',
    'CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;',
    'DO $tag$ BEGIN PERFORM $$x;y$$; END; $tag$;',
    "SELECT E'it\\'s;fine'; SELECT \"semi;colon\" FROM t",
  ].join('\n');
  const parts = splitSqlStatements(sql);
  assert.equal(parts.length, 6);
  assert.match(parts[2], /^CREATE FUNCTION f\(\)[\s\S]*plpgsql$/);
  assert.match(parts[3], /^DO \$tag\$[\s\S]*\$tag\$$/);
  assert.equal(scanSql('SELECT $1, $2;').statements.length, 1, '$1 is a parameter, not a dollar quote');
});

test('DO blocks are entered one level; function bodies are not', () => {
  const src = [
    'exports.up = async function (knex) {',
    '  await knex.raw(`',
    '    DO $$ BEGIN',
    "      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'c1') THEN",
    '        ALTER TABLE comments ADD CONSTRAINT c1 CHECK (a > 0);',
    '      END IF;',
    '    END $$;',
    '  `);',
    '};',
  ].join('\n');
  const r = lintMigrationSet([{ name: 'a.cjs', source: src }], ctx());
  assert.deepEqual(r.violations.map((v) => v.rule), [2], 'guarded for rule 7 but still needs NOT VALID');
});

test('CLI: exit codes against a temp git repo (0 clean, 1 violation, 2 cannot decide)', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'mlint-'));
  const run = (args, opts = {}) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', ...opts });
  run(['init', '-q', '-b', 'main']);
  run(['config', 'user.email', 't@example.com']);
  run(['config', 'user.name', 't']);
  fs.mkdirSync(path.join(repo, 'server/migrations'), { recursive: true });
  const write = (name, body) => fs.writeFileSync(path.join(repo, 'server/migrations', name), body);
  write('20240101000000_base.cjs', "exports.up = async (knex) => { await knex.raw('CREATE TABLE IF NOT EXISTS comments (id int)'); };\n");
  run(['add', '.']);
  run(['commit', '-q', '-m', 'base']);
  run(['switch', '-q', '-c', 'pr']);
  const lint = (extra = []) => spawnSync('node', [CLI, '--repo', repo, '--base', 'main', ...extra], { encoding: 'utf8' });

  assert.equal(lint().status, 0, 'empty change set is clean');

  write('20240201000000_good.cjs', "exports.up = async (knex) => { await knex.raw('CREATE TABLE IF NOT EXISTS extra (id int)'); };\n");
  run(['add', '.']); run(['commit', '-q', '-m', 'good']);
  assert.equal(lint().status, 0);

  write('20240301000000_bad.cjs', "exports.up = async (knex) => {\n  await knex.raw('ALTER TABLE comments ALTER COLUMN id SET NOT NULL');\n};\n");
  run(['add', '.']); run(['commit', '-q', '-m', 'bad']);
  const red = lint();
  assert.equal(red.status, 1);
  assert.match(red.stdout, /20240301000000_bad\.cjs:2: R3 /);
  assert.match(red.stdout, /1 violation\(s\), 0 annotation\(s\) honoured/);

  assert.equal(lint(['--base', 'does-not-exist']).status, 2, 'missing base ref is "could not decide"');

  write('20240301000000_bad.cjs', "exports.up = async (knex) => {\n  const t = process.env.T;\n  await knex.raw(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS x int`);\n};\n");
  run(['add', '.']); run(['commit', '-q', '-m', 'dynamic']);
  const undecided = lint();
  assert.equal(undecided.status, 2);

  write('20240301000000_bad.cjs', "exports.up = async (knex) => {\n  // migration-lint: allow 3 - verified empty table on every deployed tenant\n  await knex.raw('ALTER TABLE comments ALTER COLUMN id SET NOT NULL');\n};\n");
  run(['add', '.']); run(['commit', '-q', '-m', 'annotated']);
  const allowed = lint();
  assert.equal(allowed.status, 0);
  assert.match(allowed.stdout, /ALLOWED .*verified empty table/);
  assert.match(allowed.stdout, /1 annotation\(s\) honoured/);

  // Rule 6 on the real CLI path: a migration older than base's newest.
  write('20230101000000_old.cjs', "exports.up = async () => {};\n");
  run(['add', '.']); run(['commit', '-q', '-m', 'old']);
  assert.match(lint().stdout, /R6 timestamp 20230101000000 is not later/);
  fs.rmSync(repo, { recursive: true, force: true });
});
