#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'pipe', ...opts }).toString('utf8');

const guardScriptPath = new URL('./guard-no-tracked-env-backups.mjs', import.meta.url);

const initRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'alga-env-backup-guard-'));
  run('git', ['init'], { cwd: dir });
  // Avoid requiring global git config in CI environments.
  run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  run('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
};

const runGuard = (cwd) => {
  execFileSync(process.execPath, [guardScriptPath.pathname], { cwd, stdio: 'pipe' });
};

const expectPass = (cwd) => {
  try {
    runGuard(cwd);
  } catch (error) {
    const stderr = error?.stderr?.toString?.('utf8') ?? '';
    throw new Error(`Expected guard to pass but it failed. stderr=${stderr}`);
  }
};

const expectFail = (cwd, expectedStderrIncludes) => {
  try {
    runGuard(cwd);
    throw new Error('Expected guard to fail but it passed.');
  } catch (error) {
    const code = error?.status;
    const stderr = error?.stderr?.toString?.('utf8') ?? '';
    if (code !== 1) {
      throw new Error(`Expected exit code 1, got ${code}. stderr=${stderr}`);
    }
    for (const text of expectedStderrIncludes) {
      if (!stderr.includes(text)) {
        throw new Error(`Expected stderr to include ${JSON.stringify(text)}. stderr=${stderr}`);
      }
    }
  }
};

const main = () => {
  // Empty repo: should pass.
  const emptyRepo = initRepo();
  writeFileSync(join(emptyRepo, 'README.md'), '# test\n', 'utf8');
  run('git', ['add', 'README.md'], { cwd: emptyRepo });
  run('git', ['commit', '-m', 'init'], { cwd: emptyRepo });
  expectPass(emptyRepo);

  // Repo with tracked env backup: should fail.
  const badRepo = initRepo();
  const offender = '.env.local.bak.20260213';
  writeFileSync(join(badRepo, offender), 'SECRET=oops\n', 'utf8');
  run('git', ['add', offender], { cwd: badRepo });
  run('git', ['commit', '-m', 'add offender'], { cwd: badRepo });
  expectFail(badRepo, ['Tracked env-backup files detected', offender]);
};

main();

