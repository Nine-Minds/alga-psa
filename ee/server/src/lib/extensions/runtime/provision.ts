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
  const norm = (s: string) => (/^[0-9a-f]{8}-/.test(s) ? s.replace(/-/g, '').slice(0, 8) : s.replace(/-/g, '').slice(0, 12));
  const label = `${norm(t)}-${norm(e)}`;
  return `${label}.${rootDomain}`;
}

export async function enqueueProvisioningWorkflow(params: { tenantId: string; extensionId: string; installId?: string }) {
  // Best-effort Temporal client kickoff; falls back to no-op if client not available
  try {
    const mod: any = await import('@temporalio/client').catch(() => null);
    if (!mod) return { enqueued: false };
    const address = process.env.TEMPORAL_ADDRESS || 'temporal-frontend.temporal.svc.cluster.local:7233';
    const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
    const taskQueue = process.env.TEMPORAL_TASK_QUEUE || 'tenant-workflows';
    const conn = await mod.Connection.connect({ address });
    const client = new mod.Client({ connection: conn, namespace });
    const workflowId = `provision-ext-domain:${params.tenantId}:${params.extensionId}`;
    await client.workflow.start('provisionExtensionDomain', {
      args: [params],
      taskQueue,
      workflowId,
    });
    return { enqueued: true };
  } catch (_e) {
    return { enqueued: false };
  }
}
