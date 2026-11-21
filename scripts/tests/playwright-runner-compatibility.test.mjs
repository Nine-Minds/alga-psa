import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));

for (const file of ['node-tests.yml', 'integration-tests.yml', 'e2e-fresh-install-tests.yaml']) {
  const workflow = parse(readFileSync(path.join(root, '.github/workflows', file), 'utf8'));
  for (const [id, job] of Object.entries(workflow.jobs)) {
    for (const step of job.steps ?? []) {
      const commands = (step.run ?? '').split('\n').filter(line => !line.trim().startsWith('#')).join('\n');
      if (!/playwright\s+(?:install\s+--with-deps|install-deps)\b/.test(commands)) continue;

      test(`${file}: ${id} can resolve Chromium and system dependencies on its runner`, () => {
        // A floating runner can advance beyond the OS versions understood by
        // the locked browser tooling. Exercise that tooling for the chosen OS.
        const runner = /^ubuntu-(\d+\.\d+)(-arm)?$/.exec(job['runs-on']);
        assert.ok(runner, `${id}: choose a versioned Ubuntu runner for browser installation`);
        const cwd = path.resolve(root, step['working-directory'] ?? job.defaults?.run?.['working-directory'] ?? '.');
        const require = createRequire(path.join(cwd, 'package.json'));
        const packageFile = require.resolve('playwright/package.json');
        const { bin } = JSON.parse(readFileSync(packageFile, 'utf8'));
        const cli = path.resolve(path.dirname(packageFile), bin.playwright);
        const result = spawnSync(process.execPath, [cli, 'install', '--with-deps', '--dry-run', 'chromium'], {
          cwd,
          encoding: 'utf8',
          timeout: 30_000,
          env: { ...process.env, PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: `ubuntu${runner[1]}-${runner[2] ? 'arm64' : 'x64'}` },
        });
        const diagnostics = `${result.stdout}\n${result.stderr}`;
        assert.equal(result.status, 0, diagnostics);
        // Playwright 1.57's dependency dry-run exits zero even on unsupported
        // systems. Require both an actual package plan and a browser download.
        assert.match(result.stdout, /apt-get install[^\n]+lib/, diagnostics);
        assert.match(result.stdout, /Download url:\s+https:\/\//, diagnostics);
        assert.doesNotMatch(diagnostics, /Cannot install dependencies|does not support chromium/);
      });
    }
  }
}
