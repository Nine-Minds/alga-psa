import { getAdminConnection } from '@alga-psa/shared/db/admin.js';
import type { Knex } from 'knex';

export interface ComputeDomainInput {
  tenantId: string;
  extensionId: string; // registry_id
  rootDomain?: string; // fallback to process.env.EXT_DOMAIN_ROOT
}

export interface EnsureDomainMappingInput {
  domain: string;
  namespace?: string; // k8s namespace for Runner
  kservice?: string;  // Runner KService name
}

export interface UpdateInstallStatusInput {
  installId?: string;         // optional direct id
  runnerDomain?: string;      // or lookup by domain
  state: 'pending' | 'provisioning' | 'ready' | 'error';
  message?: string;
  runnerRef?: any;
}

function slugify(input: string): string {
  return (input || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function computeDomain(input: ComputeDomainInput): Promise<{ domain: string }> {
  const root = (input.rootDomain || process.env.EXT_DOMAIN_ROOT || '').trim();
  if (!root) throw new Error('EXT_DOMAIN_ROOT not configured');
  const t = slugify(input.tenantId);
  const e = slugify(input.extensionId);
  const domain = `${t}--${e}.${root}`;
  return { domain };
}

export async function ensureDomainMapping(input: EnsureDomainMappingInput): Promise<{ applied: boolean; ref?: any }> {
  // Stub: in a future step, call the Kubernetes API to upsert a DomainMapping
  // For now, return a placeholder reference
  const namespace = input.namespace || process.env.RUNNER_NAMESPACE || 'default';
  const kservice = input.kservice || process.env.RUNNER_KSERVICE || 'runner';
  return { applied: true, ref: { api: 'knative.dev/v1', kind: 'DomainMapping', namespace, name: input.domain, ref: { kservice } } };
}

export async function updateInstallStatus(input: UpdateInstallStatusInput): Promise<{ updated: boolean }> {
  const knex: Knex = await getAdminConnection();
  const now = knex.fn.now();

  if (!input.installId && !input.runnerDomain) {
    throw new Error('installId or runnerDomain required');
  }

  const patch: any = { runner_status: { state: input.state } };
  if (input.message) patch.runner_status.message = input.message;
  patch.runner_status.last_updated = new Date().toISOString();
  if (input.runnerRef) patch.runner_ref = input.runnerRef;

  let q = knex('tenant_extension_install').update({
    runner_status: JSON.stringify(patch.runner_status),
    runner_ref: input.runnerRef ? JSON.stringify(input.runnerRef) : null,
    updated_at: now,
  });

  if (input.installId) {
    q = q.where({ id: input.installId });
  } else if (input.runnerDomain) {
    q = q.where({ runner_domain: input.runnerDomain });
  }

  const count = await q;
  return { updated: (Array.isArray(count) ? count.length : Number(count)) > 0 };
}

