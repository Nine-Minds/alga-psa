"use server";

import { randomBytes, createHmac } from "node:crypto";
import { auth } from "server/src/app/api/auth/[...nextauth]/auth";
import { authenticateUser } from "@alga-psa/auth/actions/auth";
import {
  MSP_SSO_RESOLUTION_COOKIE,
  MSP_SSO_RESOLUTION_TTL_SECONDS,
  createSignedMspSsoResolutionCookie,
  getMspSsoSigningSecret,
  hasAppFallbackProviderCredentials,
  hasTenantProviderCredentials,
  parseResolverProvider,
} from "@alga-psa/auth/lib/sso/mspSsoResolution";
import {
  CLIENT_PORTAL_SSO_DISCOVERY_COOKIE,
  CLIENT_PORTAL_SSO_RESOLUTION_COOKIE,
} from "@alga-psa/auth/lib/sso/clientPortalSsoResolution";
import { TIER_FEATURES } from "@alga-psa/types";
import { verifyAuthenticator } from "server/src/utils/authenticator/authenticator";
import logger from "@alga-psa/core/logger";
import { getNextAuthSecret } from "server/src/lib/auth/sessionCookies";
import { cookies } from "next/headers.js";
import { ensureSsoSettingsPermission } from "@ee/lib/actions/auth/ssoPermissions";
import { assertTierAccess } from "server/src/lib/tier-gating/assertTierAccess";

interface AuthorizeSsoLinkingInput {
  password: string;
  twoFactorCode?: string;
}

interface AuthorizeSsoLinkingResult {
  success: boolean;
  error?: string;
  nonce?: string;
  nonceIssuedAt?: number;
  nonceSignature?: string;
  requiresTwoFactor?: boolean;
}

interface LinkNoncePayload {
  nonce: string;
  userId: string;
}

interface PrepareSsoLinkResolutionResult {
  success: boolean;
  error?: string;
}

const LINK_TTL_SECONDS = 5 * 60; // 5 minutes
const LINK_TTL_MS = LINK_TTL_SECONDS * 1000;
const LINK_STATE_COOKIE = "sso-link-state";

async function signLinkNonce({ nonce, userId }: LinkNoncePayload): Promise<{ issuedAt: number; signature: string }> {
  const secret = await getNextAuthSecret();
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is required to sign SSO link state.");
  }

  const issuedAt = Date.now();
  const signature = createHmac("sha256", secret)
    .update(`${userId}:${nonce}:${issuedAt}`)
    .digest("hex");

  return { issuedAt, signature };
}

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// Keep a signed copy of the linking state server-side so the callback can recover it if the provider strips `state`.
async function persistLinkStateCookie(payload: { userId: string; nonce: string; issuedAt: number; signature: string }) {
  try {
    const store = await cookies();
    const rawJson = JSON.stringify(payload);
    const encoded = toBase64Url(rawJson);

    store.set({
      name: LINK_STATE_COOKIE,
      value: encoded,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: LINK_TTL_SECONDS,
    });
  } catch (error) {
    logger.warn("[connect-sso] failed to persist link state cookie", { error });
  }
}

// Self-service linking already knows the tenant from the session, so it selects the
// credential source directly instead of replaying the sign-in page's anonymous domain
// discovery (which needs a claimed login domain). Appliances configure Microsoft through
// the tenant provider profile only; without this cookie `getOAuthSecrets` never registers
// azure-ad and the redirect has no provider to start.
export async function prepareSsoLinkResolutionAction(
  providerId: string
): Promise<PrepareSsoLinkResolutionResult> {
  await assertTierAccess(TIER_FEATURES.SSO);

  const provider = parseResolverProvider(providerId);
  if (!provider) {
    return { success: false };
  }

  const session = await auth();
  if (!session?.user?.id) {
    return {
      success: false,
      error: "You must be signed in to link single sign-on providers.",
    };
  }

  const { user: currentUser, tenant } = await ensureSsoSettingsPermission();
  if (currentUser.user_id !== session.user.id) {
    logger.warn("[connect-sso] Session user mismatch while preparing SSO link", {
      sessionUserId: session.user.id,
      currentUserId: currentUser.user_id,
    });
    return {
      success: false,
      error: "Your session is out of date. Please sign in again.",
    };
  }

  const signingSecret = await getMspSsoSigningSecret();
  if (!signingSecret) {
    logger.warn("[connect-sso] NEXTAUTH_SECRET is not configured; cannot issue resolution cookie");
    return { success: false };
  }

  const tenantReady = Boolean(tenant) && (await hasTenantProviderCredentials(tenant, provider));
  const source = tenantReady
    ? "tenant"
    : (await hasAppFallbackProviderCredentials(provider))
      ? "app"
      : null;

  if (!source) {
    logger.info("[connect-sso] no available credential source for SSO linking", { provider });
    return { success: false };
  }

  const cookie = createSignedMspSsoResolutionCookie({
    provider,
    source,
    tenantId: source === "tenant" ? tenant : undefined,
    userId: currentUser.user_id.toString(),
    secret: signingSecret,
    ttlSeconds: MSP_SSO_RESOLUTION_TTL_SECONDS,
  });

  const store = await cookies();
  // A client-portal resolution outranks the MSP one in getOAuthSecrets, so drop any stale
  // portal handshake first, exactly as /api/auth/msp/sso/resolve does.
  for (const name of [CLIENT_PORTAL_SSO_DISCOVERY_COOKIE, CLIENT_PORTAL_SSO_RESOLUTION_COOKIE]) {
    store.set({
      name,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
  }
  store.set({
    name: MSP_SSO_RESOLUTION_COOKIE,
    value: cookie.value,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MSP_SSO_RESOLUTION_TTL_SECONDS,
  });

  return { success: true };
}

export async function authorizeSsoLinkingAction(
  input: AuthorizeSsoLinkingInput
): Promise<AuthorizeSsoLinkingResult> {
  await assertTierAccess(TIER_FEATURES.SSO);

  const session = await auth();

  if (!session?.user?.email || !session.user.id) {
    return {
      success: false,
      error: "You must be signed in to link single sign-on providers.",
    };
  }

  const { user: currentUser } = await ensureSsoSettingsPermission();

  if (currentUser.user_id !== session.user.id) {
    logger.warn("[connect-sso] Session user mismatch during SSO linking", {
      sessionUserId: session.user.id,
      currentUserId: currentUser.user_id,
    });
    return {
      success: false,
      error: "Your session is out of date. Please sign in again.",
    };
  }

  const password = input.password?.trim();
  if (!password) {
    return {
      success: false,
      error: "Password is required.",
    };
  }

  const tenantId =
    typeof session.user.tenant === "string" && session.user.tenant.length > 0
      ? session.user.tenant
      : undefined;

  const authenticatedUser = await authenticateUser(
    session.user.email,
    password,
    session.user.user_type,
    {
      tenantId,
      requireTenantMatch: Boolean(tenantId),
    }
  );

  if (!authenticatedUser) {
    return {
      success: false,
      error: "Invalid email or password.",
    };
  }

  if (authenticatedUser.two_factor_enabled) {
    if (!input.twoFactorCode || input.twoFactorCode.trim().length === 0) {
      return {
        success: false,
        error: "Two-factor authentication code is required.",
        requiresTwoFactor: true,
      };
    }

    if (!authenticatedUser.two_factor_secret) {
      logger.warn("[connect-sso] User has 2FA enabled but no secret stored.", {
        userId: authenticatedUser.user_id,
      });
      return {
        success: false,
        error: "Two-factor authentication is misconfigured for this account.",
        requiresTwoFactor: true,
      };
    }

    const isValidCode = verifyAuthenticator(
      input.twoFactorCode,
      authenticatedUser.two_factor_secret
    );

    if (!isValidCode) {
      return {
        success: false,
        error: "Invalid two-factor authentication code.",
        requiresTwoFactor: true,
      };
    }
  }

  const nonce = randomBytes(16).toString("hex");
  const userId = authenticatedUser.user_id.toString();
  const { issuedAt, signature } = await signLinkNonce({
    nonce,
    userId,
  });

  console.log("[connect-sso] issued link nonce", { userId, nonce, issuedAt });
  await persistLinkStateCookie({ userId, nonce, issuedAt, signature });

  return {
    success: true,
    nonce,
    nonceIssuedAt: issuedAt,
    nonceSignature: signature,
    requiresTwoFactor: Boolean(authenticatedUser.two_factor_enabled),
  };
}
