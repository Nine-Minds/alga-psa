/**
 * Next's dev-only origin check does not consider 127.0.0.1 equivalent to the
 * machine hostname. Keep local loopback available when a dev server is opened
 * through its usual IPv4 URL, even when HOSTNAME names the machine instead.
 */
export function getAllowedDevOrigins(configured = process.env.DEV_ALLOWED_ORIGINS) {
  const configuredOrigins = String(configured ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return [...new Set(['127.0.0.1', ...configuredOrigins])];
}
