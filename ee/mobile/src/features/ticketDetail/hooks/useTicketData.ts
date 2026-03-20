import { useCallback, useEffect, useState } from "react";
import { getTicketById, getTicketComments, type TicketComment, type TicketDetail } from "../../../api/tickets";
import { getCachedTicketDetail, setCachedTicketDetail } from "../../../cache/ticketsCache";
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";
import type { TicketDetailDeps } from "../types";

export function useTicketData(deps: Pick<TicketDetailDeps, "client" | "session" | "ticketId" | "t">) {
  const { client, session, ticketId, t } = deps;

  const [ticket, setTicket] = useState<TicketDetail | null>(() => {
    const cached = getCachedTicketDetail(ticketId);
    return cached ? (cached as TicketDetail) : null;
  });
  const [initialLoading, setInitialLoading] = useState(ticket === null);
  const [error, setError] = useState<{ title: string; description: string } | null>(null);
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [commentsError, setCommentsError] = useState<string | null>(null);

  const fetchTicket = useCallback(async () => {
    if (!client || !session) return;
    setError(null);
    const result = await getTicketById(client, { apiKey: session.accessToken, ticketId });
    if (!result.ok) {
      if (result.error.kind === "http" && result.status === 404) {
        setTicket(null);
        setError({ title: t("detail.ticketNotFound"), description: t("detail.ticketNotFoundDescription") });
        return;
      }
      if (result.error.kind === "permission") {
        setError({ title: t("detail.noAccessTitle"), description: t("detail.noAccessDescription") });
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
    comments,
    setComments,
    commentsError,
    fetchTicket,
    fetchComments,
    refreshing,
    refresh,
  };
}
