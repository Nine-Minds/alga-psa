import fs from 'node:fs';
import path from 'node:path';

function versionCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
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

export function listChannels(releasesDir) {
  const channelsDir = path.join(releasesDir, 'channels');
  if (!fs.existsSync(channelsDir)) {
    return [];
  }
  return fs
    .readdirSync(channelsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.replace(/\.json$/, ''))
    .sort();
}

export function readChannel(releasesDir, channelName) {
  if (!channelName) {
    return null;
  }
  const filePath = path.join(releasesDir, 'channels', `${channelName}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Release channel not found: ${filePath}`);
  }
  const channel = readJsonFile(filePath);
  if (channel.channel && channel.channel !== channelName) {
    throw new Error(`Release channel file ${filePath} declares channel ${channel.channel}, expected ${channelName}`);
  }
  if (!channel.releaseVersion) {
    throw new Error(`Release channel ${channelName} does not point to a releaseVersion`);
  }
  return { ...channel, channel: channelName };
}

export function latestReleaseVersion(releasesDir) {
  const versions = listPublishedReleases(releasesDir);
  return versions.length > 0 ? versions[versions.length - 1] : null;
}

export function defaultChannelName(releasesDir) {
  const channels = listChannels(releasesDir);
  if (channels.includes('stable')) {
    return 'stable';
  }
  return channels[0] || null;
}

export function defaultReleaseVersion(releasesDir) {
  const channelName = defaultChannelName(releasesDir);
  if (channelName) {
    try {
      return readChannel(releasesDir, channelName).releaseVersion;
    } catch {
      // Fall through to latest immutable release if the default channel is incomplete.
    }
  }
  return latestReleaseVersion(releasesDir);
}

export function resolveReleaseReference(releasesDir, { releaseVersion, channel } = {}) {
  if (releaseVersion) {
    return { releaseVersion, channel: channel || null, channelMetadata: channel ? readChannel(releasesDir, channel) : null };
  }

  const channelName = channel || defaultChannelName(releasesDir);
  if (channelName) {
    const channelMetadata = readChannel(releasesDir, channelName);
    return { releaseVersion: channelMetadata.releaseVersion, channel: channelName, channelMetadata };
  }

  const fallbackReleaseVersion = latestReleaseVersion(releasesDir);
  if (!fallbackReleaseVersion) {
    throw new Error('No appliance release version available. Publish a release or pass --release-version.');
  }
  return { releaseVersion: fallbackReleaseVersion, channel: null, channelMetadata: null };
}

export function readReleaseManifest(releasesDir, releaseVersion) {
  const filePath = path.join(releasesDir, releaseVersion, 'release.json');
  return readJsonFile(filePath);
}
