"use client";

import { useEffect, useRef } from 'react';

/**
 * Cloudflare Turnstile challenge widget, rendered by the login forms once the
 * server signals CAPTCHA_REQUIRED. Tokens are single-use: bump `resetSignal`
 * after every failed sign-in attempt so the widget issues a fresh token.
 */

interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }
  if (window.turnstile) {
    return Promise.resolve();
  }
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error('Failed to load captcha script'));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

export interface CaptchaChallengeProps {
  siteKey: string;
  /** Receives the solved token, or '' when the token expires or errors out. */
  onToken: (token: string) => void;
  /** Increment to discard the current (single-use) token and issue a fresh one. */
  resetSignal?: number;
  id?: string;
}

export default function CaptchaChallenge({
  siteKey,
  onToken,
  resetSignal = 0,
  id = 'captcha-challenge',
}: CaptchaChallengeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) {
          return;
        }
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(''),
          'error-callback': () => onTokenRef.current(''),
        });
      })
      .catch(() => {
        onTokenRef.current('');
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Widget already gone; nothing to clean up.
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetSignal > 0 && widgetIdRef.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current);
      } catch {
        // Widget not resettable in its current state; the next render recreates it.
      }
      onTokenRef.current('');
    }
  }, [resetSignal]);

  return <div ref={containerRef} id={id} />;
}
