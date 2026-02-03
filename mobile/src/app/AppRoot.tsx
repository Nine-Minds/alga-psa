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
import { getSecureJson, setSecureJson } from "../storage/secureStorage";

function getActiveRouteName(state: any): string | null {
  let current: any = state;
  while (current && Array.isArray(current.routes) && typeof current.index === "number") {
    const route = current.routes[current.index];
    if (!route) return null;
    if (route.state) current = route.state;
    else return typeof route.name === "string" ? route.name : null;
  }
  return null;
}

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

      const stored = await getStoredSession();
      if (stored) {
        if (stored.expiresAtMs > Date.now()) {
          sessionRef.current = stored;
          if (!canceled) setSessionState(stored);
        } else {
          await clearStoredSession();
        }
      }

      if (stored && stored.expiresAtMs > Date.now()) {
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
    analytics.trackEvent("app.startup.ready", {
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
        analytics.trackEvent("auth.refresh.failed", {
          errorKind: result.error.kind,
          status: result.status ?? null,
        });
        if (
          result.error.kind === "auth" ||
          result.error.kind === "permission"
        ) {
          analytics.trackEvent("auth.refresh.revoked", { status: result.status });
          setSession(null);
        }
        return null;
      }

      analytics.trackEvent("auth.refresh.succeeded", { expiresInSec: result.data.expiresInSec });

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
      analytics.trackEvent("auth.refresh.failed", { errorKind: "exception" });
      return null;
    } finally {
      refreshInFlight.current = false;
    }
  }, [baseUrl, setSession]);

  useEffect(() => {
    if (!baseUrl || !session) return;

    const skewMs = 60_000;
    const msUntilRefresh = Math.max(0, session.expiresAtMs - Date.now() - skewMs);
    const handle = setTimeout(() => void refreshSession(), msUntilRefresh);
    return () => clearTimeout(handle);
  }, [baseUrl, refreshSession, session?.expiresAtMs, session?.refreshToken]);

  useEffect(() => {
    if (!session) return;
    const msUntilExpiry = Math.max(0, session.expiresAtMs - Date.now());
    const handle = setTimeout(() => setSession(null), msUntilExpiry + 500);
    return () => clearTimeout(handle);
  }, [session?.expiresAtMs, session?.refreshToken, setSession]);

  useAppResume(() => {
    if (!session) return;
    const skewMs = 120_000;
    if (session.expiresAtMs - Date.now() <= skewMs) {
      void refreshSession();
    }
  });

  useAppResume(() => {
    if (!session) return;
    const throttleMs = 10 * 60_000;
    const now = Date.now();
    if (now - lastRevocationCheckAtMs.current < throttleMs) return;
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
    analytics.trackEvent("auth.logout", { hadSession: Boolean(currentSession) });
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
          {network.isConnected === false ? <OfflineBanner onRetry={() => {}} /> : null}
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
  );
}
