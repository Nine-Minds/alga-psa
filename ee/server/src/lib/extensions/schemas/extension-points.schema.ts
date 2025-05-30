/**
 * Schema for extension points validation
 */
import { z } from 'zod';

// Define valid extension points (slots) in the application
export const validExtensionPoints = [
  // Tab extension points
  'page-tabs',
  'billing-tabs',
  'tickets-tabs',
  'projects-tabs',
  'settings-tabs',
  'documents-tabs',
  'companies-tabs',
  'contacts-tabs',
  'assets-tabs',
  'dashboard-tabs',
  
  // Navigation extension points
  'main-navigation',
  'settings-navigation',
  
  // Dashboard widget extension points
  'dashboard-widgets',
  'account-dashboard-widgets',
  'billing-dashboard-widgets',
  'tickets-dashboard-widgets',
  
  // Custom page extension points
  'custom-pages',
] as const;

// Schema for validating extension points
export const extensionPointSchema = z.enum(validExtensionPoints);

// Schema for validating an array of extension points
export const extensionPointsSchema = z.array(extensionPointSchema);

// Schema for component mapping to extension points
export const componentExtensionPointsSchema = z.record(
  z.string(),
  extensionPointSchema
);

// Map of extension point to required permissions
export const extensionPointPermissions = {
  // Tab extension points
  'page-tabs': ['ui:view'],
  'billing-tabs': ['ui:view', 'billing:read'],
  'tickets-tabs': ['ui:view', 'ticket:read'],
  'projects-tabs': ['ui:view', 'project:read'],
  'settings-tabs': ['ui:view'],
  'documents-tabs': ['ui:view', 'document:read'],
  'companies-tabs': ['ui:view', 'company:read'],
  'contacts-tabs': ['ui:view', 'contact:read'],
  'assets-tabs': ['ui:view'],
  'dashboard-tabs': ['ui:view'],
  
  // Navigation extension points
  'main-navigation': ['ui:view'],
  'settings-navigation': ['ui:view'],
  
  // Dashboard widget extension points
  'dashboard-widgets': ['ui:view'],
  'account-dashboard-widgets': ['ui:view'],
  'billing-dashboard-widgets': ['ui:view', 'billing:read'],
  'tickets-dashboard-widgets': ['ui:view', 'ticket:read'],
  
  // Custom page extension points
  'custom-pages': ['ui:view'],
} as const;

// Helper to get required permissions for an extension point
export function getRequiredPermissions(
  extensionPoint: ExtensionPoint
): string[] {
  return extensionPointPermissions[extensionPoint];
}

// Helper to check if an extension point is valid
export function isValidExtensionPoint(
  extensionPoint: string
): extensionPoint is ExtensionPoint {
  return extensionPointSchema.safeParse(extensionPoint).success;
}

// Types for TypeScript
export type ExtensionPoint = typeof validExtensionPoints[number];