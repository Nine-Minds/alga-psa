import { useState } from "react";
import { updateTicketTitle } from "../../../api/tickets";
import type { TicketDetail, TicketNotificationSuppressionOptions } from "../../../api/tickets";
import { getClientMetadataHeaders } from "../../../device/clientMetadata";
import { invalidateTicketsListCache } from "../../../cache/ticketsCache";
import type { TicketDetailDeps } from "../types";
import { getApiErrorMessage, ticketUpdateSuccessMessage } from "../utils";

export function useTicketTitle(
  deps: TicketDetailDeps & {
    ticket: TicketDetail | null;
    setTicket: (updater: (prev: TicketDetail | null) => TicketDetail | null) => void;
  },
) {
  const { client, session, ticketId, t, showToast, ticket, setTicket } = deps;

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

  const saveTitle = async (notificationSuppression?: TicketNotificationSuppressionOptions) => {
    if (!client || !session) return false;
    const trimmed = draft.trim();
    if (!trimmed) {
      setError(t("detail.errors.titleEmpty"));
      return false;
    }
    if (trimmed === ticket?.title) {
      setEditing(false);
      return true;
    }
    setSaving(true);
    setError(null);
    try {
      const auditHeaders = await getClientMetadataHeaders();
      const res = await updateTicketTitle(client, {
        apiKey: session.accessToken,
        ticketId,
        title: trimmed,
        notificationSuppression,
        auditHeaders,
      });
      if (!res.ok) {
        if (res.error.kind === "permission") {
          setError(t("detail.errors.titlePermission"));
          return false;
        }
        if (res.error.kind === "validation") {
          const msg = getApiErrorMessage(res.error.body);
          setError(msg ?? t("detail.errors.titleValidation"));
          return false;
        }
        setError(t("detail.errors.titleGeneric"));
        return false;
      }
      setTicket((prev) => (prev ? { ...prev, title: trimmed } : prev));
      invalidateTicketsListCache();
      setEditing(false);
      showToast({
        message: ticketUpdateSuccessMessage(t, notificationSuppression, t("detail.titleUpdated", { defaultValue: "Title updated" })),
        tone: "success",
      });
      return true;
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
