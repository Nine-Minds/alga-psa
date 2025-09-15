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
      cookieString += `; samesite=${options.sameSite}`;
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