/**
 * IP Address Extraction Utilities
 *
 * Extracts client IP addresses from HTTP requests, handling various
 * proxy configurations (Cloudflare, nginx, etc.)
 */

/**
 * Extract client IP address from request headers
 * Handles various proxy configurations (Cloudflare, nginx, etc.)
 *
 * @param request - HTTP Request object
 * @returns Client IP address or 'unknown'
 */
export function getClientIp(request: Request): string {
  // Check X-Forwarded-For (most common proxy header)
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    // X-Forwarded-For can contain multiple IPs: "client, proxy1, proxy2"
    return forwarded.split(',')[0].trim();
  }

  // Check other common headers
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;

  // Cloudflare
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;

  // Fastly
  const fastlyIp = request.headers.get('fastly-client-ip');
  if (fastlyIp) return fastlyIp;

  return 'unknown';
}

/**
 * Validate IPv4 or IPv6 address
 *
 * @param ip - IP address string to validate
 * @returns true if valid IPv4 or IPv6, false otherwise
 */
export function isValidIp(ip: string): boolean {
  // IPv4 regex
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

  // IPv6 regex (simplified)
  const ipv6Regex = /^(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}$/i;

  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}
