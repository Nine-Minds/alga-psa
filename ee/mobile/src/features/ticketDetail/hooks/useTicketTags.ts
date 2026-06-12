import { useCallback, useEffect, useState } from "react";
import { addTicketTag, getTicketTags, removeTicketTag, type TicketTag } from "../../../api/tags";
import { getClientMetadataHeaders } from "../../../device/clientMetadata";
import type { TicketDetailDeps } from "../types";
import { getApiErrorMessage } from "../utils";

export function useTicketTags(deps: TicketDetailDeps) {
  const { client, session, ticketId, t } = deps;

  const [tags, setTags] = useState<TicketTag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(true);
  const [tagsHidden, setTagsHidden] = useState(false);
  const [tagsError, setTagsError] = useState<string | null>(null);
  const [tagUpdating, setTagUpdating] = useState(false);
  const [tagActionError, setTagActionError] = useState<string | null>(null);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);

  const fetchTags = useCallback(async () => {
    if (!client || !session) return;
    setTagsError(null);
    const res = await getTicketTags(client, { apiKey: session.accessToken, ticketId });
    if (!res.ok) {
      if (res.error.kind === "permission") {
        setTagsHidden(true);
      } else {
        setTagsError(t("tags.errors.load", { defaultValue: "Unable to load tags." }));
      }
      setTagsLoading(false);
      return;
    }
    setTagsHidden(false);
    setTags(res.data.data?.tags ?? []);
    setTagsLoading(false);
  }, [client, session, t, ticketId]);

  useEffect(() => {
    void fetchTags();
  }, [fetchTags]);

  const addTag = async (tagText: string): Promise<boolean> => {
    if (!client || !session) return false;
    if (tagUpdating) return false;
    const trimmed = tagText.trim();
    if (!trimmed) return false;
    if (tags.some((tag) => tag.tag_text.toLowerCase() === trimmed.toLowerCase())) {
      return true;
    }

    setTagActionError(null);
    setTagUpdating(true);
    try {
      const auditHeaders = await getClientMetadataHeaders();
      const res = await addTicketTag(client, {
        apiKey: session.accessToken,
        ticketId,
        tagText: trimmed,
        auditHeaders,
      });
      if (!res.ok) {
        if (res.error.kind === "permission") {
          setTagActionError(t("tags.errors.addPermission", { defaultValue: "You don't have permission to add tags." }));
          return false;
        }
        if (res.error.kind === "validation") {
          const msg = getApiErrorMessage(res.error.body);
          setTagActionError(msg ?? t("tags.errors.addValidation", { defaultValue: "Tag was rejected by the server." }));
          return false;
        }
        setTagActionError(t("tags.errors.addGeneric", { defaultValue: "Unable to add tag. Please try again." }));
        return false;
      }
      const created = res.data.data?.tags ?? [];
      setTags((prev) => [
        ...prev,
        ...created.filter((tag) => !prev.some((existing) => existing.tag_id === tag.tag_id)),
      ]);
      return true;
    } finally {
      setTagUpdating(false);
    }
  };

  const removeTag = async (tag: TicketTag) => {
    if (!client || !session) return;
    if (tagUpdating) return;

    setTagActionError(null);
    const previous = tags;
    setTags(previous.filter((existing) => existing.tag_id !== tag.tag_id));
    setTagUpdating(true);
    try {
      const auditHeaders = await getClientMetadataHeaders();
      const res = await removeTicketTag(client, {
        apiKey: session.accessToken,
        ticketId,
        tagId: tag.tag_id,
        auditHeaders,
      });
      if (!res.ok) {
        setTags(previous);
        if (res.error.kind === "permission") {
          setTagActionError(t("tags.errors.removePermission", { defaultValue: "You don't have permission to remove tags." }));
          return;
        }
        setTagActionError(t("tags.errors.removeGeneric", { defaultValue: "Unable to remove tag. Please try again." }));
      }
    } finally {
      setTagUpdating(false);
    }
  };

  const selectTag = async (tagText: string) => {
    const added = await addTag(tagText);
    if (added) {
      setTagPickerOpen(false);
    }
  };

  const openTagPicker = () => {
    setTagActionError(null);
    setTagPickerOpen(true);
  };

  const closeTagPicker = () => {
    setTagPickerOpen(false);
  };

  return {
    tags,
    tagsLoading,
    tagsHidden,
    tagsError,
    tagUpdating,
    tagActionError,
    tagPickerOpen,
    fetchTags,
    addTag,
    removeTag,
    selectTag,
    openTagPicker,
    closeTagPicker,
  };
}
