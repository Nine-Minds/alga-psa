import { useState } from "react";
import {
  getTicketCategories,
  updateTicketCategory,
  type TicketCategory,
  type TicketNotificationSuppressionOptions,
} from "../../../api/tickets";
import { getClientMetadataHeaders } from "../../../device/clientMetadata";
import { invalidateTicketsListCache } from "../../../cache/ticketsCache";
import { getCachedTicketCategories, setCachedTicketCategories } from "../../../cache/referenceDataCache";
import type { TicketDetailDeps } from "../types";
import { getApiErrorMessage, ticketUpdateSuccessMessage } from "../utils";
import { ticketCategorySelection } from "../ticketCategory";

/**
 * Category/subcategory editing. Boards can require both before a ticket closes,
 * so this is the difference between resolving a ticket on the phone and not.
 */
export function useTicketCategory(
  deps: TicketDetailDeps & {
    fetchTicket: () => Promise<void>;
    boardId?: string | null;
  },
) {
  const { client, session, ticketId, t, showToast, fetchTicket, boardId } = deps;

  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState<TicketCategory[]>([]);
  const [categoryOptionsLoading, setCategoryOptionsLoading] = useState(false);
  const [categoryOptionsError, setCategoryOptionsError] = useState<string | null>(null);
  const [categoryUpdating, setCategoryUpdating] = useState(false);
  const [categoryUpdateError, setCategoryUpdateError] = useState<string | null>(null);

  const openCategoryPicker = async () => {
    if (!client || !session) return;
    setCategoryPickerOpen(true);
    setCategoryUpdateError(null);
    if (categoryOptions.length > 0) return;
    const tenantKey = session.tenantId ?? "unknownTenant";
    const cacheKey = boardId ? `${tenantKey}:board:${boardId}` : tenantKey;
    const cached = getCachedTicketCategories(cacheKey);
    if (Array.isArray(cached) && cached.length > 0) {
      setCategoryOptions(cached as TicketCategory[]);
      return;
    }
    setCategoryOptionsLoading(true);
    setCategoryOptionsError(null);
    try {
      const res = await getTicketCategories(client, {
        apiKey: session.accessToken,
        board_id: boardId ?? undefined,
      });
      if (!res.ok) {
        setCategoryOptionsError(
          res.error.kind === "permission"
            ? t("detail.errors.categoryPermission")
            : t("detail.errors.unableToLoadCategories"),
        );
        return;
      }
      setCategoryOptions(res.data.data);
      setCachedTicketCategories(cacheKey, res.data.data);
    } finally {
      setCategoryOptionsLoading(false);
    }
  };

  const submitCategory = async (
    categoryId: string | null,
    notificationSuppression?: TicketNotificationSuppressionOptions,
  ) => {
    if (!client || !session) return;
    if (categoryUpdating) return;
    setCategoryUpdateError(null);
    setCategoryUpdating(true);
    try {
      const auditHeaders = await getClientMetadataHeaders();
      const selection = ticketCategorySelection(categoryOptions, categoryId);
      const res = await updateTicketCategory(client, {
        apiKey: session.accessToken,
        ticketId,
        category_id: selection.category_id,
        subcategory_id: selection.subcategory_id,
        notificationSuppression,
        auditHeaders,
      });
      if (!res.ok) {
        if (res.error.kind === "permission") {
          setCategoryUpdateError(t("detail.errors.categoryPermission"));
          return;
        }
        if (res.error.kind === "validation") {
          const msg = getApiErrorMessage(res.error.body);
          setCategoryUpdateError(msg ?? t("detail.errors.categoryValidation"));
          return;
        }
        setCategoryUpdateError(t("detail.errors.categoryGeneric"));
        return;
      }
      invalidateTicketsListCache();
      await fetchTicket();
      setCategoryPickerOpen(false);
      showToast({
        message: ticketUpdateSuccessMessage(t, notificationSuppression, t("detail.category")),
        tone: "success",
      });
    } finally {
      setCategoryUpdating(false);
    }
  };

  return {
    categoryPickerOpen,
    setCategoryPickerOpen,
    categoryOptions,
    categoryOptionsLoading,
    categoryOptionsError,
    categoryUpdating,
    categoryUpdateError,
    openCategoryPicker,
    submitCategory,
  };
}
