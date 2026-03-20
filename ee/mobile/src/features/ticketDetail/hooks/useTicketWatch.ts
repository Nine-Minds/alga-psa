import { useState } from "react";
import type { TicketDetail } from "../../../api/tickets";
import { updateTicketAttributes } from "../../../api/tickets";
import { getClientMetadataHeaders } from "../../../device/clientMetadata";
import { invalidateTicketsListCache } from "../../../cache/ticketsCache";
import type { TicketDetailDeps } from "../types";
import { getApiErrorMessage, getTicketAttributes, getWatcherUserIds } from "../utils";

export function useTicketWatch(
  deps: TicketDetailDeps & {
    ticket: TicketDetail | null;
    fetchTicket: () => Promise<void>;
  },
) {
  const { client, session, ticketId, t, ticket, fetchTicket } = deps;

  const [watchUpdating, setWatchUpdating] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);

  const toggleWatch = async () => {
    if (!client || !session || !ticket) return;
    if (watchUpdating) return;
    const me = session.user?.id;
    if (!me) {
      setWatchError(t("detail.errors.watchNoUser"));
      return;
    }

    setWatchError(null);
    setWatchUpdating(true);
    try {
      const base = getTicketAttributes(ticket);
      const existing = getWatcherUserIds(ticket);
      const nextIds = existing.includes(me)
        ? existing.filter((id) => id !== me)
        : [...existing, me];

      const nextAttrs: Record<string, unknown> = { ...base };
      if (nextIds.length > 0) {
        nextAttrs.watcher_user_ids = nextIds;
      } else {
        delete nextAttrs.watcher_user_ids;
      }

      const auditHeaders = await getClientMetadataHeaders();
      const res = await updateTicketAttributes(client, {
        apiKey: session.accessToken,
        ticketId,
        attributes: Object.keys(nextAttrs).length === 0 ? null : nextAttrs,
        auditHeaders,
      });

      if (!res.ok) {
        if (res.error.kind === "permission") {
          setWatchError(t("detail.errors.watchPermission"));
          return;
        }
        if (res.error.kind === "validation") {
          const msg = getApiErrorMessage(res.error.body);
          setWatchError(msg ?? t("detail.errors.watchValidation"));
          return;
        }
        setWatchError(t("detail.errors.watchGeneric"));
        return;
      }

      invalidateTicketsListCache();
      await fetchTicket();
    } finally {
      setWatchUpdating(false);
    }
  };

  return {
    watchUpdating,
    watchError,
    toggleWatch,
  };
}
