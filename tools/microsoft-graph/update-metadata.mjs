#!/usr/bin/env node
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsdl, runValidation } from './validate-endpoints.mjs';

const toolDir = dirname(fileURLToPath(import.meta.url));
const configPath = join(toolDir, 'endpoints.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const slug = new URL(config.metadata.repository).pathname.replace(/^\/|\.git$/g, '');
const ref = process.argv.find((argument) => argument.startsWith('--ref='))?.slice('--ref='.length)
  || config.metadata.branch
  || 'HEAD';

async function fetchUpstream(url, as) {
  const headers = { 'user-agent': 'alga-psa-microsoft-graph-guard' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  return as === 'json' ? response.json() : Buffer.from(await response.arrayBuffer());
}

const commit = await fetchUpstream(`https://api.github.com/repos/${slug}/commits/${ref}`, 'json');
const pinnedAt = commit.commit?.committer?.date ?? commit.commit?.author?.date;
if (!commit.sha || !pinnedAt) throw new Error(`could not resolve ${slug}@${ref} to a commit with a date`);

for (const version of ['v1.0', 'beta']) {
  const source = config.metadata.sources[version];
  const xml = await fetchUpstream(`https://raw.githubusercontent.com/${slug}/${commit.sha}/${source}`);
  const model = parseCsdl(xml.toString('utf8'));
  if (model.roots.size < 50) throw new Error(`${source} parsed to only ${model.roots.size} entity sets; refusing to pin a truncated download`);
  const compressed = gzipSync(xml, { level: 9 });
  writeFileSync(join(toolDir, config.metadata[version]), compressed);
  config.metadata.sha256[version] = createHash('sha256').update(compressed).digest('hex');
  console.log(`pinned ${version}: ${model.roots.size} entity sets, ${config.metadata.sha256[version]}`);
}

config.metadata.commit = commit.sha;
config.metadata.pinnedAt = pinnedAt;
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`pinned ${slug}@${commit.sha} (${pinnedAt})`);

const result = runValidation({ config, now: Date.now() });
console.log(`Microsoft Graph endpoint guard passed after repin (${result.sourceCalls} source call sites, `
  + `${result.emulatorRoutes} emulator routes, ${result.validatedPaths} distinct paths, ${result.suppressions} suppressions).`);
