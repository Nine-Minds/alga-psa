import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TicketComment, TicketNotificationSuppressionOptions } from "../../../api/tickets";
import { updateTicketStatus } from "../../../api/tickets";
import { commentDraftKey, createCommentApi, ticketTarget, type CommentTarget } from "../../comments/commentTarget";
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
    /** Where the thread lives; defaults to the ticket named by `ticketId`. */
    target?: CommentTarget;
  },
) {
  const { client, session, ticketId, showToast, t, isOffline, fetchTicket, fetchComments, setComments } = deps;
  const target = useMemo<CommentTarget>(() => deps.target ?? ticketTarget(ticketId), [deps.target, ticketId]);
  const api = useMemo(() => createCommentApi(target), [target]);
  const isTicket = target.kind === "ticket";

  const [commentsVisibleCount, setCommentsVisibleCount] = useState(20);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentDraftPlainText, setCommentDraftPlainText] = useState("");
  const [commentIsInternal, setCommentIsInternal] = useState(true);
  const [commentIsResolution, setCommentIsResolution] = useState(false);
  const [commentCloseStatusId, setCommentCloseStatusId] = useState<string | null>(null);
  const [commentScheduleAt, setCommentScheduleAt] = useState<Date | null>(null);
  // One-off Cc/Bcc for this comment's email. Never persisted with the draft and
  // never sent with an internal note.
  const [commentCc, setCommentCc] = useState<string[]>([]);
  const [commentBcc, setCommentBcc] = useState<string[]>([]);
  const [commentSendError, setCommentSendError] = useState<string | null>(null);
  const [commentSending, setCommentSending] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);

  const commentEditorRef = useRef<TicketRichTextEditorRef>(null);
  const commentSendInFlightRef = useRef(false);

  const draftKey = useMemo(() => commentDraftKey(target, session?.user?.id), [session?.user?.id, target]);

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

  // Persist visibility preference. Task comments are always internal and must
  // not overwrite the user's ticket default.
  useEffect(() => {
    if (!draftLoaded || !isTicket) return;
    void setSecureJson(visibilityPrefKey, commentIsInternal);
  }, [commentIsInternal, draftLoaded, isTicket, visibilityPrefKey]);

  const submitCommentPayload = useCallback(
    async ({
      serializedDraft,
      text,
      originalDraft,
      originalDraftPlainText,
      originalIsInternal,
      isResolution,
      closeStatusId,
      notificationSuppression,
      scheduleAt,
      cc,
      bcc,
    }: {
      serializedDraft: string;
      text: string;
      originalDraft: string;
      originalDraftPlainText: string;
      originalIsInternal: boolean;
      isResolution?: boolean;
      closeStatusId?: string | null;
      notificationSuppression?: TicketNotificationSuppressionOptions;
      scheduleAt?: Date | null;
      cc?: string[];
      bcc?: string[];
    }): Promise<boolean> => {
      if (!client || !session) return false;
      if (commentSendInFlightRef.current || commentSending) return false;
      commentSendInFlightRef.current = true;
      const scheduled = scheduleAt && !originalIsInternal ? scheduleAt : null;

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
        ...(scheduled ? { publish_state: "scheduled" as const, scheduled_publish_at: scheduled.toISOString() } : {}),
      };

      setComments((prev) => [...prev, optimisticComment]);
      setCommentDraft("");
      setCommentDraftPlainText("");
      setCommentSendError(null);
      setCommentSending(true);
      try {
        const auditHeaders = await getClientMetadataHeaders();
        const result = await api.add(client, {
          apiKey: session.accessToken,
          comment_text: serializedDraft,
          is_internal: isTicket ? originalIsInternal : true,
          is_resolution: isResolution,
          ...(scheduled
            ? {
                scheduled_publish_at: scheduled.toISOString(),
                scheduled_publish_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
              }
            : {}),
          // The API rejects cc/bcc on an internal note, so only a public
          // comment carries them.
          ...(isTicket && !originalIsInternal && cc?.length ? { cc } : {}),
          ...(isTicket && !originalIsInternal && bcc?.length ? { bcc } : {}),
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
            notificationSuppression,
          }).catch(() => {});
        }

        await secureStorage.deleteItem(draftKey);
        if (isTicket) invalidateTicketsListCache();
        await Promise.all([fetchTicket(), fetchComments()]);
        showToast({ message: t(scheduled ? "comments.commentScheduled" : "comments.commentSent"), tone: "success" });
        return true;
      } finally {
        setCommentSending(false);
        commentSendInFlightRef.current = false;
      }
    },
    [api, client, commentSending, draftKey, fetchComments, fetchTicket, isOffline, isTicket, session, showToast, ticketId],
  );

  // Lean reply path: optimistic insert nested under the parent, POST with
  // parent_comment_id, reconcile, refresh. No draft persistence / resolution /
  // close-status (replies don't carry those). is_internal is sent as false; the
  // server ignores it for replies and inherits the thread root's visibility.
  const submitReply = useCallback(
    async ({
      parentCommentId,
      serializedDraft,
      text,
    }: {
      parentCommentId: string;
      serializedDraft: string;
      text: string;
    }): Promise<boolean> => {
      if (!client || !session) return false;

      const trimmedText = text.trim();
      if (!trimmedText) return false;
      if (trimmedText.length > MAX_COMMENT_LENGTH) return false;
      if (isOffline) {
        showToast({ message: t("comments.offlineToast"), tone: "info" });
        return false;
      }

      const optimisticId = `optimistic-reply-${Date.now()}`;
      let parentThreadKey: string | null | undefined;
      setComments((prev) => {
        const parent = prev.find((c) => c.comment_id === parentCommentId);
        parentThreadKey = parent?.thread_id ?? parent?.comment_id ?? parentCommentId;
        const optimisticReply: TicketComment = {
          comment_id: optimisticId,
          comment_text: serializedDraft,
          parent_comment_id: parentCommentId,
          thread_id: parentThreadKey,
          created_at: new Date().toISOString(),
          created_by: session.user?.id ?? null,
          created_by_name: session.user?.name ?? session.user?.email ?? "You",
          optimistic: true,
        };
        return [...prev, optimisticReply];
      });

      try {
        const auditHeaders = await getClientMetadataHeaders();
        const result = await api.add(client, {
          apiKey: session.accessToken,
          comment_text: serializedDraft,
          is_internal: !isTicket,
          parent_comment_id: parentCommentId,
          auditHeaders,
        });
        if (!result.ok) {
          setComments((prev) => prev.filter((c) => c.comment_id !== optimisticId));
          const msg =
            result.error.kind === "permission"
              ? t("comments.errors.permission")
              : result.error.kind === "validation"
                ? (getApiErrorMessage(result.error.body) ?? t("comments.errors.validation"))
                : t("comments.errors.generic");
          showToast({ message: t("comments.commentNotSent"), tone: "error" });
          setCommentSendError(msg);
          return false;
        }

        setComments((prev) =>
          prev.map((c) => {
            if (c.comment_id !== optimisticId) return c;
            return {
              ...c,
              ...result.data.data,
              parent_comment_id: result.data.data.parent_comment_id ?? c.parent_comment_id,
              thread_id: result.data.data.thread_id ?? c.thread_id,
              created_by_name: result.data.data.created_by_name ?? c.created_by_name,
              comment_text: result.data.data.comment_text ?? c.comment_text,
              optimistic: false,
            };
          }),
        );
        if (isTicket) invalidateTicketsListCache();
        await fetchComments();
        showToast({ message: t("comments.commentSent"), tone: "success" });
        return true;
      } catch {
        setComments((prev) => prev.filter((c) => c.comment_id !== optimisticId));
        showToast({ message: t("comments.commentNotSent"), tone: "error" });
        return false;
      }
    },
    [api, client, fetchComments, isOffline, isTicket, session, showToast, t, setComments],
  );

  const sendComment = async (notificationSuppression?: TicketNotificationSuppressionOptions) => {
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
      notificationSuppression,
      scheduleAt: commentScheduleAt,
      cc: commentCc,
      bcc: commentBcc,
    });
    if (sent) {
      setCommentIsResolution(false);
      setCommentCloseStatusId(null);
      setCommentScheduleAt(null);
      setCommentCc([]);
      setCommentBcc([]);
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
    commentScheduleAt,
    setCommentScheduleAt,
    commentCc,
    setCommentCc,
    commentBcc,
    setCommentBcc,
    commentSendError,
    commentSending,
    draftLoaded,
    commentEditorRef,
    sendComment,
    submitCommentPayload,
    submitReply,
  };
}
