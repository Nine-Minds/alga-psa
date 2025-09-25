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
  HttpChallengeDetails,
} from '../workflows/portal-domains/types.js';

const TABLE_NAME = "portal_domains";
const MANAGED_LABEL = "portal.alga-psa.com/managed";
const TENANT_LABEL = "portal.alga-psa.com/tenant";
const DOMAIN_ID_LABEL = "portal.alga-psa.com/domain-id";
const DOMAIN_HOST_LABEL = "portal.alga-psa.com/domain-host";

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

const DEFAULT_CONFIG: PortalDomainConfig = {
  certificateNamespace: process.env.PORTAL_DOMAIN_CERT_NAMESPACE || "msp",
  certificateIssuerName:
    process.env.PORTAL_DOMAIN_CERT_ISSUER || "letsencrypt-http01",
  certificateIssuerKind:
    process.env.PORTAL_DOMAIN_CERT_ISSUER_KIND || "ClusterIssuer",
  certificateIssuerGroup:
    process.env.PORTAL_DOMAIN_CERT_ISSUER_GROUP || "cert-manager.io",
  gatewayNamespace:
    process.env.PORTAL_DOMAIN_GATEWAY_NAMESPACE || "istio-system",
  gatewaySelector: parseSelector(
    process.env.PORTAL_DOMAIN_GATEWAY_SELECTOR,
  ) || { istio: "ingressgateway" },
  gatewayHttpsPort: parseNumberEnv(
    process.env.PORTAL_DOMAIN_GATEWAY_HTTPS_PORT,
    443,
  ),
  virtualServiceNamespace: process.env.PORTAL_DOMAIN_VS_NAMESPACE || "msp",
  serviceHost:
    process.env.PORTAL_DOMAIN_SERVICE_HOST || "sebastian.msp.svc.cluster.local",
  servicePort: parseNumberEnv(process.env.PORTAL_DOMAIN_SERVICE_PORT, 3000),
  manifestOutputDirectory: process.env.PORTAL_DOMAIN_MANIFEST_DIR || null,
};

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

  const config = DEFAULT_CONFIG;
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
    desiredFiles.set(`${manifest.tenantSlug}.yaml`, manifest);
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

  try {
    await runGit(["add", "--all", gitConfig.relativePathPosix], gitConfig, {
      suppressOutput: true,
    });
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

  const config = DEFAULT_CONFIG;
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
      nextMessage = 'Certificate issued and Istio routing configured.';
    } else {
      nextStatus = 'deploying';
      nextMessage = 'Certificate issued; waiting for Istio routing resources to become available.';
    }
  } else {
    nextStatus = 'certificate_issuing';
    nextMessage =
      certificate.message ??
      `Waiting for cert-manager to issue certificate ${manifest.secretName}.`;
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
        message: 'Waiting for cert-manager to report readiness.',
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
      const failureMessage =
        normalizedMessage ??
        normalizedReason ??
        'Certificate issuance failed.';
      return { ready: false, failureMessage };
    }

    return {
      ready: false,
      message:
        normalizedMessage ??
        normalizedReason ??
        'Certificate issuance in progress.',
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        ready: false,
        message: 'Waiting for cert-manager to create certificate resource.',
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
  const gitEnv = { GIT_TERMINAL_PROMPT: "0" };

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
    env: { ...(options.env || {}), GIT_TERMINAL_PROMPT: "0" },
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

interface RenderedChallengeResources {
  gateway: Record<string, any>;
  virtualService: Record<string, any>;
  tenantSlug: string;
  gatewayName: string;
  virtualServiceName: string;
}

function renderChallengeManifestYaml(
  manifest: RenderedChallengeResources,
): string {
  const documents = [manifest.gateway, manifest.virtualService];
  return documents
    .map((doc, index) => {
      const yaml = dumpYaml(doc, { sortKeys: true, noRefs: true });
      return index === 0 ? yaml : `---\n${yaml}`;
    })
    .join("")
    .concat("\n");
}

export async function waitForHttpChallenge(args: {
  portalDomainId: string;
  timeoutSeconds?: number;
  pollIntervalSeconds?: number;
}): Promise<HttpChallengeDetails> {
  const record = await loadPortalDomain({ portalDomainId: args.portalDomainId });

  if (!record) {
    throw new Error(`Portal domain ${args.portalDomainId} not found while waiting for HTTP challenge.`);
  }

  const tenantSlug = createTenantSlug(record);
  const namespace = DEFAULT_CONFIG.virtualServiceNamespace;
  const prefix = `portal-domain-${tenantSlug}`;
  const timeoutSeconds = args.timeoutSeconds ?? 300;
  const pollIntervalSeconds = args.pollIntervalSeconds ?? 5;
  const attempts = Math.max(1, Math.ceil(timeoutSeconds / pollIntervalSeconds));

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const challenge = await findLatestChallenge(prefix, namespace);

    if (challenge) {
      const service = await findSolverService(challenge.metadata?.name, namespace);
      if (service) {
        const portEntry = Array.isArray(service?.spec?.ports)
          ? service.spec.ports.find((p: any) => typeof p?.port === "number") ?? service.spec.ports[0]
          : null;
        const servicePort = typeof portEntry?.port === "number"
          ? portEntry.port
          : typeof portEntry?.targetPort === "number"
            ? portEntry.targetPort
            : 80;

        const token = typeof challenge?.spec?.token === "string"
          ? challenge.spec.token
          : "";

        const key = typeof challenge?.spec?.key === "string"
          ? challenge.spec.key
          : "";

        return {
          challengeName: String(challenge.metadata?.name ?? ""),
          serviceName: String(service.metadata?.name ?? ""),
          servicePort,
          token,
          key,
        };
      }
    }

    if (attempt < attempts - 1) {
      await delay(pollIntervalSeconds * 1000);
    }
  }

  throw new Error(
    `Timed out waiting for cert-manager HTTP-01 challenge resources for ${record.domain}.`,
  );
}

export async function ensureHttpChallengeRoute(args: {
  portalDomainId: string;
  challenge: HttpChallengeDetails;
}): Promise<void> {
  const record = await loadPortalDomain({ portalDomainId: args.portalDomainId });

  if (!record) {
    throw new Error(`Portal domain ${args.portalDomainId} not found while ensuring HTTP challenge route.`);
  }

  const config = DEFAULT_CONFIG;
  const resources = renderPortalDomainChallengeResources(record, args.challenge, config);
  const yaml = renderChallengeManifestYaml(resources);
  const tempDir = await fs.mkdtemp(joinPath(os.tmpdir(), "portal-domain-challenge-"));
  const manifestPath = joinPath(tempDir, `${resources.tenantSlug}-challenge.yaml`);

  try {
    await fs.writeFile(manifestPath, yaml, "utf8");
    await runKubectl(["apply", "-f", manifestPath]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function removeHttpChallengeRoute(args: {
  portalDomainId: string;
}): Promise<void> {
  const record = await loadPortalDomain({ portalDomainId: args.portalDomainId });

  if (!record) {
    return;
  }

  const config = DEFAULT_CONFIG;
  const tenantSlug = createTenantSlug(record);
  const gatewayName = truncateName(`portal-domain-challenge-gw-${tenantSlug}`, 63);
  const virtualServiceName = truncateName(`portal-domain-challenge-vs-${tenantSlug}`, 63);

  await runKubectl([
    "delete",
    "virtualservice",
    virtualServiceName,
    "-n",
    config.virtualServiceNamespace,
    "--ignore-not-found",
  ]).catch(() => undefined);

  await runKubectl([
    "delete",
    "gateway",
    gatewayName,
    "-n",
    config.gatewayNamespace,
    "--ignore-not-found",
  ]).catch(() => undefined);
}

function buildCommitMessage(
  manifests: RenderedPortalDomainResources[],
): string {
  if (manifests.length === 0) {
    return "chore(portal-domains): sync empty state";
  }

  const slugs = Array.from(
    new Set(manifests.map((manifest) => manifest.tenantSlug)),
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

async function findLatestChallenge(
  prefix: string,
  namespace: string,
): Promise<any | null> {
  try {
    const { stdout } = await runKubectl([
      "get",
      "challenge",
      "-n",
      namespace,
      "-o",
      "json",
    ]);
    const parsed = JSON.parse(stdout);
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    const matches = items.filter((item: any) => {
      const name = item?.metadata?.name;
      return typeof name === "string" && name.startsWith(prefix);
    });

    if (matches.length === 0) {
      return null;
    }

    matches.sort((a: any, b: any) => {
      const aTime = Date.parse(a?.metadata?.creationTimestamp ?? "0");
      const bTime = Date.parse(b?.metadata?.creationTimestamp ?? "0");
      return bTime - aTime;
    });

    return matches[0];
  } catch (error) {
    return null;
  }
}

async function findSolverService(
  challengeName: string | undefined,
  namespace: string,
): Promise<any | null> {
  if (!challengeName) {
    return null;
  }

  try {
    const { stdout } = await runKubectl([
      "get",
      "service",
      "-n",
      namespace,
      "-o",
      "json",
    ]);
    const parsed = JSON.parse(stdout);
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return (
      items.find((item: any) => {
        const owners = Array.isArray(item?.metadata?.ownerReferences)
          ? item.metadata.ownerReferences
          : [];
        return owners.some(
          (owner: any) => owner?.kind === "Challenge" && owner?.name === challengeName,
        );
      }) ?? null
    );
  } catch (error) {
    return null;
  }
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

export function renderPortalDomainResources(
  record: PortalDomainActivityRecord,
  config: PortalDomainConfig,
): RenderedPortalDomainResources {
  const normalizedDomain = normalizeHostname(record.domain);
  const tenantSlug = createTenantSlug(record);
  const secretName = truncateName(`portal-domain-${tenantSlug}`, 63);
  const gatewayName = truncateName(`portal-domain-gw-${tenantSlug}`, 63);
  const virtualServiceName = truncateName(`portal-domain-vs-${tenantSlug}`, 63);
  const httpServerName = truncateName(`http-${tenantSlug}`, 63);
  const httpsServerName = truncateName(`https-${tenantSlug}`, 63);

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

  const primaryDestination = {
    destination: {
      host: config.serviceHost,
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
    tenantSlug,
    gatewayName,
    virtualServiceName,
  };
}

function renderPortalDomainChallengeResources(
  record: PortalDomainActivityRecord,
  challenge: HttpChallengeDetails,
  config: PortalDomainConfig,
): RenderedChallengeResources {
  const normalizedDomain = normalizeHostname(record.domain);
  const tenantSlug = createTenantSlug(record);
  const gatewayName = truncateName(`portal-domain-challenge-gw-${tenantSlug}`, 63);
  const virtualServiceName = truncateName(`portal-domain-challenge-vs-${tenantSlug}`, 63);

  const labels = buildBaseLabels(record, normalizedDomain);

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
      servers: [
        {
          port: {
            number: 80,
            name: truncateName(`http-${tenantSlug}-challenge`, 63),
            protocol: "HTTP",
          },
          hosts: [normalizedDomain],
        },
      ],
    },
  };

  const virtualService: Record<string, any> = {
    apiVersion: "networking.istio.io/v1beta1",
    kind: "VirtualService",
    metadata: {
      name: virtualServiceName,
      namespace: config.virtualServiceNamespace,
      labels,
    },
    spec: {
      hosts: [normalizedDomain],
      gateways: [`${config.gatewayNamespace}/${gatewayName}`],
      http: [
        {
          match: [
            {
              uri: { exact: `/.well-known/acme-challenge/${challenge.token}` },
            },
          ],
          directResponse: {
            status: 200,
            body: {
              string: challenge.key,
            },
          },
        },
      ],
    },
  };

  return {
    gateway,
    virtualService,
    tenantSlug,
    gatewayName,
    virtualServiceName,
  };
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

function createTenantSlug(record: PortalDomainActivityRecord): string {
  const canonical = normalizeHostname(record.canonical_host || "");
  const prefix = canonical.split(".")[0];
  if (prefix) {
    return sanitizeName(prefix);
  }
  const tenant = record.tenant || "";
  const sanitized = tenant.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (sanitized) {
    return sanitized.slice(0, 32);
  }
  return "tenant";
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
