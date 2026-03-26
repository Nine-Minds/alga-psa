import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_CONFIG_BASE = path.join('nm-kube-config', 'alga-psa', 'talos');

function exists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function walkUpForRepo(startDir) {
  let cursor = path.resolve(startDir);
  while (true) {
    const candidate = path.join(cursor, 'ee', 'appliance', 'scripts', 'bootstrap-appliance.sh');
    if (exists(candidate)) {
      return cursor;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      return null;
    }
    cursor = parent;
  }
}

export function resolveRuntimePaths(options = {}) {
  const assetRoot =
    options.assetRoot ||
    process.env.ALGA_APPLIANCE_ASSET_ROOT ||
    null;

  if (assetRoot) {
    return {
      runtimeMode: 'asset-root',
      assetRoot: path.resolve(assetRoot),
      scriptsDir: path.resolve(assetRoot, 'scripts'),
      releasesDir: path.resolve(assetRoot, 'releases'),
      fluxDir: path.resolve(assetRoot, 'flux'),
      supportBundleScript: path.resolve(assetRoot, 'scripts', 'collect-support-bundle.sh'),
      bootstrapScript: path.resolve(assetRoot, 'scripts', 'bootstrap-appliance.sh'),
      upgradeScript: path.resolve(assetRoot, 'scripts', 'upgrade-appliance.sh'),
      repairScript: path.resolve(assetRoot, 'scripts', 'repair-release.sh'),
      resetScript: path.resolve(assetRoot, 'scripts', 'reset-appliance-data.sh'),
    };
  }

  const base =
    walkUpForRepo(options.cwd || process.cwd()) ||
    walkUpForRepo(path.dirname(fileURLToPath(import.meta.url)));

  if (!base) {
    throw new Error('Unable to resolve appliance runtime paths. Set ALGA_APPLIANCE_ASSET_ROOT.');
  }

  return {
    runtimeMode: 'repo',
    repoRoot: base,
    assetRoot: path.join(base, 'ee', 'appliance'),
    scriptsDir: path.join(base, 'ee', 'appliance', 'scripts'),
    releasesDir: path.join(base, 'ee', 'appliance', 'releases'),
    fluxDir: path.join(base, 'ee', 'appliance', 'flux'),
    supportBundleScript: path.join(base, 'ee', 'appliance', 'scripts', 'collect-support-bundle.sh'),
    bootstrapScript: path.join(base, 'ee', 'appliance', 'scripts', 'bootstrap-appliance.sh'),
    upgradeScript: path.join(base, 'ee', 'appliance', 'scripts', 'upgrade-appliance.sh'),
    repairScript: path.join(base, 'ee', 'appliance', 'scripts', 'repair-release.sh'),
    resetScript: path.join(base, 'ee', 'appliance', 'scripts', 'reset-appliance-data.sh'),
  };
}

export function resolveConfigBase(homeDir) {
  return path.join(homeDir, DEFAULT_CONFIG_BASE);
}

export function listSiteIds(configBaseDir) {
  if (!isDirectory(configBaseDir)) {
    return [];
  }
  return fs
    .readdirSync(configBaseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function resolveSitePaths(configBaseDir, siteId) {
  const dir = path.join(configBaseDir, siteId);
  return {
    siteId,
    configDir: dir,
    kubeconfig: path.join(dir, 'kubeconfig'),
    talosconfig: path.join(dir, 'talosconfig'),
    nodeIpFile: path.join(dir, 'node-ip'),
    appUrlFile: path.join(dir, 'app-url'),
  };
}

export function fileExists(filePath) {
  return exists(filePath);
}
