/**
 * Simplified telemetry configuration
 * Checks ALGA_USAGE_STATS environment variable to determine if usage stats are enabled
 */

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