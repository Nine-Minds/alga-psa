// CE stub for EE-only actions used by installs API routes.
// In Community Edition, these endpoints should behave as unavailable.

export async function lookupByHost(_host: string): Promise<{
  tenant_id: string;
  extension_id: string;
  content_hash: string;
} | null> {
  return null;
}

export async function validate(_params: {
  tenant: string;
  extension: string;
  hash: string;
}): Promise<{ valid: boolean }> {
  return { valid: false };
}

