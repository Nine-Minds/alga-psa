import { useState } from "react";
import { updateTicketTitle } from "../../../api/tickets";
import type { TicketDetail } from "../../../api/tickets";
import { getClientMetadataHeaders } from "../../../device/clientMetadata";
import { invalidateTicketsListCache } from "../../../cache/ticketsCache";
import type { TicketDetailDeps } from "../types";
import { getApiErrorMessage } from "../utils";

export function useTicketTitle(
  deps: TicketDetailDeps & {
    ticket: TicketDetail | null;
    setTicket: (updater: (prev: TicketDetail | null) => TicketDetail | null) => void;
  },
) {
  const { client, session, ticketId, t, ticket, setTicket } = deps;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEditing = () => {
    setDraft(ticket?.title ?? "");
    setError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setError(null);
  };

  const saveTitle = async () => {
    if (!client || !session) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      setError(t("detail.errors.titleEmpty"));
      return;
    }
    if (trimmed === ticket?.title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const auditHeaders = await getClientMetadataHeaders();
      const res = await updateTicketTitle(client, {
        apiKey: session.accessToken,
        ticketId,
        title: trimmed,
        auditHeaders,
      });
      if (!res.ok) {
        if (res.error.kind === "permission") {
          setError(t("detail.errors.titlePermission"));
          return;
        }
        if (res.error.kind === "validation") {
          const msg = getApiErrorMessage(res.error.body);
          setError(msg ?? t("detail.errors.titleValidation"));
          return;
        }
        setError(t("detail.errors.titleGeneric"));
        return;
      }
      setTicket((prev) => (prev ? { ...prev, title: trimmed } : prev));
      invalidateTicketsListCache();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return {
    titleEditing: editing,
    titleDraft: draft,
    titleSaving: saving,
    titleError: error,
    setTitleDraft: setDraft,
    startTitleEditing: startEditing,
    cancelTitleEditing: cancelEditing,
    saveTitle,
  };
}
