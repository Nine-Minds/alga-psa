import { useMemo } from "react";
import { Platform } from "react-native";
import { createApiClient, type ApiClient } from "../../../api";
import { getAppConfig } from "../../../config/appConfig";
import { useAuth } from "../../../auth/AuthContext";

export function useInventoryApi(): { client: ApiClient | null; apiKey: string | null } {
  const { session, refreshSession } = useAuth();
  const apiKey = session?.accessToken ?? null;
  const tenantId = session?.tenantId;

  const client = useMemo(() => {
    const config = getAppConfig();
    if (!config.ok || !apiKey) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getAccessToken: () => apiKey,
      getTenantId: () => tenantId,
      getUserAgentTag: () => `mobile/${Platform.OS}/inventory`,
      onAuthError: refreshSession,
    });
  }, [apiKey, tenantId, refreshSession]);

  return { client, apiKey };
}
