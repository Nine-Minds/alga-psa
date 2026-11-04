#!/usr/bin/env node
// Attribution for the CM safety gates (CM L0g, alga-2026-0002848).
//
//   node scripts/ci/attribute-card.mjs <path>...
//   node scripts/ci/attribute-card.mjs --stdin        (one path per line, or `path:line: message` lines)
//
// Reads the section-1 path tables of docs/cards/co-managed/*.md and prints
// `<path>: owned by card <Lx>` for each path, or `owned by no card - check the manifest`.
// Always exits 0: attribution decorates a failure, it never decides one.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHARTERS = 'docs/cards/co-managed';

/** `**` crosses directories, `*` does not, everything else is literal. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** [{ card, globs }] from every charter's `## 1.` section: backticked first-column cells. */
export function readCharters(dir = path.join(root, CHARTERS)) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const card = /^([A-Za-z0-9]+)-/.exec(f)?.[1] ?? f;
    const section = /^## 1\.[^\n]*\n([\s\S]*?)(?=^## )/m.exec(text)?.[1] ?? '';
    const globs = [...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]);
    return { card, file: `${CHARTERS}/${f}`, globs: globs.map((g) => ({ glob: g, re: globToRegExp(g) })) };
  });
}

export function owners(file, charters) {
  return charters.filter((c) => c.globs.some((g) => g.re.test(file))).map((c) => c.card);
}

export function attribute(paths, charters = readCharters()) {
  return paths.map((p) => {
    const o = owners(p, charters);
    return `${p}: ${o.length ? `owned by card ${o.join(', ')}` : 'owned by no card - check the manifest'}`;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let paths = process.argv.slice(2);
  if (paths[0] === '--stdin') {
    paths = fs.readFileSync(0, 'utf8').split('\n').map((l) => /^([^\s:]+)/.exec(l)?.[1]).filter(Boolean);
  }
  const unique = [...new Set(paths)];
  const lines = attribute(unique);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY && lines.length) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Card attribution\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
  }
}
