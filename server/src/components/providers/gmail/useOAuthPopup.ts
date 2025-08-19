/**
 * Shared OAuth popup hook for Gmail provider forms (CE and EE)
 * Handles opening the OAuth window, listening for callback, success/error state,
 * and optional auto-submit countdown.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type OAuthStatus = "idle" | "authorizing" | "success" | "error";

export interface UseOAuthPopupOptions {
  provider: string; // e.g., 'google'
  countdownSeconds?: number; // default 10
}

interface OpenOAuthHandlers<T = any> {
  onAfterSuccess?: (data: T) => void;
  onAutoSubmit: (data: T) => void;
  onError?: (message: string) => void;
}

export function useOAuthPopup<T = any>(options: UseOAuthPopupOptions) {
  const { provider, countdownSeconds = 10 } = options;

  const [oauthStatus, setOauthStatus] = useState<OAuthStatus>("idle");
  // Track latest status in a ref to avoid stale closures inside intervals
  const oauthStatusRef = useRef<OAuthStatus>("idle");
  const [oauthData, setOauthData] = useState<T | null>(null);
  const [autoSubmitCountdown, setAutoSubmitCountdown] = useState<number | null>(null);

  const countdownIntervalRef = useRef<number | null>(null);
  const popupCheckIntervalRef = useRef<number | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    oauthStatusRef.current = oauthStatus;
  }, [oauthStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) {
        window.clearInterval(countdownIntervalRef.current);
      }
      if (popupCheckIntervalRef.current) {
        window.clearInterval(popupCheckIntervalRef.current);
      }
    };
  }, []);

  const cancelAutoSubmit = useCallback(() => {
    if (countdownIntervalRef.current) {
      window.clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setAutoSubmitCountdown(null);
  }, []);

  const openOAuthPopup = useCallback(
    (authUrl: string, handlers: OpenOAuthHandlers<T>) => {
      try {
        setOauthStatus("authorizing");

        const popup = window.open(
          authUrl,
          `${provider}-oauth`,
          "width=600,height=700,scrollbars=yes,resizable=yes"
        );

        if (!popup) {
          setOauthStatus("error");
          handlers.onError?.("Failed to open OAuth popup. Please allow popups for this site.");
          return;
        }

        // Monitor popup for premature close
        popupCheckIntervalRef.current = window.setInterval(() => {
          if (popup.closed) {
            if (popupCheckIntervalRef.current) {
              window.clearInterval(popupCheckIntervalRef.current);
              popupCheckIntervalRef.current = null;
            }
            // Use ref to avoid stale state from closure
            if (oauthStatusRef.current === "authorizing") {
              setOauthStatus("idle");
              handlers.onError?.("Authorization window was closed before completing.");
            }
          }
        }, 1000);

        const messageHandler = (event: MessageEvent) => {
          // Validate message originates from our OAuth callback
          if (
            event?.data?.type === "oauth-callback" &&
            event?.data?.provider === provider
          ) {
            if (popupCheckIntervalRef.current) {
              window.clearInterval(popupCheckIntervalRef.current);
              popupCheckIntervalRef.current = null;
            }
            popup?.close();

            if (event.data.success) {
              const data = event.data.data as T;
              setOauthData(data);
              setOauthStatus("success");
              handlers.onAfterSuccess?.(data);

              // If countdownSeconds <= 0, submit immediately to avoid user confusion
              if (!countdownSeconds || countdownSeconds <= 0) {
                handlers.onAutoSubmit(data);
              } else {
                // Begin countdown
                setAutoSubmitCountdown(countdownSeconds);
                if (countdownIntervalRef.current) {
                  window.clearInterval(countdownIntervalRef.current);
                }
                countdownIntervalRef.current = window.setInterval(() => {
                  setAutoSubmitCountdown((prev) => {
                    if (prev === null || prev <= 1) {
                      if (countdownIntervalRef.current) {
                        window.clearInterval(countdownIntervalRef.current);
                        countdownIntervalRef.current = null;
                      }
                      handlers.onAutoSubmit(data);
                      return null;
                    }
                    return prev - 1;
                  });
                }, 1000);
              }
            } else {
              setOauthStatus("error");
              const message =
                event.data.errorDescription ||
                event.data.error ||
                "Authorization failed";
              handlers.onError?.(message);
            }

            window.removeEventListener("message", messageHandler);
          }
        };

        window.addEventListener("message", messageHandler);
      } catch (err: any) {
        setOauthStatus("error");
        handlers.onError?.(err?.message || "OAuth popup failed");
      }
    },
    [provider, countdownSeconds]
  );

  return {
    oauthStatus,
    oauthData,
    autoSubmitCountdown,
    openOAuthPopup,
    cancelAutoSubmit,
    setOauthStatus, // exposed in case caller needs to reset to idle
  } as const;
}
