/**
 * Pure helpers for the CIPP connect dialog: URL normalization, the
 * tested-credential fingerprint, and failure classification. Kept out of the
 * component so the rules that decide whether Save is enabled can be tested
 * without rendering anything.
 */

export type CippConnectShape = 'api_client' | 'legacy';

/**
 * CIPP shows the API URL ending in `/api`; older guidance (and the server)
 * work with the host alone. Accept either, with or without a scheme, and
 * reduce to the host form so what is shown, tested and saved are one value.
 * Returns '' for empty input and the trimmed input when it is not a URL, so
 * the field never silently rewrites something unparseable.
 */
export function normalizeCippApiUrl(input: string): string {
  const raw = input.trim();
  if (!raw) return '';
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return raw;
    const pathname = parsed.pathname.replace(/\/+$/, '').replace(/\/api$/i, '');
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return raw;
  }
}

/** The form CIPP itself displays: the host plus `/api`. */
export function displayCippApiUrl(input: string): string {
  const normalized = normalizeCippApiUrl(input);
  if (!normalized) return '';
  return /^https?:\/\//i.test(normalized) ? `${normalized}/api` : normalized;
}

export type CippFormValues = {
  shape: CippConnectShape;
  apiUrl: string;
  clientId: string;
  clientSecret: string;
  tenantId: string;
  baseUrl: string;
  apiToken: string;
};

/**
 * Everything a test proves, as one comparable string: every field of the
 * active shape, normalized the way it is sent. Save is allowed only while the
 * current form fingerprints identically to the form that last passed a test.
 */
export function cippTestFingerprint(values: CippFormValues): string {
  if (values.shape === 'api_client') {
    return JSON.stringify([
      'api_client',
      normalizeCippApiUrl(values.apiUrl),
      values.clientId.trim(),
      values.clientSecret.trim(),
      values.tenantId.trim(),
    ]);
  }
  return JSON.stringify([
    'legacy',
    normalizeCippApiUrl(values.baseUrl),
    values.apiToken.trim(),
  ]);
}

export function isCippFormComplete(values: CippFormValues): boolean {
  if (values.shape === 'api_client') {
    return Boolean(
      normalizeCippApiUrl(values.apiUrl)
      && values.clientId.trim()
      && values.clientSecret.trim()
      && values.tenantId.trim()
    );
  }
  return Boolean(normalizeCippApiUrl(values.baseUrl) && values.apiToken.trim());
}

/** Credential input for the server actions; mirrors EntraCippCredentialInput. */
export function buildCippCredentialInput(values: CippFormValues) {
  if (values.shape === 'api_client') {
    return {
      authType: 'api_client' as const,
      apiUrl: normalizeCippApiUrl(values.apiUrl),
      clientId: values.clientId.trim(),
      clientSecret: values.clientSecret.trim(),
      tenantId: values.tenantId.trim(),
    };
  }
  return {
    baseUrl: normalizeCippApiUrl(values.baseUrl),
    apiToken: values.apiToken.trim(),
  };
}

export type CippFailureKind =
  | 'unreachable'
  | 'tokenRejected'
  | 'apiRefused'
  | 'legacyRejected';

/**
 * Map the probe's classification onto the three operator-facing situations.
 * The remedy itself is the server's message (card 1 owns that wording); this
 * only chooses the localized heading above it.
 */
export function classifyCippFailure(
  shape: CippConnectShape,
  code: string | undefined
): CippFailureKind | null {
  switch (code) {
    case 'html_response':
    case 'validation_failed':
      return 'unreachable';
    case 'token_mint_failed':
    case 'token_scope_rejected':
      return 'tokenRejected';
    case 'ip_blocked':
      return 'apiRefused';
    case 'auth_rejected':
      return shape === 'api_client' ? 'apiRefused' : 'legacyRejected';
    default:
      return null;
  }
}
