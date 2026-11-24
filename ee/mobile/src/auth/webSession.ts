import * as WebBrowser from "expo-web-browser";
import { logger } from "../logging/logger";
import { buildWebSignOutUrl, getSignedOutRedirectUri } from "./mobileAuth";

type Opener = (url: string, redirectUrl: string) => Promise<unknown>;

/**
 * Signing in goes through the system auth browser, which keeps the web session
 * cookie after the app has thrown its own token away. Logout therefore also
 * opens the web sign-out in that same browser so the next sign-in starts from
 * the login form instead of silently returning the previous user.
 *
 * Best effort: a failure here must never block the local logout.
 */
export async function clearWebSignInSession(
  baseUrl: string,
  opener: Opener = (url, redirectUrl) => WebBrowser.openAuthSessionAsync(url, redirectUrl),
): Promise<void> {
  try {
    const redirectUri = getSignedOutRedirectUri();
    await opener(buildWebSignOutUrl({ baseUrl, redirectUri }), redirectUri);
  } catch (e) {
    logger.warn("Web sign-out failed", { error: e });
  }
}
