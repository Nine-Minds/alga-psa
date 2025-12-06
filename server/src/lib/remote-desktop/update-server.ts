/**
 * Remote Desktop Agent Update Server
 *
 * Provides API endpoints for agent update manifest and download management.
 * Handles platform-specific versioning and staged rollouts.
 */

import crypto from 'crypto';

/**
 * Platform identifiers for agent updates
 */
export type AgentPlatform = 'win32' | 'darwin';

/**
 * Update manifest for an agent version
 */
export interface UpdateManifest {
  /** Current latest version */
  version: string;
  /** Platform this manifest is for */
  platform: AgentPlatform;
  /** Download URL for the installer/binary */
  downloadUrl: string;
  /** SHA256 hash of the installer for integrity verification */
  sha256: string;
  /** Code signing signature for verification */
  signature?: string;
  /** Release notes/changelog */
  changelog: string;
  /** Minimum required version to update from (for breaking changes) */
  minVersion?: string;
  /** Release date */
  releaseDate: string;
  /** Whether this is a mandatory update */
  mandatory: boolean;
  /** File size in bytes */
  fileSize: number;
}

/**
 * Agent update check request
 */
export interface UpdateCheckRequest {
  /** Current agent version */
  currentVersion: string;
  /** Agent platform */
  platform: AgentPlatform;
  /** Agent ID for cohort assignment */
  agentId: string;
  /** Tenant ID */
  tenantId: string;
}

/**
 * Agent update check response
 */
export interface UpdateCheckResponse {
  /** Whether an update is available */
  updateAvailable: boolean;
  /** Update manifest if available */
  manifest?: UpdateManifest;
  /** Next check interval in seconds */
  checkIntervalSeconds: number;
}

/**
 * Configuration for the update server
 */
export interface UpdateServerConfig {
  /** Base URL for update downloads */
  downloadBaseUrl: string;
  /** Current versions per platform */
  currentVersions: Record<AgentPlatform, string>;
  /** Rollout percentage (0-100) */
  rolloutPercentage: number;
  /** Default check interval in seconds */
  defaultCheckInterval: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: UpdateServerConfig = {
  downloadBaseUrl: process.env.AGENT_UPDATE_BASE_URL || '/downloads/agent',
  currentVersions: {
    win32: process.env.AGENT_VERSION_WINDOWS || '1.0.0',
    darwin: process.env.AGENT_VERSION_MACOS || '1.0.0',
  },
  rolloutPercentage: parseInt(process.env.UPDATE_ROLLOUT_PERCENTAGE || '100', 10),
  defaultCheckInterval: 14400, // 4 hours
};

/**
 * Compare semantic versions
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const partA = partsA[i] || 0;
    const partB = partsB[i] || 0;

    if (partA < partB) return -1;
    if (partA > partB) return 1;
  }

  return 0;
}

/**
 * Check if a version is valid semantic version format
 */
export function isValidVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(version);
}

/**
 * Determine if an agent should receive an update based on rollout percentage
 * Uses a deterministic hash to ensure consistent assignment
 */
export function isInRolloutCohort(
  agentId: string,
  rolloutPercentage: number
): boolean {
  if (rolloutPercentage >= 100) return true;
  if (rolloutPercentage <= 0) return false;

  // Create a deterministic hash of the agent ID
  const hash = crypto.createHash('md5').update(agentId).digest('hex');
  // Use first 8 hex chars as a number (0 to 4294967295)
  const hashNum = parseInt(hash.substring(0, 8), 16);
  // Normalize to 0-100 range
  const cohortValue = (hashNum / 0xffffffff) * 100;

  return cohortValue < rolloutPercentage;
}

/**
 * Get update manifest for a platform
 */
export async function getUpdateManifest(
  platform: AgentPlatform,
  config: UpdateServerConfig = DEFAULT_CONFIG
): Promise<UpdateManifest | null> {
  const version = config.currentVersions[platform];
  if (!version) return null;

  // In production, these would come from database or file storage
  const manifest: UpdateManifest = {
    version,
    platform,
    downloadUrl: `${config.downloadBaseUrl}/${platform}/alga-desktop-agent-${version}${platform === 'win32' ? '.exe' : '.dmg'}`,
    sha256: '', // Would be populated from release artifacts
    changelog: `Version ${version} release`,
    releaseDate: new Date().toISOString(),
    mandatory: false,
    fileSize: 0, // Would be populated from release artifacts
  };

  return manifest;
}

/**
 * Check if an update is available for an agent
 */
export async function checkForUpdate(
  request: UpdateCheckRequest,
  config: UpdateServerConfig = DEFAULT_CONFIG
): Promise<UpdateCheckResponse> {
  const { currentVersion, platform, agentId } = request;

  // Validate inputs
  if (!isValidVersion(currentVersion)) {
    return {
      updateAvailable: false,
      checkIntervalSeconds: config.defaultCheckInterval,
    };
  }

  // Get latest version for platform
  const latestVersion = config.currentVersions[platform];
  if (!latestVersion) {
    return {
      updateAvailable: false,
      checkIntervalSeconds: config.defaultCheckInterval,
    };
  }

  // Check if update is available
  const needsUpdate = compareVersions(currentVersion, latestVersion) < 0;

  if (!needsUpdate) {
    return {
      updateAvailable: false,
      checkIntervalSeconds: config.defaultCheckInterval,
    };
  }

  // Check if agent is in rollout cohort
  const inCohort = isInRolloutCohort(agentId, config.rolloutPercentage);

  if (!inCohort) {
    // Not in rollout yet, check again later
    return {
      updateAvailable: false,
      checkIntervalSeconds: config.defaultCheckInterval * 2, // Check less frequently
    };
  }

  // Get manifest
  const manifest = await getUpdateManifest(platform, config);

  return {
    updateAvailable: true,
    manifest: manifest || undefined,
    checkIntervalSeconds: config.defaultCheckInterval,
  };
}

/**
 * Update manifest storage interface for database-backed manifests
 */
export interface UpdateManifestStore {
  /** Get the latest manifest for a platform */
  getLatestManifest(platform: AgentPlatform): Promise<UpdateManifest | null>;

  /** Save a new manifest */
  saveManifest(manifest: UpdateManifest): Promise<void>;

  /** Get manifest by version */
  getManifestByVersion(platform: AgentPlatform, version: string): Promise<UpdateManifest | null>;

  /** List all manifests for a platform */
  listManifests(platform: AgentPlatform, limit?: number): Promise<UpdateManifest[]>;
}

/**
 * In-memory manifest store for development/testing
 */
export class InMemoryManifestStore implements UpdateManifestStore {
  private manifests: Map<string, UpdateManifest[]> = new Map();

  async getLatestManifest(platform: AgentPlatform): Promise<UpdateManifest | null> {
    const platformManifests = this.manifests.get(platform) || [];
    if (platformManifests.length === 0) return null;

    // Sort by version descending and return first
    return platformManifests.sort((a, b) => compareVersions(b.version, a.version))[0];
  }

  async saveManifest(manifest: UpdateManifest): Promise<void> {
    const platformManifests = this.manifests.get(manifest.platform) || [];

    // Remove existing manifest with same version
    const filtered = platformManifests.filter(m => m.version !== manifest.version);
    filtered.push(manifest);

    this.manifests.set(manifest.platform, filtered);
  }

  async getManifestByVersion(
    platform: AgentPlatform,
    version: string
  ): Promise<UpdateManifest | null> {
    const platformManifests = this.manifests.get(platform) || [];
    return platformManifests.find(m => m.version === version) || null;
  }

  async listManifests(platform: AgentPlatform, limit = 10): Promise<UpdateManifest[]> {
    const platformManifests = this.manifests.get(platform) || [];
    return platformManifests
      .sort((a, b) => compareVersions(b.version, a.version))
      .slice(0, limit);
  }
}
