/**
 * ITIL Priority levels
 */
export enum ItilPriority {
  CRITICAL = 1,    // Resolve immediately
  HIGH = 2,        // Resolve within 4 hours
  MEDIUM = 3,      // Resolve within 24 hours
  LOW = 4,         // Resolve within 72 hours
  PLANNING = 5     // Resolve when resources permit
}

/**
 * Get SLA target times based on priority level
 * @param priority ITIL priority level (1-5)
 * @returns Target resolution time in hours
 */
export function getSlaTarget(priority: number): number {
  const slaTargets: Record<number, number> = {
    [ItilPriority.CRITICAL]: 1,    // 1 hour
    [ItilPriority.HIGH]: 4,        // 4 hours
    [ItilPriority.MEDIUM]: 24,     // 24 hours (1 day)
    [ItilPriority.LOW]: 72,        // 72 hours (3 days)
    [ItilPriority.PLANNING]: 168   // 168 hours (1 week)
  };

  return slaTargets[priority] || 24; // Default to 24 hours if unknown priority
}
