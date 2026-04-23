/**
 * expo-apple-authentication wrapper for Sign in with Apple.
 *
 * iOS-only. Android and web callers must gate on Platform.OS === 'ios' before
 * importing — the native module is not available elsewhere.
 *
 * Flow:
 *   1. signInWithApple() runs the native SIWA sheet.
 *   2. Caller POSTs identityToken (+ authorizationCode on first sign-in) to
 *      /api/v1/mobile/auth/apple.
 *   3. Server returns an OTT, which the existing AuthCallback handler
 *      exchanges for a mobile session.
 */
import { Platform } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";

export type AppleSignInResult = {
  identityToken: string;
  authorizationCode: string | null;
  fullName: {
    givenName: string | null;
    familyName: string | null;
  } | null;
  user: string;
  email: string | null;
};

export class AppleSignInCancelledError extends Error {
  constructor() {
    super("Apple sign-in cancelled");
    this.name = "AppleSignInCancelledError";
  }
}

export class AppleSignInUnavailableError extends Error {
  constructor() {
    super("Sign in with Apple is not available on this device");
    this.name = "AppleSignInUnavailableError";
  }
}

/**
 * Whether Sign in with Apple is available. False on Android, and on iOS
 * devices that don't support the native flow (< iOS 13, some configurations).
 */
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Run the native Sign in with Apple flow. Resolves with the identity token
 * and (on first sign-in) the authorization code. Rejects with
 * AppleSignInCancelledError if the user cancelled.
 */
export async function signInWithApple(): Promise<AppleSignInResult> {
  if (Platform.OS !== "ios") {
    throw new AppleSignInUnavailableError();
  }
  const available = await isAppleSignInAvailable();
  if (!available) {
    throw new AppleSignInUnavailableError();
  }

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (e: any) {
    // expo-apple-authentication throws with code "ERR_REQUEST_CANCELED" when
    // the user dismisses the sheet. Normalize to a specific error so callers
    // can treat cancellation as a no-op without surfacing an error toast.
    if (e?.code === "ERR_REQUEST_CANCELED") {
      throw new AppleSignInCancelledError();
    }
    throw e;
  }

  if (!credential.identityToken) {
    throw new Error("Apple credential missing identityToken");
  }

  return {
    identityToken: credential.identityToken,
    authorizationCode: credential.authorizationCode ?? null,
    fullName: credential.fullName
      ? {
          givenName: credential.fullName.givenName ?? null,
          familyName: credential.fullName.familyName ?? null,
        }
      : null,
    user: credential.user,
    email: credential.email ?? null,
  };
}
