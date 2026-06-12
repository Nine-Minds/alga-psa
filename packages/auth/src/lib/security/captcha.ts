import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';

/**
 * Cloudflare Turnstile integration for the progressive login captcha.
 *
 * Configuration comes from the app secret provider (names `captcha_site_key` /
 * `captcha_secret_key`) with CAPTCHA_SITE_KEY / CAPTCHA_SECRET_KEY environment
 * variables as fallback. When neither is configured the captcha is simply off and
 * login protection degrades to rate limiting alone.
 */

const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SITEVERIFY_TIMEOUT_MS = 10_000;

export interface CaptchaPublicConfig {
  provider: 'turnstile';
  /** The widget site key. Public by design; safe to send to browsers. */
  siteKey: string;
}

async function readConfigValue(secretName: string, envName: string): Promise<string | undefined> {
  try {
    const secretProvider = await getSecretProviderInstance();
    const value = await secretProvider.getAppSecret(secretName);
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  } catch (error) {
    logger.warn('[captcha] Failed to read captcha configuration from secret provider', {
      secretName,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const envValue = process.env[envName];
  return envValue && envValue.trim().length > 0 ? envValue.trim() : undefined;
}

/**
 * The browser-safe captcha configuration, or null when captcha is not configured.
 * Requires BOTH keys: a site key without a verifiable secret would render challenges
 * that the server could never validate.
 */
export async function getCaptchaPublicConfig(): Promise<CaptchaPublicConfig | null> {
  const [siteKey, secretKey] = await Promise.all([
    readConfigValue('captcha_site_key', 'CAPTCHA_SITE_KEY'),
    readConfigValue('captcha_secret_key', 'CAPTCHA_SECRET_KEY'),
  ]);

  if (!siteKey || !secretKey) {
    return null;
  }

  return { provider: 'turnstile', siteKey };
}

export async function isCaptchaConfigured(): Promise<boolean> {
  return (await getCaptchaPublicConfig()) !== null;
}

/**
 * Verify a Turnstile response token against Cloudflare's siteverify endpoint.
 * Fails closed: any transport error, timeout, or malformed response counts as
 * unverified, since an unverifiable challenge must not admit a throttled attacker.
 */
export async function verifyCaptchaToken(token: string, remoteIp?: string): Promise<boolean> {
  const secretKey = await readConfigValue('captcha_secret_key', 'CAPTCHA_SECRET_KEY');
  if (!secretKey || !token || token.trim().length === 0) {
    return false;
  }

  try {
    const body = new URLSearchParams({
      secret: secretKey,
      response: token.trim(),
    });
    if (remoteIp && remoteIp !== 'unknown') {
      body.set('remoteip', remoteIp);
    }

    const response = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn('[captcha] siteverify returned non-OK status', { status: response.status });
      return false;
    }

    const outcome = (await response.json()) as { success?: boolean; 'error-codes'?: string[] };
    if (outcome.success !== true) {
      logger.info('[captcha] Captcha token rejected', { errorCodes: outcome['error-codes'] ?? [] });
      return false;
    }
    return true;
  } catch (error) {
    logger.error('[captcha] siteverify request failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
