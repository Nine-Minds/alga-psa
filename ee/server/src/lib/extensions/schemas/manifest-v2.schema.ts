import { z } from 'zod';

// Basic patterns
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

// reverse-domain string like: com.example.product
// - lowercase letters, digits, hyphens inside segments
// - at least 2 dot-separated segments
const reverseDomainPattern = /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)+$/;

// API HTTP methods allowed
const httpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

// UI schema
const uiHooksSchema = z
  .object({
    appMenu: z
      .object({
        label: z.string().min(1),
      })
      .optional(),
    clientPortalMenu: z
      .object({
        label: z.string().min(1),
      })
      .optional(),
  })
  .catchall(z.unknown());

const uiSchema = z.object({
  type: z.literal('iframe'),
  entry: z.string().min(1),
  hooks: uiHooksSchema.optional(),
});

// API endpoint schema
const apiEndpointSchema = z.object({
  method: httpMethodSchema,
  path: z.string().min(1),
  handler: z.string().min(1),
});

// API schema
const apiSchema = z.object({
  endpoints: z.array(apiEndpointSchema).nonempty(),
});

// Main Manifest v2 schema
export const manifestV2Schema = z.object({
  name: z
    .string()
    .min(1)
    .regex(reverseDomainPattern, 'name must be a reverse-domain identifier like "com.example.app"'),
  publisher: z.string().min(1),
  version: z
    .string()
    .regex(semverPattern, 'version must be a valid semantic version (e.g., 1.0.0)'),
  runtime: z.literal('wasm-js@1'),
  capabilities: z.array(z.string()).default([]),
  ui: uiSchema,
  api: apiSchema.optional(),
  precompiled: z.record(z.string()).optional(),
  assets: z.array(z.string()).optional(),
  sbom: z.string().optional(),
});

// Exported type
export type ManifestV2 = z.infer<typeof manifestV2Schema>;

// Validator
export function validateManifestV2(
  manifest: unknown
): { valid: boolean; errors?: string[]; data?: ManifestV2 } {
  const result = manifestV2Schema.safeParse(manifest);
  if (result.success) {
    return { valid: true, data: result.data };
  }

  const errors = result.error.errors.map((e) => {
    const path = e.path.join('.') || '(root)';
    return `${path}: ${e.message}`;
  });

  return { valid: false, errors };
}