/**
 * @alga-psa/sla
 *
 * SLA (Service Level Agreement) management module for Alga PSA.
 * Provides SLA policy definitions, business hours schedules, and SLA pause configurations.
 */

// Re-export types
export * from './types';

// Re-export components
export * from './components';

// Re-export services
export * from './services';

// Note: This module contains:
// - SLA Policy management (create, update, delete, resolve)
// - SLA Policy Targets (response/resolution time per priority)
// - Business Hours Schedules
// - Holiday definitions
// - SLA Pause configurations (by status or awaiting client)
// - SLA Notification Thresholds
