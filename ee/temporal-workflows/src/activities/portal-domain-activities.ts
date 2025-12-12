import { promises as dns } from "dns";
import { promises as fs } from "node:fs";
import { join as joinPath, dirname } from "node:path";
import { setTimeout as delay } from "timers/promises";
import { execFile } from "node:child_process";
import type { ExecFileOptions } from "node:child_process";
import { promisify } from "node:util";
import type { Knex } from "knex";
import { dump as dumpYaml } from "js-yaml";
import os from "os";

import { getAdminConnection } from "@alga-psa/shared/db/admin.js";

import type {
  PortalDomainActivityRecord,
  VerifyCnameInput,
  VerifyCnameResult,
  MarkStatusInput,
  ApplyPortalDomainResourcesResult,
  PortalDomainStatusSnapshot,
} from '../workflows/portal-domains/types.js';

const TABLE_NAME = "portal_domains";
const MANAGED_LABEL = "portal.alga-psa.com/managed";
const TENANT_LABEL = "portal.alga-psa.com/tenant";
const DOMAIN_ID_LABEL = "portal.alga-psa.com/domain-id";
const DOMAIN_HOST_LABEL = "portal.alga-psa.com/domain-host";
const ORIGIN_SECRET_NAME_LABEL = "portal.alga-psa.com/origin-secret-name";
const ORIGIN_SECRET_NAMESPACE_LABEL = "portal.alga-psa.com/origin-secret-namespace";
const ORIGIN_SECRET_RESOURCE_VERSION_ANNOTATION =
  "portal.alga-psa.com/origin-resource-version";
const PORTAL_MANAGED_HOSTS_ANNOTATION = "portal.alga-psa.com/managed-hosts";
const PORTAL_MANAGED_GATEWAYS_ANNOTATION =
  "portal.alga-psa.com/managed-gateways";
const PORTAL_DASHBOARD_REDIRECT_URI = "/client-portal/dashboard";

export function getBasePortalVirtualService(): string {
  return (process.env.PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE ?? "").trim();
}

const execFileAsync = promisify(execFile);

export type CommandResult = { stdout: string; stderr: string };
export type CommandRunner = (
  command: string,
  args: string[],
  options: ExecFileOptions,
) => Promise<CommandResult>;

const defaultCommandRunner: CommandRunner = async (command, args, options) => {
  const result = await execFileAsync(command, args, options);
  const stdout =
    typeof result.stdout === "string"
      ? result.stdout
      : result.stdout.toString("utf8");
  const stderr =
    typeof result.stderr === "string"
      ? result.stderr
      : result.stderr.toString("utf8");
  return { stdout, stderr };
};

let commandRunner: CommandRunner = defaultCommandRunner;

export function __setCommandRunnerForTests(runner: CommandRunner | null): void {
  commandRunner = runner ?? defaultCommandRunner;
}

type ConnectionFactory = () => Promise<Knex>;
let connectionFactory: ConnectionFactory = () => getAdminConnection();

export function __setConnectionFactoryForTests(
  factory: ConnectionFactory | null,
): void {
  connectionFactory = factory ?? (() => getAdminConnection());
}

export interface PortalDomainConfig {
  certificateNamespace: string;
  certificateIssuerName: string;
  certificateIssuerKind: string;
  certificateIssuerGroup: string;
  gatewayNamespace: string;
  gatewaySelector: Record<string, string>;
  gatewayHttpsPort: number;
  virtualServiceNamespace: string;
  serviceHost: string;
  servicePort: number;
  manifestOutputDirectory: string | null;
}

function getPortalDomainConfig(): PortalDomainConfig {
  return {
    certificateNamespace: process.env.PORTAL_DOMAIN_CERT_NAMESPACE || "msp",
    certificateIssuerName:
      process.env.PORTAL_DOMAIN_CERT_ISSUER || "letsencrypt-http01",
    certificateIssuerKind:
      process.env.PORTAL_DOMAIN_CERT_ISSUER_KIND || "ClusterIssuer",
    certificateIssuerGroup:
      process.env.PORTAL_DOMAIN_CERT_ISSUER_GROUP || "cert-manager.io",
    gatewayNamespace:
      process.env.PORTAL_DOMAIN_GATEWAY_NAMESPACE || "istio-system",
    gatewaySelector:
      parseSelector(process.env.PORTAL_DOMAIN_GATEWAY_SELECTOR) ||
      { istio: "ingressgateway" },
    gatewayHttpsPort: parseNumberEnv(
      process.env.PORTAL_DOMAIN_GATEWAY_HTTPS_PORT,
      443,
    ),
    virtualServiceNamespace: process.env.PORTAL_DOMAIN_VS_NAMESPACE || "msp",
    serviceHost: process.env.PORTAL_DOMAIN_SERVICE_HOST ?? "",
    servicePort: parseNumberEnv(process.env.PORTAL_DOMAIN_SERVICE_PORT, 3000),
    manifestOutputDirectory: process.env.PORTAL_DOMAIN_MANIFEST_DIR || null,
  };
}

const ACTIVE_RECONCILE_STATUSES = new Set([
  "pending_certificate",
  "certificate_issuing",
  "certificate_failed",
  "deploying",
  "active",
]);

function parseSelector(
  rawValue?: string | null,
): Record<string, string> | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed).reduce<Record<string, string>>(
        (acc, [key, value]) => {
          if (typeof value === "string") {
            acc[key] = value;
          }
          return acc;
        },
        {},
      );
    }
  } catch (error) {
    console.warn(
      "[portal-domains] Failed to parse gateway selector JSON; falling back to default",
      { error },
    );
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

interface RetryOptions {
  attempts?: number;
  delayMs?: number;
}

function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const anyError = error as any;
  const code = typeof anyError?.code === "string" ? anyError.code.toUpperCase() : "";
  const message = typeof anyError?.message === "string" ? anyError.message.toLowerCase() : "";

  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ECONNREFUSED") {
    return true;
  }

  if (message.includes("econnreset") || message.includes("connection reset") || message.includes("timeout")) {
    return true;
  }

  return false;
}

async function withTransientRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delayMs = Math.max(0, options.delayMs ?? 1000);

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientError(error) || attempt === attempts - 1) {
        throw error;
      }
      await delay(delayMs);
    }
  }

  throw lastError ?? new Error('Transient operation failed');
}

function shouldManageStatus(status: string | null | undefined): boolean {
  return status ? ACTIVE_RECONCILE_STATUSES.has(status) : false;
}

async function getConnection(): Promise<Knex> {
  return connectionFactory();
}

export async function loadPortalDomain(args: {
  portalDomainId: string;
}): Promise<PortalDomainActivityRecord | null> {
  const knex = await getConnection();
  const record = await knex<PortalDomainActivityRecord>(TABLE_NAME)
    .where({ id: args.portalDomainId })
    .first();

  return record || null;
}

export async function markPortalDomainStatus(
  args: MarkStatusInput,
): Promise<void> {
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

  await knex(TABLE_NAME).where({ id: args.portalDomainId }).update(updates);
}

export async function deletePortalDomainRecord(
  args: { portalDomainId: string; tenantId: string },
): Promise<void> {
  const knex = await getConnection();
  await knex(TABLE_NAME)
    .where({ id: args.portalDomainId, tenant: args.tenantId })
    .delete();
}

export async function verifyCnameRecord(
  input: VerifyCnameInput,
): Promise<VerifyCnameResult> {
  const attempts = input.attempts ?? 6;
  const intervalSeconds = input.intervalSeconds ?? 10;
  const expected = normalizeHostname(input.expectedCname);
  let lastError: unknown = null;
  let observed: string[] = [];

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      observed = await lookupCname(input.domain);
      const matched = observed.some(
        (candidate) =>
          candidate === expected || candidate.endsWith(`.${expected}`),
      );
      if (matched) {
        return {
          matched: true,
          observed,
          message:
            attempt === 0
              ? "CNAME record verified."
              : `CNAME verified after ${attempt + 1} attempts.`,
        };
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts - 1) {
      await delay(intervalSeconds * 1000);
    }
  }

  const errorMessage =
    lastError instanceof Error
      ? lastError.message
      : "CNAME lookup did not match expected target.";

  return {
    matched: false,
    observed,
    message: errorMessage,
  };
}

export async function applyPortalDomainResources(args: { tenantId: string; portalDomainId: string }): Promise<ApplyPortalDomainResourcesResult> {
  const knex = await getConnection();
  let rows: PortalDomainActivityRecord[] = [];

  try {
    rows = await knex<PortalDomainActivityRecord>(TABLE_NAME).select("*");
  } catch (error) {
    const message = `Failed to load portal domains during resource application: ${formatErrorMessage(error)}`;
    return { success: false, appliedCount: 0, errors: [message] };
  }

  const triggeringDomain = rows.find((row) => row.id === args.portalDomainId);

  const config = getPortalDomainConfig();
  const managedRows = rows.filter((row) => shouldManageStatus(row.status));
  const manifests = managedRows.map((row) =>
    renderPortalDomainResources(row, config),
  );
  const errors: string[] = [];

  let gitConfig: GitConfiguration;
  try {
    gitConfig = resolveGitConfiguration();
  } catch (error) {
    const message = formatErrorMessage(
      error,
      "Failed to resolve Git configuration",
    );
    return { success: false, appliedCount: 0, errors: [message] };
  }

  let repoDir: string;
  try {
    repoDir = await prepareGitRepository(gitConfig);
  } catch (error) {
    const message = formatErrorMessage(
      error,
      "Failed to prepare Git repository",
    );
    return { success: false, appliedCount: 0, errors: [message] };
  }

  const manifestRoot = resolveManifestRoot(
    repoDir,
    gitConfig.relativePathSegments,
  );
  try {
    await ensureDirectory(manifestRoot);
  } catch (error) {
    const message = formatErrorMessage(
      error,
      "Failed to prepare manifest directory",
    );
    return { success: false, appliedCount: 0, errors: [message] };
  }

  const desiredFiles = new Map<string, RenderedPortalDomainResources>();
  for (const manifest of manifests) {
    desiredFiles.set(`${manifest.domainSlug}.yaml`, manifest);
  }

  let existingFiles: string[] = [];
  try {
    existingFiles = await listYamlFiles(manifestRoot);
  } catch (error) {
    const message = formatErrorMessage(
      error,
      "Failed to enumerate existing manifest files",
    );
    errors.push(message);
  }

  for (const fileName of existingFiles) {
    if (!desiredFiles.has(fileName)) {
      const fullPath = joinPath(manifestRoot, fileName);
      try {
        await runKubectl(["delete", "-f", fullPath, "--ignore-not-found"]);
      } catch (error) {
        errors.push(
          formatErrorMessage(
            error,
            `Failed to delete Kubernetes resources for ${fileName}`,
          ),
        );
      }

      if (config.gatewayNamespace !== config.certificateNamespace) {
        const domainSlug = fileName.replace(/\.ya?ml$/i, "");
        if (domainSlug) {
          const secretName = truncateName(`portal-domain-${domainSlug}`, 63);
          try {
            await deleteGatewaySecret(secretName, config.gatewayNamespace);
          } catch (error) {
            errors.push(
              formatErrorMessage(
                error,
                `Failed to remove replicated TLS secret ${secretName}`,
              ),
            );
          }
        }
      }

      try {
        await fs.rm(fullPath, { force: true });
      } catch (error) {
        errors.push(
          formatErrorMessage(
            error,
            `Failed to remove manifest file ${fileName}`,
          ),
        );
      }
    }
  }

  for (const [fileName, manifest] of desiredFiles) {
    const filePath = joinPath(manifestRoot, fileName);
    try {
      await ensureDirectory(dirname(filePath));
      const yamlContent = renderManifestYaml(manifest);
      await fs.writeFile(filePath, yamlContent, "utf8");
    } catch (error) {
      errors.push(
        formatErrorMessage(error, `Failed to write manifest file ${fileName}`),
      );
    }
  }

  if (getBasePortalVirtualService()) {
    try {
      const domainToCleanup = triggeringDomain && !shouldManageStatus(triggeringDomain.status)
        ? triggeringDomain.domain
        : undefined;
      console.log('[applyPortalDomainResources] Calling syncBaseVirtualServiceRouting', {
        triggeringDomainId: args.portalDomainId,
        triggeringDomainStatus: triggeringDomain?.status,
        triggeringDomainName: triggeringDomain?.domain,
        domainToCleanup,
        manifestCount: manifests.length,
        manifestRoot,
      });
      await syncBaseVirtualServiceRouting(manifests, config, manifestRoot, domainToCleanup);
      console.log('[applyPortalDomainResources] syncBaseVirtualServiceRouting completed successfully');
    } catch (error) {
      console.error('[applyPortalDomainResources] syncBaseVirtualServiceRouting failed', error);
      errors.push(
        formatErrorMessage(
          error,
          'Failed to update base VirtualService routing',
        ),
      );
    }
  } else {
    console.log('[applyPortalDomainResources] Skipping base VirtualService sync (not configured)');
  }

  try {
    await runGit(["add", "--all", gitConfig.relativePathPosix], gitConfig, {
      suppressOutput: true,
    });

    if (getBasePortalVirtualService()) {
      const baseVsPath = joinPath(gitConfig.relativePathSegments[0], 'istio-virtualservice.yaml');
      console.log('[applyPortalDomainResources] Adding base VirtualService to git', { path: baseVsPath });
      await runGit(["add", baseVsPath], gitConfig, {
        suppressOutput: true,
      });
    }
  } catch (error) {
    errors.push(formatErrorMessage(error, "Failed to stage manifest changes"));
  }

  if (desiredFiles.size > 0) {
    try {
      await runKubectl(["apply", "-f", manifestRoot, "--recursive"]);
    } catch (error) {
      errors.push(
        formatErrorMessage(
          error,
          "Failed to apply manifest changes to cluster",
        ),
      );
    }
  }

  if (getBasePortalVirtualService()) {
    try {
      const repoDir = dirname(manifestRoot);
      const vsFilePath = joinPath(repoDir, 'istio-virtualservice.yaml');
      console.log('[applyPortalDomainResources] Applying base VirtualService to Kubernetes', { path: vsFilePath });
      await runKubectl(["apply", "-f", vsFilePath]);
      console.log('[applyPortalDomainResources] Successfully applied base VirtualService to Kubernetes');
    } catch (error) {
      console.error('[applyPortalDomainResources] Failed to apply base VirtualService to Kubernetes', error);
      errors.push(
        formatErrorMessage(
          error,
          "Failed to apply base VirtualService to cluster",
        ),
      );
    }
  }

  if (
    config.gatewayNamespace !== config.certificateNamespace &&
    manifests.length > 0
  ) {
    for (const manifest of manifests) {
      try {
        await syncGatewaySecret(manifest, config);
      } catch (error) {
        errors.push(
          formatErrorMessage(
            error,
            `Failed to sync gateway TLS secret for ${manifest.secretName}`,
          ),
        );
      }
    }
  }

  for (const manifest of manifests) {
    try {
      await knex(TABLE_NAME).where({ id: manifest.record.id }).update({
        certificate_secret_name: manifest.secretName,
        last_synced_resource_version: null,
        updated_at: knex.fn.now(),
        last_checked_at: knex.fn.now(),
      });
    } catch (error) {
      errors.push(
        formatErrorMessage(
          error,
          `Failed to update portal_domains row ${manifest.record.id}`,
        ),
      );
    }
  }

  const cleanupIds = rows
    .filter(
      (row) =>
        row.status === "disabled" &&
        (row.certificate_secret_name || row.last_synced_resource_version),
    )
    .map((row) => row.id);

  if (cleanupIds.length > 0) {
    try {
      await knex(TABLE_NAME).whereIn("id", cleanupIds).update({
        certificate_secret_name: null,
        last_synced_resource_version: null,
        updated_at: knex.fn.now(),
        last_checked_at: knex.fn.now(),
      });
    } catch (error) {
      errors.push(
        formatErrorMessage(
          error,
          "Failed to clear metadata for disabled domains",
        ),
      );
    }
  }

  try {
    const status = await runGit(["status", "--porcelain"], gitConfig, {
      suppressOutput: true,
    });
    if (status.stdout.trim()) {
      await runGit(["config", "user.name", gitConfig.authorName], gitConfig, {
        suppressOutput: true,
      });
      await runGit(["config", "user.email", gitConfig.authorEmail], gitConfig, {
        suppressOutput: true,
      });
      const commitMessage = buildCommitMessage(manifests);
      await runGit(["commit", "-m", commitMessage], gitConfig, {
        suppressOutput: true,
      });
      await runGit(["push", "origin", gitConfig.branch], gitConfig);
    }
  } catch (error) {
    errors.push(
      formatErrorMessage(error, "Failed to commit or push manifest changes"),
    );
  }

  const appliedCount = desiredFiles.size;

  console.info('[portal-domains] resource apply complete', {
    tenantId: args.tenantId,
    appliedCount,
    errors: errors.length,
  });

  if (errors.length > 0) {
    return { success: false, appliedCount, errors };
  }

  return { success: true, appliedCount };
}

export async function checkPortalDomainDeploymentStatus(args: { portalDomainId: string }): Promise<PortalDomainStatusSnapshot | null> {
  const knex = await getConnection();
  const record = await withTransientRetry(
    () =>
      knex<PortalDomainActivityRecord>(TABLE_NAME)
        .where({ id: args.portalDomainId })
        .first(),
    { attempts: 3, delayMs: 1000 }
  );

  if (!record) {
    return null;
  }

  const terminalStatuses = new Set(['active', 'disabled', 'dns_failed']);
  if (terminalStatuses.has(record.status)) {
    return { status: record.status, statusMessage: record.status_message };
  }

  if (record.status === 'certificate_failed') {
    const message = record.status_message ?? '';
    const recoverable =
      typeof message === 'string' &&
      message.toLowerCase().includes('secret does not exist');

    if (!recoverable) {
      return { status: record.status, statusMessage: record.status_message };
    }
  }

  if (!shouldManageStatus(record.status)) {
    return { status: record.status, statusMessage: record.status_message };
  }

  const config = getPortalDomainConfig();
  const manifest = renderPortalDomainResources(record, config);

  const certificate = await inspectCertificateStatus(
    manifest.secretName,
    config.certificateNamespace,
  );

  let nextStatus = record.status;
  let nextMessage = record.status_message ?? null;

  if (certificate.failureMessage) {
    nextStatus = 'certificate_failed';
    nextMessage = certificate.failureMessage;
  } else if (certificate.ready) {
    let secretSyncFailed = false;
    if (config.gatewayNamespace !== config.certificateNamespace) {
      try {
        await syncGatewaySecret(manifest, config);
      } catch (error) {
        secretSyncFailed = true;
        nextStatus = 'certificate_failed';
        nextMessage = formatErrorMessage(
          error,
          `Failed to replicate TLS secret into ${config.gatewayNamespace}`,
        );
      }
    }

    if (!secretSyncFailed) {
      const gatewayExists = await kubectlResourceExists(
        'gateway',
        manifest.gatewayName,
        config.gatewayNamespace,
      );
    const virtualServiceExists = await kubectlResourceExists(
      'virtualservice',
      manifest.virtualServiceName,
      config.virtualServiceNamespace,
    );

      if (gatewayExists && virtualServiceExists) {
        nextStatus = 'active';
        nextMessage = 'Your domain is live and protected by HTTPS.';
      } else {
        nextStatus = 'deploying';
        nextMessage = 'SSL is ready. Finishing the domain routing setup...';
      }
    }
  } else {
    nextStatus = 'certificate_issuing';
    nextMessage =
      certificate.message ??
      'Requesting an HTTPS certificate. This usually takes a couple of minutes.';
  }

  if (certificate.recoverableError) {
    nextMessage = certificate.recoverableError;
  }

  if (nextMessage && nextMessage.length > 1024) {
    nextMessage = nextMessage.slice(0, 1024);
  }

  const currentMessage = record.status_message ?? null;

  if (nextStatus !== record.status || nextMessage !== currentMessage) {
    await markPortalDomainStatus({
      portalDomainId: record.id,
      status: nextStatus,
      statusMessage: nextMessage,
    });
  }

  return { status: nextStatus, statusMessage: nextMessage ?? null };
}

interface CertificateInspectionResult {
  ready: boolean;
  failureMessage?: string;
  message?: string;
  recoverableError?: string;
}

async function inspectCertificateStatus(
  name: string,
  namespace: string,
): Promise<CertificateInspectionResult> {
  try {
    const { stdout } = await withTransientRetry(
      () =>
        runKubectl([
          'get',
          'certificate',
          name,
          '-n',
          namespace,
          '-o',
          'json',
        ]),
      { attempts: 5, delayMs: 2000 }
    );
    const certificate = JSON.parse(stdout);
    const conditions = Array.isArray(certificate?.status?.conditions)
      ? certificate.status.conditions
      : [];
    const readyCondition = conditions.find(
      (condition: any) => condition?.type === 'Ready',
    );

    if (!readyCondition) {
      return {
        ready: false,
        message: "Requesting an HTTPS certificate from Let's Encrypt...",
      };
    }

    const normalizedMessage =
      typeof readyCondition.message === 'string'
        ? readyCondition.message
        : undefined;
    const normalizedReason =
      typeof readyCondition.reason === 'string'
        ? readyCondition.reason
        : undefined;

    if (readyCondition.status === 'True') {
      return { ready: true, message: normalizedMessage };
    }

    if (readyCondition.status === 'False') {
      const failureMessage = normalizedMessage
        ? `We couldn’t finish the HTTPS setup: ${normalizedMessage}`
        : normalizedReason
          ? `We couldn’t finish the HTTPS setup: ${normalizedReason}`
          : 'We couldn’t finish the HTTPS setup. Please double-check DNS and try again.';
      return { ready: false, failureMessage };
    }

    return {
      ready: false,
      message:
        normalizedMessage ??
        normalizedReason ??
        "Waiting for Let's Encrypt to finish verifying your domain...",
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        ready: false,
        message: 'Preparing HTTPS resources...',
      };
    }

    const errorMessage = formatErrorMessage(
      error,
      'Failed to inspect certificate status',
    );
    console.warn('[portal-domains] certificate inspection error', {
      name,
      namespace,
      error: errorMessage,
    });
    return {
      ready: false,
      recoverableError: errorMessage,
    };
  }
}

async function kubectlResourceExists(
  kind: string,
  name: string,
  namespace: string,
): Promise<boolean> {
  try {
    await withTransientRetry(
      () => runKubectl(['get', kind, name, '-n', namespace]),
      { attempts: 3, delayMs: 1000 }
    );
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }

    const errorMessage = formatErrorMessage(
      error,
      `Failed to verify ${kind}/${name}`,
    );
    console.warn('[portal-domains] resource existence check failed', {
      kind,
      name,
      namespace,
      error: errorMessage,
    });
    return false;
  }
}

function isNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /NotFound/i.test(message) || /not found/i.test(message);
}

interface GitConfiguration {
  repoUrl: string;
  authenticatedRepoUrl: string;
  branch: string;
  workspaceDir: string;
  repoDir: string;
  relativePathPosix: string;
  relativePathSegments: string[];
  authorName: string;
  authorEmail: string;
  token: string;
  maskValues: string[];
}

interface CommandOptions extends ExecFileOptions {
  maskValues?: string[];
  suppressOutput?: boolean;
}

export function resolveGitConfiguration(): GitConfiguration {
  const repoUrl = process.env.PORTAL_DOMAIN_GIT_REPO;
  const branch = process.env.PORTAL_DOMAIN_GIT_BRANCH || "main";
  const workspaceDir =
    process.env.PORTAL_DOMAIN_GIT_WORKDIR || "/tmp/portal-domain-sync";
  const relativePathPosix =
    process.env.PORTAL_DOMAIN_GIT_ROOT || "alga-psa/portal-domains";
  const authorName =
    process.env.PORTAL_DOMAIN_GIT_AUTHOR_NAME || "Portal Domains Bot";
  const authorEmail =
    process.env.PORTAL_DOMAIN_GIT_AUTHOR_EMAIL || "platform@nineminds.ai";
  const token = process.env.GITHUB_ACCESS_TOKEN;

  if (!token) {
    throw new Error('GITHUB_ACCESS_TOKEN environment variable is required for portal domain resource application.');
  }

  if (!repoUrl) {
    throw new Error('PORTAL_DOMAIN_GIT_REPO environment variable is required for portal domain resource application.');
  }

  const url = new URL(repoUrl);
  url.username = token;
  url.password = "";

  const repoDir = joinPath(workspaceDir, "nm-kube-config");
  const relativePathSegments = relativePathPosix.split("/").filter(Boolean);

  return {
    repoUrl,
    authenticatedRepoUrl: url.toString(),
    branch,
    workspaceDir,
    repoDir,
    relativePathPosix,
    relativePathSegments,
    authorName,
    authorEmail,
    token,
    maskValues: [token, url.toString()],
  };
}

export async function prepareGitRepository(
  config: GitConfiguration,
): Promise<string> {
  await ensureDirectory(config.workspaceDir);
  const gitEnv: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

  const gitDirExists = await pathExists(joinPath(config.repoDir, ".git"));
  if (!gitDirExists) {
    await runCommand(
      "git",
      ["clone", config.authenticatedRepoUrl, config.repoDir],
      {
        cwd: config.workspaceDir,
        env: gitEnv,
        maskValues: config.maskValues,
        suppressOutput: true,
      },
    );
  }

  await runCommand(
    "git",
    ["remote", "set-url", "origin", config.authenticatedRepoUrl],
    {
      cwd: config.repoDir,
      env: gitEnv,
      maskValues: config.maskValues,
      suppressOutput: true,
    },
  );

  await runCommand("git", ["fetch", "origin", config.branch], {
    cwd: config.repoDir,
    env: gitEnv,
    maskValues: config.maskValues,
    suppressOutput: true,
  });

  await runCommand("git", ["checkout", config.branch], {
    cwd: config.repoDir,
    env: gitEnv,
    maskValues: config.maskValues,
    suppressOutput: true,
  });

  await runCommand("git", ["pull", "origin", config.branch], {
    cwd: config.repoDir,
    env: gitEnv,
    maskValues: config.maskValues,
    suppressOutput: true,
  });

  return config.repoDir;
}

function resolveManifestRoot(repoDir: string, segments: string[]): string {
  return joinPath(repoDir, ...segments);
}

export async function listYamlFiles(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function runGit(
  args: string[],
  config: GitConfiguration,
  options: CommandOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return runCommand("git", args, {
    cwd: options.cwd || config.repoDir,
    env: { ...process.env, ...(options.env || {}), GIT_TERMINAL_PROMPT: "0" },
    maskValues: config.maskValues,
    suppressOutput: options.suppressOutput,
  });
}

export async function runKubectl(
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return runCommand("kubectl", args, { suppressOutput: true });
}

export async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const maskValues = options.maskValues?.filter(Boolean) ?? [];
  const execOptions: ExecFileOptions = {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    maxBuffer: options.maxBuffer ?? 1024 * 1024 * 10,
  };

  try {
    const { stdout, stderr } = await commandRunner(command, args, execOptions);
    if (!options.suppressOutput) {
      const sanitizedStdout = maskSecrets(stdout, maskValues).trim();
      const sanitizedStderr = maskSecrets(stderr, maskValues).trim();
      if (sanitizedStdout) {
        console.debug(`[portal-domains] ${command} stdout: ${sanitizedStdout}`);
      }
      if (sanitizedStderr) {
        console.debug(`[portal-domains] ${command} stderr: ${sanitizedStderr}`);
      }
    }
    return { stdout, stderr };
  } catch (error) {
    const message = maskSecrets(formatErrorMessage(error), maskValues);
    throw new Error(message);
  }
}

export function renderManifestYaml(
  manifest: RenderedPortalDomainResources,
): string {
  const documents = [
    manifest.certificate,
    manifest.gateway,
    manifest.virtualService,
  ];
  return documents
    .map((doc, index) => {
      const yaml = dumpYaml(doc, { sortKeys: true, noRefs: true });
      return index === 0 ? yaml : `---\n${yaml}`;
    })
    .join("")
    .concat("\n");
}

function buildCommitMessage(
  manifests: RenderedPortalDomainResources[],
): string {
  if (manifests.length === 0) {
    return "chore(portal-domains): sync empty state";
  }

  const slugs = Array.from(
    new Set(manifests.map((manifest) => manifest.domainSlug)),
  );
  const preview = slugs.slice(0, 5).join(", ");
  const suffix =
    slugs.length > 5 ? `${preview}, +${slugs.length - 5} more` : preview;
  return `chore(portal-domains): sync ${suffix}`;
}

function maskSecrets(value: string, secrets: string[]): string {
  return secrets.reduce((acc, secret) => {
    if (!secret) {
      return acc;
    }
    return acc.split(secret).join("***");
  }, value);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function lookupCname(domain: string): Promise<string[]> {
  const normalized = normalizeHostname(domain);
  const results = await dns.resolveCname(normalized).catch(async (error) => {
    // Some providers return CNAME via resolveAny
    if (
      (error as any)?.code === "ENODATA" ||
      (error as any)?.code === "ENOTFOUND"
    ) {
      try {
        const anyRecords = await dns.resolveAny(normalized);
        const aliases = anyRecords
          .filter((record) => "value" in record)
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
  return hostname.trim().replace(/\.$/, "").toLowerCase();
}

export interface RenderedPortalDomainResources {
  record: PortalDomainActivityRecord;
  certificate: Record<string, any>;
  gateway: Record<string, any>;
  virtualService: Record<string, any>;
  secretName: string;
  domainSlug: string;
  gatewayName: string;
  virtualServiceName: string;
}

export function renderPortalDomainResources(
  record: PortalDomainActivityRecord,
  config: PortalDomainConfig,
): RenderedPortalDomainResources {
  const normalizedDomain = normalizeHostname(record.domain);
  const domainSlug = createDomainSlug(record);
  const secretName = truncateName(`portal-domain-${domainSlug}`, 63);
  const gatewayName = truncateName(`portal-domain-gw-${domainSlug}`, 63);
  const virtualServiceName = truncateName(`portal-domain-vs-${domainSlug}`, 63);
  const httpServerName = truncateName(`http-${domainSlug}`, 63);
  const httpsServerName = truncateName(`https-${domainSlug}`, 63);

  const labels = buildBaseLabels(record, normalizedDomain);

  const certificate: Record<string, any> = {
    apiVersion: "cert-manager.io/v1",
    kind: "Certificate",
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
        rotationPolicy: "Always",
      },
      usages: ["digital signature", "key encipherment"],
    },
  };

  const hosts = [normalizedDomain];

  const servers: any[] = [
    {
      port: {
        number: config.gatewayHttpsPort,
        name: httpsServerName,
        protocol: "HTTPS",
      },
      tls: {
        mode: "SIMPLE",
        credentialName: secretName,
      },
      hosts,
    },
  ];

  const gateway: Record<string, any> = {
    apiVersion: "networking.istio.io/v1beta1",
    kind: "Gateway",
    metadata: {
      name: gatewayName,
      namespace: config.gatewayNamespace,
      labels,
    },
    spec: {
      selector: config.gatewaySelector,
      servers,
    },
  };

  const serviceHost = config.serviceHost;
  if (!serviceHost) {
    throw new Error(
      "Portal domain service host is not configured. Set PORTAL_DOMAIN_SERVICE_HOST.",
    );
  }

  const primaryDestination = {
    destination: {
      host: serviceHost,
      port: {
        number: config.servicePort,
      },
    },
  };

  const httpRoutes: any[] = [
    {
      match: [
        {
          uri: { prefix: "/" },
          port: config.gatewayHttpsPort,
        },
      ],
      route: [primaryDestination],
    },
  ];

  const virtualService: Record<string, any> = {
    apiVersion: "networking.istio.io/v1beta1",
    kind: "VirtualService",
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
    domainSlug,
    gatewayName,
    virtualServiceName,
  };
}

async function syncGatewaySecret(
  manifest: RenderedPortalDomainResources,
  config: PortalDomainConfig,
): Promise<void> {
  if (config.gatewayNamespace === config.certificateNamespace) {
    return;
  }

  const sourceNamespace = config.certificateNamespace;
  const targetNamespace = config.gatewayNamespace;
  const secretName = manifest.secretName;

  let sourceSecret: any;
  try {
    const { stdout } = await withTransientRetry(
      () =>
        runKubectl([
          'get',
          'secret',
          secretName,
          '-n',
          sourceNamespace,
          '-o',
          'json',
        ]),
      { attempts: 3, delayMs: 1000 }
    );
    sourceSecret = JSON.parse(stdout);
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }
    throw new Error(
      formatErrorMessage(
        error,
        `Failed to load source TLS secret ${sourceNamespace}/${secretName}`,
      ),
    );
  }

  const data = (sourceSecret?.data ?? {}) as Record<string, string>;
  const tlsCrt = data['tls.crt'];
  const tlsKey = data['tls.key'];

  if (!tlsCrt || !tlsKey) {
    throw new Error(
      `Source TLS secret ${sourceNamespace}/${secretName} is missing tls.crt or tls.key`,
    );
  }

  const baseLabels = buildBaseLabels(
    manifest.record,
    normalizeHostname(manifest.record.domain),
  );

  const labels: Record<string, string> = {
    ...baseLabels,
    [ORIGIN_SECRET_NAME_LABEL]: secretName,
    [ORIGIN_SECRET_NAMESPACE_LABEL]: sourceNamespace,
  };

  const annotations: Record<string, string> = {};
  const resourceVersion = sourceSecret?.metadata?.resourceVersion;
  if (resourceVersion) {
    annotations[ORIGIN_SECRET_RESOURCE_VERSION_ANNOTATION] = String(
      resourceVersion,
    );
  }

  const replica: Record<string, any> = {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: {
      name: secretName,
      namespace: targetNamespace,
      labels,
      ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
    },
    type:
      typeof sourceSecret?.type === 'string'
        ? sourceSecret.type
        : 'kubernetes.io/tls',
    data: {
      'tls.crt': tlsCrt,
      'tls.key': tlsKey,
    },
  };

  const tempDir = await fs.mkdtemp(joinPath(os.tmpdir(), 'portal-gateway-secret-'));
  const filePath = joinPath(tempDir, `${manifest.domainSlug}-gateway-secret.yaml`);

  try {
    const yaml = dumpYaml(replica, { sortKeys: true, noRefs: true });
    await fs.writeFile(filePath, yaml, 'utf8');
    await runKubectl(['apply', '-f', filePath]);
  } catch (error) {
    throw new Error(
      formatErrorMessage(
        error,
        `Failed to apply replicated TLS secret ${targetNamespace}/${secretName}`,
      ),
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function syncBaseVirtualServiceRouting(
  manifests: RenderedPortalDomainResources[],
  config: PortalDomainConfig,
  manifestRoot: string,
  domainToCleanup?: string,
): Promise<void> {
  console.log('[syncBaseVS] Starting sync', {
    manifestCount: manifests.length,
    manifestRoot,
    domainToCleanup: domainToCleanup || '(none)',
  });

  const baseRef = getBasePortalVirtualService();
  if (!baseRef) {
    console.log('[syncBaseVS] No PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE configured, skipping sync');
    return;
  }

  console.log('[syncBaseVS] Base VirtualService reference:', baseRef);

  const parsed = parseNamespacedResourceRef(
    baseRef,
    config.virtualServiceNamespace,
  );
  if (!parsed) {
    throw new Error(
      `Invalid PORTAL_DOMAIN_BASE_VIRTUAL_SERVICE reference: ${baseRef}`,
    );
  }

  const { namespace, name } = parsed;

  console.log('[syncBaseVS] Fetching base VirtualService', { namespace, name });

  let baseVirtualService: any;
  try {
    const { stdout } = await runKubectl([
      'get',
      'virtualservice',
      name,
      '-n',
      namespace,
      '-o',
      'json',
    ]);
    baseVirtualService = JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      formatErrorMessage(
        error,
        `Failed to load base portal VirtualService ${namespace}/${name}`,
      ),
    );
  }

  const baseHosts = normalizeStringList(baseVirtualService?.spec?.hosts);
  const baseGateways = normalizeStringList(baseVirtualService?.spec?.gateways);
  const baseHttpRoutes = Array.isArray(baseVirtualService?.spec?.http)
    ? [...baseVirtualService.spec.http]
    : [];

  console.log('[syncBaseVS] Current state:', {
    baseHosts,
    baseGateways,
    baseHttpRouteCount: baseHttpRoutes.length,
  });

  const desiredHostsSet = new Set<string>();
  const desiredGatewaysSet = new Set<string>();

  for (const manifest of manifests) {
    const manifestHosts = normalizeStringList(
      manifest.virtualService?.spec?.hosts,
    );
    for (const host of manifestHosts) {
      desiredHostsSet.add(host);
    }

    const manifestGateways = normalizeStringList(
      manifest.virtualService?.spec?.gateways,
    );
    for (const gateway of manifestGateways) {
      desiredGatewaysSet.add(gateway);
    }

    desiredGatewaysSet.add(
      `${config.gatewayNamespace}/${manifest.gatewayName}`,
    );
  }

  const managedHosts = readManagedAnnotationSet(
    baseVirtualService?.metadata?.annotations?.[
      PORTAL_MANAGED_HOSTS_ANNOTATION
    ],
  );
  const managedGateways = readManagedAnnotationSet(
    baseVirtualService?.metadata?.annotations?.[
      PORTAL_MANAGED_GATEWAYS_ANNOTATION
    ],
  );

  console.log('[syncBaseVS] Desired from manifests:', {
    desiredHosts: Array.from(desiredHostsSet),
    desiredGateways: Array.from(desiredGatewaysSet),
  });

  console.log('[syncBaseVS] Managed annotations:', {
    managedHosts: Array.from(managedHosts),
    managedGateways: Array.from(managedGateways),
  });

  const retainedHosts = baseHosts.filter(
    (host) => {
      // If this is the domain being cleaned up, always remove it
      if (domainToCleanup && host === domainToCleanup) {
        return false;
      }
      // Keep if not managed OR if managed and still desired
      return !managedHosts.has(host) || desiredHostsSet.has(host);
    },
  );
  const retainedGateways = baseGateways.filter(
    (gateway) => {
      // If cleaning up a domain, remove portal domain gateways that aren't in the desired set
      // Portal domain gateways follow the pattern: {namespace}/portal-domain-gw-{id}
      if (domainToCleanup) {
        const isPortalDomainGateway = gateway.includes('/portal-domain-gw-');
        const isStillDesired = desiredGatewaysSet.has(gateway);

        // Remove orphaned portal domain gateways
        if (isPortalDomainGateway && !isStillDesired) {
          return false;
        }
      }
      // Keep if not managed OR if managed and still desired
      return !managedGateways.has(gateway) || desiredGatewaysSet.has(gateway);
    },
  );

  const desiredHosts = combineUniqueStrings(
    retainedHosts,
    Array.from(desiredHostsSet),
  );
  const desiredGateways = combineUniqueStrings(
    retainedGateways,
    Array.from(desiredGatewaysSet),
  );

  console.log('[syncBaseVS] After filtering:', {
    retainedHosts,
    retainedGateways,
    desiredHosts,
    desiredGateways,
  });

  const hostsChanged = !arraysShallowEqual(baseHosts, desiredHosts);
  const gatewaysChanged = !arraysShallowEqual(baseGateways, desiredGateways);

  console.log('[syncBaseVS] Change detection:', {
    hostsChanged,
    gatewaysChanged,
    baseHosts,
    desiredHosts,
    baseGateways,
    desiredGateways,
  });

  const desiredManagedHostsList = Array.from(desiredHostsSet).sort();
  const desiredManagedGatewaysList = Array.from(desiredGatewaysSet).sort();
  const existingManagedHostsList = Array.from(managedHosts).sort();
  const existingManagedGatewaysList = Array.from(managedGateways).sort();

  const retainedHttpRoutes: any[] = [];
  const existingManagedRedirectRoutes = new Map<string, any>();
  for (const route of baseHttpRoutes) {
    const managedHost = extractManagedRedirectHost(route);
    if (managedHost) {
      existingManagedRedirectRoutes.set(managedHost, route);
    } else {
      retainedHttpRoutes.push(route);
    }
  }

  const desiredManagedRedirectRoutes = Array.from(desiredHostsSet)
    .sort()
    .map((host) =>
      existingManagedRedirectRoutes.get(host) ??
      buildManagedRedirectRoute(host),
    );

  // Separate catch-all routes from specific routes
  // Catch-all routes are those with no match conditions or very generic matches
  const specificRoutes: any[] = [];
  const catchAllRoutes: any[] = [];

  for (const route of retainedHttpRoutes) {
    if (isCatchAllRoute(route)) {
      catchAllRoutes.push(route);
    } else {
      specificRoutes.push(route);
    }
  }

  // Order: specific routes, then redirect routes, then catch-all routes
  const desiredHttpRoutes = [
    ...specificRoutes,
    ...desiredManagedRedirectRoutes,
    ...catchAllRoutes,
  ];

  const httpRoutesChanged = !httpRoutesEqual(
    baseHttpRoutes,
    desiredHttpRoutes,
  );

  const managedHostsChanged = !arraysShallowEqual(
    existingManagedHostsList,
    desiredManagedHostsList,
  );
  const managedGatewaysChanged = !arraysShallowEqual(
    existingManagedGatewaysList,
    desiredManagedGatewaysList,
  );

  const metadataSanitizationReasons = getMetadataSanitizationReasons(baseVirtualService);
  const requiresMetadataSanitization = metadataSanitizationReasons.length > 0;

  console.log('[syncBaseVS] All change flags:', {
    hostsChanged,
    gatewaysChanged,
    managedHostsChanged,
    managedGatewaysChanged,
    httpRoutesChanged,
    requiresMetadataSanitization,
    metadataSanitizationReasons,
  });

  if (
    !hostsChanged &&
    !gatewaysChanged &&
    !managedHostsChanged &&
    !managedGatewaysChanged &&
    !httpRoutesChanged &&
    !requiresMetadataSanitization
  ) {
    console.log('[syncBaseVS] No changes detected, skipping file write');
    return;
  }

  console.log('[syncBaseVS] Changes detected, updating base VirtualService');
  if (requiresMetadataSanitization) {
    console.log('[syncBaseVS] Metadata sanitization required before writing base VirtualService', {
      reasons: metadataSanitizationReasons,
    });
  }

  if (hostsChanged) {
    baseVirtualService.spec.hosts = desiredHosts;
  }
  if (gatewaysChanged) {
    baseVirtualService.spec.gateways = desiredGateways;
  }
  if (httpRoutesChanged) {
    baseVirtualService.spec.http = desiredHttpRoutes;
  }

  if (!baseVirtualService.metadata.annotations) {
    baseVirtualService.metadata.annotations = {};
  }

  if (desiredManagedHostsList.length > 0) {
    baseVirtualService.metadata.annotations[PORTAL_MANAGED_HOSTS_ANNOTATION] =
      JSON.stringify(desiredManagedHostsList);
  } else {
    delete baseVirtualService.metadata.annotations[PORTAL_MANAGED_HOSTS_ANNOTATION];
  }

  if (desiredManagedGatewaysList.length > 0) {
    baseVirtualService.metadata.annotations[PORTAL_MANAGED_GATEWAYS_ANNOTATION] =
      JSON.stringify(desiredManagedGatewaysList);
  } else {
    delete baseVirtualService.metadata.annotations[PORTAL_MANAGED_GATEWAYS_ANNOTATION];
  }

  // Write the base VirtualService to the repo root (not the portal-domains folder)
  const repoDir = dirname(manifestRoot);
  const vsFilePath = joinPath(repoDir, 'istio-virtualservice.yaml');

  console.log('[syncBaseVS] File path construction:', {
    manifestRoot,
    repoDir,
    vsFilePath,
  });

  try {
    await ensureDirectory(dirname(vsFilePath));
    sanitizeKubernetesResourceForApply(baseVirtualService);
    const yamlContent = dumpYaml(baseVirtualService, { sortKeys: true, noRefs: true });
    console.log('[syncBaseVS] Writing base VirtualService to file', {
      path: vsFilePath,
      contentLength: yamlContent.length,
      hosts: baseVirtualService.spec.hosts,
      gateways: baseVirtualService.spec.gateways,
    });
    await fs.writeFile(vsFilePath, yamlContent, 'utf8');
    console.log('[syncBaseVS] Successfully wrote base VirtualService to file');
  } catch (error) {
    console.error('[syncBaseVS] Failed to write base VirtualService', {
      path: vsFilePath,
      error: formatErrorMessage(error),
    });
    throw new Error(
      formatErrorMessage(
        error,
        `Failed to write base VirtualService to ${vsFilePath}`,
      ),
    );
  }
}

const RUNTIME_METADATA_FIELDS = [
  'creationTimestamp',
  'deletionTimestamp',
  'resourceVersion',
  'uid',
  'generation',
  'managedFields',
  'selfLink',
];

function getMetadataSanitizationReasons(resource: Record<string, any> | undefined | null): string[] {
  const reasons: string[] = [];

  if (!resource || typeof resource !== 'object') {
    return reasons;
  }

  if ('status' in resource) {
    reasons.push('status field present');
  }

  const metadata = resource.metadata;
  if (!metadata || typeof metadata !== 'object') {
    return reasons;
  }

  const presentRuntimeFields = RUNTIME_METADATA_FIELDS.filter((field) => field in metadata);
  if (presentRuntimeFields.length > 0) {
    reasons.push(`metadata fields: ${presentRuntimeFields.join(', ')}`);
  }

  if (
    metadata.annotations &&
    typeof metadata.annotations === 'object' &&
    'kubectl.kubernetes.io/last-applied-configuration' in metadata.annotations
  ) {
    reasons.push('last-applied annotation present');
  }

  if (Array.isArray(metadata.finalizers) && metadata.finalizers.length === 0) {
    reasons.push('empty finalizers array present');
  }

  return reasons;
}

function sanitizeKubernetesResourceForApply(resource: Record<string, any> | undefined | null): void {
  if (!resource || typeof resource !== 'object') {
    return;
  }

  let statusRemoved = false;
  const removedMetadataFields: string[] = [];
  const removedAnnotations: string[] = [];
  let annotationsObjectCleared = false;
  let emptyFinalizersRemoved = false;

  if ('status' in resource) {
    delete resource.status;
    statusRemoved = true;
  }

  const metadata = resource.metadata;
  if (!metadata || typeof metadata !== 'object') {
    return;
  }

  for (const field of RUNTIME_METADATA_FIELDS) {
    if (field in metadata) {
      delete (metadata as Record<string, unknown>)[field];
      removedMetadataFields.push(field);
    }
  }

  if (metadata.annotations && typeof metadata.annotations === 'object') {
    if ('kubectl.kubernetes.io/last-applied-configuration' in metadata.annotations) {
      delete metadata.annotations['kubectl.kubernetes.io/last-applied-configuration'];
      removedAnnotations.push('kubectl.kubernetes.io/last-applied-configuration');
    }
    if (Object.keys(metadata.annotations).length === 0) {
      delete metadata.annotations;
      annotationsObjectCleared = true;
    }
  }

  if (Array.isArray(metadata.finalizers) && metadata.finalizers.length === 0) {
    delete metadata.finalizers;
    emptyFinalizersRemoved = true;
  }

  if (
    statusRemoved ||
    removedMetadataFields.length > 0 ||
    removedAnnotations.length > 0 ||
    annotationsObjectCleared ||
    emptyFinalizersRemoved
  ) {
    console.log('[syncBaseVS] Sanitized base VirtualService metadata', {
      statusRemoved,
      removedMetadataFields,
      removedAnnotations,
      annotationsObjectCleared,
      emptyFinalizersRemoved,
    });
  }
}

async function deleteGatewaySecret(
  secretName: string,
  namespace: string,
): Promise<void> {
  await runKubectl([
    'delete',
    'secret',
    secretName,
    '-n',
    namespace,
    '--ignore-not-found',
  ]);
}

function buildBaseLabels(
  record: PortalDomainActivityRecord,
  domainHost: string,
): Record<string, string> {
  return {
    [MANAGED_LABEL]: "true",
    [TENANT_LABEL]: sanitizeLabelValue(record.tenant, "tenant"),
    [DOMAIN_ID_LABEL]: sanitizeLabelValue(record.id, "domain"),
    [DOMAIN_HOST_LABEL]: sanitizeLabelValue(domainHost, "host"),
  };
}

function createDomainSlug(record: PortalDomainActivityRecord): string {
  const source = record.id ?? '';
  const sanitized = sanitizeName(source);
  if (sanitized) {
    return sanitized.length <= 46 ? sanitized : sanitized.slice(0, 46);
  }

  const fallback = sanitizeName(record.domain ?? '') || sanitizeName(record.tenant ?? '');
  return fallback || 'domain';
}

function sanitizeName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function sanitizeLabelValue(input: string, fallback: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

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

async function ensureDirectory(directoryPath: string): Promise<void> {
  await fs.mkdir(directoryPath, { recursive: true });
}

function parseNamespacedResourceRef(
  value: string,
  fallbackNamespace: string,
): { namespace: string; name: string } | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (!trimmed.includes('/')) {
    return { namespace: fallbackNamespace, name: trimmed };
  }

  const [rawNamespace, rawName] = trimmed.split('/', 2);
  const namespace = rawNamespace?.trim() || fallbackNamespace;
  const name = rawName?.trim();

  if (!name) {
    return null;
  }

  return { namespace, name };
}

function normalizeStringList(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function combineUniqueStrings(
  existing: string[],
  additions: string[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of existing) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  for (const value of additions) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}

function arraysShallowEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}

function extractManagedRedirectHost(route: any): string | null {
  if (!route || typeof route !== 'object') {
    return null;
  }

  const redirectUri = route?.redirect?.uri;
  if (redirectUri !== PORTAL_DASHBOARD_REDIRECT_URI) {
    return null;
  }

  const matches = Array.isArray(route.match) ? route.match : [];
  for (const condition of matches) {
    const host = condition?.authority?.exact;
    const uriExact = condition?.uri?.exact;
    if (typeof host === 'string' && uriExact === '/') {
      return host;
    }
  }

  return null;
}

function buildManagedRedirectRoute(host: string): Record<string, any> {
  return {
    match: [
      {
        authority: { exact: host },
        uri: { exact: '/' },
      },
    ],
    redirect: {
      uri: PORTAL_DASHBOARD_REDIRECT_URI,
    },
  };
}

function isCatchAllRoute(route: any): boolean {
  if (!route || typeof route !== 'object') {
    return false;
  }

  // A catch-all route has no match conditions or only very generic ones
  // and contains a route (not a redirect)
  if (!route.route || !Array.isArray(route.route)) {
    return false;
  }

  // If there's no match array at all, it's definitely a catch-all
  if (!Array.isArray(route.match)) {
    return true;
  }

  // If the match array is empty, it's a catch-all
  if (route.match.length === 0) {
    return true;
  }

  // Check if all match conditions are generic (like prefix: "/" without authority)
  // A route is considered catch-all if it only has generic URI matches without authority constraints
  const hasSpecificMatch = route.match.some((condition: any) => {
    // If there's an authority match, it's specific
    if (condition?.authority) {
      return true;
    }

    // If there's a specific URI match (exact or regex), it might be specific
    // But prefix: "/" without authority is generic
    const uriPrefix = condition?.uri?.prefix;
    if (uriPrefix && uriPrefix !== '/') {
      return true;
    }

    const uriExact = condition?.uri?.exact;
    if (uriExact && uriExact !== '/') {
      return true;
    }

    // Other match types (headers, queryParams, etc.) make it specific
    if (condition?.headers || condition?.queryParams || condition?.method) {
      return true;
    }

    return false;
  });

  return !hasSpecificMatch;
}

function httpRoutesEqual(a: any[], b: any[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let index = 0; index < a.length; index += 1) {
    if (stableStringify(a[index]) !== stableStringify(b[index])) {
      return false;
    }
  }

  return true;
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(
        ([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`,
      );
    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}

function readManagedAnnotationSet(value: unknown): Set<string> {
  if (typeof value !== 'string') {
    return new Set<string>();
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      const result = new Set<string>();
      for (const entry of parsed) {
        if (typeof entry === 'string' && entry.trim().length > 0) {
          result.add(entry.trim());
        }
      }
      return result;
    }
  } catch (error) {
    console.warn('[portal-domains] Failed to parse managed annotation', {
      annotation: value,
      error: error instanceof Error ? error.message : String(error ?? ''),
    });
  }

  return new Set<string>();
}

function formatErrorMessage(error: unknown, prefix?: string): string {
  let base = "Unknown error";

  if (error instanceof Error) {
    base = error.message;
  } else if (typeof error === "string") {
    base = error;
  } else if (error && typeof error === "object") {
    const anyError = error as any;
    const status = anyError?.response?.status ?? anyError?.status;
    const body = anyError?.response?.body ?? anyError?.body;
    if (body) {
      if (typeof body === "string") {
        base = body;
      } else if (typeof body.message === "string") {
        base = body.message;
      } else {
        try {
          base = JSON.stringify(body);
        } catch {
          base = String(body);
        }
      }
    } else if (typeof anyError.message === "string") {
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
