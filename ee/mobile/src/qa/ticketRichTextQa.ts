import type { MobileSession } from "../auth/AuthContext";

export type TicketRichTextQaScenario = "richtext-smoke" | "malformed-guard";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  if (typeof atob === "function") {
    return atob(padded);
  }

  const maybeBuffer = (globalThis as typeof globalThis & {
    Buffer?: {
      from: (input: string, encoding: string) => { toString: (outputEncoding: string) => string };
    };
  }).Buffer;

  if (maybeBuffer) {
    return maybeBuffer.from(padded, "base64").toString("utf8");
  }

  throw new Error("No base64 decoder available");
}

function isMobileSession(value: unknown): value is MobileSession {
  if (!isObject(value)) return false;
  if (typeof value.accessToken !== "string" || value.accessToken.length === 0) return false;
  if (typeof value.refreshToken !== "string" || value.refreshToken.length === 0) return false;
  if (typeof value.expiresAtMs !== "number" || !Number.isFinite(value.expiresAtMs)) return false;
  if ("tenantId" in value && value.tenantId !== undefined && value.tenantId !== null && typeof value.tenantId !== "string") {
    return false;
  }

  if ("user" in value && value.user !== undefined) {
    if (!isObject(value.user)) return false;
    if (typeof value.user.id !== "string" || value.user.id.length === 0) return false;
    if ("email" in value.user && value.user.email !== undefined && typeof value.user.email !== "string") return false;
    if ("name" in value.user && value.user.name !== undefined && typeof value.user.name !== "string") return false;
  }

  return true;
}

export function isDevQaEnabled(): boolean {
  return __DEV__;
}

export function parseTicketRichTextQaScenario(value: string | undefined): TicketRichTextQaScenario | null {
  if (!isDevQaEnabled()) return null;
  if (value === "richtext-smoke" || value === "malformed-guard") return value;
  return null;
}

export function decodeQaSession(value: string | undefined): MobileSession | null {
  if (!isDevQaEnabled() || !value) return null;

  try {
    const decoded = JSON.parse(decodeBase64Url(value)) as unknown;
    return isMobileSession(decoded) ? decoded : null;
  } catch {
    return null;
  }
}
