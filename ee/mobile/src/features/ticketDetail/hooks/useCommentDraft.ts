import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TicketComment } from "../../../api/tickets";
import { addTicketComment, updateTicketStatus } from "../../../api/tickets";
import { getSecureJson, secureStorage, setSecureJson } from "../../../storage/secureStorage";
import { getClientMetadataHeaders } from "../../../device/clientMetadata";
import { invalidateTicketsListCache } from "../../../cache/ticketsCache";
import {
  extractPlainTextFromRichEditorJson,
  extractPlainTextFromSerializedRichEditorContent,
  serializeRichEditorJson,
} from "../../ticketRichText/helpers";
import type { TicketRichTextEditorRef } from "../../ticketRichText/TicketRichTextEditor";
import type { TicketDetailDeps } from "../types";
import { MAX_COMMENT_LENGTH, } from "../types";
import { getApiErrorMessage } from "../utils";

export function useCommentDraft(
  deps: TicketDetailDeps & {
    isOffline: boolean;
    fetchTicket: () => Promise<void>;
    fetchComments: () => Promise<void>;
    setComments: React.Dispatch<React.SetStateAction<TicketComment[]>>;
  },
) {
  const { client, session, ticketId, showToast, t, isOffline, fetchTicket, fetchComments, setComments } = deps;

  const [commentsVisibleCount, setCommentsVisibleCount] = useState(20);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentDraftPlainText, setCommentDraftPlainText] = useState("");
  const [commentIsInternal, setCommentIsInternal] = useState(true);
  const [commentIsResolution, setCommentIsResolution] = useState(false);
  const [commentCloseStatusId, setCommentCloseStatusId] = useState<string | null>(null);
  const [commentSendError, setCommentSendError] = useState<string | null>(null);
  const [commentSending, setCommentSending] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);

  const commentEditorRef = useRef<TicketRichTextEditorRef>(null);
  const commentSendInFlightRef = useRef(false);

  const draftKey = useMemo(() => {
    const userId = session?.user?.id ?? "anonymous";
    return `alga.mobile.ticketDraft.${userId}.${ticketId}`;
  }, [session?.user?.id, ticketId]);

  const visibilityPrefKey = useMemo(() => {
    const userId = session?.user?.id ?? "anonymous";
    return `alga.mobile.ticketComment.visibility.${userId}`;
  }, [session?.user?.id]);

  // Load draft from storage
  useEffect(() => {
    let canceled = false;
    const run = async () => {
      const saved = await getSecureJson<{ text: string; isInternal: boolean }>(draftKey);
      if (canceled) return;
      if (saved) {
        setCommentDraft(saved.text);
        setCommentDraftPlainText(extractPlainTextFromSerializedRichEditorContent(saved.text));
        setCommentIsInternal(saved.isInternal);
      } else {
        const pref = await getSecureJson<boolean>(visibilityPrefKey);
        if (canceled) return;
        if (typeof pref === "boolean") {
          setCommentIsInternal(pref);
        }
      }
      setDraftLoaded(true);
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [draftKey, visibilityPrefKey]);

  // Persist draft to storage
  useEffect(() => {
    if (!draftLoaded) return;
    void setSecureJson(draftKey, { text: commentDraft, isInternal: commentIsInternal });
  }, [commentDraft, commentIsInternal, draftKey, draftLoaded]);

  // Persist visibility preference
  useEffect(() => {
    if (!draftLoaded) return;
    void setSecureJson(visibilityPrefKey, commentIsInternal);
  }, [commentIsInternal, draftLoaded, visibilityPrefKey]);

  const submitCommentPayload = useCallback(
    async ({
      serializedDraft,
      text,
      originalDraft,
      originalDraftPlainText,
      originalIsInternal,
      isResolution,
      closeStatusId,
    }: {
      serializedDraft: string;
      text: string;
      originalDraft: string;
      originalDraftPlainText: string;
      originalIsInternal: boolean;
      isResolution?: boolean;
      closeStatusId?: string | null;
    }): Promise<boolean> => {
      if (!client || !session) return false;
      if (commentSendInFlightRef.current || commentSending) return false;
      commentSendInFlightRef.current = true;

      const trimmedText = text.trim();
      if (!trimmedText) {
        setCommentSendError(t("comments.errors.empty"));
        commentSendInFlightRef.current = false;
        return false;
      }
      if (trimmedText.length > MAX_COMMENT_LENGTH) {
        setCommentSendError(t("comments.errors.tooLong", { max: MAX_COMMENT_LENGTH }));
        commentSendInFlightRef.current = false;
        return false;
      }
      if (isOffline) {
        setCommentSendError(t("comments.errors.offlineSaved"));
        showToast({ message: t("comments.offlineToast"), tone: "info" });
        commentSendInFlightRef.current = false;
        return false;
      }

      const optimisticId = `optimistic-${Date.now()}`;
      const optimisticComment: TicketComment = {
        comment_id: optimisticId,
        comment_text: serializedDraft,
        is_internal: originalIsInternal,
        created_at: new Date().toISOString(),
        created_by_name: session.user?.name ?? session.user?.email ?? "You",
        optimistic: true,
      };

      setComments((prev) => [...prev, optimisticComment]);
      setCommentDraft("");
      setCommentDraftPlainText("");
      setCommentSendError(null);
      setCommentSending(true);
      try {
        const auditHeaders = await getClientMetadataHeaders();
        const result = await addTicketComment(client, {
          apiKey: session.accessToken,
          ticketId,
          comment_text: serializedDraft,
          is_internal: originalIsInternal,
          is_resolution: isResolution,
          auditHeaders,
        });
        if (!result.ok) {
          if (result.error.kind === "permission") {
            setComments((prev) => prev.filter((c) => c.comment_id !== optimisticId));
            setCommentDraft(originalDraft);
            setCommentDraftPlainText(originalDraftPlainText);
            setCommentIsInternal(originalIsInternal);
            setCommentSendError(t("comments.errors.permission"));
            showToast({ message: t("comments.commentNotSent"), tone: "error" });
            return false;
          }
          if (result.error.kind === "validation") {
            const msg = getApiErrorMessage(result.error.body);
            setComments((prev) => prev.filter((c) => c.comment_id !== optimisticId));
            setCommentDraft(originalDraft);
            setCommentDraftPlainText(originalDraftPlainText);
            setCommentIsInternal(originalIsInternal);
            setCommentSendError(msg ?? t("comments.errors.validation"));
            showToast({ message: t("comments.commentNotSent"), tone: "error" });
            return false;
          }
          setComments((prev) => prev.filter((c) => c.comment_id !== optimisticId));
          setCommentDraft(originalDraft);
          setCommentDraftPlainText(originalDraftPlainText);
          setCommentIsInternal(originalIsInternal);
          setCommentSendError(t("comments.errors.generic"));
          showToast({ message: t("comments.commentNotSent"), tone: "error" });
          return false;
        }

        setComments((prev) =>
          prev.map((c) => {
            if (c.comment_id !== optimisticId) return c;
            return {
              ...c,
              ...result.data.data,
              created_by_name: result.data.data.created_by_name ?? c.created_by_name,
              comment_text: result.data.data.comment_text ?? c.comment_text,
              optimistic: false,
            };
          }),
        );
        // If resolution with a close status, update the ticket status
        if (isResolution && closeStatusId) {
          await updateTicketStatus(client, {
            apiKey: session.accessToken,
            ticketId,
            status_id: closeStatusId,
            auditHeaders,
          }).catch(() => {});
        }

        await secureStorage.deleteItem(draftKey);
        invalidateTicketsListCache();
        await Promise.all([fetchTicket(), fetchComments()]);
        showToast({ message: t("comments.commentSent"), tone: "success" });
        return true;
      } finally {
        setCommentSending(false);
        commentSendInFlightRef.current = false;
      }
    },
    [client, commentSending, draftKey, fetchComments, fetchTicket, isOffline, session, showToast, ticketId],
  );

  const sendComment = async () => {
    if (!client || !session) return;
    const originalDraft = commentDraft;
    const originalDraftPlainText = commentDraftPlainText;
    const originalIsInternal = commentIsInternal;
    const draftJson = commentEditorRef.current ? await commentEditorRef.current.getJSON().catch(() => null) : null;
    const serializedDraft = draftJson ? serializeRichEditorJson(draftJson) : originalDraft.trim();
    const text = draftJson
      ? extractPlainTextFromRichEditorJson(draftJson).trim()
      : originalDraftPlainText.trim();
    const sent = await submitCommentPayload({
      serializedDraft,
      text,
      originalDraft,
      originalDraftPlainText,
      originalIsInternal,
      isResolution: commentIsResolution,
      closeStatusId: commentCloseStatusId,
    });
    if (sent) {
      setCommentIsResolution(false);
      setCommentCloseStatusId(null);
    }
  };

  return {
    commentsVisibleCount,
    setCommentsVisibleCount,
    commentDraft,
    setCommentDraft,
    commentDraftPlainText,
    setCommentDraftPlainText,
    commentIsInternal,
    setCommentIsInternal,
    commentIsResolution,
    setCommentIsResolution,
    commentCloseStatusId,
    setCommentCloseStatusId,
    commentSendError,
    commentSending,
    draftLoaded,
    commentEditorRef,
    sendComment,
    submitCommentPayload,
  };
}
