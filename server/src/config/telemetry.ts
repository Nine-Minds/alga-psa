/**
 * Simplified telemetry configuration
 * Checks ALGA_USAGE_STATS environment variable to determine if usage stats are enabled
 */

// Types for compatibility with existing components
export type AnonymizationLevel = 'none' | 'partial' | 'full';

export interface TenantTelemetrySettings {
  enabled: boolean;
  allowUserOverride: boolean;
  anonymizationLevel: AnonymizationLevel;
  complianceNotes?: string;
  lastUpdated: string;
  updatedBy?: string;
}

/**
 * Check if usage stats are enabled via environment variable
 * @returns {boolean} True if usage stats are enabled, false otherwise
 */
export function isUsageStatsEnabled(): boolean {
  const usageStats = process.env.ALGA_USAGE_STATS;
  
  // Default to false if not set, require explicit opt-in
  if (!usageStats) return false;
  
  // Accept various truthy values
  return ['true', '1', 'yes', 'on'].includes(usageStats.toLowerCase());
}

// Export for backward compatibility if needed
export const USAGE_STATS_ENABLED = isUsageStatsEnabled();