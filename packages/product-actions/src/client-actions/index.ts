/**
 * Client Actions Module
 *
 * This module provides client-related server actions.
 * During the migration period, legacy client actions are re-exported from client-actions
 * until they can be fully migrated to use client terminology.
 */

// Re-export all client actions as legacy aliases
// These will be gradually migrated to client-specific implementations
export * from './clientActions';
export * from './clientLocationActions';
export * from './clientLocaleActions';
export * from './clientTaxRateActions';
export * from './clientContractLineActions';
export * from './clientContractActions';
export * from './countryActions';

// TODO: Create client-specific action files with dual-write logic:
// - clientActions.ts (replaces clientActions.ts)
// - clientLocationActions.ts (replaces clientLocationActions.ts)
// - clientLocaleActions.ts (replaces clientLocaleActions.ts)
// - clientTaxRateActions.ts (replaces clientTaxRateActions.ts)
// - clientContractLineActions.ts (replaces clientContractLineActions.ts)
// - clientContractActions.ts (replaces clientContractActions.ts)
