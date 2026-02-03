import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
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
import { refreshSession, revokeSession } from "../api/mobileAuth";
import { logger } from "../logging/logger";
import { clearPendingMobileAuth, clearReceivedOtt } from "../auth/mobileAuth";
import { getBiometricGateEnabled } from "../auth/biometricGate";
import { BiometricLockView } from "./BiometricLockView";

export function AppRoot() {
  const config = useMemo(() => getAppConfig(), []);
  const [bootStatus, setBootStatus] = useState<"booting" | "ready">("booting");
  const [session, setSessionState] = useState<MobileSession | null>(null);
  const [isBiometricLocked, setIsBiometricLocked] = useState(false);
  const network = useNetworkStatus();
  const refreshInFlight = useRef(false);

  const baseUrl = config.ok ? config.baseUrl : null;

  const setSession = useCallback(
    (next: MobileSession | null) => {
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

  const refreshNow = useCallback(async (): Promise<boolean> => {
    if (!baseUrl || !session) return false;
    if (refreshInFlight.current) return false;

    refreshInFlight.current = true;
    try {
      const client = createApiClient({
        baseUrl,
        getUserAgentTag: () => `mobile/${Platform.OS}`,
      });

      const result = await refreshSession(client, {
        refreshToken: session.refreshToken,
        device: { platform: Platform.OS },
      });

      if (!result.ok) {
        if (
          result.error.kind === "http" &&
          (result.status === 401 || result.status === 403)
        ) {
          setSession(null);
        }
        return false;
      }

      setSession({
        ...session,
        accessToken: result.data.accessToken,
        refreshToken: result.data.refreshToken,
        expiresAtMs: Date.now() + result.data.expiresInSec * 1000,
      });

      return true;
    } catch (e) {
      logger.warn("Refresh attempt failed", { error: e });
      return false;
    } finally {
      refreshInFlight.current = false;
    }
  }, [baseUrl, session, setSession]);

  useEffect(() => {
    if (!baseUrl || !session) return;

    const skewMs = 60_000;
    const msUntilRefresh = Math.max(0, session.expiresAtMs - Date.now() - skewMs);
    const handle = setTimeout(() => void refreshNow(), msUntilRefresh);
    return () => clearTimeout(handle);
  }, [baseUrl, refreshNow, session?.expiresAtMs, session?.refreshToken]);

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
      void refreshNow();
    }
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

  return (
    <AuthContext.Provider
      value={{
        session,
        setSession,
        logout,
      }}
    >
      {session && isBiometricLocked ? (
        <BiometricLockView onUnlocked={() => setIsBiometricLocked(false)} />
      ) : (
        <View style={{ flex: 1 }}>
          {network.isConnected === false ? <OfflineBanner onRetry={() => {}} /> : null}
          <View style={{ flex: 1 }}>
            <NavigationContainer key={session ? "signed-in" : "signed-out"} linking={linking}>
              <RootNavigator isSignedIn={session !== null} />
            </NavigationContainer>
          </View>
        </View>
      )}
    </AuthContext.Provider>
  );
}
