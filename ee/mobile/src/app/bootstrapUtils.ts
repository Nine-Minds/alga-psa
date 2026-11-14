import type { MobileSession } from "../auth/AuthContext";

export function isSessionUsable(session: MobileSession): boolean {
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

/**
 * A persisted route is replayed on relaunch, but not after a sign-in: that
 * session opens on the drawer's initial route (Home) instead of wherever the
 * previous one stopped. A pending deep link skips it too — React Navigation
 * ignores links when an initial state is supplied.
 */
export function skipRestoredNavState(options: { freshSignIn: boolean; pendingDeepLink: boolean }): boolean {
  return options.freshSignIn || options.pendingDeepLink;
}

