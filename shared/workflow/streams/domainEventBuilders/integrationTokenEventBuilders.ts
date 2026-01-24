const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_TOKEN_EXPIRING_WINDOW_DAYS = 7;

export function computeDaysUntilExpiry(params: { expiresAt: string; now: string }): number {
  const expiresAtMs = Date.parse(params.expiresAt);
  const nowMs = Date.parse(params.now);

  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs)) {
    return 0;
  }

  return Math.max(0, Math.ceil((expiresAtMs - nowMs) / DAY_MS));
}

export function getIntegrationTokenExpiringStatus(params: {
  expiresAt: string;
  now: string;
  windowDays?: number;
  minimumRemainingMs?: number;
}): { shouldNotify: boolean; daysUntilExpiry: number } {
  const expiresAtMs = Date.parse(params.expiresAt);
  const nowMs = Date.parse(params.now);

  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs)) {
    return { shouldNotify: false, daysUntilExpiry: 0 };
  }

  const remainingMs = expiresAtMs - nowMs;
  if (remainingMs <= 0) {
    return { shouldNotify: false, daysUntilExpiry: 0 };
  }

  const minimumRemainingMs = params.minimumRemainingMs ?? DAY_MS;
  if (remainingMs < minimumRemainingMs) {
    return { shouldNotify: false, daysUntilExpiry: computeDaysUntilExpiry(params) };
  }

  const windowDays = params.windowDays ?? DEFAULT_TOKEN_EXPIRING_WINDOW_DAYS;
  const daysUntilExpiry = computeDaysUntilExpiry(params);

  return { shouldNotify: daysUntilExpiry <= windowDays, daysUntilExpiry };
}

export function buildIntegrationTokenExpiringPayload(params: {
  integrationId: string;
  provider: string;
  connectionId: string;
  expiresAt: string;
  daysUntilExpiry: number;
  notifiedAt?: string;
}) {
  return {
    integrationId: params.integrationId,
    provider: params.provider,
    connectionId: params.connectionId,
    expiresAt: params.expiresAt,
    daysUntilExpiry: params.daysUntilExpiry,
    notifiedAt: params.notifiedAt,
  };
}

export function buildIntegrationTokenRefreshFailedPayload(params: {
  integrationId: string;
  provider: string;
  connectionId: string;
  failedAt?: string;
  errorCode?: string;
  errorMessage: string;
  retryable?: boolean;
}) {
  return {
    integrationId: params.integrationId,
    provider: params.provider,
    connectionId: params.connectionId,
    failedAt: params.failedAt,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
    retryable: params.retryable,
  };
}

