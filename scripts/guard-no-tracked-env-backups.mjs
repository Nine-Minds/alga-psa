#!/usr/bin/env node
import { spawn } from 'node:child_process';

const ENV_BACKUP_REGEXES = [
  // Matches `.env*.bak*` (ex: `.env.local.bak`, `.env.local.bak.20260213`, `.env.bak~`)
  /(^|\/)\.env[^/]*\.bak[^/]*$/i,
];

const findOffenders = async () => {
  const child = spawn('git', ['ls-files', '-z'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const completed = new Promise((resolve) => {
    child.once('error', (error) => resolve({ error }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  child.stdout.setEncoding('utf8');
  const offenders = [];
  let pending = '';
  for await (const chunk of child.stdout) {
    pending += chunk;
    let separator;
    while ((separator = pending.indexOf('\0')) !== -1) {
      const file = pending.slice(0, separator);
      pending = pending.slice(separator + 1);
      if (ENV_BACKUP_REGEXES.some((re) => re.test(file))) offenders.push(file);
    }
  }
  const result = await completed;
  if (result.error) throw result.error;
  if (result.code !== 0) throw new Error(`git ls-files failed (${result.signal ?? result.code})`);
  if (pending) throw new Error('git ls-files returned an incomplete filename');
  return offenders;
};

const main = async () => {
  const offenders = await findOffenders();

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

main().catch((error) => {
  console.error(`Unable to inspect tracked filenames: ${error.message}`);
  process.exitCode = 1;
});

