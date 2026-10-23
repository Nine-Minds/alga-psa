import { getSecureJson, secureStorage, setSecureJson } from "../storage/secureStorage";

// Which server + account a device's Expo push token was last registered with.
// The registration is per (tenant, user, device) on the server, so a marker
// that only remembered the token let a device that had registered against one
// server (a cloud trial, say) silently skip registering with the next one.
export const PUSH_REGISTRATION_KEY = "alga.mobile.push.registration";
// Pre-scoped marker; cleared on first read so old installs re-register once.
export const LEGACY_PUSH_TOKEN_KEY = "alga.mobile.push.registeredToken";

export const PUSH_REGISTRATION_TTL_MS = 24 * 60 * 60 * 1000;

export type PushRegistrationContext = {
  token: string;
  baseUrl: string;
  tenantId: string | null;
  userId: string | null;
};

export type PushRegistrationRecord = PushRegistrationContext & { registeredAt: number };

export function isRegisteredFor(
  record: PushRegistrationRecord | null,
  ctx: Omit<PushRegistrationContext, "token"> & { token?: string },
): boolean {
  if (!record) return false;
  return (
    record.baseUrl === ctx.baseUrl &&
    record.tenantId === ctx.tenantId &&
    record.userId === ctx.userId &&
    (ctx.token === undefined || record.token === ctx.token)
  );
}

/** Re-register when the server, account, or token changed, or once a day so a
 *  server-side deactivation (a failed logout, a support reset) heals itself. */
export function shouldRegisterPushToken(
  record: PushRegistrationRecord | null,
  ctx: PushRegistrationContext,
  now: number = Date.now(),
): boolean {
  if (!isRegisteredFor(record, ctx)) return true;
  return now - (record as PushRegistrationRecord).registeredAt >= PUSH_REGISTRATION_TTL_MS;
}

export async function readPushRegistration(): Promise<PushRegistrationRecord | null> {
  const record = await getSecureJson<PushRegistrationRecord>(PUSH_REGISTRATION_KEY);
  if (record && typeof record === "object" && typeof record.token === "string" && typeof record.baseUrl === "string") {
    return record;
  }
  return null;
}

export async function writePushRegistration(ctx: PushRegistrationContext, now: number = Date.now()): Promise<void> {
  await setSecureJson(PUSH_REGISTRATION_KEY, { ...ctx, registeredAt: now } satisfies PushRegistrationRecord);
  await secureStorage.deleteItem(LEGACY_PUSH_TOKEN_KEY).catch(() => undefined);
}

export async function clearPushRegistration(): Promise<void> {
  await Promise.allSettled([
    secureStorage.deleteItem(PUSH_REGISTRATION_KEY),
    secureStorage.deleteItem(LEGACY_PUSH_TOKEN_KEY),
  ]);
}
