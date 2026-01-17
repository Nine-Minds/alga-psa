import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const nxBin = path.resolve(process.cwd(), 'node_modules/.bin/nx');

function runNx(args: string[]) {
  return execFileSync(nxBin, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NX_DAEMON: 'false',
      CI: 'true',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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

describe('nx affected', () => {
  it('identifies affected projects from a file list', { timeout: 180_000 }, () => {
    const output = runNx(['show', 'projects', '--affected', '--files=packages/types/src/index.ts', '--json']);
    const projects = parseTrailingJsonArray(output);

    expect(projects).toContain('@alga-psa/types');
    // Types changes should affect the main app as a downstream consumer.
    expect(projects).toContain('server');
  });

  it('includes @alga-psa/clients when client code changes', { timeout: 180_000 }, () => {
    const output = runNx(['show', 'projects', '--affected', '--files=packages/clients/src/schemas/client.schema.ts', '--json']);
    const projects = parseTrailingJsonArray(output);
    expect(projects).toContain('@alga-psa/clients');
  });
});
