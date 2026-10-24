/**
 * Operator-facing wording for the ways a CIPP API call can be refused that are
 * not a bad credential. Shared by the sync adapter and the connect probe so
 * the Connection tab and the run history say the same thing.
 *
 * Mirrored verbatim into packages/ee; keep it free of imports.
 */

/** The endpoints a Custom Role can block, as named in CIPP. */
export const CIPP_ROLE_CHECKED_ENDPOINTS = [
  'listtenants',
  'listusers',
  'listgroups',
  'listusergroups',
  'ListMailboxes',
] as const;

export type CippRefusalReason = 'ip-blocked' | 'role-blocked' | 'html-response';

/** `/api/ListUsers?tenantFilter=x` -> `listusers` (CIPP routes are case-insensitive). */
export function cippEndpointName(urlOrPath: string): string {
  const path = urlOrPath.split('?')[0].replace(/\/+$/, '');
  const name = path.split('/').pop() ?? '';
  return name;
}

export function cippIpBlockedMessage(): string {
  return 'CIPP refused the request with HTTP 403 for every endpoint, including listtenants. This usually means our egress IP is not in the API client\'s allowlist. In CIPP > Integrations > CIPP-API, add our egress IPs under Allowed IP Ranges.';
}

export function cippListTenantsForbiddenMessage(): string {
  return 'CIPP refused the tenant list (listtenants) with HTTP 403. This usually means our egress IP is not in the API client\'s allowlist: in CIPP > Integrations > CIPP-API, add our egress IPs under Allowed IP Ranges. If the allowlist is already open, the client\'s Custom Role may be blocking listtenants.';
}

export function cippRoleBlockedMessage(endpoint: string): string {
  const name = CIPP_ROLE_CHECKED_ENDPOINTS.find((e) => e.toLowerCase() === endpoint.toLowerCase()) ?? endpoint;
  return `CIPP refused ${name} with HTTP 403 while other endpoints work, so the API client's Custom Role is blocking it. In CIPP, give the role access to ${name}.`;
}

export function cippHtmlResponseMessage(): string {
  return 'CIPP answered with a web page instead of API data: the API URL is missing /api or points at the wrong host. Use the CIPP-API URL shown in CIPP > Integrations > CIPP-API (the host that serves /api), not the CIPP web UI address.';
}

export function cippApiClientRejectedMessage(): string {
  return 'CIPP rejected a freshly issued access token for this API client. In CIPP > Integrations > CIPP-API, confirm the client is enabled and its Role allows API access, then reconnect from the Connection tab.';
}

/**
 * Why a request never got an HTTP answer. Read from the Node/axios error code
 * so the operator learns whether to fix the host name, the port/firewall, or
 * the network path, instead of a bare "request failed".
 */
export type CippTransportCause = 'dns' | 'refused' | 'timeout' | 'tls' | 'network';

export function classifyCippTransportError(code: unknown): CippTransportCause {
  const value = typeof code === 'string' ? code.toUpperCase() : '';
  if (value === 'ENOTFOUND' || value === 'EAI_AGAIN' || value === 'EAI_NONAME') return 'dns';
  if (value === 'ECONNREFUSED') return 'refused';
  if (value === 'ECONNABORTED' || value === 'ETIMEDOUT' || value === 'ESOCKETTIMEDOUT') return 'timeout';
  if (
    value.startsWith('CERT_')
    || value.startsWith('ERR_TLS')
    || value.includes('SELF_SIGNED')
    || value === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
    || value === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'
  ) {
    return 'tls';
  }
  return 'network';
}

export function cippUnreachableMessage(host: string, cause: CippTransportCause): string {
  switch (cause) {
    case 'dns':
      return `Could not reach CIPP at ${host}: the host name does not resolve (DNS). Check the API URL for typos; copy it from CIPP > Integrations > CIPP-API.`;
    case 'refused':
      return `Could not reach CIPP at ${host}: the connection was refused. The host exists but nothing is accepting connections on that port. Check the API URL and that the CIPP-API function app is running.`;
    case 'timeout':
      return `Could not reach CIPP at ${host}: the request timed out. The host may be down, or a firewall may be dropping our traffic. Check the API URL and try again.`;
    case 'tls':
      return `Could not reach CIPP at ${host}: the TLS certificate was not accepted. Use the https CIPP-API URL shown in CIPP > Integrations > CIPP-API.`;
    default:
      return `Could not reach CIPP at ${host}: the network request failed before CIPP answered. Check the API URL and try again.`;
  }
}

/** Whether an HTTP body is HTML (a web UI or proxy page), not API JSON. */
export function looksLikeHtml(contentType: unknown, body: unknown): boolean {
  if (typeof contentType === 'string' && /text\/html/i.test(contentType)) {
    return true;
  }
  if (typeof body === 'string') {
    return /^\s*(<!doctype\s+html|<html[\s>])/i.test(body);
  }
  return false;
}
