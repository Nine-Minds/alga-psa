#!/usr/bin/env node
// Generated-artifact gate (CM L0g, alga-2026-0002848).
//
//   node scripts/ci/artifact-drift.mjs [--base <ref>] [--no-generate]
//
// 1. Runs `npm run generate:artifacts` (skip with --no-generate).
// 2. Fails when `git status` shows any generated artifact differing from what is
//    committed (modified or untracked): the PR forgot to commit regenerated output.
// 3. Fails when the OpenAPI documents changed NON-additively relative to --base
//    (default HEAD): a removed path/method/property/enum value, a changed type, or a
//    newly required request field. Deliberate breaks go in
//    scripts/ci/artifact-drift-allow.json with a reason.
//
// Exit 0 clean, 1 drift or breaking change, 2 the check could not run.
//
// Output contract: stdout carries ONLY repo-relative paths, one per line (each
// drifted artifact, and each OpenAPI document with a non-additive change), because
// CI pipes stdout to `attribute-card.mjs --stdin`, which reads every line as a
// path. Generator output and every human-readable message go to stderr, which
// the job log still shows.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../..');

/** Every file `npm run generate:artifacts` owns. Keep in sync with the generators. */
export const ARTIFACT_PATHS = [
  'sdk/docs/openapi',
  'server/src/lib/mcp/registry.generated.ts',
  'ee/server/src/chat/registry/apiRegistry.generated.ts',
  'server/public/locales/xx',
  'server/public/locales/yy',
];
const OPENAPI_DOCS = ['sdk/docs/openapi/alga-openapi.ce.json', 'sdk/docs/openapi/alga-openapi.ee.json'];
const ALLOW_FILE = path.join(here, 'artifact-drift-allow.json');
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

// ---------------------------------------------------------------- additivity

const esc = (k) => String(k).replace(/~/g, '~0').replace(/\//g, '~1');

/** Component schema names reachable from any request body or parameter: only there is "newly required" breaking. */
function requestSchemaNames(doc) {
  const comps = doc.components?.schemas ?? {};
  const seen = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node.$ref === 'string') {
      const m = /^#\/components\/schemas\/(.+)$/.exec(node.$ref);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        visit(comps[m[1]]);
      }
    }
    for (const v of Object.values(node)) visit(v);
  };
  for (const item of Object.values(doc.paths ?? {})) {
    for (const [k, op] of Object.entries(item ?? {})) {
      if (!HTTP_METHODS.includes(k) || !op) continue;
      visit(op.requestBody);
      visit(op.parameters);
    }
    visit(item?.parameters);
  }
  return seen;
}

/**
 * Differences between two OpenAPI documents that are not additive.
 * Returns [{ pointer, kind, message }].
 */
export function nonAdditiveChanges(before, after) {
  const out = [];
  const reqNames = requestSchemaNames(after);
  const add = (pointer, kind, message) => out.push({ pointer, kind, message });

  const walk = (b, a, pointer, inRequest) => {
    if (Array.isArray(b)) {
      if (!Array.isArray(a)) return add(pointer, 'type-changed', 'array became non-array');
      if (pointer.endsWith('/enum')) {
        for (const v of b) if (!a.some((x) => JSON.stringify(x) === JSON.stringify(v))) add(pointer, 'enum-removed', `enum value ${JSON.stringify(v)} removed`);
        return;
      }
      if (pointer.endsWith('/required')) {
        if (inRequest) for (const v of a) if (!b.includes(v)) add(pointer, 'required-added', `"${v}" is newly required in a request schema`);
        return;
      }
      if (pointer.endsWith('/parameters')) {
        const key = (p) => (p && p.$ref) || `${p?.in}:${p?.name}`;
        const bk = new Map(b.map((p) => [key(p), p]));
        const ak = new Map(a.map((p) => [key(p), p]));
        for (const [k, p] of bk) if (!ak.has(k)) add(`${pointer}`, 'param-removed', `parameter ${k} removed`);
        for (const [k, p] of ak) if (!bk.has(k) && p?.required === true) add(`${pointer}`, 'required-added', `new required parameter ${k}`);
        for (const [k, p] of bk) if (ak.has(k)) walk(p, ak.get(k), `${pointer}/${esc(k)}`, inRequest);
        return;
      }
      // anyOf/oneOf/allOf/tags/etc: positional compare, additions at the end are fine.
      b.forEach((v, i) => {
        if (i >= a.length) add(`${pointer}/${i}`, 'removed', 'array element removed');
        else walk(v, a[i], `${pointer}/${i}`, inRequest);
      });
      return;
    }
    if (b && typeof b === 'object') {
      if (!a || typeof a !== 'object' || Array.isArray(a)) return add(pointer, 'type-changed', 'object became non-object');
      for (const k of Object.keys(b)) {
        if (!(k in a)) {
          if (k === 'description' || k === 'summary' || k === 'example' || k === 'examples' || k === 'x-placeholder') continue;
          add(`${pointer}/${esc(k)}`, 'removed', `${k} removed`);
          continue;
        }
        let req = inRequest;
        if (pointer === '/components/schemas') req = reqNames.has(k);
        else if (/^\/paths\/[^/]+\/[a-z]+$/.test(pointer) && k === 'requestBody') req = true;
        else if (/^\/paths\/[^/]+\/[a-z]+$/.test(pointer) && k === 'responses') req = false;
        walk(b[k], a[k], `${pointer}/${esc(k)}`, req);
      }
      return;
    }
    // scalars
    if (pointer.endsWith('/type') && b !== a) add(pointer, 'type-changed', `type ${JSON.stringify(b)} -> ${JSON.stringify(a)}`);
    else if (/\/(format|nullable|maximum|exclusiveMaximum)$/.test(pointer) && b !== a) add(pointer, 'constraint-changed', `${pointer.split('/').pop()} ${JSON.stringify(b)} -> ${JSON.stringify(a)}`);
    else if (/\/(minimum|exclusiveMinimum|minLength|minItems)$/.test(pointer) && inRequest && a > b) add(pointer, 'constraint-tightened', `${b} -> ${a}`);
    else if (/\/(maxLength|maxItems)$/.test(pointer) && inRequest && a < b) add(pointer, 'constraint-tightened', `${b} -> ${a}`);
    else if (pointer.endsWith('/$ref') && b !== a) add(pointer, 'ref-changed', `${b} -> ${a}`);
  };

  walk(before.paths ?? {}, after.paths ?? {}, '/paths', false);
  walk(before.components?.schemas ?? {}, after.components?.schemas ?? {}, '/components/schemas', false);
  return out;
}

export function readAllow(file = ALLOW_FILE) {
  if (!fs.existsSync(file)) return [];
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const e of list) {
    if (!e.doc || !e.pointer || typeof e.reason !== 'string' || e.reason.replace(/\s/g, '').length < 12) {
      throw new Error(`${path.relative(repoRoot, file)}: every entry needs doc, pointer and a reason of at least 12 characters`);
    }
  }
  return list;
}

export function applyAllow(changes, doc, allow) {
  const used = new Set();
  const left = changes.filter((c) => {
    const hit = allow.find((e) => e.doc === doc && (c.pointer === e.pointer || c.pointer.startsWith(`${e.pointer}/`)));
    if (hit) used.add(hit);
    return !hit;
  });
  return { left, used };
}

// ------------------------------------------------------------------ git side

const git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 28 });

export function driftedFiles() {
  return git(['status', '--porcelain', '--untracked-files=all', '--', ...ARTIFACT_PATHS])
    .split('\n').filter(Boolean).map((l) => l.slice(3));
}

/**
 * Split a run's findings into machine output (stdout: paths only) and human
 * output (stderr). `breaks` is [{ doc, left, used }] per OpenAPI document.
 */
export function formatReport({ drift, breaks, base }) {
  const stdout = [];
  const stderr = [];
  if (drift.length) {
    stderr.push('artifact-drift: generated artifacts differ from what is committed. Run `npm run generate:artifacts` and commit the result:');
    for (const f of drift) {
      stderr.push(`  ${f}`);
      stdout.push(f);
    }
  }
  for (const { doc, left, used } of breaks) {
    for (const e of used) stderr.push(`artifact-drift: ALLOWED ${doc} ${e.pointer} - ${e.reason}`);
    if (left.length) {
      stdout.push(doc);
      stderr.push(`artifact-drift: ${doc} has ${left.length} non-additive change(s) vs ${base}:`);
      for (const c of left.slice(0, 200)) stderr.push(`  [${c.kind}] ${c.pointer}: ${c.message}`);
      stderr.push('  If intentional, add an entry (doc, pointer, reason) to scripts/ci/artifact-drift-allow.json');
    }
  }
  const exit = drift.length || breaks.some((b) => b.left.length) ? 1 : 0;
  if (exit === 0) stderr.push(`artifact-drift: clean (${drift.length} drifted files, OpenAPI additive vs ${base})`);
  return { stdout, stderr, exit };
}

function main(argv) {
  let base = 'HEAD';
  let generate = true;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') base = argv[++i];
    else if (argv[i] === '--no-generate') generate = false;
    else throw new Error(`unknown argument ${argv[i]}`);
  }

  if (generate) {
    // Generator chatter goes to stderr so stdout stays a pure path list.
    const res = spawnSync('npm', ['run', 'generate:artifacts'], { cwd: repoRoot, stdio: ['ignore', 2, 2] });
    if (res.status !== 0) {
      console.error('artifact-drift: `npm run generate:artifacts` failed (tool failure, not drift)');
      return 2;
    }
  }

  const drift = driftedFiles();
  const allow = readAllow();
  const breaks = [];
  for (const doc of OPENAPI_DOCS) {
    let before;
    try {
      before = JSON.parse(git(['show', `${base}:${doc}`]));
    } catch {
      console.error(`artifact-drift: cannot read ${doc} at ${base} (fetch the base ref, e.g. fetch-depth: 0)`);
      return 2;
    }
    const after = JSON.parse(fs.readFileSync(path.join(repoRoot, doc), 'utf8'));
    breaks.push({ doc, ...applyAllow(nonAdditiveChanges(before, after), doc, allow) });
  }
  const report = formatReport({ drift, breaks, base });
  for (const line of report.stderr) console.error(line);
  for (const line of report.stdout) console.log(line);
  return report.exit;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(`artifact-drift: ${err.message}`);
    process.exit(2);
  }
}
