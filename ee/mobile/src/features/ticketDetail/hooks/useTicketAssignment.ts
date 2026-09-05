import { useState } from "react";
import { updateTicketAssignment, type TicketNotificationSuppressionOptions } from "../../../api/tickets";
import { getClientMetadataHeaders } from "../../../device/clientMetadata";
import { invalidateTicketsListCache } from "../../../cache/ticketsCache";
import type { TicketDetailDeps } from "../types";
import { getApiErrorMessage, ticketUpdateSuccessMessage } from "../utils";

export function useTicketAssignment(
  deps: TicketDetailDeps & {
    fetchTicket: () => Promise<void>;
  },
) {
  const { client, session, ticketId, t, showToast, fetchTicket } = deps;

  const [assignmentUpdating, setAssignmentUpdating] = useState(false);
  const [assignmentAction, setAssignmentAction] = useState<"assign" | "unassign" | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);

  const updateAssignment = async (
    assignedTo: string | null,
    action: "assign" | "unassign",
    notificationSuppression?: TicketNotificationSuppressionOptions,
  ) => {
    if (!client || !session) return false;
    if (assignmentUpdating) return false;
    setAssignmentError(null);
    setAssignmentAction(action);
    setAssignmentUpdating(true);
    try {
      const auditHeaders = await getClientMetadataHeaders();
      const res = await updateTicketAssignment(client, {
        apiKey: session.accessToken,
        ticketId,
        assigned_to: assignedTo,
        notificationSuppression,
        auditHeaders,
      });
      if (!res.ok) {
        if (res.error.kind === "permission") {
          setAssignmentError(t("detail.errors.assignmentPermission"));
          return false;
        }
        if (res.error.kind === "validation") {
          const msg = getApiErrorMessage(res.error.body);
          setAssignmentError(msg ?? t("detail.errors.assignmentValidation"));
          return false;
        }
        setAssignmentError(t("detail.errors.assignmentGeneric"));
        return false;
      }
      invalidateTicketsListCache();
      await fetchTicket();
      showToast({
        message: ticketUpdateSuccessMessage(t, notificationSuppression, t("detail.assignmentUpdated", { defaultValue: "Assignment updated" })),
        tone: "success",
      });
      return true;
    } finally {
      setAssignmentUpdating(false);
      setAssignmentAction(null);
    }
  };

  const assignToMe = async () => {
    if (!session) return;
    const me = session.user?.id;
    if (!me) {
      setAssignmentError(t("detail.errors.assignmentNoUser"));
      return;
    }
    await updateAssignment(me, "assign");
  };

  const unassign = async (notificationSuppression?: TicketNotificationSuppressionOptions) => {
    return updateAssignment(null, "unassign", notificationSuppression);
  };

  const assignToUser = async (userId: string, notificationSuppression?: TicketNotificationSuppressionOptions) => {
    const updated = await updateAssignment(userId, "assign", notificationSuppression);
    if (updated) setAgentPickerOpen(false);
  };

  const openAgentPicker = () => {
    setAssignmentError(null);
    setAgentPickerOpen(true);
  };

  const closeAgentPicker = () => {
    setAgentPickerOpen(false);
  };

  return {
    assignmentUpdating,
    assignmentAction,
    assignmentError,
    assignToMe,
    unassign,
    assignToUser,
    agentPickerOpen,
    openAgentPicker,
    closeAgentPicker,
  };
}
