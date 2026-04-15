import fs from 'node:fs';
import path from 'node:path';

function versionCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function listPublishedReleases(releasesDir) {
  if (!fs.existsSync(releasesDir)) {
    return [];
  }
  return fs
    .readdirSync(releasesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'channels')
    .map((entry) => entry.name)
    .filter((version) => fs.existsSync(path.join(releasesDir, version, 'release.json')))
    .sort(versionCompare);
}

export function latestReleaseVersion(releasesDir) {
  const versions = listPublishedReleases(releasesDir);
  return versions.length > 0 ? versions[versions.length - 1] : null;
}

export function readReleaseManifest(releasesDir, releaseVersion) {
  const filePath = path.join(releasesDir, releaseVersion, 'release.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}
