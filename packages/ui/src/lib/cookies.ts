/**
 * Simple cookie utilities for client-side cookie management
 * using the browser's native document.cookie API
 */

export const clientCookies = {
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

  set(
    name: string,
    value: string,
    options?: {
      expires?: number; // days
      path?: string;
      domain?: string;
      secure?: boolean;
      sameSite?: 'strict' | 'lax' | 'none';
    }
  ): void {
    if (typeof document === 'undefined') return;

    let cookieString = `${name}=${value}`;

    if (options?.expires) {
      const date = new Date();
      date.setTime(date.getTime() + options.expires * 24 * 60 * 60 * 1000);
      cookieString += `; expires=${date.toUTCString()}`;
    }

    if (options?.path) {
      cookieString += `; path=${options.path}`;
    } else {
      cookieString += '; path=/';
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

  remove(name: string, path?: string): void {
    if (typeof document === 'undefined') return;

    this.set(name, '', {
      expires: -1,
      path: path || '/',
    });
  },
};

export function getPreferenceWithFallback(
  key: string,
  defaultValue: string = 'false'
): string {
  const cookieValue = clientCookies.get(key);
  if (cookieValue !== undefined) {
    return cookieValue;
  }

  if (typeof window !== 'undefined') {
    try {
      const localValue = localStorage.getItem(key);
      if (localValue !== null) {
        clientCookies.set(key, localValue, {
          expires: 365,
          sameSite: 'lax',
          path: '/',
        });
        return localValue;
      }
    } catch (e) {
      console.error('Failed to read from localStorage:', e);
    }
  }

  return defaultValue;
}

export function savePreference(key: string, value: string): void {
  clientCookies.set(key, value, {
    expires: 365,
    sameSite: 'lax',
    path: '/',
  });

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
    }
  }
}

