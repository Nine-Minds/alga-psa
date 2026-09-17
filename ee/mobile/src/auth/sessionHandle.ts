import type { MutableRefObject } from "react";
import type { MobileSession } from "./AuthContext";

const LIVE_FIELDS = ["accessToken", "refreshToken", "expiresAtMs", "tenantId", "user"] as const;

/** Identity of a session as the data layer sees it: same account on the same tenant. */
export function sessionIdentityKey(session: MobileSession | null): string | null {
  if (!session) return null;
  return `${session.tenantId ?? ""}:${session.user?.id ?? ""}`;
}

/**
 * A session object whose fields always read the latest stored session but
 * whose identity survives token rotation. Screens memoise API clients and
 * fetch effects on `session`; with a fresh object per refresh every rotation
 * rebuilt the clients and re-ran every fetch, doubling the launch burst.
 */
export function createSessionHandle(ref: MutableRefObject<MobileSession | null>): MobileSession {
  const handle = {} as MobileSession;
  for (const field of LIVE_FIELDS) {
    Object.defineProperty(handle, field, {
      enumerable: true,
      get: () => ref.current?.[field],
    });
  }
  return handle;
}
