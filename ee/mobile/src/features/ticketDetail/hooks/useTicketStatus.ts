import { useRef, useState } from "react";
import { Alert } from "react-native";
import { getTicketStatuses, updateTicketStatus, type TicketNotificationSuppressionOptions, type TicketStatus } from "../../../api/tickets";
import { getClientMetadataHeaders } from "../../../device/clientMetadata";
import { invalidateTicketsListCache } from "../../../cache/ticketsCache";
import { getCachedTicketStatuses, setCachedTicketStatuses } from "../../../cache/referenceDataCache";
import type { TicketDetailDeps } from "../types";
import { getApiErrorMessage, ticketUpdateSuccessMessage } from "../utils";

export type BundlePropagationConfirmationDetails = {
  reason: 'bundle_propagation_confirmation_required';
  crossesBoundary: 'close' | 'reopen' | null;
  affectedChildren: Array<{
    ticket_id: string;
    ticket_number?: string | null;
    title?: string | null;
    is_closed?: boolean;
  }>;
  unaffectedChildren: Array<{
    ticket_id: string;
    ticket_number?: string | null;
    title?: string | null;
    reason?: string;
  }>;
};

export function extractBundlePropagationDetails(
  body: unknown,
): BundlePropagationConfirmationDetails | null {
  const details = (body as { error?: { details?: unknown } } | null | undefined)?.error?.details;
  if (
    details &&
    typeof details === 'object' &&
    (details as { reason?: unknown }).reason === 'bundle_propagation_confirmation_required'
  ) {
    return details as BundlePropagationConfirmationDetails;
  }
  return null;
}

export function useTicketStatus(
  deps: TicketDetailDeps & {
    fetchTicket: () => Promise<void>;
    boardId?: string | null;
    onChecklistBlocked?: () => void;
  },
) {
  const { client, session, ticketId, showToast, t, fetchTicket, boardId, onChecklistBlocked } = deps;

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

  const submitStatus = async (
    statusId: string,
    notificationSuppression?: TicketNotificationSuppressionOptions,
    propagateToChildren?: boolean,
  ) => {
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
        propagateToChildren,
        notificationSuppression,
        auditHeaders,
      });
      if (!res.ok) {
        if (res.error.kind === "http" && res.status === 409) {
          const bundleDetails = extractBundlePropagationDetails(res.error.body);
          if (bundleDetails && bundleDetails.crossesBoundary) {
            setPendingStatusId(null);
            const count = bundleDetails.affectedChildren.length;
            const childLabels = bundleDetails.affectedChildren
              .map((child) => child.ticket_number || child.title || child.ticket_id)
              .join(", ");
            const isClose = bundleDetails.crossesBoundary === "close";
            Alert.alert(
              t(
                isClose ? "detail.bundle.closeTitle" : "detail.bundle.reopenTitle",
                { count },
              ),
              `${t(
                isClose ? "detail.bundle.closeDescription" : "detail.bundle.reopenDescription",
                { count },
              )}\n${childLabels}`,
              [
                { text: t("common:cancel"), style: "cancel" },
                {
                  text: t("detail.bundle.masterOnly"),
                  onPress: () => void submitStatus(statusId, notificationSuppression, false),
                },
                {
                  text: t(
                    isClose ? "detail.bundle.closeWithChildren" : "detail.bundle.reopenWithChildren",
                  ),
                  onPress: () => void submitStatus(statusId, notificationSuppression, true),
                },
              ],
            );
            return;
          }
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
          if (msg && /checklist/i.test(msg)) {
            setStatusPickerOpen(false);
            onChecklistBlocked?.();
          }
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
      showToast({
        message: ticketUpdateSuccessMessage(t, notificationSuppression, t("detail.changeStatus")),
        tone: "success",
      });
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
