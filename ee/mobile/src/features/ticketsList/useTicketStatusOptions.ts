import { useEffect, useState } from "react";
import type { ApiClient } from "../../api";
import { getTicketStatuses, type TicketStatus } from "../../api/tickets";
import { getCachedTicketStatuses, setCachedTicketStatuses } from "../../cache/referenceDataCache";

/** Board-owned ticket statuses for the tenant, cached; shared by the list and its filter sheet. */
export function useTicketStatusOptions({
  client,
  apiKey,
  tenantId,
  enabled = true,
  errorMessage,
}: {
  client: ApiClient | null;
  apiKey: string | null | undefined;
  tenantId: string | null | undefined;
  enabled?: boolean;
  errorMessage: string;
}) {
  const [statusOptions, setStatusOptions] = useState<TicketStatus[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !client || !apiKey || loaded) return;
    let canceled = false;
    const cacheKey = tenantId ?? "unknownTenant";
    const cached = getCachedTicketStatuses(cacheKey);
    if (Array.isArray(cached) && cached.length > 0) {
      setStatusOptions(cached as TicketStatus[]);
      setLoaded(true);
      return;
    }
    setLoading(true);
    setError(null);
    void (async () => {
      const res = await getTicketStatuses(client, { apiKey });
      if (canceled) return;
      setLoading(false);
      if (!res.ok) {
        setError(errorMessage);
        // Loaded stays false so a later mount retries; the list must not wait forever on it.
        setLoaded(true);
        return;
      }
      setStatusOptions(res.data.data);
      setCachedTicketStatuses(cacheKey, res.data.data);
      setLoaded(true);
    })();
    return () => {
      canceled = true;
    };
  }, [apiKey, client, enabled, errorMessage, loaded, tenantId]);

  return { statusOptions, statusOptionsLoaded: loaded, statusOptionsLoading: loading, statusOptionsError: error };
}
