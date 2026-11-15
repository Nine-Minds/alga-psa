#!/usr/bin/env node
// Migration lint CLI (CM L0g, alga-2026-0002848). Rules live in scripts/lib/migration-lint.mjs.
//
//   node scripts/ci/migration-lint.mjs [--base <ref>] [--files <path>...] [--last <n>] [--json]
//
// Exit 0 clean, 1 violations, 2 the lint could not decide (missing base ref,
// unparseable file, unannotated unresolved substitution).

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RULES,
  contextFromFacts,
  deriveSchemaFacts,
  formatViolation,
  lintMigrationSet,
  timestampOf,
} from '../lib/migration-lint.mjs';

const MIGRATION_DIRS = ['server/migrations', 'ee/server/migrations'];
const MIGRATION_FILE = /^\d{8,14}_.+\.(cjs|js)$/;

let rootOverride = null;
export function repoRoot() {
  return rootOverride ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: repoRoot(), encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
}

function readWorkingTree(dirs = MIGRATION_DIRS) {
  const out = [];
  for (const dir of dirs) {
    const abs = path.join(repoRoot(), dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (MIGRATION_FILE.test(f)) out.push({ name: `${dir}/${f}`, source: fs.readFileSync(path.join(abs, f), 'utf8') });
    }
  }
  return out;
}

/** All migration sources at a git ref, via one `cat-file --batch` (no process per file). */
function readAtRef(ref) {
  const listing = git(['ls-tree', '-r', ref, '--', ...MIGRATION_DIRS]).split('\n').filter(Boolean);
  const entries = listing
    .map((l) => {
      const [meta, file] = l.split('\t');
      return { sha: meta.split(' ')[2], name: file };
    })
    .filter((e) => MIGRATION_FILE.test(e.name.split('/').pop()) && MIGRATION_DIRS.includes(path.dirname(e.name)));
  const res = spawnSync('git', ['cat-file', '--batch'], {
    cwd: repoRoot(),
    input: entries.map((e) => e.sha).join('\n') + '\n',
    maxBuffer: 1 << 29,
  });
  if (res.status !== 0) throw new Error(`git cat-file failed: ${res.stderr}`);
  const buf = res.stdout;
  let pos = 0;
  const out = [];
  for (const e of entries) {
    const nl = buf.indexOf(0x0a, pos);
    const [, , size] = buf.subarray(pos, nl).toString().split(' ');
    const start = nl + 1;
    out.push({ name: e.name, source: buf.subarray(start, start + Number(size)).toString('utf8') });
    pos = start + Number(size) + 1;
  }
  return out;
}

function parseArgs(argv) {
  const opts = { base: 'origin/main', files: null, last: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') opts.base = argv[++i];
    else if (a === '--last') opts.last = Number(argv[++i]);
    else if (a === '--json') opts.json = true;
    else if (a === '--repo') rootOverride = path.resolve(argv[++i]); // tests point the CLI at a temp git repo
    else if (a === '--files') {
      opts.files = [];
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) opts.files.push(argv[++i]);
    } else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

function expandFiles(paths) {
  const out = [];
  for (const p of paths) {
    const abs = path.resolve(process.cwd(), p);
    const stat = fs.statSync(abs);
    const list = stat.isDirectory() ? fs.readdirSync(abs).map((f) => path.join(abs, f)) : [abs];
    for (const f of list) if (/\.(cjs|js)$/.test(f)) out.push({ name: path.relative(repoRoot(), f), source: fs.readFileSync(f, 'utf8') });
  }
  return out;
}

export function run(argv) {
  const opts = parseArgs(argv);
  let files;
  let ctx;
  let mode;
  const touched = [];

  if (opts.last) {
    // Audit mode: newest N migrations in the working tree, judged against the
    // tables/functions that existed when each one landed.
    const all = readWorkingTree();
    const facts = deriveSchemaFacts(all);
    files = [...all].sort((a, b) => (timestampOf(a.name) < timestampOf(b.name) ? 1 : -1)).slice(0, opts.last);
    ctx = contextFromFacts(facts, { asOf: true });
    mode = `audit of newest ${opts.last}`;
  } else {
    // PR mode: "existing" = created by a migration already on the base ref.
    try {
      git(['rev-parse', '--verify', `${opts.base}^{commit}`]);
    } catch {
      return { exit: 2, report: { error: `base ref ${opts.base} not found (fetch it, e.g. actions/checkout fetch-depth: 0)` } };
    }
    const baseFiles = readAtRef(opts.base);
    const facts = deriveSchemaFacts(baseFiles);
    ctx = contextFromFacts(facts, { baseMaxTimestamp: facts.maxTimestamp });
    if (opts.files) files = expandFiles(opts.files);
    else {
      // Added (A), modified (M) and renamed (R) migrations. Lines are `A\tpath`,
      // `M\tpath` or `R<score>\told\tnew`; the new path is what gets linted.
      const changes = git(['diff', '--name-status', '--diff-filter=AMR', `${opts.base}...HEAD`, '--', ...MIGRATION_DIRS])
        .split('\n').filter(Boolean).map((l) => {
          const [st, a, b] = l.split('\t');
          return st.startsWith('R') ? { status: 'R', from: a, name: b } : { status: st, from: null, name: a };
        })
        .filter((c) => MIGRATION_FILE.test(path.basename(c.name)) && MIGRATION_DIRS.includes(path.dirname(c.name)));
      // Modified / timestamp-keeping renamed files are judged as of their own
      // timestamp (same view as the main audit); added files and renames that
      // change the timestamp (new migration names to knex) use the current view.
      const asOfCtx = contextFromFacts(facts, { asOf: true });
      let newCtx = ctx;
      const movedOut = changes.filter((c) => c.status === 'R' && timestampOf(c.from) !== timestampOf(c.name)).map((c) => c.from);
      if (movedOut.length) {
        const rest = deriveSchemaFacts(baseFiles.filter((f) => !movedOut.includes(f.name)));
        newCtx = contextFromFacts(rest, { baseMaxTimestamp: facts.maxTimestamp });
      }
      files = changes.map((c) => {
        const file = { name: c.name, source: fs.readFileSync(path.join(repoRoot(), c.name), 'utf8') };
        if (c.status === 'A') return file;
        touched.push({ file: c.name, status: c.status === 'R' ? 'renamed' : 'modified', renamedFrom: c.from });
        if (c.status === 'M' || timestampOf(c.from) === timestampOf(c.name)) return { ...file, ctx: asOfCtx, skipBaseMax: true, onBase: c.status === 'M' };
        return movedOut.length ? { ...file, ctx: newCtx } : file;
      });
    }
    mode = `change set vs ${opts.base}`;
  }

  const result = lintMigrationSet(files, ctx);
  let exit = 0;
  if (result.violations.length) exit = 1;
  else if (result.undecided.length) exit = 2;
  return { exit, report: { mode, opts, ...result, ...(touched.length ? { touched } : {}) } };
}

function print(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (report.error) {
    console.error(`migration-lint: ${report.error}`);
    return;
  }
  console.log(`migration-lint: ${report.mode}`);
  for (const t of report.touched ?? []) console.log(`${t.file}: ${t.status}${t.renamedFrom ? ` from ${t.renamedFrom}` : ''}`);
  for (const v of report.violations) console.log(formatViolation(v));
  for (const v of report.undecided) console.log(`${v.file}:${v.line}: ${v.rule === 'PARSE' ? 'PARSE' : 'R*-UNRESOLVED'} ${v.message} (lint could not decide)`);
  for (const a of report.allowed) console.log(`${a.file}:${a.line}: R${a.rule} ALLOWED by line ${a.annotationLine} - ${a.reason}`);
  for (const s of report.stale) console.log(`${s.file}:${s.line}: warning: ${s.message}`);
  console.log(`${report.violations.length} violation(s), ${report.allowed.length} annotation(s) honoured, ${report.undecided.length} undecided, ${report.stale.length} stale annotation(s), ${report.filesScanned} file(s) scanned`);
  if (report.violations.length) {
    const rules = [...new Set(report.violations.map((v) => v.rule))].filter((r) => RULES[r]);
    for (const r of rules) console.log(`  R${r}: ${RULES[r]}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { exit, report } = run(process.argv.slice(2));
    print(report, process.argv.includes('--json'));
    if (process.env.GITHUB_STEP_SUMMARY && !report.error) {
      const lines = [`### migration-lint (${report.mode})`, '', `${report.violations.length} violation(s), ${report.allowed.length} annotation(s), ${report.undecided.length} undecided`];
      if (exit === 2) lines.push('', '**The lint could not decide** (tool failure, not an unsafe migration).');
      for (const v of report.violations) lines.push(`- \`${formatViolation(v)}\``);
      for (const a of report.allowed) lines.push(`- allowed \`${a.file}:${a.line}\` R${a.rule}: ${a.reason}`);
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
    }
    if (process.env.GITHUB_ACTIONS && !report.error) {
      // Keep stdout machine-readable in --json mode; workflow diagnostics use stderr.
      for (const v of [...report.violations, ...report.undecided]) console.error(`::error file=${v.file},line=${v.line}::R${v.rule} ${v.message}`);
    }
    process.exit(exit);
  } catch (err) {
    console.error(`migration-lint: ${err.message}`);
    process.exit(2);
  }
}
