#!/usr/bin/env node

/**
 * Detects circular dependencies in the Nx project graph.
 *
 * Usage:
 *   npx nx graph --file=graph.json
 *   node scripts/check-circular-deps.mjs graph.json
 *
 * With baseline (fails only on NEW cycles):
 *   node scripts/check-circular-deps.mjs graph.json --baseline .github/known-cycles.json
 *
 * To update the baseline with current cycles:
 *   node scripts/check-circular-deps.mjs graph.json --update-baseline .github/known-cycles.json
 */

import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const graphPath = args.find(a => !a.startsWith('--'));

function getFlag(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

const baselinePath = getFlag('--baseline');
const updateBaselinePath = getFlag('--update-baseline');

if (!graphPath) {
  console.error('Usage: node scripts/check-circular-deps.mjs <graph.json> [--baseline <known-cycles.json>] [--update-baseline <path>]');
  process.exit(1);
}

// Parse the Nx project graph
const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
const deps = graph.graph?.dependencies || {};

// Build adjacency list
const adj = {};
for (const [source, edges] of Object.entries(deps)) {
  adj[source] = edges.map(e => e.target);
}

// Detect all cycles using DFS with coloring
const GRAY = 1;
const BLACK = 2;
const color = {};
const rawCycles = [];

function dfs(node, path) {
  color[node] = GRAY;
  path.push(node);

  for (const neighbor of adj[node] || []) {
    if (color[neighbor] === GRAY) {
      const cycleStart = path.indexOf(neighbor);
      rawCycles.push(path.slice(cycleStart));
    } else if (color[neighbor] !== BLACK) {
      dfs(neighbor, path);
    }
  }

  path.pop();
  color[node] = BLACK;
}

for (const node of Object.keys(deps)) {
  if (!color[node]) dfs(node, []);
}

// Normalize cycles for stable comparison:
// rotate so the lexicographically smallest node is first
function normalizeCycle(cycle) {
  if (cycle.length === 0) return cycle;
  let minIdx = 0;
  for (let i = 1; i < cycle.length; i++) {
    if (cycle[i] < cycle[minIdx]) minIdx = i;
  }
  return [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
}

const cycles = rawCycles
  .map(normalizeCycle)
  .map(c => c.join(' -> '))
  .filter((v, i, a) => a.indexOf(v) === i) // deduplicate
  .sort();

// Update baseline mode
if (updateBaselinePath) {
  writeFileSync(updateBaselinePath, JSON.stringify({ cycles }, null, 2) + '\n');
  console.log(`Wrote ${cycles.length} cycles to ${updateBaselinePath}`);
  process.exit(0);
}

// Load baseline if provided
let knownCycles = new Set();
if (baselinePath) {
  try {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    knownCycles = new Set(baseline.cycles || []);
  } catch {
    console.error(`Warning: could not read baseline at ${baselinePath}, treating all cycles as new`);
  }
}

// Categorize cycles
const newCycles = cycles.filter(c => !knownCycles.has(c));
const resolvedCycles = [...knownCycles].filter(c => !cycles.includes(c));

// Report
console.log(`Total cycles found: ${cycles.length}`);

if (resolvedCycles.length > 0) {
  console.log(`\nResolved cycles (${resolvedCycles.length}) -- remove from baseline:`);
  resolvedCycles.forEach(c => console.log(`  - ${c}`));
}

if (baselinePath) {
  console.log(`Known (baselined) cycles: ${cycles.length - newCycles.length}`);
}

if (newCycles.length > 0) {
  console.log(`\n::error::NEW circular dependencies detected (${newCycles.length}):\n`);
  newCycles.forEach(c => console.log(`  - ${c}`));
  console.log('\nTo fix: remove the import causing the cycle.');
  console.log('To baseline (temporary): run `node scripts/check-circular-deps.mjs graph.json --update-baseline .github/known-cycles.json`');
  process.exit(1);
} else if (cycles.length > 0 && !baselinePath) {
  console.log('\nCircular dependencies found:');
  cycles.forEach(c => console.log(`  - ${c}`));
  process.exit(1);
} else {
  console.log('\nNo new circular dependencies.');
  process.exit(0);
}
