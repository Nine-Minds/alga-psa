import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTrailingJsonArray, runNx, workspaceRoot } from './nxTestUtils';

const execFileAsync = promisify(execFile);

describe('nx workspace', () => {
  it('initializes and lists projects', { timeout: 120_000 }, async () => {
    const output = await runNx(['show', 'projects', '--json']);
    const projects = parseTrailingJsonArray(output);

    expect(projects).toContain('server');
    expect(projects).toContain('@alga-psa/types');
    expect(projects).toContain('@alga-psa/core');
    expect(projects).toContain('@alga-psa/db');
  });

  it('can generate an nx graph html file', { timeout: 180_000 }, async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-nx-graph-'));
    try {
      const outFile = path.join(tmpDir, 'graph.html');
      // HTML exports expand inputs for every selected task. Restrict the task
      // graph to a real server target rather than expanding every workspace target.
      await runNx(['graph', '--file', outFile, '--focus', 'server', '--targets=test:e2e:email-settings']);

      expect(fs.statSync(outFile).size).toBeGreaterThan(0);
      const environment = fs.readFileSync(path.join(tmpDir, 'static', 'environment.js'), 'utf8');
      const graphJson = environment.match(/window\.taskGraphResponse = (.+);/)?.[1];
      expect(graphJson).toBeDefined();
      const graph: { error: string | null; taskGraph: { tasks: Record<string, unknown> } } = JSON.parse(graphJson!);
      expect(graph.error).toBeNull();
      expect(graph.taskGraph.tasks).toHaveProperty('server:test:e2e:email-settings');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('generates a package graph that passes the circular dependency gate', { timeout: 180_000 }, async () => {
    // LEVERAGE: pattern nx-build-plan-fixture — graph fixtures repeat across build boundary checks
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-nx-cycles-'));
    try {
      const outFile = path.join(tmpDir, 'graph.json');
      await runNx(['graph', '--file', outFile]);
      // Test-only fixtures and locale resources participate in Nx dependency
      // analysis too, and must not introduce application build cycles.
      await execFileAsync(process.execPath, [
        'scripts/check-circular-deps.mjs', outFile,
        '--baseline', '.github/known-cycles.json',
      ], { cwd: workspaceRoot, encoding: 'utf8' });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('plans standalone database builds without application or worker tasks', { timeout: 180_000 }, async () => {
    // LEVERAGE: pattern nx-build-plan-fixture — task graph fixtures repeat across build boundary checks
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-nx-db-build-'));
    try {
      const outFile = path.join(tmpDir, 'tasks.json');
      await runNx(['run', '@alga-psa/db:build', '--graph', outFile]);
      const graph = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      const targets = Object.values(graph.tasks.tasks).map((task: any) => task.target);
      // Even test imports contribute Nx project edges. DB tests must not pull
      // their application consumers back into the database build plan.
      expect(targets).toContainEqual(expect.objectContaining({
        project: '@alga-psa/db', target: 'build',
      }));
      expect(targets.some(target => ['server', 'sebastian-ee', 'temporal-workflows'].includes(target.project))).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('plans dependency builds without prematurely building the server', { timeout: 180_000 }, async () => {
    // LEVERAGE: pattern nx-build-plan-fixture — task graph fixtures repeat across build boundary checks
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-nx-build-deps-'));
    try {
      const outFile = path.join(tmpDir, 'tasks.json');
      await runNx(['build-deps', 'server', '--graph', outFile]);
      const graph = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      const targets = Object.values(graph.tasks.tasks).map((task: any) => task.target);
      // Package-to-server cycles previously scheduled the application while
      // its dependency outputs were still absent, breaking both image builds.
      expect(targets).toEqual(expect.arrayContaining([
        expect.objectContaining({ project: '@alga-psa/billing', target: 'build' }),
        expect.objectContaining({ project: '@alga-psa/opportunities', target: 'build' }),
      ]));
      // Runtime integration fixtures must not pull the separately deployed EE
      // worker (or its EE-only imports) into the community image build.
      expect(targets.some(target => target.project === 'temporal-workflows')).toBe(false);
      expect(targets.filter(target => target.project === 'server')).toEqual([
        expect.objectContaining({ project: 'server', target: 'build-deps' }),
      ]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it.each(['@alga-psa/integrations', '@alga-psa/assets'])(
    'plans standalone %s builds without pulling in the server',
    { timeout: 180_000 },
    async (project) => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-nx-package-build-'));
      try {
        const outFile = path.join(tmpDir, 'tasks.json');
        await runNx(['run', `${project}:build`, '--graph', outFile]);
        const graph = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        const targets = Object.values(graph.tasks.tasks).map((task: any) => task.target);
        expect(targets).toContainEqual(expect.objectContaining({
          project, target: 'build',
        }));
        // Package fixtures must use lower-layer test helpers: importing server
        // implementations from a package creates application build cycles.
        expect(targets.some(target => target.project === 'server')).toBe(false);
        expect(targets.some(target => target.project === 'sebastian-ee')).toBe(false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );

  it('runs the alga-module generator in dry-run mode', { timeout: 120_000 }, async () => {
    const output = await runNx([
      'g',
      '@alga-psa/generators:alga-module',
      '--name',
      'tmp-module',
      '--type',
      'vertical',
      '--directory',
      'packages',
      '--dry-run',
      '--no-interactive',
    ]);

    expect(output).toContain('tmp-module');
  });
});
