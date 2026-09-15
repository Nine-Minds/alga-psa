import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { createApiClient } from "../api";
import { EMPTY_FEATURE_CAPABILITIES, getMyCapabilities, type FeatureCapabilities } from "../api/capabilities";
import { useAuth } from "../auth/AuthContext";
import { useAppResume } from "../hooks/useAppResume";
import { logger } from "../logging/logger";
import { TenantThemeBridge } from "../ui/TenantThemeBridge";
import { parseMobileTheme, type MobileTheme } from "../ui/themeTokens";

export type CapabilitiesContextValue = {
  features: FeatureCapabilities;
  /** Tenant theme pair from the server; null on older servers and after sign-out. */
  theme: MobileTheme | null;
  loaded: boolean;
  refresh: () => Promise<void>;
};

const CapabilitiesContext = createContext<CapabilitiesContextValue | null>(null);

export function useCapabilities(): CapabilitiesContextValue {
  const value = useContext(CapabilitiesContext);
  if (!value) throw new Error("useCapabilities must be used within a CapabilitiesProvider");
  return value;
}

export function CapabilitiesProvider({ children }: { children: ReactNode }) {
  const { session, refreshSession, baseUrl } = useAuth();
  const [features, setFeatures] = useState<FeatureCapabilities>(EMPTY_FEATURE_CAPABILITIES);
  const [theme, setTheme] = useState<MobileTheme | null>(null);
  const [loaded, setLoaded] = useState(false);
  const inFlight = useRef(false);
  const signedIn = Boolean(session?.accessToken);

  // Keyed on the session handle, not the token: a rotation must not refetch.
  const refresh = useCallback(async () => {
    const accessToken = session?.accessToken;
    if (!accessToken || !baseUrl || inFlight.current) return;
    inFlight.current = true;
    try {
      const client = createApiClient({
        baseUrl,
        getAccessToken: () => session?.accessToken,
        getTenantId: () => session?.tenantId,
        getUserAgentTag: () => `mobile/${Platform.OS}/capabilities`,
        onAuthError: refreshSession,
      });
      const result = await getMyCapabilities(client, { apiKey: accessToken });
      if (result.ok) {
        setFeatures({
          inventory: result.data.data?.features?.inventory === true,
          opportunities: result.data.data?.features?.opportunities === true,
          opportunitiesCreate: result.data.data?.features?.opportunitiesCreate === true,
        });
        // Older servers send no theme block; the app keeps the Alga pair.
        const themeBlock = result.data.data?.theme;
        const parsedTheme = parseMobileTheme(themeBlock);
        if (themeBlock && !parsedTheme) {
          logger.warn("capabilities.theme_rejected", { pairId: (themeBlock as { pairId?: unknown }).pairId });
        } else {
          logger.info("capabilities.theme", { pairId: parsedTheme?.pairId ?? null, version: parsedTheme?.version ?? null });
        }
        setTheme(parsedTheme);
      } else {
        // Older servers have no endpoint (404) — every feature stays off.
        // The theme is left alone: a flaky network should not repaint the app.
        setFeatures(EMPTY_FEATURE_CAPABILITIES);
        if (result.error.kind !== "http" && result.error.kind !== "network") {
          logger.warn("capabilities.fetch_failed", { kind: result.error.kind });
        }
      }
    } finally {
      inFlight.current = false;
      setLoaded(true);
    }
  }, [session, baseUrl, refreshSession]);

  useEffect(() => {
    if (!signedIn) {
      setFeatures(EMPTY_FEATURE_CAPABILITIES);
      setTheme(null);
      setLoaded(false);
      return;
    }
    void refresh();
  }, [signedIn, refresh]);

  useAppResume(
    useCallback(() => {
      if (signedIn) void refresh();
    }, [signedIn, refresh]),
  );

  const value = useMemo(
    () => ({ features, theme, loaded, refresh }),
    [features, theme, loaded, refresh],
  );

  return (
    <CapabilitiesContext.Provider value={value}>
      <TenantThemeBridge theme={theme} baseUrl={baseUrl} tenantId={session?.tenantId} />
      {children}
    </CapabilitiesContext.Provider>
  );
}
