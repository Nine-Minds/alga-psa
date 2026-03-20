import { useState } from "react";
import { updateTicketAssignment } from "../../../api/tickets";
import { getClientMetadataHeaders } from "../../../device/clientMetadata";
import { invalidateTicketsListCache } from "../../../cache/ticketsCache";
import type { TicketDetailDeps } from "../types";
import { getApiErrorMessage } from "../utils";

export function useTicketAssignment(
  deps: TicketDetailDeps & {
    fetchTicket: () => Promise<void>;
  },
) {
  const { client, session, ticketId, t, fetchTicket } = deps;

  const [assignmentUpdating, setAssignmentUpdating] = useState(false);
  const [assignmentAction, setAssignmentAction] = useState<"assign" | "unassign" | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);

  const updateAssignment = async (assignedTo: string | null, action: "assign" | "unassign") => {
    if (!client || !session) return;
    if (assignmentUpdating) return;
    setAssignmentError(null);
    setAssignmentAction(action);
    setAssignmentUpdating(true);
    try {
      const auditHeaders = await getClientMetadataHeaders();
      const res = await updateTicketAssignment(client, {
        apiKey: session.accessToken,
        ticketId,
        assigned_to: assignedTo,
        auditHeaders,
      });
      if (!res.ok) {
        if (res.error.kind === "permission") {
          setAssignmentError(t("detail.errors.assignmentPermission"));
          return;
        }
        if (res.error.kind === "validation") {
          const msg = getApiErrorMessage(res.error.body);
          setAssignmentError(msg ?? t("detail.errors.assignmentValidation"));
          return;
        }
        setAssignmentError(t("detail.errors.assignmentGeneric"));
        return;
      }
      invalidateTicketsListCache();
      await fetchTicket();
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

  const unassign = async () => {
    await updateAssignment(null, "unassign");
  };

  return {
    assignmentUpdating,
    assignmentAction,
    assignmentError,
    assignToMe,
    unassign,
  };
}
