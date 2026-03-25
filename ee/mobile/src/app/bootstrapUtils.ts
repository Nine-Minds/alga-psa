import type { MobileSession } from "../auth/AuthContext";

export function isSessionUsable(session: MobileSession, nowMs: number = Date.now()): boolean {
  // A session is usable as long as the refresh token exists, even if the
  // access token has expired — the app will attempt a refresh on resume.
  // Previously this checked only access token expiry, which caused
  // cold-start logouts when the 15-min access token had expired overnight
  // despite the 30-day refresh token still being valid.
  return Boolean(session.refreshToken);
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

