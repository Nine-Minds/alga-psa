"use server";

import { randomBytes, createHmac } from "node:crypto";
import { auth } from "server/src/app/api/auth/[...nextauth]/auth";
import { authenticateUser } from "server/src/lib/actions/auth";
import { verifyAuthenticator } from "server/src/utils/authenticator/authenticator";
import logger from "@alga-psa/core/logger";
import { getNextAuthSecret } from "server/src/lib/auth/sessionCookies";
import { cookies } from "next/headers";
import { ensureSsoSettingsPermission } from "@ee/lib/actions/auth/ssoPermissions";

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

export async function authorizeSsoLinkingAction(
  input: AuthorizeSsoLinkingInput
): Promise<AuthorizeSsoLinkingResult> {
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
