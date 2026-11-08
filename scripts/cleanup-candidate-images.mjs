#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { browserArtifactServices } from './lib/browser-artifact-manifest.mjs';

// The browser lane pushes one candidate image per service and run to
// ghcr.io/<repository>/e2e-<service> (see e2e-fresh-install-tests.yaml). The
// registry keeps them until something deletes them, so this removes versions
// older than the retention window; consumers pull by digest within their own
// run and never need an old version.
//
// The same lane keeps its build-cache snapshots in ghcr.io/<repository>/build-cache
// under one moving tag per edition. Every push leaves the previous snapshot
// behind as an untagged version, so those are removed on the same schedule
// while the tagged, current snapshots stay.
export const candidateImageServices = () =>
  [...new Set([...browserArtifactServices('community'), ...browserArtifactServices('enterprise')])].sort();
export const BUILD_CACHE_PACKAGE = 'build-cache';
export const cleanupPackages = () => [
  ...candidateImageServices().map(service => ({ suffix: `e2e-${service}`, taggedToo: true })),
  { suffix: BUILD_CACHE_PACKAGE, taggedToo: false },
];

export async function cleanupCandidateImages({ repository, token, maxAgeHours, dryRun = false, now = Date.now(),
  request = globalThis.fetch, api = 'https://api.github.com', log = () => {} }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') || typeof token !== 'string' || !token
    || !Number.isFinite(maxAgeHours) || maxAgeHours < 1) throw new Error('Repository, token and a retention of at least one hour are required');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const call = (method, url) => request(url, { method, headers });
  const repo = await call('GET', `${api}/repos/${repository}`);
  if (!repo.ok) throw new Error(`Repository lookup failed: ${repo.status}`);
  const { owner, name } = await repo.json();
  const base = `${api}/${owner.type === 'Organization' ? 'orgs' : 'users'}/${owner.login}/packages/container`;
  const cutoff = now - maxAgeHours * 3600 * 1000;
  const summary = { dryRun, cutoff: new Date(cutoff).toISOString(), packages: [], deleted: 0, kept: 0, failed: 0, missing: 0 };
  for (const { suffix, taggedToo } of cleanupPackages()) {
    const packageName = `${name.toLowerCase()}/${suffix}`;
    const packagePath = `${base}/${encodeURIComponent(packageName)}`;
    const versions = [];
    for (let page = 1; ; page += 1) {
      const response = await call('GET', `${packagePath}/versions?per_page=100&page=${page}`);
      if (response.status === 404 && page === 1) { summary.missing += 1; break; }
      if (!response.ok) throw new Error(`Listing ${packageName} failed: ${response.status}`);
      const batch = await response.json();
      if (!Array.isArray(batch)) throw new Error(`Listing ${packageName} returned no versions array`);
      versions.push(...batch);
      if (batch.length < 100) break;
    }
    const entry = { package: packageName, versions: versions.length, deleted: 0, kept: 0, failed: 0 };
    for (const version of versions) {
      const created = Date.parse(version?.created_at ?? '');
      const tagged = Array.isArray(version?.metadata?.container?.tags) && version.metadata.container.tags.length > 0;
      if (!Number.isFinite(created) || created >= cutoff || (tagged && !taggedToo)) { entry.kept += 1; continue; }
      if (dryRun) { entry.deleted += 1; log(`would delete ${packageName} version ${version.id} from ${version.created_at}`); continue; }
      const response = await call('DELETE', `${packagePath}/versions/${version.id}`);
      if (response.status === 204) { entry.deleted += 1; log(`deleted ${packageName} version ${version.id} from ${version.created_at}`); }
      else { entry.failed += 1; log(`failed to delete ${packageName} version ${version.id}: ${response.status}`); }
    }
    for (const key of ['deleted', 'kept', 'failed']) summary[key] += entry[key];
    summary.packages.push(entry);
  }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const summary = await cleanupCandidateImages({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN,
      maxAgeHours: Number(process.env.CANDIDATE_IMAGE_MAX_AGE_HOURS || 72), dryRun: process.env.CANDIDATE_IMAGE_DRY_RUN === 'true',
      log: line => console.log(line) });
    console.log(JSON.stringify(summary, null, 2));
    if (summary.failed > 0) process.exitCode = 1;
  } catch (error) {
    // Never echo the token-bearing request details; the message names the step that failed.
    console.error(error instanceof Error ? error.message : 'Candidate image cleanup failed');
    process.exitCode = 1;
  }
}
