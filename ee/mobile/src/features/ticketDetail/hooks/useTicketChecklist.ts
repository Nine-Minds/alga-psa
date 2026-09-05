import { useCallback, useEffect, useState } from "react";
import {
  createTicketChecklistItem,
  getTicketChecklist,
  setTicketChecklistItemCompleted,
  type TicketChecklistItem,
} from "../../../api/ticketChecklist";
import { getClientMetadataHeaders } from "../../../device/clientMetadata";
import type { TicketDetailDeps } from "../types";
import { getApiErrorMessage } from "../utils";

export function useTicketChecklist(deps: TicketDetailDeps) {
  const { client, session, ticketId, t } = deps;
  const [items, setItems] = useState<TicketChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(() => new Set());

  const fetchChecklist = useCallback(async () => {
    if (!client || !session) return;
    setError(null);
    try {
      const result = await getTicketChecklist(client, {
        apiKey: session.accessToken,
        ticketId,
      });
      if (!result?.ok) {
        if (result?.error.kind === "permission") setHidden(true);
        else setError(t("checklist.errors.load", { defaultValue: "Unable to load checklist." }));
        setLoading(false);
        return;
      }
      setHidden(false);
      setItems(result.data.data);
    } catch {
      setError(t("checklist.errors.load", { defaultValue: "Unable to load checklist." }));
    } finally {
      setLoading(false);
    }
  }, [client, session, t, ticketId]);

  useEffect(() => {
    void fetchChecklist();
  }, [fetchChecklist]);

  const addItem = async (itemName: string, isRequired: boolean): Promise<boolean> => {
    if (!client || !session || adding) return false;
    const trimmed = itemName.trim();
    if (!trimmed) return false;
    setAdding(true);
    setActionError(null);
    try {
      const auditHeaders = await getClientMetadataHeaders();
      const result = await createTicketChecklistItem(client, {
        apiKey: session.accessToken,
        ticketId,
        itemName: trimmed,
        isRequired,
        auditHeaders,
      });
      if (!result.ok) {
        const validationMessage = result.error.kind === "validation" ? getApiErrorMessage(result.error.body) : null;
        setActionError(
          result.error.kind === "permission"
            ? t("checklist.errors.permission", { defaultValue: "You don't have permission to update this checklist." })
            : validationMessage ?? t("checklist.errors.add", { defaultValue: "Unable to add checklist item." }),
        );
        return false;
      }
      setItems((current) => [...current, result.data.data].sort((a, b) => a.order_number - b.order_number));
      return true;
    } finally {
      setAdding(false);
    }
  };

  const toggleItem = async (item: TicketChecklistItem): Promise<void> => {
    if (!client || !session || updatingIds.has(item.checklist_item_id)) return;
    const nextCompleted = !item.completed;
    setActionError(null);
    setUpdatingIds((current) => new Set(current).add(item.checklist_item_id));
    setItems((current) => current.map((row) =>
      row.checklist_item_id === item.checklist_item_id ? { ...row, completed: nextCompleted } : row
    ));
    try {
      const auditHeaders = await getClientMetadataHeaders();
      const result = await setTicketChecklistItemCompleted(client, {
        apiKey: session.accessToken,
        ticketId,
        itemId: item.checklist_item_id,
        completed: nextCompleted,
        auditHeaders,
      });
      if (!result.ok) {
        setItems((current) => current.map((row) =>
          row.checklist_item_id === item.checklist_item_id ? item : row
        ));
        setActionError(
          result.error.kind === "permission"
            ? t("checklist.errors.permission", { defaultValue: "You don't have permission to update this checklist." })
            : t("checklist.errors.update", { defaultValue: "Unable to update checklist item." }),
        );
        return;
      }
      setItems((current) => current.map((row) =>
        row.checklist_item_id === item.checklist_item_id ? result.data.data : row
      ));
    } finally {
      setUpdatingIds((current) => {
        const next = new Set(current);
        next.delete(item.checklist_item_id);
        return next;
      });
    }
  };

  return {
    items,
    loading,
    hidden,
    error,
    actionError,
    adding,
    updatingIds,
    fetchChecklist,
    addItem,
    toggleItem,
  };
}
