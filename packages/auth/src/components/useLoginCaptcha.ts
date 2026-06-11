"use client";

import { useCallback, useState } from 'react';

/**
 * Login-form state for the progressive captcha. The widget site key is fetched
 * lazily from /api/auth/captcha-config the first time the server answers a
 * sign-in attempt with CAPTCHA_REQUIRED; when no captcha is configured the
 * endpoint returns null and the form never renders a challenge.
 */

export interface LoginCaptchaConfig {
  provider: string;
  siteKey: string;
}

export function useLoginCaptcha() {
  const [config, setConfig] = useState<LoginCaptchaConfig | null>(null);
  const [required, setRequired] = useState(false);
  const [token, setToken] = useState('');
  const [resetSignal, setResetSignal] = useState(0);

  const ensureConfigLoaded = useCallback(async (): Promise<LoginCaptchaConfig | null> => {
    if (config) {
      return config;
    }
    try {
      const response = await fetch('/api/auth/captcha-config', { credentials: 'include' });
      if (!response.ok) {
        return null;
      }
      const data = (await response.json()) as { captcha?: LoginCaptchaConfig | null };
      const loaded = data?.captcha ?? null;
      setConfig(loaded);
      return loaded;
    } catch {
      return null;
    }
  }, [config]);

  /** Call when the server answered CAPTCHA_REQUIRED: show the widget, demand a fresh token. */
  const requireCaptcha = useCallback(async () => {
    await ensureConfigLoaded();
    setRequired(true);
    setToken('');
    setResetSignal((n) => n + 1);
  }, [ensureConfigLoaded]);

  /** Call after any failed attempt while the widget is visible — tokens are single-use. */
  const refreshChallenge = useCallback(() => {
    setToken('');
    setResetSignal((n) => n + 1);
  }, []);

  return { config, required, token, setToken, resetSignal, requireCaptcha, refreshChallenge };
}
