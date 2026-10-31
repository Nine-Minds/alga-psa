import { useCallback, useEffect, useState } from "react";
import { getTicketById, getTicketComments, type TicketComment, type TicketDetail } from "../../../api/tickets";
import { getCachedTicketDetail, setCachedTicketDetail } from "../../../cache/ticketsCache";
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";
import type { TicketDetailDeps } from "../types";
import { isRecordUnavailableError } from "../../../ui/components/RecordUnavailableState";

export function useTicketData(deps: Pick<TicketDetailDeps, "client" | "session" | "ticketId" | "t">) {
  const { client, session, ticketId, t } = deps;

  const [ticket, setTicket] = useState<TicketDetail | null>(() => {
    const cached = getCachedTicketDetail(ticketId);
    return cached ? (cached as TicketDetail) : null;
  });
  const [initialLoading, setInitialLoading] = useState(ticket === null);
  const [error, setError] = useState<{ title: string; description: string } | null>(null);
  // 403 and 404 are one state to the user: not found, or no access.
  const [unavailable, setUnavailable] = useState(false);
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [commentsError, setCommentsError] = useState<string | null>(null);

  const fetchTicket = useCallback(async () => {
    if (!client || !session) return;
    setError(null);
    setUnavailable(false);
    const result = await getTicketById(client, { apiKey: session.accessToken, ticketId });
    if (!result.ok) {
      if (isRecordUnavailableError(result.error)) {
        // Drop any cached copy so a record the user can no longer read is not shown.
        setTicket(null);
        setUnavailable(true);
        setError({ title: t("detail.ticketNotFound"), description: t("detail.ticketNotFoundDescription") });
        return;
      }
      setError({ title: t("detail.unableToLoad"), description: t("detail.unableToLoadDescription") });
      return;
    }
    setTicket(result.data.data);
    setCachedTicketDetail(ticketId, result.data.data);
  }, [client, session, ticketId]);

  const fetchComments = useCallback(async () => {
    if (!client || !session) return;
    setCommentsError(null);
    const result = await getTicketComments(client, { apiKey: session.accessToken, ticketId });
    if (!result.ok) {
      setCommentsError(t("comments.errors.loadFailed"));
      return;
    }
    setComments(result.data.data);
  }, [client, session, ticketId]);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchTicket(), fetchComments()]);
  }, [fetchComments, fetchTicket]);

  const { refreshing, refresh } = usePullToRefresh(refreshAll);

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      if (!client || !session) return;
      if (ticket === null) setInitialLoading(true);
      await fetchTicket();
      await fetchComments();
      if (!canceled) setInitialLoading(false);
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [client, fetchTicket, session, ticketId]);

  return {
    ticket,
    setTicket,
    initialLoading,
    error,
    unavailable,
    comments,
    setComments,
    commentsError,
    fetchTicket,
    fetchComments,
    refreshing,
    refresh,
  };
}
