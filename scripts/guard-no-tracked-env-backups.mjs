#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const ENV_BACKUP_REGEXES = [
  // Matches `.env*.bak*` (ex: `.env.local.bak`, `.env.local.bak.20260213`, `.env.bak~`)
  /(^|\/)\.env[^/]*\.bak[^/]*$/i,
];

const lsFilesZ = () => {
  const out = execFileSync('git', ['ls-files', '-z'], { stdio: ['ignore', 'pipe', 'inherit'] });
  return out
    .toString('utf8')
    .split('\0')
    .map((s) => s.trim())
    .filter(Boolean);
};

const main = () => {
  const tracked = lsFilesZ();
  const offenders = tracked.filter((file) => ENV_BACKUP_REGEXES.some((re) => re.test(file)));

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

main();

