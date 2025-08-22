import { getAdminConnection } from '@alga-psa/shared/db/admin.js';
import type { Knex } from 'knex';
import { KubeConfig, CustomObjectsApi, PatchUtils } from '@kubernetes/client-node';

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
  const sTenant = slugify(input.tenantId);
  const sExt = slugify(input.extensionId);
  // Shorten segments to respect K8s name length constraints (<=63 chars for metadata.name)
  // Use UUID-friendly shortening: first 8 hex if UUID-like, else first 12 chars
  const short = (s: string) => (/^[0-9a-f]{8}-/.test(s) ? s.slice(0, 8) : s.slice(0, 12));
  const label = `${short(sTenant)}--${short(sExt)}`;
  const domain = `${label}.${root}`;
  return { domain };
}

export async function ensureDomainMapping(input: EnsureDomainMappingInput): Promise<{ applied: boolean; ref?: any }> {
  const namespace = input.namespace || process.env.RUNNER_NAMESPACE || 'default';
  const kservice = input.kservice || process.env.RUNNER_KSERVICE || 'runner';

  // Normalize overly long domain names to comply with K8s name limits (<=63)
  let domainName = (input.domain || '').trim();
  if (!domainName) throw new Error('domain is required');
  if (domainName.length > 63) {
    const firstDot = domainName.indexOf('.');
    if (firstDot > 0) {
      const label = domainName.slice(0, firstDot);
      const root = domainName.slice(firstDot + 1);
      if (label.includes('--')) {
        const [left, right] = label.split('--', 2);
        const short = (s: string) => (/^[0-9a-f]{8}-/.test(s) ? s.slice(0, 8) : s.slice(0, 12));
        const newLabel = `${short(left)}--${short(right)}`;
        const newDomain = `${newLabel}.${root}`;
        if (newDomain.length <= 63) {
          // Attempt DB update so EE server reflects new domain
          try {
            const knex: Knex = await getAdminConnection();
            await knex('tenant_extension_install')
              .where({ runner_domain: domainName })
              .update({ runner_domain: newDomain, updated_at: knex.fn.now() });
          } catch {
            // best-effort; continue even if DB update fails
          }
          domainName = newDomain;
        }
      }
    }
  }

  const kc = new KubeConfig();
  try {
    kc.loadFromDefault();
  } catch (e) {
    throw new Error('Failed to load Kubernetes config');
  }
  const co = kc.makeApiClient(CustomObjectsApi);

  const group = 'serving.knative.dev';
  const version = 'v1beta1';
  const plural = 'domainmappings';
  const name = domainName; // DomainMapping name is the FQDN

  const desired = {
    apiVersion: `${group}/${version}`,
    kind: 'DomainMapping',
    metadata: {
      name,
      namespace,
    },
    spec: {
      ref: {
        apiVersion: 'serving.knative.dev/v1',
        kind: 'Service',
        name: kservice,
      },
    },
  };

  // Check if exists
  let exists = false;
  try {
    await co.getNamespacedCustomObject(group, version, namespace, plural, name);
    exists = true;
  } catch (e: any) {
    const res = e?.response;
    const body = res?.body;
    const status = res?.status ?? body?.code;
    const reason = body?.reason;
    const message = typeof body === 'string' ? body : (body?.message ?? '');
    const isNotFound = status === 404 || reason === 'NotFound' || /not\s*found/i.test(message);
    if (isNotFound) {
      exists = false;
    } else {
      const msg = typeof body === 'string' ? body : JSON.stringify(body);
      throw new Error(`domainmapping.get failed: status=${status} body=${msg}`);
    }
  }

  if (!exists) {
    try {
      await co.createNamespacedCustomObject(group, version, namespace, plural, desired);
    } catch (e: any) {
      const status = e?.response?.status;
      const body = e?.response?.body;
      const msg = typeof body === 'string' ? body : JSON.stringify(body);
      throw new Error(`domainmapping.create failed: status=${status} body=${msg}`);
    }
    return { applied: true, ref: { namespace, name, kind: 'DomainMapping', group, version } };
  }

  // Patch spec if exists to ensure correct ref
  const body = { spec: desired.spec };
  const options = { headers: { 'Content-Type': PatchUtils.PATCH_FORMAT_JSON_MERGE_PATCH } } as const;
  try {
    await co.patchNamespacedCustomObject(group, version, namespace, plural, name, body, undefined, undefined, undefined, options);
  } catch (e: any) {
    const status = e?.response?.status;
    const resBody = e?.response?.body;
    const msg = typeof resBody === 'string' ? resBody : JSON.stringify(resBody);
    throw new Error(`domainmapping.patch failed: status=${status} body=${msg}`);
  }
  return { applied: true, ref: { namespace, name, kind: 'DomainMapping', group, version } };
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
