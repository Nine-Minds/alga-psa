/**
 * Resolve the public base URL for inbound email webhook endpoints.
 *
 * Appliances supply a public callback origin separately from the worker's
 * internal APPLICATION_URL. Other deployments can use their application URL.
 */
export function getEmailWebhookBaseUrl(): string {
  const envApplicationUrl = process.env.NGROK_URL
    || process.env.PUBLIC_WEBHOOK_BASE_URL
    || process.env.APPLICATION_URL
    || process.env.NEXT_PUBLIC_BASE_URL
    || process.env.NEXTAUTH_URL;

  if (!envApplicationUrl) {
    return 'https://algapsa.com';
  }

  const withScheme = /^https?:\/\//i.test(envApplicationUrl)
    ? envApplicationUrl
    : `https://${envApplicationUrl}`;

  // Graph does not follow redirects during the subscription validation
  // handshake, and www.algapsa.com 301s to the apex, so a www value fails
  // every registration with 400 ValidationError and degrades the provider to
  // polling. Only normalize the host we own — a self-hosted www. domain may
  // legitimately be canonical.
  return withScheme
    .replace(/\/+$/, '')
    .replace(/^(https:\/\/)www\.algapsa\.com\b/i, '$1algapsa.com');
}
