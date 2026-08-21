import { useState } from "react";
import { getTicketPriorities, updateTicketPriority, type TicketNotificationSuppressionOptions, type TicketPriority } from "../../../api/tickets";
import { getClientMetadataHeaders } from "../../../device/clientMetadata";
import { invalidateTicketsListCache } from "../../../cache/ticketsCache";
import { getCachedTicketPriorities, setCachedTicketPriorities } from "../../../cache/referenceDataCache";
import type { TicketDetailDeps } from "../types";
import { getApiErrorMessage, ticketUpdateSuccessMessage } from "../utils";

export function useTicketPriority(
  deps: TicketDetailDeps & {
    fetchTicket: () => Promise<void>;
  },
) {
  const { client, session, ticketId, t, showToast, fetchTicket } = deps;

  const [priorityPickerOpen, setPriorityPickerOpen] = useState(false);
  const [priorityOptions, setPriorityOptions] = useState<TicketPriority[]>([]);
  const [priorityOptionsLoading, setPriorityOptionsLoading] = useState(false);
  const [priorityOptionsError, setPriorityOptionsError] = useState<string | null>(null);
  const [priorityUpdating, setPriorityUpdating] = useState(false);
  const [priorityUpdateError, setPriorityUpdateError] = useState<string | null>(null);

  const openPriorityPicker = async () => {
    if (!client || !session) return;
    setPriorityPickerOpen(true);
    if (priorityOptions.length > 0) return;
    const tenantKey = session.tenantId ?? "unknownTenant";
    const cached = getCachedTicketPriorities(tenantKey);
    if (Array.isArray(cached) && cached.length > 0) {
      setPriorityOptions(cached as TicketPriority[]);
      return;
    }
    setPriorityOptionsLoading(true);
    setPriorityOptionsError(null);
    try {
      const res = await getTicketPriorities(client, { apiKey: session.accessToken });
      if (!res.ok) {
        setPriorityOptionsError(t("detail.errors.unableToLoadPriorities"));
        return;
      }
      setPriorityOptions(res.data.data);
      setCachedTicketPriorities(tenantKey, res.data.data);
    } finally {
      setPriorityOptionsLoading(false);
    }
  };

  const submitPriority = async (priorityId: string, notificationSuppression?: TicketNotificationSuppressionOptions) => {
    if (!client || !session) return;
    if (priorityUpdating) return;
    setPriorityUpdateError(null);
    setPriorityUpdating(true);
    try {
      const auditHeaders = await getClientMetadataHeaders();
      const res = await updateTicketPriority(client, {
        apiKey: session.accessToken,
        ticketId,
        priority_id: priorityId,
        notificationSuppression,
        auditHeaders,
      });
      if (!res.ok) {
        if (res.error.kind === "permission") {
          setPriorityUpdateError(t("detail.errors.priorityPermission"));
          return;
        }
        if (res.error.kind === "validation") {
          const msg = getApiErrorMessage(res.error.body);
          setPriorityUpdateError(msg ?? t("detail.errors.priorityValidation"));
          return;
        }
        setPriorityUpdateError(t("detail.errors.priorityGeneric"));
        return;
      }
      invalidateTicketsListCache();
      await fetchTicket();
      setPriorityPickerOpen(false);
      showToast({
        message: ticketUpdateSuccessMessage(t, notificationSuppression, t("detail.priority")),
        tone: "success",
      });
    } finally {
      setPriorityUpdating(false);
    }
  };

  return {
    priorityPickerOpen,
    setPriorityPickerOpen,
    priorityOptions,
    priorityOptionsLoading,
    priorityOptionsError,
    priorityUpdating,
    priorityUpdateError,
    openPriorityPicker,
    submitPriority,
  };
}
