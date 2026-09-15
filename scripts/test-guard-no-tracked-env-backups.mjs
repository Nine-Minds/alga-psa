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
  // A failed Git command must never be interpreted as an empty clean index.
  expectFail(mkdtempSync(join(tmpdir(), 'alga-env-guard-no-git-')), ['Unable to inspect tracked filenames']);

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

  // Exercise a real index whose NUL-delimited output exceeds execFileSync's
  // default 1 MiB buffer, including an offender after the large safe prefix.
  const largeRepo = initRepo();
  const blob = run('git', ['hash-object', '-w', '--stdin'], { cwd: largeRepo, input: 'fixture' }).trim();
  const entries = Array.from({ length: 9000 }, (_, index) =>
    `100644 ${blob}\tfiles/${String(index).padStart(5, '0')}-${'x'.repeat(130)}.txt\0`).join('');
  run('git', ['update-index', '-z', '--index-info'], { cwd: largeRepo, input: entries });
  expectPass(largeRepo);
  const lateOffender = 'zz-last/.env.local.bak.fixture';
  run('git', ['update-index', '-z', '--index-info'], {
    cwd: largeRepo, input: `100644 ${blob}\t${lateOffender}\0`,
  });
  expectFail(largeRepo, ['Tracked env-backup files detected', lateOffender]);

};

main();

