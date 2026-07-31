import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  HEADER,
  buildRow,
  coverageByDirectory,
  coverageGroupKey,
  testCounts,
} from '../../../../scripts/record-test-metrics.mjs';

const scriptPath = join(process.cwd(), '../scripts/record-test-metrics.mjs');

const ENV_KEYS = [
  'TEST_METRICS_SUITE', 'TEST_METRICS_RESULTS', 'TEST_METRICS_COVERAGE', 'TEST_METRICS_DETAIL',
  'GITHUB_SHA', 'GITHUB_REF_NAME', 'GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_SERVER_URL',
];
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('testCounts', () => {
  it('reads vitest json-reporter counts and computes pass % over passed+failed only', () => {
    const counts = testCounts({
      numTotalTests: 110,
      numPassedTests: 97,
      numFailedTests: 3,
      numPendingTests: 8,
      numTodoTests: 2,
      testResults: [
        { startTime: 1_000, endTime: 61_000 },
        { startTime: 5_000, endTime: 121_000 },
      ],
    });
    expect(counts).toMatchObject({ passed: 97, failed: 3, skipped: 8, todo: 2, total: 110 });
    expect(counts!.passPct).toBe(97);
    expect(counts!.durationS).toBe(120);
  });

  it('returns null for missing results and blank pass % when nothing ran', () => {
    expect(testCounts(null)).toBeNull();
    expect(testCounts({ numPassedTests: 0, numFailedTests: 0, numPendingTests: 5 })!.passPct).toBe('');
  });
});

describe('coverageGroupKey', () => {
  it('groups at the subsystem depth per tree', () => {
    expect(coverageGroupKey('server/src/lib/actions/foo/bar.ts')).toBe('server/src/lib/actions');
    expect(coverageGroupKey('server/src/components/tickets/Board.tsx')).toBe('server/src/components');
    expect(coverageGroupKey('server/src/rootFile.ts')).toBe('server/src');
    expect(coverageGroupKey('packages/billing/src/actions/invoice.ts')).toBe('packages/billing');
    expect(coverageGroupKey('shared/workflow/core/engine.ts')).toBe('shared/workflow');
  });
});

describe('coverageByDirectory', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'metrics-fixture-'));
    mkdirSync(join(repoRoot, 'server/src/lib/actions'), { recursive: true });
    mkdirSync(join(repoRoot, 'packages/billing/src'), { recursive: true });
    mkdirSync(join(repoRoot, 'packages/unloaded/src'), { recursive: true });
    mkdirSync(join(repoRoot, 'packages/billing/src/dist'), { recursive: true });
    writeFileSync(join(repoRoot, 'server/src/lib/actions/a.ts'), '');
    writeFileSync(join(repoRoot, 'server/src/lib/actions/b.ts'), '');
    writeFileSync(join(repoRoot, 'packages/billing/src/x.ts'), '');
    writeFileSync(join(repoRoot, 'packages/billing/src/x.test.ts'), '');
    writeFileSync(join(repoRoot, 'packages/billing/src/types.d.ts'), '');
    writeFileSync(join(repoRoot, 'packages/billing/src/dist/bundle.js'), '');
    writeFileSync(join(repoRoot, 'packages/unloaded/src/y.ts'), '');
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  const metric = (covered: number, total: number) => ({
    lines: { covered, total },
    statements: { covered, total },
    branches: { covered: 0, total: 0 },
    functions: { covered, total },
  });

  it('aggregates per directory, counts files on disk, and reports never-loaded directories as 0/N', () => {
    const rows = coverageByDirectory(
      {
        total: metric(99, 99),
        [join(repoRoot, 'server/src/lib/actions/a.ts')]: metric(8, 10),
        [join(repoRoot, 'server/src/lib/actions/b.ts')]: metric(2, 10),
        [join(repoRoot, 'packages/billing/src/x.ts')]: metric(5, 5),
      },
      repoRoot,
    );

    const actions = rows.find((r) => r.dir === 'server/src/lib/actions')!;
    expect(actions).toMatchObject({ lines: 50, linesCovered: 10, linesTotal: 20, filesMeasured: 2, filesTotal: 2 });

    // test files, .d.ts, and dist/ do not count toward files on disk
    const billing = rows.find((r) => r.dir === 'packages/billing')!;
    expect(billing).toMatchObject({ lines: 100, filesMeasured: 1, filesTotal: 1 });

    const unloaded = rows.find((r) => r.dir === 'packages/unloaded')!;
    expect(unloaded).toMatchObject({ lines: '', filesMeasured: 0, filesTotal: 1 });
  });

  it('returns empty for a missing summary', () => {
    expect(coverageByDirectory(null as never, repoRoot)).toEqual([]);
  });
});

describe('buildRow', () => {
  it('assembles the sheet row from env and result files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'metrics-row-'));
    writeFileSync(join(dir, 'results.json'), JSON.stringify({ numTotalTests: 5, numPassedTests: 4, numFailedTests: 1 }));
    process.env.TEST_METRICS_SUITE = 'unit-coverage';
    process.env.TEST_METRICS_RESULTS = join(dir, 'results.json');
    delete process.env.TEST_METRICS_COVERAGE;
    process.env.GITHUB_SHA = 'abcdef0123456789';
    process.env.GITHUB_REF_NAME = 'main';
    process.env.GITHUB_REPOSITORY = 'Nine-Minds/alga-psa';
    process.env.GITHUB_RUN_ID = '42';
    delete process.env.GITHUB_SERVER_URL;

    const row = buildRow();
    const get = (col: string) => row[HEADER.indexOf(col)];
    expect(get('suite')).toBe('unit-coverage');
    expect(get('commit')).toBe('abcdef0123');
    expect(get('passed')).toBe(4);
    expect(get('pass_pct')).toBe(80);
    expect(get('run_url')).toBe('https://github.com/Nine-Minds/alga-psa/actions/runs/42');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('CLI', () => {
  it('--dry-run prints the row without needing Google credentials', () => {
    const dir = mkdtempSync(join(tmpdir(), 'metrics-cli-'));
    writeFileSync(join(dir, 'results.json'), JSON.stringify({ numTotalTests: 2, numPassedTests: 2, numFailedTests: 0 }));
    const result = spawnSync(process.execPath, [scriptPath, '--dry-run'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TEST_METRICS_SUITE: 'smoke',
        TEST_METRICS_RESULTS: join(dir, 'results.json'),
        GOOGLE_SA_KEY: '',
        TEST_METRICS_SHEET_ID: '',
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('suite: smoke');
    expect(result.stdout).toContain('passed: 2');
    rmSync(dir, { recursive: true, force: true });
  });
});
