#!/usr/bin/env node
/**
 * Build memory harness — runs INSIDE a container (see scripts/build-mem.sh).
 *
 * Pipeline:
 *   1. clear   — remove server/.next + server/tsconfig.tsbuildinfo (cold build)
 *   2. build   — `npm run build` (or --build-cmd) from /work, captured + timed
 *   3. sample  — every --interval-ms, walk the build's /proc descendant tree and
 *                sum PSS (smaps_rollup); tag each sample with the current stage
 *                (assemblyscript / build-deps / next-build) for attribution
 *   4. verify  — exit 0 AND server/.next/BUILD_ID present (+ best-effort manifests)
 *
 * Headline metric is the container's whole-tree cgroup high-water mark, read from
 * /sys/fs/cgroup/memory.peak (cgroup v2). The PSS sampler is only for attribution
 * (which stage/process drives the peak). The container is fresh per run, so
 * memory.peak reflects only this build.
 *
 * Output: a human summary, one machine line `[BUILD-MEM RESULT] {json}`, plus
 * .build-mem/result-<label>.json and .build-mem/timeline-<label>.csv.
 *
 * Exit code is 0 only if the build succeeds AND verification passes.
 *
 * Usage (inside container):
 *   node scripts/build-mem-harness.mjs [--build-cmd "npm run build"] [--label NAME]
 *       [--skip-clear] [--interval-ms 150] [--json-only]
 */

import { spawn } from 'node:child_process';
import { rmSync, existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SERVER_DIR = resolve(REPO_ROOT, 'server');
const NEXT_DIR = resolve(SERVER_DIR, '.next');
const TSBUILDINFO = resolve(SERVER_DIR, 'tsconfig.tsbuildinfo');
const ARTIFACT_DIR = resolve(REPO_ROOT, '.build-mem');

const ARGS = parseArgs(process.argv.slice(2));
const BUILD_CMD = ARGS['build-cmd'] ?? 'npm run build';
const SKIP_CLEAR = !!ARGS['skip-clear'];
const INTERVAL_MS = Number(ARGS['interval-ms'] ?? 150);
const JSON_ONLY = !!ARGS['json-only'];
const LABEL = sanitizeLabel(ARGS.label ?? defaultLabel());

const CGROUP_PEAK = '/sys/fs/cgroup/memory.peak';
const CGROUP_CURRENT = '/sys/fs/cgroup/memory.current';

// Stage detection: ordered high → low precedence. First matching marker present
// in the live process tree wins (stages run sequentially, but a later stage can
// briefly overlap a lingering parent of an earlier one).
const STAGES = [
  { name: 'next-build', test: (c) => /next(\/dist)?\b.*\bbuild\b|next-build|next\/dist\/build/.test(c) || /\bnext\b.*\bbuild\b/.test(c) },
  { name: 'build-deps', test: (c) => /\bnx\b|build-deps|nx\/bin|run-many/.test(c) || /\btsc\b/.test(c) },
  { name: 'assemblyscript', test: (c) => /build-assemblyscript|assemblyscript\/bin\/asc|\basc\b/.test(c) },
];

function log(...a) { if (!JSON_ONLY) console.log(...a); }
function stamp(stage, status, extra = '') { log(`[HARNESS] stage=${stage} status=${status}${extra ? ' ' + extra : ''}`); }

// ---------- /proc helpers ----------

function listPids() {
  const out = [];
  for (const name of readdirSync('/proc')) {
    if (/^\d+$/.test(name)) out.push(Number(name));
  }
  return out;
}

function readStatPpid(pid) {
  // /proc/<pid>/stat: ppid is field 4, but comm (field 2) may contain spaces/parens.
  try {
    const s = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = s.lastIndexOf(')');
    const rest = s.slice(close + 2).split(' '); // after ") ", field 3 = state, field 4 = ppid
    return Number(rest[1]);
  } catch {
    return -1;
  }
}

function readCmdline(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
  } catch {
    return '';
  }
}

function readPssKb(pid) {
  try {
    const s = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
    const m = s.match(/^Pss:\s+(\d+)\s+kB/m);
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

function readCgroupBytes(path) {
  try {
    return Number(readFileSync(path, 'utf8').trim());
  } catch {
    return null;
  }
}

// BFS the descendant set of rootPid (inclusive) from a single /proc snapshot.
function descendantTree(rootPid) {
  const pids = listPids();
  const childrenOf = new Map();
  for (const pid of pids) {
    const ppid = readStatPpid(pid);
    if (ppid < 0) continue;
    if (!childrenOf.has(ppid)) childrenOf.set(ppid, []);
    childrenOf.get(ppid).push(pid);
  }
  const out = [];
  const queue = [rootPid];
  const seen = new Set();
  while (queue.length) {
    const pid = queue.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    out.push(pid);
    for (const child of childrenOf.get(pid) ?? []) queue.push(child);
  }
  return out;
}

function classifyStage(cmdlines) {
  for (const stage of STAGES) {
    if (cmdlines.some((c) => stage.test(c))) return stage.name;
  }
  return 'setup';
}

function friendlyProc(cmd) {
  if (!cmd) return '(unknown)';
  if (/next(\/dist)?.*build/.test(cmd) || /\bnext\b.*\bbuild\b/.test(cmd)) {
    return /jest-worker|worker/.test(cmd) ? 'next build (worker)' : 'next build';
  }
  if (/\bnx\b|build-deps/.test(cmd)) return 'nx build-deps';
  if (/build-assemblyscript|\basc\b/.test(cmd)) return 'assemblyscript';
  if (/\btsc\b/.test(cmd)) return 'tsc';
  if (/jest-worker/.test(cmd)) return 'jest-worker';
  const tok = cmd.split(/\s+/);
  const bin = tok[0].split('/').pop();
  if (bin === 'node' && tok[1]) return `node ${tok[1].split('/').pop()}`;
  return bin || '(unknown)';
}

// ---------- main ----------

const result = {
  label: LABEL,
  buildCmd: BUILD_CMD,
  startedAt: new Date().toISOString(),
  ok: false,
  build: { exitCode: null, durationMs: null },
  peak: { cgroupBytes: null, samplerPssKb: null, atStage: null },
  stages: {},          // stageName -> { peakPssKb, firstSeenMs, lastSeenMs }
  topAtPeak: [],       // [{ label, pssKb }] — top 8 individual procs at peak
  rollupAtPeak: [],    // [{ label, count, totalPssKb }] — grouped by proc type at peak
  procCountAtPeak: 0,  // total processes alive at the peak sample
  verify: {},
  intervalMs: INTERVAL_MS,
  samples: 0,
};

mkdirSync(ARTIFACT_DIR, { recursive: true });

// 1. clear
if (!SKIP_CLEAR) {
  stamp('clear', 'start');
  for (const p of [NEXT_DIR, TSBUILDINFO]) {
    try { rmSync(p, { recursive: true, force: true }); } catch {}
  }
  stamp('clear', 'done');
} else {
  stamp('clear', 'skipped');
}

// Reset cgroup peak if the file is writable (kernels >= 6.6). Best-effort; the
// container is fresh anyway so this just discards the harness's own startup blip.
try { writeFileSync(CGROUP_PEAK, '0'); } catch {}

// 2. build + 3. sample
stamp('build', 'start', `cmd="${BUILD_CMD}"`);
const buildStart = Date.now();
const logPath = resolve(ARTIFACT_DIR, `build-${LABEL}.log`);
const logFd = openSync(logPath, 'w');

const child = spawn('bash', ['-lc', BUILD_CMD], {
  cwd: REPO_ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
});

const tee = (chunk) => {
  writeSync(logFd, chunk);
  if (!JSON_ONLY) process.stdout.write(chunk);
};
child.stdout.on('data', tee);
child.stderr.on('data', tee);

const timeline = []; // { tMs, stage, sumPssKb }
let globalPeak = { sumPssKb: 0, stage: 'setup', procs: [] };
const stageMeta = new Map(); // stage -> { peakPssKb, firstSeenMs, lastSeenMs }

const sampler = setInterval(() => {
  let pids;
  try { pids = descendantTree(child.pid); } catch { return; }
  let sumPssKb = 0;
  const procs = [];
  const cmdlines = [];
  for (const pid of pids) {
    if (pid === child.pid) {
      // include the build shell's own cmdline for stage detection but it's tiny
    }
    const cmd = readCmdline(pid);
    if (cmd) cmdlines.push(cmd);
    const pss = readPssKb(pid);
    if (pss > 0) {
      sumPssKb += pss;
      procs.push({ pid, pssKb: pss, label: friendlyProc(cmd) });
    }
  }
  const stage = classifyStage(cmdlines);
  const tMs = Date.now() - buildStart;
  timeline.push({ tMs, stage, sumPssKb });
  result.samples++;

  const meta = stageMeta.get(stage) ?? { peakPssKb: 0, firstSeenMs: tMs, lastSeenMs: tMs };
  meta.peakPssKb = Math.max(meta.peakPssKb, sumPssKb);
  meta.lastSeenMs = tMs;
  stageMeta.set(stage, meta);

  if (sumPssKb > globalPeak.sumPssKb) {
    procs.sort((a, b) => b.pssKb - a.pssKb);
    globalPeak = { sumPssKb, stage, procs }; // keep the full list for an accurate rollup
  }
}, INTERVAL_MS);

const exitCode = await new Promise((res) => {
  child.on('close', (code) => res(code ?? -1));
  child.on('error', () => res(-1));
});

clearInterval(sampler);
closeSync(logFd);
const durationMs = Date.now() - buildStart;
result.build.exitCode = exitCode;
result.build.durationMs = durationMs;
stamp('build', exitCode === 0 ? 'done' : 'fail', `exit=${exitCode} duration_ms=${durationMs}`);

// Headline: cgroup peak (read after build so it covers the whole run).
const cgroupPeak = readCgroupBytes(CGROUP_PEAK);
result.peak.cgroupBytes = cgroupPeak;
result.peak.samplerPssKb = globalPeak.sumPssKb;
result.peak.atStage = globalPeak.stage;
result.procCountAtPeak = globalPeak.procs.length;
result.topAtPeak = globalPeak.procs.slice(0, 8).map((p) => ({ label: p.label, pssKb: p.pssKb }));
// Roll the peak sample's processes up by friendly label so a large worker pool's
// full weight is visible even though only the top 8 are listed individually.
const rollupMap = new Map();
for (const p of globalPeak.procs) {
  const r = rollupMap.get(p.label) ?? { label: p.label, count: 0, totalPssKb: 0 };
  r.count++;
  r.totalPssKb += p.pssKb;
  rollupMap.set(p.label, r);
}
result.rollupAtPeak = [...rollupMap.values()].sort((a, b) => b.totalPssKb - a.totalPssKb);

// Collapse stage metadata, dropping the trivial "setup" bucket if others exist.
for (const [name, meta] of stageMeta) {
  result.stages[name] = meta;
}

// 4. verify
stamp('verify', 'start');
const buildIdPath = resolve(NEXT_DIR, 'BUILD_ID');
const verify = {
  exitZero: exitCode === 0,
  buildId: existsSync(buildIdPath),
  routesManifest: existsSync(resolve(NEXT_DIR, 'routes-manifest.json')),
  buildManifest: existsSync(resolve(NEXT_DIR, 'build-manifest.json')),
};
// Required: exit 0 + BUILD_ID. Manifests are informational (turbopack output may vary).
verify.ok = verify.exitZero && verify.buildId;
result.verify = verify;
result.ok = verify.ok;
stamp('verify', verify.ok ? 'done' : 'fail',
  `exit0=${verify.exitZero} build_id=${verify.buildId} routes_manifest=${verify.routesManifest}`);

// ---------- output ----------

const mb = (bytes) => bytes == null ? 'n/a' : `${(bytes / 1024 / 1024).toFixed(0)} MB`;
const mbFromKb = (kb) => kb == null ? 'n/a' : `${(kb / 1024).toFixed(0)} MB`;
const dur = (ms) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

if (!JSON_ONLY) {
  const headline = cgroupPeak != null ? mb(cgroupPeak) : `${mbFromKb(globalPeak.sumPssKb)} (PSS fallback)`;
  log('');
  log('══════════════════════════════════════════════════════════════');
  log(`  BUILD MEMORY REPORT  [label=${LABEL}]`);
  log('══════════════════════════════════════════════════════════════');
  log(`  PEAK (whole tree): ${headline}   [cgroup memory.peak]`);
  if (cgroupPeak != null) {
    log(`  Sampler cross-check (PSS sum): ${mbFromKb(globalPeak.sumPssKb)}`);
  }
  log(`  DURATION: ${dur(durationMs)}`);
  log(`  BUILD: ${verify.ok ? 'PASS' : 'FAIL'}`);
  log('');
  log(`  Per-stage peak (PSS sampler @ ${INTERVAL_MS}ms):`);
  const ordered = ['assemblyscript', 'build-deps', 'next-build', 'setup'].filter((s) => result.stages[s]);
  const driver = result.peak.atStage;
  for (const s of ordered) {
    const peak = result.stages[s].peakPssKb;
    const flag = s === driver ? '  <-- peak' : '';
    log(`    ${s.padEnd(16)} ${mbFromKb(peak).padStart(8)}${flag}`);
  }
  log('');
  log(`  Top processes at global peak (${result.procCountAtPeak} procs alive):`);
  if (result.topAtPeak.length === 0) {
    log('    (no samples captured — build may have been too fast)');
  } else {
    for (const p of result.topAtPeak) {
      log(`    ${p.label.padEnd(22)} ${mbFromKb(p.pssKb).padStart(8)}`);
    }
  }
  log('');
  log('  Rollup by process type at peak:');
  for (const r of result.rollupAtPeak) {
    const name = `${r.label} ×${r.count}`;
    const each = r.count > 1 ? `  (${mbFromKb(Math.round(r.totalPssKb / r.count))} ea)` : '';
    log(`    ${name.padEnd(26)} ${mbFromKb(r.totalPssKb).padStart(8)}${each}`);
  }
  log('');
  log('  VERIFY:');
  log(`    exit code .......... ${verify.exitZero ? '0      OK' : exitCode + '    FAIL'}`);
  log(`    .next/BUILD_ID ..... ${verify.buildId ? 'present OK' : 'MISSING FAIL'}`);
  log(`    routes-manifest .... ${verify.routesManifest ? 'present OK' : 'absent (info)'}`);
  log(`  => BUILD ${verify.ok ? 'OK' : 'FAILED'}`);
  log('══════════════════════════════════════════════════════════════');
  log(`  artifacts: ${ARTIFACT_DIR}/{result,timeline,build}-${LABEL}.*`);
  log('');
}

// Machine-parseable result line + persisted artifacts.
result.finishedAt = new Date().toISOString();
console.log(`[BUILD-MEM RESULT] ${JSON.stringify(result)}`);

writeFileSync(resolve(ARTIFACT_DIR, `result-${LABEL}.json`), JSON.stringify(result, null, 2));
const csv = ['t_ms,stage,sum_pss_kb', ...timeline.map((r) => `${r.tMs},${r.stage},${r.sumPssKb}`)].join('\n');
writeFileSync(resolve(ARTIFACT_DIR, `timeline-${LABEL}.csv`), csv + '\n');

process.exit(result.ok ? 0 : 1);

// ---------- arg parsing ----------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

function sanitizeLabel(s) {
  return String(s).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'run';
}

function defaultLabel() {
  // ISO without separators, e.g. 20260604-1432
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
