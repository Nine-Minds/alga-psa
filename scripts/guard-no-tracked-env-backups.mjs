#!/usr/bin/env node
import { spawn } from 'node:child_process';

const ENV_BACKUP_REGEXES = [
  // Matches `.env*.bak*` (ex: `.env.local.bak`, `.env.local.bak.20260213`, `.env.bak~`)
  /(^|\/)\.env[^/]*\.bak[^/]*$/i,
];

const findTrackedEnvBackups = () => new Promise((resolve, reject) => {
  // Stream the index: a monorepo's file list can exceed execFileSync's buffer.
  // NUL framing preserves filenames even when a chunk ends mid-name.
  const git = spawn('git', ['ls-files', '-z'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const offenders = [];
  let pending = '';
  git.stdout.setEncoding('utf8');
  git.stdout.on('data', chunk => {
    pending += chunk;
    let end;
    while ((end = pending.indexOf('\0')) !== -1) {
      const file = pending.slice(0, end);
      pending = pending.slice(end + 1);
      if (ENV_BACKUP_REGEXES.some(re => re.test(file))) offenders.push(file);
    }
  });
  git.on('error', reject);
  git.stdout.on('error', reject);
  git.on('close', (code, signal) => {
    if (code !== 0 || pending) reject(new Error(`Unable to scan tracked files: git exited with ${signal ?? code}`));
    else resolve(offenders);
  });
});

const main = async () => {
  const offenders = await findTrackedEnvBackups();

  if (offenders.length === 0) {
    process.exit(0);
  }

  // Keep this output tight so GitHub logs are readable.
  console.error('ERROR: Tracked env-backup files detected (these often contain credentials).');
  for (const file of offenders) {
    console.error(`- ${file}`);
  }
  console.error('');
  console.error('Fix: delete these from git history (or at least untrack them) and rely on .gitignore to keep them unstaged.');
  process.exit(1);
};

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

