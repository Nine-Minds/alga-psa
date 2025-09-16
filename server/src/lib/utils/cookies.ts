/**
 * Simple cookie utilities for client-side cookie management
 * using the browser's native document.cookie API
 */

export const clientCookies = {
  /**
   * Get a cookie value by name
   */
  get(name: string): string | undefined {
    if (typeof document === 'undefined') return undefined;

    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);

    if (parts.length === 2) {
      const cookieValue = parts.pop()?.split(';').shift();
      return cookieValue;
    }

    return undefined;
  },

  /**
   * Set a cookie with options
   */
  set(name: string, value: string, options?: {
    expires?: number; // days
    path?: string;
    domain?: string;
    secure?: boolean;
    sameSite?: 'strict' | 'lax' | 'none';
  }): void {
    if (typeof document === 'undefined') return;

    let cookieString = `${name}=${value}`;

    if (options?.expires) {
      const date = new Date();
      date.setTime(date.getTime() + (options.expires * 24 * 60 * 60 * 1000));
      cookieString += `; expires=${date.toUTCString()}`;
    }

    if (options?.path) {
      cookieString += `; path=${options.path}`;
    } else {
      cookieString += '; path=/'; // Default to root path
    }

    if (options?.domain) {
      cookieString += `; domain=${options.domain}`;
    }

    if (options?.secure) {
      cookieString += '; secure';
    }

    if (options?.sameSite) {
      cookieString += `; SameSite=${options.sameSite}`;
    }

    document.cookie = cookieString;
  },

  /**
   * Remove a cookie
   */
  remove(name: string, path?: string): void {
    if (typeof document === 'undefined') return;

    this.set(name, '', {
      expires: -1,
      path: path || '/'
    });
  }
};

/**
 * Get a preference value from cookies with localStorage fallback.
 * Automatically migrates localStorage values to cookies.
 *
 * @param key - The preference key
 * @param defaultValue - Default value if not found
 * @returns The preference value
 */
export function getPreferenceWithFallback(key: string, defaultValue: string = 'false'): string {
  // Try cookie first
  const cookieValue = clientCookies.get(key);
  if (cookieValue !== undefined) {
    return cookieValue;
  }

  // Fall back to localStorage
  if (typeof window !== 'undefined') {
    try {
      const localValue = localStorage.getItem(key);
      if (localValue !== null) {
        // Migrate to cookie
        clientCookies.set(key, localValue, {
          expires: 365,
          sameSite: 'lax',
          path: '/'
        });
        return localValue;
      }
    } catch (e) {
      console.error('Failed to read from localStorage:', e);
    }
  }

  return defaultValue;
}

/**
 * Save a preference to both cookie and localStorage.
 *
 * @param key - The preference key
 * @param value - The value to save
 */
export function savePreference(key: string, value: string): void {
  // Save to cookie
  clientCookies.set(key, value, {
    expires: 365,
    sameSite: 'lax',
    path: '/'
  });

  // Also save to localStorage for backup
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
    }
  }
}