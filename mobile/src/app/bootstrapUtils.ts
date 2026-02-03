import type { MobileSession } from "../auth/AuthContext";

export function isSessionUsable(session: MobileSession, nowMs: number = Date.now()): boolean {
  return session.expiresAtMs > nowMs;
}

export function msUntilRefresh(expiresAtMs: number, nowMs: number, skewMs: number = 60_000): number {
  return Math.max(0, expiresAtMs - nowMs - skewMs);
}

export function msUntilExpiry(expiresAtMs: number, nowMs: number): number {
  return Math.max(0, expiresAtMs - nowMs);
}

export function shouldRefreshOnResume(expiresAtMs: number, nowMs: number, skewMs: number = 120_000): boolean {
  return expiresAtMs - nowMs <= skewMs;
}

export function shouldRunRevocationCheck(lastCheckedAtMs: number, nowMs: number, throttleMs: number = 10 * 60_000): boolean {
  return nowMs - lastCheckedAtMs >= throttleMs;
}

