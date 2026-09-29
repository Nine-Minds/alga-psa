import type {
  DiagnosticsRecommendation,
  DiagnosticsSeverity,
  EntraClientOutcomeCategory,
} from '@alga-psa/types';

export type EntraOAuthContext = 'partner' | 'customer';

export type EntraNetworkCause = 'dns' | 'tls' | 'timeout' | 'unreachable';

export interface EntraOAuthFailureInput {
  message?: string;
  httpStatus?: number;
  /** Graph code or transport/native error code. */
  code?: string;
  graphCode?: string;
  oauthError?: string;
  suberror?: string;
  aadstsCode?: string;
  responseBody?: unknown;
  context: EntraOAuthContext;
  customer?: {
    entraTenantId?: string | null;
    applicationClientId?: string | null;
    operation?: 'users' | 'groups' | 'membership' | 'token';
  };
}

export interface EntraOAuthClassification {
  aadstsCode: string | null;
  suberror: string | null;
  oauthError: string | null;
  graphCode: string | null;
  httpStatus: number | null;
  networkCause: EntraNetworkCause | null;
  category: EntraClientOutcomeCategory;
  severity: DiagnosticsSeverity;
  remedy: string;
  recommendation: DiagnosticsRecommendation | null;
}

const AADSTS_PATTERN = /AADSTS(\d{3,})/i;
const INVALID_CLIENT = 'invalid_client';
const INVALID_GRANT = 'invalid_grant';
const CONSENT_REQUIRED = 'consent_required';

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function fromBody(input: EntraOAuthFailureInput): {
  code?: string;
  message?: string;
  aadsts?: string;
  suberror?: string;
  oauthError?: string;
} {
  const body: any = input.responseBody;
  const err = body?.error || body;
  return {
    code: asString(err?.code),
    message: asString(err?.message),
    aadsts: asString(err?.innerError?.code) ?? asString(err?.aadstsCode),
    suberror: asString(err?.suberror),
    oauthError: asString(err?.error),
  };
}

export function extractOAuthCodes(input: EntraOAuthFailureInput): {
  aadstsCode: string | null;
  suberror: string | null;
  oauthError: string | null;
  graphCode: string | null;
} {
  const body = fromBody(input);
  const haystack = [input.message, body.message, body.code, body.aadsts]
    .filter(Boolean)
    .join(' ');
  const lower = haystack.toLowerCase();
  const aadstsMatch = haystack.match(AADSTS_PATTERN);
  const oauthFromMessage = lower.includes(INVALID_CLIENT)
    ? INVALID_CLIENT
    : lower.includes(INVALID_GRANT)
      ? INVALID_GRANT
      : lower.includes(CONSENT_REQUIRED)
        ? CONSENT_REQUIRED
        : null;
  const suberrorFromMessage = lower.includes(CONSENT_REQUIRED) ? CONSENT_REQUIRED : null;
  return {
    aadstsCode: input.aadstsCode ?? body.aadsts ?? (aadstsMatch ? `AADSTS${aadstsMatch[1]}` : null),
    suberror: input.suberror ?? body.suberror ?? suberrorFromMessage,
    oauthError: input.oauthError ?? body.oauthError ?? oauthFromMessage,
    graphCode: input.graphCode ?? input.code ?? body.code ?? null,
  };
}

function classifyNetwork(input: EntraOAuthFailureInput): EntraNetworkCause | null {
  const code = (input.code ?? '').toUpperCase();
  const message = (input.message ?? '').toLowerCase();
  if (code === 'ENOTFOUND' || message.includes('getaddrinfo') || message.includes('enotfound')) {
    return 'dns';
  }
  if (
    code === 'CERT_HAS_EXPIRED' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    message.includes('certificate') ||
    message.includes('tls')
  ) {
    return 'tls';
  }
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || message.includes('timeout')) {
    return 'timeout';
  }
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || message.includes('socket hang up')) {
    return 'unreachable';
  }
  return null;
}

export function buildCustomerConsentUrl(
  entraTenantId?: string | null,
  applicationClientId?: string | null
): string | null {
  const tid = asString(entraTenantId);
  const appId = asString(applicationClientId);
  if (!tid || !appId) return null;
  return `https://login.microsoftonline.com/${encodeURIComponent(tid)}/adminconsent?client_id=${encodeURIComponent(appId)}`;
}

function customerConsentRecommendation(
  input: EntraOAuthFailureInput,
  textCustomer: string
): DiagnosticsRecommendation {
  const url = buildCustomerConsentUrl(
    input.customer?.entraTenantId,
    input.customer?.applicationClientId
  );
  return {
    code: 'customer_consent_required',
    severity: 'fail',
    text: textCustomer,
    messageKey: 'customerConsentRequired',
    action: url ? { kind: 'open_url', payload: url } : undefined,
  };
}

function partnerRecommendation(
  code: string,
  severity: DiagnosticsSeverity,
  text: string,
  messageKey?: string
): DiagnosticsRecommendation {
  return { code, severity, text, messageKey: messageKey ?? code };
}

/**
 * Classify an OAuth/Graph/transport failure into an operator remedy. Specific
 * AADSTS/OAuth codes take precedence over generic HTTP status handling.
 *
 * Partner context describes the MSP app/connection; customer context describes
 * a managed tenant where reconnecting the partner will not help.
 */
export function classifyEntraOAuthFailure(
  input: EntraOAuthFailureInput
): EntraOAuthClassification {
  const codes = extractOAuthCodes(input);
  const networkCause = classifyNetwork(input);
  const isCustomer = input.context === 'customer';
  const status = input.httpStatus ?? null;
  const aadsts = codes.aadstsCode;
  const oauth = codes.oauthError;

  const base = {
    ...codes,
    httpStatus: status,
    networkCause,
  };

  // Specific AADSTS codes always win over a generic OAuth error such as
  // invalid_client. AADSTS700016 (app not found / single-tenant) plus
  // invalid_client must not be reported as a secret-rotation problem.
  if (aadsts === 'AADSTS7000222') {
    return {
      ...base,
      category: 'other',
      severity: 'fail',
      remedy: isCustomer
        ? 'The app credential was rejected in this customer tenant. Rotate the Microsoft app registration secret in Azure and update it in Alga.'
        : 'The app client secret expired or is wrong. Rotate the secret in Azure and update the app registration in Alga.',
      recommendation: partnerRecommendation(
        'client_secret_invalid',
        'fail',
        'Microsoft rejected the app credential (AADSTS7000222). Rotate the client secret in Azure, update the Microsoft app registration in Settings > Integrations > Microsoft, then reconnect.'
      ),
    };
  }

  if (aadsts === 'AADSTS700016') {
    return {
      ...base,
      category: 'other',
      severity: 'fail',
      remedy: isCustomer
        ? 'The bound app has no service principal in this customer tenant. Ensure it is multi-tenant and consented here.'
        : 'The app was not found or is single-tenant. Verify the bound client id and multi-tenant app configuration.',
      recommendation: partnerRecommendation(
        'app_not_found',
        'fail',
        'Microsoft could not find the application (AADSTS700016). Verify the bound client id and that the app is multi-tenant.'
      ),
    };
  }

  if (aadsts === 'AADSTS65001' || oauth === CONSENT_REQUIRED || codes.suberror === CONSENT_REQUIRED) {
    if (isCustomer) {
      return {
        ...base,
        category: 'need_consent',
        severity: 'fail',
        remedy:
          'The app is not consented in this customer tenant. Reconnecting the partner will not fix this; grant consent in the customer tenant using the consent link, then re-run.',
        recommendation: customerConsentRecommendation(
          input,
          'The app needs admin consent in this customer tenant. Reconnecting the partner will not help. Open the consent link and grant consent as the customer admin.'
        ),
      };
    }
    return {
      ...base,
      category: 'need_consent',
      severity: 'fail',
      remedy:
        'Grant partner-tenant admin consent for the app, then reconnect Microsoft Entra.',
      recommendation: partnerRecommendation(
        'partner_consent_required',
        'fail',
        'Partner-tenant admin consent is missing (AADSTS65001 / consent_required). Grant admin consent for the app in the partner tenant, then reconnect.'
      ),
    };
  }

  if (aadsts === 'AADSTS50076' || aadsts === 'AADSTS50079') {
    return {
      ...base,
      category: 'conditional_access',
      severity: 'fail',
      remedy: isCustomer
        ? 'This customer tenant requires MFA or a compliant device for the syncing account. Adjust Conditional Access or use an account that satisfies it.'
        : 'Conditional Access requires MFA for the connecting account. Use an account that can satisfy the policy or adjust Conditional Access.',
      recommendation: partnerRecommendation(
        'conditional_access',
        'fail',
        'Conditional Access blocked the request (AADSTS50076/AADSTS50079). The connecting account must satisfy MFA/compliant-device policy.'
      ),
    };
  }

  if (aadsts === 'AADSTS90002') {
    return {
      ...base,
      category: 'other',
      severity: 'fail',
      remedy: isCustomer
        ? 'The customer tenant id was not found. Verify the mapping points at the correct tenant.'
        : 'The tenant was not found. Verify the tenant configuration.',
      recommendation: partnerRecommendation(
        'tenant_not_found',
        'fail',
        'Microsoft could not resolve the tenant (AADSTS90002). Verify the tenant id in the connection or mapping.'
      ),
    };
  }

  if (aadsts === 'AADSTS50020') {
    return {
      ...base,
      category: 'other',
      severity: 'fail',
      remedy: isCustomer
        ? 'The connecting account is not a guest or allowed user in this customer tenant. Verify account access.'
        : 'The connecting account is not allowed in the tenant. Verify the account has access.',
      recommendation: partnerRecommendation(
        'account_not_allowed',
        'fail',
        'The connecting account is not allowed in the tenant (AADSTS50020). Verify the account has access or is a guest.'
      ),
    };
  }

  if (aadsts === 'AADSTS70000') {
    return {
      ...base,
      category: 'other',
      severity: 'fail',
      remedy: isCustomer
        ? 'The customer grant is expired or revoked. Re-run after reconnecting the partner; a more specific code takes precedence when present.'
        : 'The refresh token was revoked or expired. Reconnect Microsoft Entra.',
      recommendation: partnerRecommendation(
        'refresh_token_invalid',
        'fail',
        'The refresh grant is expired or revoked (AADSTS70000). Reconnect Microsoft Entra to issue a new refresh token.'
      ),
    };
  }

  // Generic OAuth errors, only after every specific AADSTS code has been ruled
  // out so that (for example) AADSTS700016 + invalid_client stays "app not
  // found" rather than becoming a secret-rotation remedy.
  if (oauth === INVALID_CLIENT) {
    return {
      ...base,
      category: 'other',
      severity: 'fail',
      remedy: isCustomer
        ? 'The app credential was rejected in this customer tenant. Rotate the Microsoft app registration secret in Azure and update it in Alga.'
        : 'The app client secret expired or is wrong. Rotate the secret in Azure and update the app registration in Alga.',
      recommendation: partnerRecommendation(
        'client_secret_invalid',
        'fail',
        'Microsoft rejected the app credential (invalid_client). Rotate the client secret in Azure, update the Microsoft app registration in Settings > Integrations > Microsoft, then reconnect.'
      ),
    };
  }

  if (oauth === INVALID_GRANT) {
    return {
      ...base,
      category: 'other',
      severity: 'fail',
      remedy: isCustomer
        ? 'The customer grant is expired or revoked. Re-run after reconnecting the partner; a more specific code takes precedence when present.'
        : 'The refresh token was revoked or expired. Reconnect Microsoft Entra.',
      recommendation: partnerRecommendation(
        'refresh_token_invalid',
        'fail',
        'The refresh grant is expired or revoked (invalid_grant). Reconnect Microsoft Entra to issue a new refresh token.'
      ),
    };
  }

  // Customer directory read denied although consent exists.
  if (status === 403 && isCustomer && (input.customer?.operation === 'users' || input.customer?.operation === 'groups')) {
    const op = input.customer?.operation;
    return {
      ...base,
      category: 'missing_role',
      severity: 'fail',
      remedy:
        'Consent exists but the delegated account lacks a directory-read role in this customer tenant (for example Directory Readers via GDAP). Check GDAP role assignments.',
      recommendation: partnerRecommendation(
        'customer_directory_role_missing',
        'fail',
        `Microsoft Graph denied the ${op} read (403). The delegated account needs a directory-read role in this customer tenant, typically assigned through GDAP (for example Directory Readers).`
      ),
    };
  }

  if (networkCause) {
    const label =
      networkCause === 'dns'
        ? 'DNS resolution'
        : networkCause === 'tls'
          ? 'TLS negotiation'
          : networkCause === 'timeout'
            ? 'a request timeout'
            : 'the endpoint being unreachable';
    return {
      ...base,
      category: 'other',
      severity: 'fail',
      remedy: `Microsoft Graph could not be reached (${label}). Verify outbound network access and DNS/TLS settings.`,
      recommendation: partnerRecommendation(
        'network_unreachable',
        'fail',
        `Microsoft Graph could not be reached because of ${label}. Check outbound connectivity, DNS, and TLS trust.`
      ),
    };
  }

  if (status === 401) {
    return {
      ...base,
      category: 'other',
      severity: 'fail',
      remedy: isCustomer
        ? 'The token was rejected in this customer tenant after refresh. Re-run diagnostics; if it persists, verify the mapping and consent.'
        : 'Microsoft rejected the token after refresh. Reconnect Microsoft Entra.',
      recommendation: partnerRecommendation(
        'token_rejected',
        'fail',
        'Microsoft rejected the token (401). Reconnect Microsoft Entra or verify the customer consent.'
      ),
    };
  }

  if (status === 403) {
    return {
      ...base,
      category: isCustomer ? 'missing_role' : 'other',
      severity: 'fail',
      remedy: isCustomer
        ? 'Graph returned 403. Check the delegated directory-role/GDAP assignment for the syncing account in this customer tenant.'
        : 'Microsoft Graph returned 403 (Forbidden). Verify delegated permissions and consent.',
      recommendation: partnerRecommendation(
        'forbidden',
        'fail',
        'Microsoft Graph returned 403 (Forbidden). Verify delegated permissions, consent, and role assignments.'
      ),
    };
  }

  return {
    ...base,
    category: 'other',
    severity: 'fail',
    remedy: isCustomer
      ? 'The customer-tenant request failed. Expand the step for the Microsoft error code and request id.'
      : 'The request failed. Expand the step for the Microsoft error code and request id.',
    recommendation: partnerRecommendation(
      'request_failed',
      'fail',
      'The Microsoft request failed. Expand the step for the error code and correlation id.'
    ),
  };
}
