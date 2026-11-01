#!/usr/bin/env node
// Usage: node scripts/review/hotpath-diff.mjs <baseDir> <headDir>
// Compares hotpath capture files (<dir>/*.json, as written by emitStep) step by step.
// Accepts only an empty diff: additions, reductions and reordering all fail.
import fs from 'node:fs';
import path from 'node:path';

const [baseDir, headDir] = process.argv.slice(2);
if (!baseDir || !headDir) {
  console.error('usage: hotpath-diff.mjs <baseDir> <headDir>');
  process.exit(2);
}

const load = (dir) => Object.fromEntries(
  fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    return [data.step, data];
  }),
);

const base = load(baseDir);
const head = load(headDir);
const steps = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort();
let failed = 0;

for (const step of steps) {
  const a = base[step];
  const b = head[step];
  if (!a || !b) {
    console.log(`FAIL ${step}: present only in ${a ? 'base' : 'head'}`);
    failed++;
    continue;
  }
  const n = Math.max(a.statements.length, b.statements.length);
  let first = -1;
  for (let i = 0; i < n; i++) {
    const x = a.statements[i];
    const y = b.statements[i];
    if (!x || !y || x.sql !== y.sql || x.bindings !== y.bindings) { first = i; break; }
  }
  if (first === -1) {
    console.log(`OK   ${step}: ${a.count} statements, identical`);
  } else {
    failed++;
    console.log(`FAIL ${step}: base=${a.count} head=${b.count} delta=${b.count - a.count}; first difference at statement ${first}`);
    console.log(`       base: ${a.statements[first]?.sql ?? '(none)'}`);
    console.log(`       head: ${b.statements[first]?.sql ?? '(none)'}`);
  }
}
process.exit(failed ? 1 : 0);
