#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readChangedFiles, selectIntegration } from './lib/integration-selection.mjs';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const selection = selectIntegration(readChangedFiles({
  cwd,
  base: process.env.TIER1_BASE_SHA,
  head: process.env.TIER1_HEAD_SHA || 'HEAD',
}));
console.log(JSON.stringify(selection));
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `should_run=${selection.shouldRun}\nfull=${selection.full}\n`);
}
