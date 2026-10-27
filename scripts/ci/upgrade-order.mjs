#!/usr/bin/env node
// Upgrade-order gate (CM L0g, alga-2026-0002848): can the release live in production
// today keep running on the schema this PR produces?
//
//   node scripts/ci/upgrade-order.mjs [--base <sha>] [--main-ref <ref>] [--work <dir>]
//                                     [--db-name <name>] [--skip-smoke] [--keep]
//
// 1. Baseline = the PR's merge base (default: merge-base of HEAD and --main-ref, in CI
//    pull_request.base.sha). It must be an ancestor of --main-ref so a stacked PR can
//    not compare against another stacked branch.
// 2. Build the baseline schema with prepareUpgradeSchema (CE+EE combined, baseline's own
//    migration helpers), apply it to a fresh database, run the baseline's dev seeds.
// 3. Snapshot, apply the PR's combined migrations with `migrate.latest`, snapshot again.
// 4. Structural N-1 assertions (scripts/lib/n1-schema.mjs): ledger append-only, no table or
//    column dropped, no type narrowed, no primary/unique constraint lost.
// 5. Behavioural smoke: the baseline release tree's own vitest suites listed in
//    scripts/ci/upgrade-order-smoke.json run against the PR schema.
//
// Needs: DB_HOST, DB_PORT, DB_USER_ADMIN, DB_PASSWORD_ADMIN (superuser on a pgvector Postgres).
// Exit 0 compatible, 1 incompatible, 2 the gate could not run (including a smoke suite that
// needs an executable the runner lacks: scripts/lib/smoke-failure.mjs).

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import knex from 'knex';

import { assertN1, snapshotSchema } from '../lib/n1-schema.mjs';
import { classifySmokeFailure, environmentMessages } from '../lib/smoke-failure.mjs';
import { prepareUpgradeSchema } from '../lib/upgrade-schema-source.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SMOKE_LIST = path.join(root, 'scripts/ci/upgrade-order-smoke.json');

class GateError extends Error {}

const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 }).trim();

function parseArgs(argv) {
  const o = { base: null, mainRef: 'origin/main', work: null, dbName: null, skipSmoke: false, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') o.base = argv[++i];
    else if (a === '--main-ref') o.mainRef = argv[++i];
    else if (a === '--work') o.work = path.resolve(argv[++i]);
    else if (a === '--db-name') o.dbName = argv[++i];
    else if (a === '--skip-smoke') o.skipSmoke = true;
    else if (a === '--keep') o.keep = true;
    else throw new GateError(`unknown argument ${a}`);
  }
  return o;
}

function resolveBaseline(o) {
  try {
    git(['rev-parse', '--verify', `${o.mainRef}^{commit}`]);
  } catch {
    throw new GateError(`main ref ${o.mainRef} not found (checkout with fetch-depth: 0)`);
  }
  const base = o.base ?? git(['merge-base', 'HEAD', o.mainRef]);
  const sha = git(['rev-parse', '--verify', `${base}^{commit}`]);
  try {
    git(['merge-base', '--is-ancestor', sha, o.mainRef]);
  } catch {
    throw new GateError(`baseline ${sha} is not an ancestor of ${o.mainRef}; the gate compares against what is released from main, not another branch`);
  }
  return sha;
}

const connection = (database) => ({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER_ADMIN || 'postgres',
  password: process.env.DB_PASSWORD_ADMIN,
  database,
});

const ts = () => new Date().toISOString().slice(11, 19);
const log = (m) => console.log(`[${ts()}] upgrade-order: ${m}`);

/** Files in the PR's migration set that are not in the baseline ledger, for the failure message. */
function blame(finding, newMigrationFiles) {
  const needle = [finding.subject.split(/[.(]/)[0]];
  const hits = newMigrationFiles.filter(({ source }) => needle.every((n) => source.includes(n)));
  return hits.length ? ` (touched by ${hits.map((h) => h.name).join(', ')})` : '';
}

async function main(argv) {
  const o = parseArgs(argv);
  if (!process.env.DB_PASSWORD_ADMIN) throw new GateError('DB_PASSWORD_ADMIN is required');
  const baseSha = resolveBaseline(o);
  const headSha = git(['rev-parse', 'HEAD']);
  if (git(['status', '--porcelain', '--', 'server/migrations', 'ee/server/migrations'])) {
    log('warning: uncommitted migration changes are ignored; the PR side is built from HEAD');
  }
  log(`baseline ${baseSha}, candidate ${headSha}`);

  const work = o.work ?? fs.mkdtempSync(path.join(os.tmpdir(), 'alga-upgrade-order-'));
  if (o.work) fs.mkdirSync(work, { recursive: true });
  const database = o.dbName ?? `upgrade_order_${Date.now().toString(36)}`;
  if (!/^upgrade_[a-z0-9_]{1,50}$/.test(database)) throw new GateError('--db-name must match upgrade_[a-z0-9_]+');

  let admin;
  let db;
  let result = 'incompatible';
  try {
    // PR side first so a bad PR archive fails before any database work.
    const prDir = path.join(work, 'pr');
    const baseDir = path.join(work, 'base');
    const pr = prepareUpgradeSchema({ repository: root, commit: headSha, destination: prDir, edition: 'ee' });
    const base = prepareUpgradeSchema({ repository: root, commit: baseSha, destination: baseDir, edition: 'ee' });
    for (const d of [prDir, baseDir]) fs.symlinkSync(path.join(root, 'node_modules'), path.join(d, 'node_modules'));
    // prepareUpgradeSchema does not extract seeds and the gate needs "schema + seed".
    execFileSync('sh', ['-c', `git archive ${baseSha} server/seeds ee/server/seeds | tar -x -C ${JSON.stringify(baseDir)}`], { cwd: root });

    admin = knex({ client: 'pg', connection: connection('postgres'), pool: { min: 0, max: 1 } });
    // CREATE DATABASE fails on an existing database: never adopt or reset one.
    await admin.raw('CREATE DATABASE ??', [database]);
    // Migrations GRANT to the application role; roles are cluster-wide, so create it only if absent.
    const appRole = process.env.DB_USER_SERVER || 'app_user';
    const hasRole = await admin.raw('SELECT 1 FROM pg_roles WHERE rolname = ?', [appRole]);
    if (!hasRole.rows.length) {
      await admin.raw(`CREATE ROLE ?? WITH LOGIN PASSWORD '${(process.env.DB_PASSWORD_SERVER || process.env.DB_PASSWORD_ADMIN).replace(/'/g, "''")}'`, [appRole]);
    }
    log(`created database ${database}`);
    process.env.DB_NAME_SERVER = database;

    db = knex({ client: 'pg', connection: connection(database), pool: { min: 0, max: 5 } });
    process.chdir(path.join(baseDir, 'server'));
    const [, baselineApplied] = await db.migrate.latest({ directory: base.directory, loadExtensions: ['.cjs'] });
    log(`baseline schema applied (${baselineApplied.length} migrations)`);
    const seedDir = path.join(baseDir, 'server/seeds/dev');
    if (fs.existsSync(seedDir)) {
      await db.seed.run({ directory: seedDir, loadExtensions: ['.cjs'] });
      log('baseline dev seeds applied');
    }
    const before = await snapshotSchema(db);

    process.chdir(path.join(prDir, 'server'));
    const [, prApplied] = await db.migrate.latest({ directory: pr.directory, loadExtensions: ['.cjs'] });
    log(`PR migrations applied (${prApplied.length} new)`);
    const after = await snapshotSchema(db);

    const baselineNames = new Set(before.ledger.map((r) => r.name));
    const newFiles = pr.manifest.migrations.filter((n) => !baselineNames.has(n))
      .map((n) => ({ name: n, source: fs.readFileSync(path.join(pr.directory, n), 'utf8') }));
    const findings = assertN1(before, after);
    for (const f of findings) log(`FAIL [${f.assertion}] ${f.message}${blame(f, newFiles)}`);
    log(`N-1 structural assertions: ${findings.length ? `${findings.length} failure(s)` : 'ok'} (${before.tables.length} tables, ${before.columns.length} columns, ${before.uniques.length} pk/unique, ${before.ledger.length} baseline migrations)`);
    if (findings.length) {
      log(`the release at ${baseSha} would break on this schema during blue/green`);
      return 1;
    }

    process.chdir(root);
    if (!o.skipSmoke) {
      const smoke = await runSmoke({ work, baseSha, pr, database });
      if (smoke.kind === 'environment') {
        for (const line of environmentMessages(smoke.tools)) console.error(line);
        log('smoke UNDECIDED: the runner lacks a tool the smoke suites need; this says nothing about schema compatibility');
        return 2;
      }
      if (smoke.kind === 'incompatible') {
        log(`smoke FAILED: the release at ${baseSha} would break on this schema during blue/green`);
        return 1;
      }
    }
    result = 'compatible';
    log('compatible');
    return 0;
  } finally {
    process.chdir(root);
    await db?.destroy();
    if (admin) {
      if (result === 'compatible' || !o.keep) await admin.raw('DROP DATABASE IF EXISTS ?? WITH (FORCE)', [database]).catch(() => {});
      await admin.destroy();
    }
    if (!o.work && !o.keep) fs.rmSync(work, { recursive: true, force: true });
    else log(`kept ${work}`);
  }
}

async function runSmoke({ work, baseSha, pr, database }) {
  const list = JSON.parse(fs.readFileSync(SMOKE_LIST, 'utf8'));
  const release = path.join(work, 'release');
  fs.mkdirSync(release);
  execFileSync('sh', ['-c', `git archive ${baseSha} | tar -x -C ${JSON.stringify(release)}`], { cwd: root, maxBuffer: 1 << 28 });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(release, 'node_modules'));
  const missing = list.tests.filter((t) => !fs.existsSync(path.join(release, t)));
  if (missing.length) throw new GateError(`smoke list names tests that do not exist at ${baseSha} (config error, not a compatibility failure): ${missing.join(', ')}`);
  log(`smoke: ${list.tests.length} baseline suites against the PR schema`);
  // The release's own tests bootstrap their schema from TEST_MIGRATIONS_DIR (server/test-utils/dbConfig.ts),
  // so pointing it at the PR's combined migrations runs old code and old seeds on the new schema.
  const child = spawn('npx', ['vitest', 'run', '--coverage.enabled=false', ...list.tests.map((t) => t.replace(/^server\//, ''))], {
    cwd: path.join(release, 'server'),
    stdio: ['inherit', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TEST_DB_NAME: `${database}_smoke`,
      TEST_MIGRATIONS_DIR: pr.directory,
      DB_PASSWORD_SERVER: process.env.DB_PASSWORD_SERVER || process.env.DB_PASSWORD_ADMIN,
      REQUIRE_DB: '1',
      NODE_ENV: 'test',
    },
  });
  // Stream live to the CI log and keep a copy for classification.
  let output = '';
  const tee = (stream, sink) => stream.on('data', (chunk) => { output += chunk; sink.write(chunk); });
  tee(child.stdout, process.stdout);
  tee(child.stderr, process.stderr);
  const outcome = await new Promise((resolve) => {
    child.on('error', (error) => resolve({ error }));
    child.on('close', (status, signal) => resolve({ status, signal }));
  });
  if (outcome.error) {
    // vitest never started (e.g. npx missing): a runner problem.
    return { kind: 'environment', tools: [outcome.error.code === 'ENOENT' ? String(outcome.error.path || 'npx') : `npx (${outcome.error.message})`] };
  }
  if (outcome.status === 0) return { kind: 'passed' };
  return classifySmokeFailure(output);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(`upgrade-order: ${err.message}`);
    if (!(err instanceof GateError)) console.error(err.stack);
    process.exit(2);
  },
);
