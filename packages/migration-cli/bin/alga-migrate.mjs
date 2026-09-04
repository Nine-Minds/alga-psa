#!/usr/bin/env node
// Executable wrapper: runs the TypeScript CLI through tsx so the CLI works
// from a workspace checkout without a build step.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = join(here, '..', 'src', 'cli.ts');
const require = createRequire(import.meta.url);

let tsxLoaderUrl;
try {
  tsxLoaderUrl = pathToFileURL(require.resolve('tsx/esm')).href;
} catch {
  process.stderr.write('alga-migrate requires the workspace tsx dependency (npm install).\n');
  process.exit(3);
}

const result = spawnSync(process.execPath, ['--import', tsxLoaderUrl, cliPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(result.status ?? 3);
