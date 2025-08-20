function slugifyLocal(input: string): string {
  return (input || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function computeDomain(tenantId: string, extensionId: string, root?: string): string {
  const rootDomain = (root || process.env.EXT_DOMAIN_ROOT || '').trim();
  if (!rootDomain) throw new Error('EXT_DOMAIN_ROOT not configured');
  const t = slugifyLocal(tenantId);
  const e = slugifyLocal(extensionId);
  return `${t}--${e}.${rootDomain}`;
}

export async function enqueueProvisioningWorkflow(params: { tenantId: string; extensionId: string; installId?: string }) {
  // TODO: wire Temporal client and kick off provisionExtensionDomain workflow
  // Placeholder no-op for now
  return { enqueued: true };
}
