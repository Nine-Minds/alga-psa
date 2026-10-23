import { useCallback, useEffect, useState } from "react";
import { getTicketBundle, type TicketBundleView, type TicketDetail } from "../../../api/tickets";
import { getTicketBundleRole } from "../../../screens/ticketsBundle";
import type { TicketDetailDeps } from "../types";

/**
 * Loads bundle membership (master, children, mode) for tickets the detail
 * payload marks as a bundle member. Standalone tickets never hit the network.
 */
export function useTicketBundle(
  deps: Pick<TicketDetailDeps, "client" | "session" | "ticketId"> & { ticket: TicketDetail | null },
) {
  const { client, session, ticketId, ticket } = deps;
  const role = getTicketBundleRole(ticket);
  const isMember = role !== "standalone";

  const [bundle, setBundle] = useState<TicketBundleView | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);

  const fetchBundle = useCallback(async () => {
    if (!client || !session || !isMember) {
      setBundle(null);
      return;
    }
    setBundleLoading(true);
    try {
      const result = await getTicketBundle(client, { apiKey: session.accessToken, ticketId });
      setBundle(result.ok ? result.data.data : null);
    } finally {
      setBundleLoading(false);
    }
  }, [client, isMember, session, ticketId]);

  useEffect(() => {
    void fetchBundle();
  }, [fetchBundle, ticket?.master_ticket_id, ticket?.bundle_child_count]);

  return { bundle, bundleLoading, bundleRole: role, fetchBundle };
}
