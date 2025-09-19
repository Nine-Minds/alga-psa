import { promises as dns } from 'dns';
import { promises as fs } from 'node:fs';
import { join as joinPath } from 'node:path';
import { setTimeout as delay } from 'timers/promises';
import type { Knex } from 'knex';
import { KubeConfig, CustomObjectsApi } from '@kubernetes/client-node';

import { getAdminConnection } from '@alga-psa/shared/db/admin.js';

import type {
  PortalDomainActivityRecord,
  VerifyCnameInput,
  VerifyCnameResult,
  MarkStatusInput,
  ReconcileResult,
} from '../workflows/portal-domains/types.js';

const TABLE_NAME = 'portal_domains';
const MANAGED_LABEL = 'portal.alga-psa.com/managed';
const TENANT_LABEL = 'portal.alga-psa.com/tenant';
const DOMAIN_ID_LABEL = 'portal.alga-psa.com/domain-id';
const DOMAIN_HOST_LABEL = 'portal.alga-psa.com/domain-host';

export interface PortalDomainConfig {
  certificateNamespace: string;
  certificateIssuerName: string;
  certificateIssuerKind: string;
  certificateIssuerGroup: string;
  gatewayNamespace: string;
  gatewaySelector: Record<string, string>;
  gatewayHttpPort: number;
  gatewayHttpsPort: number;
  virtualServiceNamespace: string;
  serviceHost: string;
  servicePort: number;
  challengeServiceHost?: string | null;
  challengeServicePort?: number;
  challengeRouteEnabled: boolean;
  manifestOutputDirectory: string | null;
}

const challengeHost = process.env.PORTAL_DOMAIN_CHALLENGE_HOST || null;
const challengeEnabledEnv = process.env.PORTAL_DOMAIN_CHALLENGE_ENABLED;

const DEFAULT_CONFIG: PortalDomainConfig = {
  certificateNamespace: process.env.PORTAL_DOMAIN_CERT_NAMESPACE || 'msp',
  certificateIssuerName: process.env.PORTAL_DOMAIN_CERT_ISSUER || 'letsencrypt-dns',
  certificateIssuerKind: process.env.PORTAL_DOMAIN_CERT_ISSUER_KIND || 'ClusterIssuer',
  certificateIssuerGroup: process.env.PORTAL_DOMAIN_CERT_ISSUER_GROUP || 'cert-manager.io',
  gatewayNamespace: process.env.PORTAL_DOMAIN_GATEWAY_NAMESPACE || 'istio-system',
  gatewaySelector: parseSelector(process.env.PORTAL_DOMAIN_GATEWAY_SELECTOR) || { istio: 'ingressgateway' },
  gatewayHttpPort: parseNumberEnv(process.env.PORTAL_DOMAIN_GATEWAY_HTTP_PORT, 80),
  gatewayHttpsPort: parseNumberEnv(process.env.PORTAL_DOMAIN_GATEWAY_HTTPS_PORT, 443),
  virtualServiceNamespace: process.env.PORTAL_DOMAIN_VS_NAMESPACE || 'msp',
  serviceHost: process.env.PORTAL_DOMAIN_SERVICE_HOST || 'sebastian.msp.svc.cluster.local',
  servicePort: parseNumberEnv(process.env.PORTAL_DOMAIN_SERVICE_PORT, 3000),
  challengeServiceHost: challengeHost,
  challengeServicePort: process.env.PORTAL_DOMAIN_CHALLENGE_PORT
    ? parseNumberEnv(process.env.PORTAL_DOMAIN_CHALLENGE_PORT, 8089)
    : undefined,
  challengeRouteEnabled: challengeEnabledEnv
    ? challengeEnabledEnv.toLowerCase() === 'true'
    : Boolean(challengeHost),
  manifestOutputDirectory: process.env.PORTAL_DOMAIN_MANIFEST_DIR || null,
};

const ACTIVE_RECONCILE_STATUSES = new Set([
  'pending_certificate',
  'certificate_issuing',
  'certificate_failed',
  'deploying',
  'active',
]);

let cachedKubeClients: { customObjects: CustomObjectsApi } | null = null;

function parseSelector(rawValue?: string | null): Record<string, string> | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed).reduce<Record<string, string>>((acc, [key, value]) => {
        if (typeof value === 'string') {
          acc[key] = value;
        }
        return acc;
      }, {});
    }
  } catch (error) {
    console.warn('[portal-domains] Failed to parse gateway selector JSON; falling back to default', { error });
  }

  return null;
}

function parseNumberEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function shouldManageStatus(status: string | null | undefined): boolean {
  return status ? ACTIVE_RECONCILE_STATUSES.has(status) : false;
}

async function getCustomObjectsApi(): Promise<CustomObjectsApi> {
  if (cachedKubeClients) {
    return cachedKubeClients.customObjects;
  }

  const kubeConfigPath = process.env.PORTAL_DOMAIN_KUBECONFIG;
  const kubeConfig = new KubeConfig();

  try {
    if (kubeConfigPath) {
      kubeConfig.loadFromFile(kubeConfigPath);
    } else {
      kubeConfig.loadFromDefault();
    }
  } catch (error) {
    throw new Error(`Failed to load Kubernetes configuration: ${formatErrorMessage(error)}`);
  }

  cachedKubeClients = {
    customObjects: kubeConfig.makeApiClient(CustomObjectsApi),
  };

  return cachedKubeClients.customObjects;
}

async function getConnection(): Promise<Knex> {
  return getAdminConnection();
}

export async function loadPortalDomain(args: { portalDomainId: string }): Promise<PortalDomainActivityRecord | null> {
  const knex = await getConnection();
  const record = await knex<PortalDomainActivityRecord>(TABLE_NAME)
    .where({ id: args.portalDomainId })
    .first();

  return record || null;
}

export async function markPortalDomainStatus(args: MarkStatusInput): Promise<void> {
  const knex = await getConnection();
  const updates: Record<string, unknown> = {
    status: args.status,
    updated_at: knex.fn.now(),
    last_checked_at: knex.fn.now(),
  };

  if (args.statusMessage !== undefined) {
    updates.status_message = args.statusMessage;
  }

  if (args.verificationDetails !== undefined) {
    updates.verification_details = args.verificationDetails;
  }

  await knex(TABLE_NAME)
    .where({ id: args.portalDomainId })
    .update(updates);
}

export async function verifyCnameRecord(input: VerifyCnameInput): Promise<VerifyCnameResult> {
  const attempts = input.attempts ?? 6;
  const intervalSeconds = input.intervalSeconds ?? 10;
  const expected = normalizeHostname(input.expectedCname);
  let lastError: unknown = null;
  let observed: string[] = [];

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      observed = await lookupCname(input.domain);
      const matched = observed.some((candidate) => candidate === expected || candidate.endsWith(`.${expected}`));
      if (matched) {
        return {
          matched: true,
          observed,
          message: attempt === 0 ? 'CNAME record verified.' : `CNAME verified after ${attempt + 1} attempts.`,
        };
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts - 1) {
      await delay(intervalSeconds * 1000);
    }
  }

  const errorMessage = lastError instanceof Error ? lastError.message : 'CNAME lookup did not match expected target.';

  return {
    matched: false,
    observed,
    message: errorMessage,
  };
}

export async function reconcilePortalDomains(args: { tenantId: string; portalDomainId: string }): Promise<ReconcileResult> {
  const knex = await getConnection();
  let rows: PortalDomainActivityRecord[] = [];

  try {
    rows = await knex<PortalDomainActivityRecord>(TABLE_NAME).select('*');
  } catch (error) {
    const message = `Failed to load portal domains during reconciliation: ${formatErrorMessage(error)}`;
    return { success: false, appliedCount: 0, errors: [message] };
  }

  const config = DEFAULT_CONFIG;
  const managedRows = rows.filter((row) => shouldManageStatus(row.status));
  const manifests = managedRows.map((row) => renderPortalDomainResources(row, config));

  const desiredNames = {
    certificates: new Set(manifests.map((manifest) => manifest.certificate.metadata?.name ?? '').filter(Boolean)),
    gateways: new Set(manifests.map((manifest) => manifest.gateway.metadata?.name ?? '').filter(Boolean)),
    virtualServices: new Set(manifests.map((manifest) => manifest.virtualService.metadata?.name ?? '').filter(Boolean)),
  };

  const errors: string[] = [];

  let manifestDir = config.manifestOutputDirectory;
  if (manifestDir) {
    try {
      await ensureDirectory(manifestDir);
    } catch (error) {
      const message = formatErrorMessage(error, 'Failed to prepare manifest output directory');
      console.error('[portal-domains] manifest directory error', {
        directory: manifestDir,
        error: message,
      });
      errors.push(message);
      manifestDir = null;
    }
  }

  console.info('[portal-domains] reconcile start', {
    tenantId: args.tenantId,
    totalDomains: rows.length,
    managedDomains: managedRows.length,
  });

  const customObjects = await getCustomObjectsApi();
  let appliedCount = 0;

  for (const manifest of manifests) {
    if (manifestDir) {
      try {
        await writeManifestsToDisk(manifestDir, manifest);
      } catch (error) {
        const message = `[${manifest.record.id}] ${formatErrorMessage(error, 'Failed to persist manifests to disk')}`;
        console.error('[portal-domains] manifest write error', {
          portalDomainId: manifest.record.id,
          directory: manifestDir,
          error: message,
        });
        errors.push(message);
      }
    }

    try {
      const certificateResult = await applyCustomResource(customObjects, {
        def: {
          group: 'cert-manager.io',
          version: 'v1',
          plural: 'certificates',
          namespace: config.certificateNamespace,
        },
        body: manifest.certificate,
      });

      const gatewayResult = await applyCustomResource(customObjects, {
        def: {
          group: 'networking.istio.io',
          version: 'v1beta1',
          plural: 'gateways',
          namespace: config.gatewayNamespace,
        },
        body: manifest.gateway,
      });

      const virtualServiceResult = await applyCustomResource(customObjects, {
        def: {
          group: 'networking.istio.io',
          version: 'v1beta1',
          plural: 'virtualservices',
          namespace: config.virtualServiceNamespace,
        },
        body: manifest.virtualService,
      });

      appliedCount += certificateResult.applied + gatewayResult.applied + virtualServiceResult.applied;

      await knex(TABLE_NAME)
        .where({ id: manifest.record.id })
        .update({
          certificate_secret_name: manifest.secretName,
          last_synced_resource_version: virtualServiceResult.resourceVersion ?? null,
          updated_at: knex.fn.now(),
          last_checked_at: knex.fn.now(),
        });
    } catch (error) {
      const message = `[${manifest.record.id}] ${formatErrorMessage(error, 'Failed to reconcile Kubernetes resources')}`;
      console.error('[portal-domains] reconcile error', { portalDomainId: manifest.record.id, error: message });
      errors.push(message);
    }
  }

  const pruneSpecs: Array<{ def: ResourceDefinition; desiredNames: Set<string> }> = [
    {
      def: {
        group: 'cert-manager.io',
        version: 'v1',
        plural: 'certificates',
        namespace: config.certificateNamespace,
      },
      desiredNames: desiredNames.certificates,
    },
    {
      def: {
        group: 'networking.istio.io',
        version: 'v1beta1',
        plural: 'gateways',
        namespace: config.gatewayNamespace,
      },
      desiredNames: desiredNames.gateways,
    },
    {
      def: {
        group: 'networking.istio.io',
        version: 'v1beta1',
        plural: 'virtualservices',
        namespace: config.virtualServiceNamespace,
      },
      desiredNames: desiredNames.virtualServices,
    },
  ];

  for (const spec of pruneSpecs) {
    try {
      const pruned = await pruneCustomResources(customObjects, spec);
      appliedCount += pruned;
    } catch (error) {
      const message = formatErrorMessage(error, `Failed to prune ${spec.def.plural}`);
      console.error('[portal-domains] prune error', {
        resource: spec.def.plural,
        namespace: spec.def.namespace,
        error: message,
      });
      errors.push(message);
    }
  }

  const cleanupIds = rows
    .filter((row) => row.status === 'disabled' && (row.certificate_secret_name || row.last_synced_resource_version))
    .map((row) => row.id);

  if (cleanupIds.length > 0) {
    await knex(TABLE_NAME)
      .whereIn('id', cleanupIds)
      .update({
        certificate_secret_name: null,
        last_synced_resource_version: null,
        updated_at: knex.fn.now(),
        last_checked_at: knex.fn.now(),
      });
  }

  console.info('[portal-domains] reconcile complete', {
    tenantId: args.tenantId,
    appliedCount,
    errors: errors.length,
  });

  if (errors.length > 0) {
    return { success: false, appliedCount, errors };
  }

  return { success: true, appliedCount };
}

async function lookupCname(domain: string): Promise<string[]> {
  const normalized = normalizeHostname(domain);
  const results = await dns.resolveCname(normalized).catch(async (error) => {
    // Some providers return CNAME via resolveAny
    if ((error as any)?.code === 'ENODATA' || (error as any)?.code === 'ENOTFOUND') {
      try {
        const anyRecords = await dns.resolveAny(normalized);
        const aliases = anyRecords
          .filter((record) => 'value' in record)
          .map((record: any) => String(record.value));
        if (aliases.length > 0) {
          return aliases;
        }
      } catch (innerError) {
        throw innerError;
      }
    }
    throw error;
  });

  return results.map(normalizeHostname);
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().replace(/\.$/, '').toLowerCase();
}

interface ResourceDefinition {
  group: string;
  version: string;
  plural: string;
  namespace: string;
}

interface ApplyResourceOptions {
  def: ResourceDefinition;
  body: Record<string, any>;
}

interface ApplyResult {
  applied: number;
  resourceVersion?: string;
}

interface PruneResourceOptions {
  def: ResourceDefinition;
  desiredNames: Set<string>;
}

export interface RenderedPortalDomainResources {
  record: PortalDomainActivityRecord;
  certificate: Record<string, any>;
  gateway: Record<string, any>;
  virtualService: Record<string, any>;
  secretName: string;
  tenantSlug: string;
  gatewayName: string;
  virtualServiceName: string;
}

async function applyCustomResource(client: CustomObjectsApi, options: ApplyResourceOptions): Promise<ApplyResult> {
  const { def } = options;
  const body = deepClone(options.body);
  const metadata = body.metadata || {};

  if (!metadata.name) {
    throw new Error('Manifest metadata.name is required.');
  }

  const namespace = metadata.namespace || def.namespace;
  body.metadata = {
    ...metadata,
    namespace,
    labels: {
      ...(metadata.labels || {}),
      [MANAGED_LABEL]: 'true',
    },
  };

  try {
    const existing = await client.getNamespacedCustomObject(def.group, def.version, namespace, def.plural, metadata.name);
    const existingBody = existing.body as any;
    body.metadata.resourceVersion = existingBody?.metadata?.resourceVersion;
    const response = await client.replaceNamespacedCustomObject(def.group, def.version, namespace, def.plural, metadata.name, body);
    const updated = response.body as any;
    return {
      applied: 1,
      resourceVersion: updated?.metadata?.resourceVersion,
    };
  } catch (error: any) {
    const status = error?.response?.status;
    if (status === 404) {
      const response = await client.createNamespacedCustomObject(def.group, def.version, namespace, def.plural, body);
      const created = response.body as any;
      return {
        applied: 1,
        resourceVersion: created?.metadata?.resourceVersion,
      };
    }
    throw error;
  }
}

async function pruneCustomResources(client: CustomObjectsApi, options: PruneResourceOptions): Promise<number> {
  const { def, desiredNames } = options;
  const namespace = def.namespace;
  const labelSelector = `${MANAGED_LABEL}=true`;
  let pruned = 0;

  try {
    const response = await client.listNamespacedCustomObject(def.group, def.version, namespace, def.plural, undefined, undefined, undefined, undefined, labelSelector);
    const list = (response.body as any)?.items ?? [];

    for (const item of list) {
      const name: string | undefined = item?.metadata?.name;
      if (!name) {
        continue;
      }
      if (desiredNames.has(name)) {
        continue;
      }
      try {
        await client.deleteNamespacedCustomObject(def.group, def.version, namespace, def.plural, name);
        pruned += 1;
      } catch (error: any) {
        const status = error?.response?.status;
        if (status !== 404) {
          throw error;
        }
      }
    }
  } catch (error) {
    throw new Error(formatErrorMessage(error, `Failed to list ${def.plural} for pruning`));
  }

  return pruned;
}

export function renderPortalDomainResources(record: PortalDomainActivityRecord, config: PortalDomainConfig): RenderedPortalDomainResources {
  const normalizedDomain = normalizeHostname(record.domain);
  const tenantSlug = createTenantSlug(record);
  const secretName = truncateName(`portal-domain-${tenantSlug}`, 63);
  const gatewayName = truncateName(`portal-domain-gw-${tenantSlug}`, 63);
  const virtualServiceName = truncateName(`portal-domain-vs-${tenantSlug}`, 63);
  const httpServerName = truncateName(`http-${tenantSlug}`, 63);
  const httpsServerName = truncateName(`https-${tenantSlug}`, 63);

  const labels = buildBaseLabels(record, normalizedDomain);

  const certificate: Record<string, any> = {
    apiVersion: 'cert-manager.io/v1',
    kind: 'Certificate',
    metadata: {
      name: secretName,
      namespace: config.certificateNamespace,
      labels,
    },
    spec: {
      secretName,
      dnsNames: [normalizedDomain],
      issuerRef: {
        name: config.certificateIssuerName,
        kind: config.certificateIssuerKind,
        group: config.certificateIssuerGroup,
      },
      privateKey: {
        rotationPolicy: 'Always',
      },
      usages: ['digital signature', 'key encipherment'],
    },
  };

  const hosts = [normalizedDomain];

  const gateway: Record<string, any> = {
    apiVersion: 'networking.istio.io/v1beta1',
    kind: 'Gateway',
    metadata: {
      name: gatewayName,
      namespace: config.gatewayNamespace,
      labels,
    },
    spec: {
      selector: config.gatewaySelector,
      servers: [
        {
          port: {
            number: config.gatewayHttpPort,
            name: httpServerName,
            protocol: 'HTTP',
          },
          tls: {
            httpsRedirect: true,
          },
          hosts,
        },
        {
          port: {
            number: config.gatewayHttpsPort,
            name: httpsServerName,
            protocol: 'HTTPS',
          },
          tls: {
            mode: 'SIMPLE',
            credentialName: secretName,
          },
          hosts,
        },
      ],
    },
  };

  const httpRoutes: any[] = [];

  if (config.challengeRouteEnabled && config.challengeServiceHost) {
    const challengeDestination: Record<string, any> = {
      host: config.challengeServiceHost,
    };
    if (config.challengeServicePort) {
      challengeDestination.port = { number: config.challengeServicePort };
    }

    httpRoutes.push({
      match: [
        {
          uri: {
            prefix: '/.well-known/acme-challenge/',
          },
        },
      ],
      route: [
        {
          destination: challengeDestination,
        },
      ],
    });
  }

  httpRoutes.push({
    route: [
      {
        destination: {
          host: config.serviceHost,
          port: {
            number: config.servicePort,
          },
        },
      },
    ],
  });

  const virtualService: Record<string, any> = {
    apiVersion: 'networking.istio.io/v1beta1',
    kind: 'VirtualService',
    metadata: {
      name: virtualServiceName,
      namespace: config.virtualServiceNamespace,
      labels,
    },
    spec: {
      hosts,
      gateways: [`${config.gatewayNamespace}/${gatewayName}`],
      http: httpRoutes,
    },
  };

  return {
    record,
    certificate,
    gateway,
    virtualService,
    secretName,
    tenantSlug,
    gatewayName,
    virtualServiceName,
  };
}

function buildBaseLabels(record: PortalDomainActivityRecord, domainHost: string): Record<string, string> {
  return {
    [MANAGED_LABEL]: 'true',
    [TENANT_LABEL]: sanitizeLabelValue(record.tenant, 'tenant'),
    [DOMAIN_ID_LABEL]: sanitizeLabelValue(record.id, 'domain'),
    [DOMAIN_HOST_LABEL]: sanitizeLabelValue(domainHost, 'host'),
  };
}

function createTenantSlug(record: PortalDomainActivityRecord): string {
  const canonical = normalizeHostname(record.canonical_host || '');
  const prefix = canonical.split('.')[0];
  if (prefix) {
    return sanitizeName(prefix);
  }
  const tenant = record.tenant || '';
  const sanitized = tenant.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (sanitized) {
    return sanitized.slice(0, 32);
  }
  return 'tenant';
}

function sanitizeName(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function sanitizeLabelValue(input: string, fallback: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');

  if (normalized.length === 0) {
    return fallback;
  }

  return normalized.length <= 63 ? normalized : normalized.slice(0, 63);
}

function truncateName(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return input.slice(0, maxLength);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

async function ensureDirectory(directoryPath: string): Promise<void> {
  await fs.mkdir(directoryPath, { recursive: true });
}

async function writeManifestsToDisk(baseDirectory: string, manifest: RenderedPortalDomainResources): Promise<void> {
  const tenantDir = joinPath(baseDirectory, manifest.tenantSlug);
  await ensureDirectory(tenantDir);

  const files: Array<{ name: string; content: unknown }> = [
    { name: 'certificate.json', content: manifest.certificate },
    { name: 'gateway.json', content: manifest.gateway },
    { name: 'virtualservice.json', content: manifest.virtualService },
  ];

  await Promise.all(
    files.map((file) => writeJsonFile(joinPath(tenantDir, file.name), file.content))
  );
}

async function writeJsonFile(filePath: string, content: unknown): Promise<void> {
  const payload = `${JSON.stringify(content, null, 2)}\n`;
  await fs.writeFile(filePath, payload, 'utf8');
}

function formatErrorMessage(error: unknown, prefix?: string): string {
  let base = 'Unknown error';

  if (error instanceof Error) {
    base = error.message;
  } else if (typeof error === 'string') {
    base = error;
  } else if (error && typeof error === 'object') {
    const anyError = error as any;
    const status = anyError?.response?.status ?? anyError?.status;
    const body = anyError?.response?.body ?? anyError?.body;
    if (body) {
      if (typeof body === 'string') {
        base = body;
      } else if (typeof body.message === 'string') {
        base = body.message;
      } else {
        try {
          base = JSON.stringify(body);
        } catch {
          base = String(body);
        }
      }
    } else if (typeof anyError.message === 'string') {
      base = anyError.message;
    } else {
      try {
        base = JSON.stringify(error);
      } catch {
        base = String(error);
      }
    }
    if (status) {
      base = `status=${status} ${base}`;
    }
  }

  if (prefix) {
    return `${prefix}: ${base}`;
  }
  return base;
}
