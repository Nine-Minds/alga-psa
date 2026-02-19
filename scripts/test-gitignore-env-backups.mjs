#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const REQUIRED_PATTERNS = [
  '**/.env*.bak*',
  'server/.env.local.bak*',
  'ee/server/.env.local.bak*',
];

const main = () => {
  const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  const missing = REQUIRED_PATTERNS.filter((pattern) => !gitignore.includes(pattern));

  if (missing.length === 0) {
    process.exit(0);
  }

  console.error('ERROR: .gitignore is missing required env-backup ignore patterns.');
  for (const pattern of missing) {
    console.error(`- ${pattern}`);
  }
  process.exit(1);
};

main();

