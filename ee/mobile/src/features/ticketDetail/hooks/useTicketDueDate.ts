import { useState } from "react";
import type { TicketDetail, TicketNotificationSuppressionOptions } from "../../../api/tickets";
import { updateTicketAttributes } from "../../../api/tickets";
import { getClientMetadataHeaders } from "../../../device/clientMetadata";
import { invalidateTicketsListCache } from "../../../cache/ticketsCache";
import type { TicketDetailDeps } from "../types";
import { dateInputToIso, getApiErrorMessage, getTicketAttributes, ticketUpdateSuccessMessage } from "../utils";

export function useTicketDueDate(
  deps: TicketDetailDeps & {
    ticket: TicketDetail | null;
    fetchTicket: () => Promise<void>;
  },
) {
  const { client, session, ticketId, t, showToast, ticket, fetchTicket } = deps;

  const [dueDateOpen, setDueDateOpen] = useState(false);
  const [dueDateDraft, setDueDateDraft] = useState("");
  const [dueDateUpdating, setDueDateUpdating] = useState(false);
  const [dueDateError, setDueDateError] = useState<string | null>(null);

  const submitDueDateIso = async (
    nextIso: string | null,
    notificationSuppression?: TicketNotificationSuppressionOptions,
  ) => {
    if (!client || !session || !ticket) return;
    if (dueDateUpdating) return;
    setDueDateError(null);
    setDueDateUpdating(true);
    try {
      const auditHeaders = await getClientMetadataHeaders();
      const base = getTicketAttributes(ticket);
      const next: Record<string, unknown> = { ...base };

      if (nextIso === null) {
        delete next.due_date;
      } else {
        next.due_date = nextIso;
      }

      const attributesToSend = next;
      const res = await updateTicketAttributes(client, {
        apiKey: session.accessToken,
        ticketId,
        attributes: attributesToSend,
        notificationSuppression,
        auditHeaders,
      });
      if (!res.ok) {
        if (res.error.kind === "permission") {
          setDueDateError(t("detail.errors.dueDatePermission"));
          return;
        }
        if (res.error.kind === "validation") {
          const msg = getApiErrorMessage(res.error.body);
          setDueDateError(msg ?? t("detail.errors.dueDateValidation"));
          return;
        }
        setDueDateError(t("detail.errors.dueDateGeneric"));
        return;
      }
      invalidateTicketsListCache();
      await fetchTicket();
      setDueDateOpen(false);
      showToast({
        message: ticketUpdateSuccessMessage(t, notificationSuppression, t("detail.dueDateUpdated", { defaultValue: "Due date updated" })),
        tone: "success",
      });
    } finally {
      setDueDateUpdating(false);
    }
  };

  const saveDueDateFromDraft = async () => {
    const trimmed = dueDateDraft.trim();
    if (!trimmed) {
      await submitDueDateIso(null);
      return;
    }
    const iso = dateInputToIso(trimmed);
    if (!iso) {
      setDueDateError(t("detail.errors.dueDateFormat"));
      return;
    }
    await submitDueDateIso(iso);
  };

  const setDueDateInDays = async (days: number) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    await submitDueDateIso(d.toISOString());
  };

  return {
    dueDateOpen,
    setDueDateOpen,
    dueDateDraft,
    setDueDateDraft,
    dueDateUpdating,
    dueDateError,
    submitDueDateIso,
    saveDueDateFromDraft,
    setDueDateInDays,
  };
}
