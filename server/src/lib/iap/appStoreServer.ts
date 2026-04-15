/**
 * Apple App Store Server API client.
 *
 * - Outbound (app -> Apple): ES256 JWT signed with the .p8 key for looking up
 *   transactions, subscription status, and optionally requesting refunds /
 *   extending subscription renewal dates.
 *
 * - Inbound (Apple -> app): Verification of App Store Server Notifications v2
 *   signedPayload JWS, including x5c certificate chain validation against the
 *   Apple Root CA.
 *
 * Secrets / config expected (loaded via `getSecretProviderInstance`):
 *   - APPLE_IAP_KEY_ID       the .p8 key identifier from App Store Connect
 *   - APPLE_IAP_ISSUER_ID    your App Store Connect issuer UUID
 *   - APPLE_IAP_BUNDLE_ID    iOS bundle identifier (e.g. com.nineminds.algapsa)
 *   - APPLE_IAP_PRIVATE_KEY  full contents of the .p8 file (PEM)
 *   - APPLE_IAP_ENVIRONMENT  'production' | 'sandbox' (default: sandbox)
 *
 * Production root cert: Apple Root CA - G3. Set APPLE_ROOT_CA_PEM or
 * APPLE_ROOT_CA_PATH to enable full chain verification; otherwise chain
 * validation is skipped and the signature-only path is used (dev only).
 */
import crypto from 'crypto';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';

// ---------- Types ----------

export type AppleIapEnvironment = 'Production' | 'Sandbox';

export type AppleIapConfig = {
  keyId: string;
  issuerId: string;
  bundleId: string;
  privateKeyPem: string;
  environment: AppleIapEnvironment;
  rootCaPem: string | null;
};

export type JWSTransactionDecodedPayload = {
  transactionId: string;
  originalTransactionId: string;
  webOrderLineItemId?: string;
  bundleId: string;
  productId: string;
  subscriptionGroupIdentifier?: string;
  purchaseDate: number;
  originalPurchaseDate: number;
  expiresDate?: number;
  quantity: number;
  type: string; // 'Auto-Renewable Subscription' | etc.
  appAccountToken?: string;
  inAppOwnershipType: string;
  signedDate: number;
  environment: AppleIapEnvironment;
  transactionReason?: 'PURCHASE' | 'RENEWAL';
  storefront?: string;
  storefrontId?: string;
  price?: number;
  currency?: string;
  revocationDate?: number;
  revocationReason?: number;
};

export type JWSRenewalInfoDecodedPayload = {
  autoRenewProductId: string;
  autoRenewStatus: 0 | 1;
  environment: AppleIapEnvironment;
  expirationIntent?: number;
  gracePeriodExpiresDate?: number;
  isInBillingRetryPeriod?: boolean;
  originalTransactionId: string;
  productId: string;
  recentSubscriptionStartDate: number;
  renewalDate?: number;
  signedDate: number;
};

export type NotificationV2DecodedPayload = {
  notificationType: string;
  subtype?: string;
  notificationUUID: string;
  version: string;
  signedDate: number;
  data?: {
    appAppleId?: number;
    bundleId: string;
    bundleVersion?: string;
    environment: AppleIapEnvironment;
    signedTransactionInfo?: string; // nested JWS
    signedRenewalInfo?: string;      // nested JWS
    status?: number;
  };
};

// ---------- Config loading ----------

let cachedConfig: AppleIapConfig | null = null;

export async function getAppleIapConfig(): Promise<AppleIapConfig> {
  if (cachedConfig) return cachedConfig;

  const provider = await getSecretProviderInstance();

  const [keyId, issuerId, bundleId, privateKeyPem, envRaw] = await Promise.all([
    provider.getAppSecret('APPLE_IAP_KEY_ID'),
    provider.getAppSecret('APPLE_IAP_ISSUER_ID'),
    provider.getAppSecret('APPLE_IAP_BUNDLE_ID'),
    provider.getAppSecret('APPLE_IAP_PRIVATE_KEY'),
    provider.getAppSecret('APPLE_IAP_ENVIRONMENT'),
  ]);

  if (!keyId || !issuerId || !bundleId || !privateKeyPem) {
    throw new Error(
      'Apple IAP config missing. Set APPLE_IAP_KEY_ID, APPLE_IAP_ISSUER_ID, ' +
        'APPLE_IAP_BUNDLE_ID, and APPLE_IAP_PRIVATE_KEY.',
    );
  }

  const environment: AppleIapEnvironment =
    String(envRaw ?? '').toLowerCase() === 'production' ? 'Production' : 'Sandbox';

  const rootCaPem = await loadRootCa();

  cachedConfig = {
    keyId,
    issuerId,
    bundleId,
    privateKeyPem,
    environment,
    rootCaPem,
  };
  return cachedConfig;
}

async function loadRootCa(): Promise<string | null> {
  const provider = await getSecretProviderInstance();
  const inline = await provider.getAppSecret('APPLE_ROOT_CA_PEM').catch(() => null);
  if (inline) return inline;

  const path = process.env.APPLE_ROOT_CA_PATH;
  if (path && fs.existsSync(path)) {
    return fs.readFileSync(path, 'utf-8');
  }

  return null;
}

/** Test-only: clear cached config between tests. */
export function __resetAppleIapConfigForTests(): void {
  cachedConfig = null;
}

// ---------- Outbound: JWT for App Store Server API calls ----------

function buildBearerToken(config: AppleIapConfig): string {
  // Apple requires ES256, token TTL ≤ 1 hour. We generate a short-lived token
  // per request; caching is not worthwhile.
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: config.issuerId,
      iat: now,
      exp: now + 20 * 60,
      aud: 'appstoreconnect-v1',
      bid: config.bundleId,
    },
    config.privateKeyPem,
    {
      algorithm: 'ES256',
      header: {
        alg: 'ES256',
        kid: config.keyId,
        typ: 'JWT',
      },
    },
  );
}

function baseUrl(config: AppleIapConfig): string {
  return config.environment === 'Production'
    ? 'https://api.storekit.itunes.apple.com'
    : 'https://api.storekit-sandbox.itunes.apple.com';
}

type AppleFetchError = {
  status: number;
  errorCode?: number;
  errorMessage?: string;
};

async function appleFetch(
  config: AppleIapConfig,
  path: string,
): Promise<unknown> {
  const url = `${baseUrl(config)}${path}`;
  const token = buildBearerToken(config);

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    let body: any = undefined;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    const err: AppleFetchError = {
      status: res.status,
      errorCode: body?.errorCode,
      errorMessage: body?.errorMessage,
    };
    throw Object.assign(new Error(`Apple API ${res.status}: ${body?.errorMessage ?? res.statusText}`), err);
  }
  return res.json();
}

/**
 * Look up a single transaction by (original) transaction ID.
 * Returns the decoded transaction payload or null if not found.
 *
 * Note: Apple returns the transaction as a JWS string under `signedTransactionInfo`.
 * We decode and verify it here.
 */
export async function getTransactionInfo(
  transactionId: string,
  config?: AppleIapConfig,
): Promise<JWSTransactionDecodedPayload | null> {
  const cfg = config ?? (await getAppleIapConfig());
  try {
    const data = (await appleFetch(cfg, `/inApps/v1/transactions/${encodeURIComponent(transactionId)}`)) as {
      signedTransactionInfo: string;
    };
    return verifyTransactionJws(data.signedTransactionInfo, cfg);
  } catch (e: any) {
    if (e?.status === 404) return null;
    throw e;
  }
}

export type AllSubscriptionStatusesResponse = {
  data: Array<{
    subscriptionGroupIdentifier: string;
    lastTransactions: Array<{
      originalTransactionId: string;
      status: number; // 1=Active, 2=Expired, 3=InBillingRetry, 4=InGracePeriod, 5=Revoked
      signedTransactionInfo: string;
      signedRenewalInfo: string;
    }>;
  }>;
  bundleId: string;
  environment: AppleIapEnvironment;
};

/**
 * Get subscription statuses for every subscription associated with a given
 * original transaction ID. Used on restore and during webhook reconciliation.
 */
export async function getAllSubscriptionStatuses(
  originalTransactionId: string,
  config?: AppleIapConfig,
): Promise<AllSubscriptionStatusesResponse> {
  const cfg = config ?? (await getAppleIapConfig());
  return (await appleFetch(
    cfg,
    `/inApps/v1/subscriptions/${encodeURIComponent(originalTransactionId)}`,
  )) as AllSubscriptionStatusesResponse;
}

// ---------- Inbound: JWS verification ----------

function base64UrlDecode(segment: string): Buffer {
  return Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

type JwsHeader = {
  alg: string;
  x5c: string[]; // array of DER certs, base64 (NOT url) encoded
};

function parseJws(jws: string): { headerRaw: string; header: JwsHeader; payloadRaw: string; payload: any; signature: Buffer } {
  const parts = jws.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWS: expected 3 segments');
  const [headerRaw, payloadRaw, signatureRaw] = parts;

  const header = JSON.parse(base64UrlDecode(headerRaw).toString('utf-8')) as JwsHeader;
  const payload = JSON.parse(base64UrlDecode(payloadRaw).toString('utf-8'));
  const signature = base64UrlDecode(signatureRaw);

  return { headerRaw, header, payloadRaw, payload, signature };
}

function derCertToPem(derB64: string): string {
  const lines = derB64.match(/.{1,64}/g)?.join('\n') ?? derB64;
  return `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----\n`;
}

/**
 * Verify an Apple JWS:
 *  1. Parse header and extract x5c chain.
 *  2. If root CA is configured, verify the chain against it.
 *  3. Extract leaf public key, verify JWS signature with ES256.
 *  4. Return the decoded payload.
 *
 * If no root CA is configured, chain validation is skipped (signature-only
 * path). This is only acceptable in dev/sandbox and logs a loud warning.
 */
export function verifyJws<T = unknown>(jws: string, config: AppleIapConfig): T {
  const { header, headerRaw, payloadRaw, payload, signature } = parseJws(jws);

  if (header.alg !== 'ES256') {
    throw new Error(`Unexpected JWS alg: ${header.alg}`);
  }
  if (!Array.isArray(header.x5c) || header.x5c.length === 0) {
    throw new Error('JWS missing x5c certificate chain');
  }

  const leafPem = derCertToPem(header.x5c[0]);
  const leafCert = new crypto.X509Certificate(leafPem);

  if (config.rootCaPem) {
    verifyCertChain(header.x5c, config.rootCaPem);
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      '[appStoreServer] APPLE_ROOT_CA_PEM / APPLE_ROOT_CA_PATH not set — ' +
        'skipping x5c chain validation. DO NOT run this configuration in production.',
    );
  }

  const signingInput = `${headerRaw}.${payloadRaw}`;
  // Apple's JWS signatures are raw R||S (64 bytes), not DER. Node's verify
  // needs the DER form for ES256 unless we pass { dsaEncoding: 'ieee-p1363' }.
  const ok = crypto.verify(
    'SHA256',
    Buffer.from(signingInput),
    {
      key: leafCert.publicKey,
      dsaEncoding: 'ieee-p1363',
    },
    signature,
  );
  if (!ok) throw new Error('JWS signature verification failed');

  return payload as T;
}

function verifyCertChain(x5c: string[], rootCaPem: string): void {
  // Minimal chain verification: walk x5c leaf -> ... -> last, then verify the
  // last cert is issued by Apple Root CA. Each cert must be signed by the next.
  const certs = x5c.map((der) => new crypto.X509Certificate(derCertToPem(der)));
  const root = new crypto.X509Certificate(rootCaPem);

  for (let i = 0; i < certs.length - 1; i++) {
    const child = certs[i];
    const parent = certs[i + 1];
    if (!child.verify(parent.publicKey)) {
      throw new Error(`x5c chain broken at index ${i}`);
    }
  }
  const topCert = certs[certs.length - 1];
  if (!topCert.verify(root.publicKey)) {
    throw new Error('x5c chain does not chain to Apple Root CA');
  }
  const now = Date.now();
  for (const c of certs) {
    if (Date.parse(c.validFrom) > now || Date.parse(c.validTo) < now) {
      throw new Error('x5c chain contains expired or not-yet-valid certificate');
    }
  }
}

export function verifyTransactionJws(
  jws: string,
  config: AppleIapConfig,
): JWSTransactionDecodedPayload {
  const payload = verifyJws<JWSTransactionDecodedPayload>(jws, config);
  if (payload.bundleId !== config.bundleId) {
    throw new Error(`Transaction bundleId mismatch: ${payload.bundleId} vs ${config.bundleId}`);
  }
  return payload;
}

export function verifyRenewalInfoJws(
  jws: string,
  config: AppleIapConfig,
): JWSRenewalInfoDecodedPayload {
  return verifyJws<JWSRenewalInfoDecodedPayload>(jws, config);
}

export type VerifiedNotification = {
  notification: NotificationV2DecodedPayload;
  transaction: JWSTransactionDecodedPayload | null;
  renewalInfo: JWSRenewalInfoDecodedPayload | null;
};

/**
 * Verify an App Store Server Notification v2 signedPayload and decode any
 * nested signedTransactionInfo / signedRenewalInfo JWSes.
 */
export async function verifyNotificationPayload(
  signedPayload: string,
  config?: AppleIapConfig,
): Promise<VerifiedNotification> {
  const cfg = config ?? (await getAppleIapConfig());
  const notification = verifyJws<NotificationV2DecodedPayload>(signedPayload, cfg);

  if (notification.data?.bundleId && notification.data.bundleId !== cfg.bundleId) {
    throw new Error(`Notification bundleId mismatch: ${notification.data.bundleId}`);
  }

  const transaction = notification.data?.signedTransactionInfo
    ? verifyTransactionJws(notification.data.signedTransactionInfo, cfg)
    : null;

  const renewalInfo = notification.data?.signedRenewalInfo
    ? verifyRenewalInfoJws(notification.data.signedRenewalInfo, cfg)
    : null;

  return { notification, transaction, renewalInfo };
}
