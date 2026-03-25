import fs from 'node:fs';
import os from 'node:os';
import { listPublishedReleases, latestReleaseVersion } from './releases.mjs';
import {
  fileExists,
  listSiteIds,
  resolveConfigBase,
  resolveSitePaths,
  resolveRuntimePaths,
} from './runtime-paths.mjs';

function readTextIfExists(filePath) {
  if (!fileExists(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, 'utf8').trim();
}

function resolveDefaultSite(siteIds) {
  if (siteIds.includes('appliance-single-node')) {
    return 'appliance-single-node';
  }
  return siteIds[0] || 'appliance-single-node';
}

export function discoverEnvironment(options = {}) {
  const runtime = resolveRuntimePaths(options);
  const homeDir = options.homeDir || os.homedir();
  const configBaseDir = options.configBaseDir || resolveConfigBase(homeDir);
  const siteIds = listSiteIds(configBaseDir);
  const selectedSiteId = options.siteId || resolveDefaultSite(siteIds);
  const site = resolveSitePaths(configBaseDir, selectedSiteId);
  const releases = listPublishedReleases(runtime.releasesDir);
  const defaultReleaseVersion = latestReleaseVersion(runtime.releasesDir);

  const discoveredNodeIp = options.nodeIp || readTextIfExists(site.nodeIpFile) || null;
  const discoveredAppUrl = options.appUrl || readTextIfExists(site.appUrlFile) || null;

  return {
    runtime,
    configBaseDir,
    siteIds,
    site,
    paths: {
      kubeconfig: options.kubeconfig || site.kubeconfig,
      talosconfig: options.talosconfig || site.talosconfig,
    },
    releases,
    defaultReleaseVersion,
    nodeIp: discoveredNodeIp,
    appUrl: discoveredAppUrl,
  };
}
