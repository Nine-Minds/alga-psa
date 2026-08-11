/**
 * Resolve the public base URL for inbound email webhook endpoints.
 *
 * APPLICATION_URL is the canonical variable in worker/background contexts
 * (see ee/temporal-workflows startupValidation); NEXTAUTH_URL covers the Next
 * server. Never falls back to localhost: Microsoft Graph rejects non-HTTPS
 * callback URLs, so a wrong-but-public default is safer than a dead one.
 */
export function getEmailWebhookBaseUrl(): string {
  const envApplicationUrl = process.env.APPLICATION_URL
    || process.env.NEXTAUTH_URL
    || process.env.NEXT_PUBLIC_BASE_URL;

  if (!envApplicationUrl) {
    return 'https://algapsa.com';
  }

  const withScheme = envApplicationUrl.startsWith('http://localhost') || envApplicationUrl.startsWith('https://')
    ? envApplicationUrl
    : `https://${envApplicationUrl}`;

  // Graph does not follow redirects during the subscription validation
  // handshake, and www.algapsa.com 301s to the apex, so a www value fails
  // every registration with 400 ValidationError and degrades the provider to
  // polling. Only normalize the host we own — a self-hosted www. domain may
  // legitimately be canonical.
  return withScheme
    .replace(/\/$/, '')
    .replace(/^(https:\/\/)www\.algapsa\.com\b/i, '$1algapsa.com');
}
