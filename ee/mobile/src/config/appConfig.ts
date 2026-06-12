export type HostedEnvironment = "dev" | "stage" | "prod";

export const DEFAULT_BASE_URL = "https://algapsa.com";

export type AppConfig =
  | {
      ok: true;
      env: HostedEnvironment;
      baseUrl: string;
    }
  | {
      ok: false;
      env?: HostedEnvironment;
      error: string;
    };

const HOSTED_ENVS: readonly HostedEnvironment[] = ["dev", "stage", "prod"];

function parseHostedEnvironment(raw: unknown): HostedEnvironment | undefined {
  if (typeof raw !== "string") return undefined;
  const normalized = raw.trim().toLowerCase();
  return HOSTED_ENVS.includes(normalized as HostedEnvironment)
    ? (normalized as HostedEnvironment)
    : undefined;
}

export function normalizeBaseUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function buildOverrideBaseUrl(): string | undefined {
  const raw = process.env.EXPO_PUBLIC_ALGA_BASE_URL;
  return raw ? normalizeBaseUrl(raw) : undefined;
}

// Resolved host, hydrated at boot from the persisted custom host.
let activeBaseUrl: string | null = null;

export function resolveBaseUrl(storedHost: string | null): string {
  return (
    buildOverrideBaseUrl() ??
    (storedHost ? normalizeBaseUrl(storedHost) : undefined) ??
    DEFAULT_BASE_URL
  );
}

export function hydrateAppConfig(storedHost: string | null): void {
  activeBaseUrl = resolveBaseUrl(storedHost);
}

export function setActiveBaseUrl(url: string | null): void {
  activeBaseUrl = resolveBaseUrl(url);
}

export function getAppConfig(): AppConfig {
  const env = parseHostedEnvironment(process.env.EXPO_PUBLIC_ALGA_ENV) ?? "dev";
  return { ok: true, env, baseUrl: activeBaseUrl ?? resolveBaseUrl(null) };
}

export function isHostLocked(): boolean {
  return Boolean(buildOverrideBaseUrl());
}

export function isDefaultHost(baseUrl: string | null): boolean {
  if (!baseUrl) return false;
  try {
    return (
      new URL(baseUrl).hostname.toLowerCase() ===
      new URL(DEFAULT_BASE_URL).hostname.toLowerCase()
    );
  } catch {
    return false;
  }
}
