import { getAdminConnection } from '@alga-psa/db/admin.js';
import { computeDomain as sharedComputeDomain } from '@alga-psa/shared/extensions/domain.js';
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
  const domain = sharedComputeDomain(input.tenantId, input.extensionId, input.rootDomain);
  return { domain };
}

export async function ensureDomainMapping(input: EnsureDomainMappingInput): Promise<{ applied: boolean; ref?: any }> {
  // Helper to format HttpError details consistently
  const formatHttpError = (e: any) => {
    const status = e?.response?.status ?? e?.status;
    const body = e?.response?.body ?? e?.body;
    const reason = body?.reason;
    const message = typeof body === 'string' ? body : (body?.message ?? '');
    const asJson = typeof body === 'string' ? body : JSON.stringify(body);
    return { status, reason, message, body: asJson };
  };

  try {
    const namespace = input.namespace || process.env.RUNNER_NAMESPACE || 'default';
    const kservice = input.kservice || process.env.RUNNER_KSERVICE || 'runner';
    const autoCreateCdc = (process.env.KNATIVE_AUTO_CREATE_CDC || '').toLowerCase() === 'true';

    // Normalize overly long domain names to comply with K8s name limits (<=63)
    let domainName = (input.domain || '').trim();
    if (!domainName) throw new Error('domain is required');
  if (domainName.length > 63) {
    const firstDot = domainName.indexOf('.');
    if (firstDot > 0) {
      const label = domainName.slice(0, firstDot);
      const root = domainName.slice(firstDot + 1);
      // Support both legacy "--" and new single '-' separator
      if (label.includes('--') || label.includes('-')) {
        const [left, right] = label.includes('--') ? label.split('--', 2) : label.split('-', 2);
        const short = (s: string) => (/^[0-9a-f]{8}/.test(s) ? s.replace(/-/g, '').slice(0, 8) : s.replace(/-/g, '').slice(0, 12));
        const newLabel = `${short(left)}-${short(right)}`;
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

    // Preflight: Ensure target KService exists (serving.knative.dev/v1 services)
    try {
      await co.getNamespacedCustomObject('serving.knative.dev', 'v1', namespace, 'services', kservice);
    } catch (e: any) {
      const { status, body } = formatHttpError(e);
      throw new Error(`runner kservice check failed: namespace=${namespace} name=${kservice}; status=${status} body=${body}`);
    }

    // Preflight: Ensure ClusterDomainClaim exists or auto-create if allowed
    const cdcGroup = 'networking.internal.knative.dev';
    const cdcVersion = 'v1alpha1';
    const cdcPlural = 'clusterdomainclaims';
    try {
      await co.getClusterCustomObject(cdcGroup, cdcVersion, cdcPlural, domainName);
    } catch (e: any) {
      const { status, reason, message, body } = formatHttpError(e);
      const isNotFound = status === 404 || reason === 'NotFound' || /not\s*found/i.test(message);
      if (isNotFound) {
        if (!autoCreateCdc) {
          throw new Error(`ClusterDomainClaim missing for domain \"${domainName}\" and auto-create disabled. Set config-network autocreate-cluster-domain-claims=true, or create CDC:\napiVersion: ${cdcGroup}/${cdcVersion}\nkind: ClusterDomainClaim\nmetadata:\n  name: ${domainName}\nspec:\n  namespace: ${namespace}`);
        }
        const cdcBody = {
          apiVersion: `${cdcGroup}/${cdcVersion}`,
          kind: 'ClusterDomainClaim',
          metadata: { name: domainName },
          spec: { namespace },
        };
        try {
          await co.createClusterCustomObject(cdcGroup, cdcVersion, cdcPlural, cdcBody as any);
        } catch (e2: any) {
          const { status: s2, body: b2 } = formatHttpError(e2);
          throw new Error(`failed to create ClusterDomainClaim for ${domainName}: status=${s2} body=${b2}`);
        }
      } else {
        throw new Error(`clusterdomainclaim.get failed: status=${status} body=${body}`);
      }
    }

    const group = 'serving.knative.dev';
    const plural = 'domainmappings';

    // Discover supported DomainMapping version (prefer v1, fallback v1beta1)
    let version: 'v1' | 'v1beta1' | undefined;
    for (const v of ['v1', 'v1beta1'] as const) {
      try {
        await co.listNamespacedCustomObject(group, v, namespace, plural);
        version = v;
        break;
      } catch (e: any) {
        const { status, message } = formatHttpError(e);
        const notFound = status === 404 || /requested resource/i.test(message) || /not\s*found/i.test(message);
        if (!notFound) {
          throw new Error(`failed discovering DomainMapping (${v}): status=${status} msg=${message}`);
        }
      }
    }
    if (!version) {
      throw new Error('DomainMapping CRD not available (serving.knative.dev/v1 or v1beta1)');
    }

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
      const { status, reason, message, body } = formatHttpError(e);
      const isNotFound = status === 404 || reason === 'NotFound' || /not\s*found/i.test(message);
      if (isNotFound) {
        exists = false;
      } else {
        throw new Error(`domainmapping.get failed: status=${status} body=${body}`);
      }
    }

    if (!exists) {
      try {
        await co.createNamespacedCustomObject(group, version, namespace, plural, desired);
      } catch (e: any) {
        const { status, body } = formatHttpError(e);
        throw new Error(`domainmapping.create failed: status=${status} body=${body}`);
      }
      return { applied: true, ref: { namespace, name, kind: 'DomainMapping', group, version } };
    }

    // Patch spec if exists to ensure correct ref
    const body = { spec: desired.spec };
    const options = { headers: { 'Content-Type': PatchUtils.PATCH_FORMAT_JSON_MERGE_PATCH } } as const;
    try {
      await co.patchNamespacedCustomObject(group, version, namespace, plural, name, body, undefined, undefined, undefined, options);
    } catch (e: any) {
      const { status, body } = formatHttpError(e);
      throw new Error(`domainmapping.patch failed: status=${status} body=${body}`);
    }
    return { applied: true, ref: { namespace, name, kind: 'DomainMapping', group, version } };
  } catch (e: any) {
    // As a last resort, unwrap HttpError to avoid opaque "HTTP request failed" messages
    const status = e?.response?.status ?? e?.status;
    const body = e?.response?.body ?? e?.body;
    const msg = typeof body === 'string' ? body : (body ? JSON.stringify(body) : e?.message);
    if (e?.name === 'HttpError' || e?.response) {
      throw new Error(`ensureDomainMapping http error: status=${status} body=${msg}`);
    }
    throw e;
  }
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

  // If caller supplied a DomainMapping ref, persist the domain into runner_domain for UI/queries.
  let runnerDomainToSet: string | undefined;
  const ref = input.runnerRef as any;
  if (ref && typeof ref === 'object' && ref.kind === 'DomainMapping' && typeof ref.name === 'string' && ref.name) {
    runnerDomainToSet = ref.name;
  }

  const update: any = {
    runner_status: JSON.stringify(patch.runner_status),
    runner_ref: input.runnerRef ? JSON.stringify(input.runnerRef) : null,
    updated_at: now,
  };
  if (runnerDomainToSet) {
    update.runner_domain = runnerDomainToSet;
  }

  let q = knex('tenant_extension_install').update(update);

  if (input.installId) {
    q = q.where({ id: input.installId });
  } else if (input.runnerDomain) {
    q = q.where({ runner_domain: input.runnerDomain });
  }

  const count = await q;
  return { updated: (Array.isArray(count) ? count.length : Number(count)) > 0 };
}
