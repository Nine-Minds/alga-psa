import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { createApiClient } from "../api";
import {
  EMPTY_FEATURE_CAPABILITIES,
  getMyCapabilities,
  type DateFormatCapability,
  type FeatureCapabilities,
} from "../api/capabilities";
import {
  getDateTimeLocale,
  setDateTimeLocale,
  SYSTEM_DATE_FORMAT,
  type DateTimeFormatShape,
} from "../ui/formatters/dateTime";
import { useAuth } from "../auth/AuthContext";
import { useAppResume } from "../hooks/useAppResume";
import { logger } from "../logging/logger";

export type CapabilitiesContextValue = {
  features: FeatureCapabilities;
  loaded: boolean;
  refresh: () => Promise<void>;
};

const CapabilitiesContext = createContext<CapabilitiesContextValue | null>(null);

/**
 * Hand the server's resolved shape to the date formatters.
 *
 * Anything missing or malformed — an older server with no `formatting` field,
 * a failed fetch — applies the fixed system default rather than the device
 * locale, which is the coupling this replaces.
 */
function applyServerDateFormat(formatting?: DateFormatCapability | null): void {
  const shape: DateTimeFormatShape | null =
    formatting && Array.isArray(formatting.order) && formatting.order.length === 3
      ? {
          order: formatting.order,
          separator: typeof formatting.separator === "string" ? formatting.separator : "/",
          hour12: formatting.hour12 !== false,
        }
      : null;

  setDateTimeLocale(getDateTimeLocale(), shape ?? SYSTEM_DATE_FORMAT);
}

export function useCapabilities(): CapabilitiesContextValue {
  const value = useContext(CapabilitiesContext);
  if (!value) throw new Error("useCapabilities must be used within a CapabilitiesProvider");
  return value;
}

export function CapabilitiesProvider({ children }: { children: ReactNode }) {
  const { session, refreshSession, baseUrl } = useAuth();
  const [features, setFeatures] = useState<FeatureCapabilities>(EMPTY_FEATURE_CAPABILITIES);
  const [loaded, setLoaded] = useState(false);
  const inFlight = useRef(false);
  const accessToken = session?.accessToken ?? null;
  const tenantId = session?.tenantId;

  const refresh = useCallback(async () => {
    if (!accessToken || !baseUrl || inFlight.current) return;
    inFlight.current = true;
    try {
      const client = createApiClient({
        baseUrl,
        getAccessToken: () => accessToken ?? undefined,
        getTenantId: () => tenantId,
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
        applyServerDateFormat(result.data.data?.formatting);
      } else {
        // Older servers have no endpoint (404) — every feature stays off.
        setFeatures(EMPTY_FEATURE_CAPABILITIES);
        applyServerDateFormat(null);
        if (result.error.kind !== "http" && result.error.kind !== "network") {
          logger.warn("capabilities.fetch_failed", { kind: result.error.kind });
        }
      }
    } finally {
      inFlight.current = false;
      setLoaded(true);
    }
  }, [accessToken, baseUrl, tenantId, refreshSession]);

  useEffect(() => {
    if (!accessToken) {
      setFeatures(EMPTY_FEATURE_CAPABILITIES);
      applyServerDateFormat(null);
      setLoaded(false);
      return;
    }
    void refresh();
  }, [accessToken, refresh]);

  useAppResume(
    useCallback(() => {
      if (accessToken) void refresh();
    }, [accessToken, refresh]),
  );

  const value = useMemo(() => ({ features, loaded, refresh }), [features, loaded, refresh]);

  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
}
