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

function resolveSelectedSiteId(siteIds, options = {}) {
  if (options.siteId) {
    return {
      siteId: options.siteId,
      requiresSelection: false,
    };
  }

  if (siteIds.length <= 1) {
    return {
      siteId: resolveDefaultSite(siteIds),
      requiresSelection: false,
    };
  }

  if (options.allowAmbiguousSiteSelection) {
    return {
      siteId: null,
      requiresSelection: true,
    };
  }

  throw new Error(
    `Multiple appliance sites found: ${siteIds.join(', ')}. Re-run with --site-id.`,
  );
}

export function discoverEnvironment(options = {}) {
  const runtime = resolveRuntimePaths(options);
  const homeDir = options.homeDir || os.homedir();
  const configBaseDir = options.configBaseDir || resolveConfigBase(homeDir);
  const siteIds = listSiteIds(configBaseDir);
  const selectedSite = resolveSelectedSiteId(siteIds, options);
  const site = selectedSite.siteId ? resolveSitePaths(configBaseDir, selectedSite.siteId) : null;
  const releases = listPublishedReleases(runtime.releasesDir);
  const defaultReleaseVersion = latestReleaseVersion(runtime.releasesDir);

  const discoveredNodeIp =
    options.nodeIp || (site ? readTextIfExists(site.nodeIpFile) : null) || null;
  const discoveredAppUrl =
    options.appUrl || (site ? readTextIfExists(site.appUrlFile) : null) || null;

  return {
    runtime,
    configBaseDir,
    siteIds,
    siteSelectionRequired: selectedSite.requiresSelection,
    site,
    paths: {
      kubeconfig: options.kubeconfig || site?.kubeconfig || null,
      talosconfig: options.talosconfig || site?.talosconfig || null,
    },
    releases,
    defaultReleaseVersion,
    nodeIp: discoveredNodeIp,
    appUrl: discoveredAppUrl,
  };
}

export function selectDiscoveredSite(environment, siteId) {
  const site = resolveSitePaths(environment.configBaseDir, siteId);
  return {
    ...environment,
    siteSelectionRequired: false,
    site,
    paths: {
      ...environment.paths,
      kubeconfig: environment.paths.kubeconfig || site.kubeconfig,
      talosconfig: environment.paths.talosconfig || site.talosconfig,
    },
    nodeIp: environment.nodeIp || readTextIfExists(site.nodeIpFile) || null,
    appUrl: environment.appUrl || readTextIfExists(site.appUrlFile) || null,
  };
}
