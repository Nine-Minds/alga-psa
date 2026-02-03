export type HostedEnvironment = "dev" | "stage" | "prod";

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

function normalizeBaseUrl(raw: string): string | undefined {
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

export function getAppConfig(): AppConfig {
  const env = parseHostedEnvironment(process.env.EXPO_PUBLIC_ALGA_ENV) ?? "dev";
  const baseUrl = normalizeBaseUrl(process.env.EXPO_PUBLIC_ALGA_BASE_URL ?? "");

  if (!baseUrl) {
    return {
      ok: false,
      env,
      error:
        "Missing EXPO_PUBLIC_ALGA_BASE_URL. Copy mobile/.env.example to mobile/.env and set the hosted base URL.",
    };
  }

  return { ok: true, env, baseUrl };
}

