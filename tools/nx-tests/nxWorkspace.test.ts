import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const nxBin = path.resolve(process.cwd(), 'node_modules/.bin/nx');

async function runNx(args: string[]) {
  const { stdout } = await execFileAsync(nxBin, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NX_DAEMON: 'false',
      NX_ISOLATE_PLUGINS: 'false',
      CI: 'true',
      // Nx loads Playwright configs while building the project graph. In some restricted
      // environments, binding/listening on ports is not permitted (EPERM), so force a
      // locked port to avoid probing during config evaluation.
      PLAYWRIGHT_APP_PORT: process.env.PLAYWRIGHT_APP_PORT || '3300',
      PLAYWRIGHT_APP_PORT_LOCKED: 'true',
    },
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

function parseTrailingJsonArray(output: string): string[] {
  const start = output.lastIndexOf('[');
  const end = output.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Expected JSON array in output. Output:\n${output}`);
  }
  const json = output.slice(start, end + 1);
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error(`Expected JSON array, got: ${typeof parsed}`);
  return parsed as string[];
}

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
    const outFile = path.join(tmpDir, 'graph.html');

    await runNx(['graph', '--file', outFile, '--focus', 'server']);

    const stat = fs.statSync(outFile);
    expect(stat.size).toBeGreaterThan(0);
  });

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
