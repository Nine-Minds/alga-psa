/**
 * Zod schema for validating extension manifests
 */
import { z } from 'zod';
import { ExtensionComponentType } from '../types';

// Tab extension props schema
const tabExtensionPropsSchema = z.object({
  id: z.string().min(1),
  parentPage: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  priority: z.number().int().optional(),
  permissions: z.array(z.string()).optional(),
});

// Navigation item props schema
const navigationItemPropsSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  path: z.string().min(1),
  priority: z.number().int().optional(),
  permissions: z.array(z.string()).optional(),
});

// Dashboard widget props schema
const dashboardWidgetPropsSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  size: z.enum(['small', 'medium', 'large']),
  refreshInterval: z.number().int().optional(),
  permissions: z.array(z.string()).optional(),
});

// Custom page props schema
const customPagePropsSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().optional(),
  permissions: z.array(z.string()).optional(),
});

// Component definition schema with discriminated union based on type
const extensionComponentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(ExtensionComponentType.TAB),
    slot: z.string().min(1),
    component: z.string().min(1),
    props: tabExtensionPropsSchema,
  }),
  z.object({
    type: z.literal(ExtensionComponentType.NAVIGATION),
    slot: z.string().min(1),
    component: z.string().optional(),
    props: navigationItemPropsSchema,
  }),
  z.object({
    type: z.literal(ExtensionComponentType.DASHBOARD_WIDGET),
    slot: z.string().min(1),
    component: z.string().min(1),
    props: dashboardWidgetPropsSchema,
  }),
  z.object({
    type: z.literal(ExtensionComponentType.CUSTOM_PAGE),
    slot: z.string().min(1),
    component: z.string().min(1),
    props: customPagePropsSchema,
  }),
]);

// Extension setting definition schema
const extensionSettingSchema = z.object({
  key: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'select', 'multiselect']),
  label: z.string().min(1),
  description: z.string().optional(),
  default: z.any().optional(),
  options: z.array(
    z.object({
      label: z.string().min(1),
      value: z.union([z.string(), z.number(), z.boolean()]),
    })
  ).optional(),
  required: z.boolean().optional(),
});

// Semantic version regex pattern
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

// Author schema - can be either a string or an object
const authorSchema = z.union([
  z.string(),
  z.object({
    name: z.string(),
    email: z.string().email().optional(),
  })
]);

// Main extension manifest schema
export const extensionManifestSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().regex(semverPattern, 'Version must be a valid semantic version (e.g., 1.0.0)'),
  author: authorSchema.optional(),
  homepage: z.string().url().optional(),
  repository: z.string().url().optional(),
  license: z.string().optional(),
  main: z.string().min(1),
  components: z.array(extensionComponentSchema).optional(),
  permissions: z.array(z.string()).optional(),
  requiredExtensions: z.array(z.string()).optional(),
  settings: z.array(extensionSettingSchema).optional(),
  assets: z.array(z.string()).optional(),
});

// Type derived from the schema
export type ExtensionManifestSchema = z.infer<typeof extensionManifestSchema>;