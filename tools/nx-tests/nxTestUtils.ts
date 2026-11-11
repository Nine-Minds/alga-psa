import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
export const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
const nxPackagePath = createRequire(import.meta.url).resolve('nx/package.json');
const nxPackage = JSON.parse(fs.readFileSync(nxPackagePath, 'utf8'));
if (typeof nxPackage.bin?.nx !== 'string') {
  throw new Error('The installed Nx package must declare its nx CLI entry point');
}
const nxBin = path.resolve(path.dirname(nxPackagePath), nxPackage.bin.nx);

export async function runNx(args: string[], extraEnv: Record<string, string> = {}): Promise<string> {
  const { stdout } = await execFileAsync(process.execPath, [nxBin, ...args], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      NX_DAEMON: 'false',
      NX_ISOLATE_PLUGINS: 'false',
      CI: 'true',
      // Avoid Playwright port probing while Nx evaluates the project graph.
      PLAYWRIGHT_APP_PORT: process.env.PLAYWRIGHT_APP_PORT || '3300',
      PLAYWRIGHT_APP_PORT_LOCKED: 'true',
      ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

export function parseTrailingJsonArray(output: string): string[] {
  const start = output.lastIndexOf('[');
  const end = output.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Expected JSON array in output. Output:\n${output}`);
  }
  const parsed = JSON.parse(output.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error(`Expected JSON array, got: ${typeof parsed}`);
  return parsed as string[];
}
