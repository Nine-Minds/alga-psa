#!/usr/bin/env node
import fs from 'node:fs';

const rootComposeFiles = [
  'docker-compose.ce.yaml',
  'docker-compose.ee.yaml',
  'docker-compose.prebuilt.ce.yaml',
  'docker-compose.prebuilt.ee.yaml',
  'docker-compose.imap.ce.yaml',
];

const failures = [];

function hocuspocusBlock(file) {
  const text = fs.readFileSync(file, 'utf8');
  const marker = /^  hocuspocus:\n/m;
  const match = marker.exec(text);
  if (!match) return '';
  const rest = text.slice(match.index);
  const nextService = rest.slice(1).search(/^  [A-Za-z0-9_-]+:\n/m);
  return nextService === -1 ? rest : rest.slice(0, nextService + 1);
}

for (const file of rootComposeFiles) {
  if (!fs.existsSync(file)) continue;
  const block = hocuspocusBlock(file);
  if (!block || !block.includes('build:')) continue;

  if (!/context:\s*\.\s*(?:\n|$)/.test(block)) {
    failures.push(`${file}: hocuspocus build context must be repo root (context: .)`);
  }
  if (!/dockerfile:\s*hocuspocus\/Dockerfile\s*(?:\n|$)/.test(block)) {
    failures.push(`${file}: hocuspocus build must use hocuspocus/Dockerfile`);
  }
}

const shared = fs.readFileSync('hocuspocus/docker-compose.yaml', 'utf8');
if (!/context:\s*\.\.\s*(?:\n|$)/.test(shared)) {
  failures.push('hocuspocus/docker-compose.yaml: shared build context must point to repo root (context: ..)');
}
if (!/dockerfile:\s*hocuspocus\/Dockerfile\s*(?:\n|$)/.test(shared)) {
  failures.push('hocuspocus/docker-compose.yaml: shared build must use hocuspocus/Dockerfile');
}

if (failures.length) {
  console.error('Hocuspocus compose build configuration is inconsistent:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Hocuspocus compose build configuration is consistent.');
