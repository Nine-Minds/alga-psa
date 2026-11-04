import { useMemo } from "react";
import { Platform } from "react-native";
import { createApiClient, type ApiClient } from "../../../api";
import { getAppConfig } from "../../../config/appConfig";
import { useAuth } from "../../../auth/AuthContext";

/**
 * `baseUrl` is the connected server's origin, the exact value the API client is
 * built with. Anything that needs to know "is this URL on my server" must use
 * it rather than re-reading app config.
 */
export function useInventoryApi(): { client: ApiClient | null; apiKey: string | null; baseUrl: string | null } {
  const { session, refreshSession } = useAuth();
  const apiKey = session?.accessToken ?? null;
  const tenantId = session?.tenantId;

  const { client, baseUrl } = useMemo(() => {
    const config = getAppConfig();
    if (!config.ok || !apiKey) return { client: null, baseUrl: null };
    const client = createApiClient({
      baseUrl: config.baseUrl,
      getAccessToken: () => apiKey,
      getTenantId: () => tenantId,
      getUserAgentTag: () => `mobile/${Platform.OS}/inventory`,
      onAuthError: refreshSession,
    });
    return { client, baseUrl: config.baseUrl };
  }, [apiKey, tenantId, refreshSession]);

  return { client, apiKey, baseUrl };
}
