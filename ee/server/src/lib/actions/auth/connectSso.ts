"use server";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { auth } from "server/src/app/api/auth/[...nextauth]/auth";
import { authenticateUser } from "server/src/lib/actions/auth";
import { verifyAuthenticator } from "server/src/utils/authenticator/authenticator";
import logger from "@alga-psa/shared/core/logger";

interface AuthorizeSsoLinkingInput {
  password: string;
  twoFactorCode?: string;
}

interface AuthorizeSsoLinkingResult {
  success: boolean;
  error?: string;
  nonce?: string;
  requiresTwoFactor?: boolean;
}

interface LinkNoncePayload {
  nonce: string;
  userId: string;
  exp: number;
}

const COOKIE_NAME = "sso-link-nonce";
const LINK_TTL_SECONDS = 5 * 60; // 5 minutes

function setLinkNonceCookie(payload: LinkNoncePayload): void {
  cookies().set(COOKIE_NAME, JSON.stringify(payload), {
    maxAge: LINK_TTL_SECONDS,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
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
  const payload: LinkNoncePayload = {
    nonce,
    userId: authenticatedUser.user_id.toString(),
    exp: Date.now() + LINK_TTL_SECONDS * 1000,
  };

  setLinkNonceCookie(payload);

  return {
    success: true,
    nonce,
    requiresTwoFactor: Boolean(authenticatedUser.two_factor_enabled),
  };
}
