import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import type { InitialState } from "@react-navigation/native";
import { getAppConfig } from "../config/appConfig";
import { linking } from "../navigation/linking";
import { RootNavigator } from "../navigation/RootNavigator";
import { ErrorState, LoadingState } from "../ui/states";
import { useNetworkStatus } from "../network/useNetworkStatus";
import { OfflineBanner } from "../ui/components/OfflineBanner";
import { AuthContext, type MobileSession } from "../auth/AuthContext";
import { clearStoredSession, getStoredSession, storeSession } from "../auth/sessionStorage";
import { useAppResume } from "../hooks/useAppResume";
import { createApiClient } from "../api";
import { refreshSession as refreshSessionApi, revokeSession } from "../api/mobileAuth";
import { logger } from "../logging/logger";
import { clearPendingMobileAuth, clearReceivedOtt } from "../auth/mobileAuth";
import { getBiometricGateEnabled } from "../auth/biometricGate";
import { BiometricLockView } from "./BiometricLockView";
import { analytics } from "../analytics/analytics";
import { MobileAnalyticsEvents } from "../analytics/events";
import { getSecureJson, setSecureJson } from "../storage/secureStorage";
import { ToastProvider } from "../ui/toast/ToastProvider";
import { isSessionUsable, msUntilExpiry, msUntilRefresh, shouldRefreshOnResume, shouldRunRevocationCheck } from "./bootstrapUtils";
import { isOffline as isOfflineStatus } from "../network/isOffline";
import { getActiveRouteName } from "../navigation/activeRoute";

export function AppRoot() {
  const config = useMemo(() => getAppConfig(), []);
  const [bootStatus, setBootStatus] = useState<"booting" | "ready">("booting");
  const [session, setSessionState] = useState<MobileSession | null>(null);
  const sessionRef = useRef<MobileSession | null>(null);
  const [isBiometricLocked, setIsBiometricLocked] = useState(false);
  const [navInitialState, setNavInitialState] = useState<InitialState | undefined>(undefined);
  const [navStateLoaded, setNavStateLoaded] = useState(false);
  const network = useNetworkStatus();
  const refreshInFlight = useRef(false);
  const navPersistHandle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startupStartedAt = useRef(Date.now());
  const startupReported = useRef(false);
  const lastRevocationCheckAtMs = useRef(0);

  const baseUrl = config.ok ? config.baseUrl : null;

  const setSession = useCallback(
    (next: MobileSession | null) => {
      sessionRef.current = next;
      setSessionState(next);
      if (!next) setIsBiometricLocked(false);
      void (next ? storeSession(next) : clearStoredSession());
    },
    [clearStoredSession, setSessionState, setIsBiometricLocked, storeSession],
  );

  useEffect(() => {
    let canceled = false;

    const run = async () => {
      if (!config.ok) {
        if (!canceled) setBootStatus("ready");
        return;
      }

      const nowMs = Date.now();
      const stored = await getStoredSession();
      if (stored) {
        if (isSessionUsable(stored, nowMs)) {
          sessionRef.current = stored;
          if (!canceled) setSessionState(stored);
        } else {
          await clearStoredSession();
        }
      }

      if (stored && isSessionUsable(stored, nowMs)) {
        const biometricEnabled = await getBiometricGateEnabled();
        if (biometricEnabled && !canceled) setIsBiometricLocked(true);
      }

      if (!canceled) setBootStatus("ready");
    };

    void run();
    return () => {
      canceled = true;
    };
  }, [config]);

  useEffect(() => {
    let canceled = false;
    const userId = session?.user?.id;

    if (navPersistHandle.current) {
      clearTimeout(navPersistHandle.current);
      navPersistHandle.current = null;
    }

    const run = async () => {
      if (!userId) {
        setNavInitialState(undefined);
        setNavStateLoaded(true);
        return;
      }

      setNavStateLoaded(false);
      const stored = await getSecureJson<InitialState>(`alga.mobile.navState.${userId}`);
      if (canceled) return;
      setNavInitialState(stored ?? undefined);
      setNavStateLoaded(true);
    };

    void run();
    return () => {
      canceled = true;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    if (startupReported.current) return;
    if (bootStatus !== "ready") return;
    if (!navStateLoaded) return;
    startupReported.current = true;
    analytics.trackEvent(MobileAnalyticsEvents.appStartupReady, {
      durationMs: Date.now() - startupStartedAt.current,
      signedIn: Boolean(session),
    });
  }, [bootStatus, navStateLoaded, session]);

  const refreshSession = useCallback(async (): Promise<string | null> => {
    const currentSession = sessionRef.current;
    if (!baseUrl || !currentSession) return null;
    if (refreshInFlight.current) return null;

    refreshInFlight.current = true;
    try {
      const client = createApiClient({
        baseUrl,
        getUserAgentTag: () => `mobile/${Platform.OS}`,
      });

      const result = await refreshSessionApi(client, {
        refreshToken: currentSession.refreshToken,
        device: { platform: Platform.OS },
      });

      if (!result.ok) {
        analytics.trackEvent(MobileAnalyticsEvents.authRefreshFailed, {
          errorKind: result.error.kind,
          status: result.status ?? null,
        });
        if (
          result.error.kind === "auth" ||
          result.error.kind === "permission"
        ) {
          analytics.trackEvent(MobileAnalyticsEvents.authRefreshRevoked, { status: result.status });
          setSession(null);
        }
        return null;
      }

      analytics.trackEvent(MobileAnalyticsEvents.authRefreshSucceeded, { expiresInSec: result.data.expiresInSec });

      const nextAccessToken = result.data.accessToken;
      const nextRefreshToken = result.data.refreshToken;
      const expiresAtMs = Date.now() + result.data.expiresInSec * 1000;

      const nextSession: MobileSession = {
        ...currentSession,
        accessToken: nextAccessToken,
        refreshToken: nextRefreshToken,
        expiresAtMs,
      };

      try {
        await storeSession(nextSession);
      } catch (e) {
        logger.error("Failed to persist refreshed session", { error: e });
        setSession(null);
        return null;
      }

      sessionRef.current = nextSession;
      setSessionState(nextSession);

      return nextAccessToken;
    } catch (e) {
      logger.warn("Refresh attempt failed", { error: e });
      analytics.trackEvent(MobileAnalyticsEvents.authRefreshFailed, { errorKind: "exception" });
      return null;
    } finally {
      refreshInFlight.current = false;
    }
  }, [baseUrl, setSession]);

  useEffect(() => {
    if (!baseUrl || !session) return;

    const handle = setTimeout(
      () => void refreshSession(),
      msUntilRefresh(session.expiresAtMs, Date.now()),
    );
    return () => clearTimeout(handle);
  }, [baseUrl, refreshSession, session?.expiresAtMs, session?.refreshToken]);

  useEffect(() => {
    if (!session) return;
    const handle = setTimeout(
      () => setSession(null),
      msUntilExpiry(session.expiresAtMs, Date.now()) + 500,
    );
    return () => clearTimeout(handle);
  }, [session?.expiresAtMs, session?.refreshToken, setSession]);

  useAppResume(() => {
    if (!session) return;
    if (shouldRefreshOnResume(session.expiresAtMs, Date.now())) {
      void refreshSession();
    }
  });

  useAppResume(() => {
    if (!session) return;
    const now = Date.now();
    if (!shouldRunRevocationCheck(lastRevocationCheckAtMs.current, now)) return;
    lastRevocationCheckAtMs.current = now;
    void refreshSession();
  });

  useAppResume(() => {
    if (!session) return;
    void (async () => {
      const biometricEnabled = await getBiometricGateEnabled();
      if (biometricEnabled) setIsBiometricLocked(true);
    })();
  });

  const logout = useCallback(async () => {
    const currentSession = session;
    analytics.trackEvent(MobileAnalyticsEvents.authLogout, { hadSession: Boolean(currentSession) });
    try {
      if (baseUrl && currentSession) {
        const client = createApiClient({
          baseUrl,
          getUserAgentTag: () => `mobile/${Platform.OS}`,
        });
        await revokeSession(client, { refreshToken: currentSession.refreshToken });
      }
    } catch (e) {
      logger.warn("Logout revoke failed", { error: e });
    } finally {
      await Promise.allSettled([clearPendingMobileAuth(), clearReceivedOtt()]);
      setSession(null);
    }
  }, [baseUrl, session, setSession]);

  if (!config.ok) {
    return (
      <ErrorState title="Configuration error" description={config.error} />
    );
  }

  if (bootStatus === "booting") {
    return <LoadingState message="Loading…" />;
  }

  if (!navStateLoaded) {
    return <LoadingState message="Restoring state…" />;
  }

  return (
    <ToastProvider>
      <AuthContext.Provider
        value={{
          session,
          setSession,
          refreshSession,
          logout,
        }}
      >
        {session && isBiometricLocked ? (
          <BiometricLockView onUnlocked={() => setIsBiometricLocked(false)} />
        ) : (
          <View style={{ flex: 1 }}>
            {isOfflineStatus(network) ? <OfflineBanner onRetry={() => {}} /> : null}
            <View style={{ flex: 1 }}>
              <NavigationContainer
                key={session ? "signed-in" : "signed-out"}
                linking={linking}
                initialState={session ? navInitialState : undefined}
                onStateChange={(state) => {
                  const userId = session?.user?.id;
                  if (!userId || !state) return;
                  const active = getActiveRouteName(state);
                  if (active === "SignIn" || active === "AuthCallback") return;
                  if (navPersistHandle.current) clearTimeout(navPersistHandle.current);
                  navPersistHandle.current = setTimeout(() => {
                    void setSecureJson(`alga.mobile.navState.${userId}`, state);
                  }, 500);
                }}
              >
                <RootNavigator isSignedIn={session !== null} />
              </NavigationContainer>
            </View>
          </View>
        )}
      </AuthContext.Provider>
    </ToastProvider>
  );
}
