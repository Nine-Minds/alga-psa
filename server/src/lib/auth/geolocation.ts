/**
 * Geolocation Service
 *
 * Provides IP-to-location lookup using free third-party APIs.
 * Supports multiple providers for failover:
 * 1. ipinfo.io (requires API token, 50k requests/month free)
 * 2. ip-api.com (45 requests/minute free, no token required)
 */

export interface LocationData {
  city?: string;
  country?: string;
  countryCode?: string;
  timezone?: string;
  latitude?: number;
  longitude?: number;
}

/**
 * Get approximate location from IP address
 * Options:
 * 1. ipinfo.io API (requires IPINFO_API_TOKEN env var, 50k requests/month free)
 * 2. ip-api.com (45 requests/minute free, no token required)
 */
export async function getLocationFromIp(ip: string): Promise<LocationData | null> {
  if (ip === 'unknown' || ip === '127.0.0.1' || ip === '::1') {
    return null;
  }

  try {
    const token = process.env.IPINFO_API_TOKEN;
    if (token) {
      const response = await fetch(`https://ipinfo.io/${ip}?token=${token}`);
      const data = await response.json();

      return {
        city: data.city,
        country: data.country,
        countryCode: data.country,
        timezone: data.timezone,
      };
    }

    const response = await fetch(`http://ip-api.com/json/${ip}`);
    const data = await response.json();

    if (data.status === 'success') {
      return {
        city: data.city,
        country: data.country,
        countryCode: data.countryCode,
        timezone: data.timezone,
        latitude: data.lat,
        longitude: data.lon,
      };
    }

    return null;
  } catch (error) {
    console.error('[geolocation] Failed to fetch location:', error);
    return null;
  }
}
