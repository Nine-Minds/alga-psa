import { useRef, useState } from "react";
import { Alert } from "react-native";
import { getTicketStatuses, updateTicketStatus, type TicketStatus } from "../../../api/tickets";
import { getClientMetadataHeaders } from "../../../device/clientMetadata";
import { invalidateTicketsListCache } from "../../../cache/ticketsCache";
import { getCachedTicketStatuses, setCachedTicketStatuses } from "../../../cache/referenceDataCache";
import type { TicketDetailDeps } from "../types";
import { getApiErrorMessage } from "../utils";

export function useTicketStatus(
  deps: TicketDetailDeps & {
    fetchTicket: () => Promise<void>;
    boardId?: string | null;
  },
) {
  const { client, session, ticketId, showToast, t, fetchTicket, boardId } = deps;

  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [statusOptions, setStatusOptions] = useState<TicketStatus[]>([]);
  const [statusOptionsLoading, setStatusOptionsLoading] = useState(false);
  const [statusOptionsError, setStatusOptionsError] = useState<string | null>(null);
  const [pendingStatusId, setPendingStatusId] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusUpdateError, setStatusUpdateError] = useState<string | null>(null);

  const statusUpdateInFlightRef = useRef(false);
  const lastBoardIdRef = useRef<string | null | undefined>(boardId);

  // Reset cached options when boardId changes (e.g. after ticket refetch)
  if (boardId !== lastBoardIdRef.current) {
    lastBoardIdRef.current = boardId;
    setStatusOptions([]);
  }

  const openStatusPicker = async () => {
    if (!client || !session) return;
    setStatusPickerOpen(true);
    if (statusOptions.length > 0) return;
    const tenantKey = session.tenantId ?? "unknownTenant";
    const cacheKey = boardId ? `${tenantKey}:board:${boardId}` : tenantKey;
    const cached = getCachedTicketStatuses(cacheKey);
    if (Array.isArray(cached) && cached.length > 0) {
      setStatusOptions(cached as TicketStatus[]);
      return;
    }
    setStatusOptionsLoading(true);
    setStatusOptionsError(null);
    try {
      const res = await getTicketStatuses(client, {
        apiKey: session.accessToken,
        board_id: boardId ?? undefined,
      });
      if (!res.ok) {
        setStatusOptionsError(t("detail.errors.unableToLoadStatuses"));
        return;
      }
      setStatusOptions(res.data.data);
      setCachedTicketStatuses(cacheKey, res.data.data);
    } finally {
      setStatusOptionsLoading(false);
    }
  };

  const submitStatus = async (statusId: string) => {
    if (!client || !session) return;
    if (statusUpdateInFlightRef.current || statusUpdating) return;
    statusUpdateInFlightRef.current = true;
    setPendingStatusId(statusId);
    setStatusUpdateError(null);
    setStatusUpdating(true);
    try {
      const auditHeaders = await getClientMetadataHeaders();
      const res = await updateTicketStatus(client, {
        apiKey: session.accessToken,
        ticketId,
        status_id: statusId,
        auditHeaders,
      });
      if (!res.ok) {
        if (res.error.kind === "http" && res.status === 409) {
          setPendingStatusId(null);
          setStatusPickerOpen(false);
          setStatusUpdateError(t("detail.errors.statusConflict"));
          showToast({ message: t("detail.errors.statusConflictTitle"), tone: "info" });
          Alert.alert(
            t("detail.errors.statusConflictTitle"),
            t("detail.errors.statusConflictDescription"),
            [
              { text: t("common:cancel"), style: "cancel" },
              {
                text: t("common:refresh"),
                onPress: () => {
                  void fetchTicket();
                },
              },
            ],
          );
          return;
        }
        if (res.error.kind === "permission") {
          setPendingStatusId(null);
          setStatusUpdateError(t("detail.errors.statusPermission"));
          showToast({ message: t("detail.errors.statusGeneric"), tone: "error" });
          return;
        }
        if (res.error.kind === "validation") {
          const msg = getApiErrorMessage(res.error.body);
          setPendingStatusId(null);
          setStatusUpdateError(msg ?? t("detail.errors.statusValidation"));
          showToast({ message: t("detail.errors.statusGeneric"), tone: "error" });
          return;
        }
        setPendingStatusId(null);
        setStatusUpdateError(t("detail.errors.statusGeneric"));
        showToast({ message: t("detail.errors.statusGeneric"), tone: "error" });
        return;
      }
      invalidateTicketsListCache();
      await fetchTicket();
      setPendingStatusId(null);
      setStatusPickerOpen(false);
      showToast({ message: t("detail.changeStatus"), tone: "success" });
    } finally {
      setStatusUpdating(false);
      statusUpdateInFlightRef.current = false;
    }
  };

  return {
    statusPickerOpen,
    setStatusPickerOpen,
    statusOptions,
    statusOptionsLoading,
    statusOptionsError,
    pendingStatusId,
    statusUpdating,
    statusUpdateError,
    openStatusPicker,
    submitStatus,
  };
}
