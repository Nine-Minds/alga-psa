import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, Alert, Linking, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../ui/ThemeContext";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import { addTicketComment, getTicketById, getTicketComments, getTicketPriorities, getTicketStatuses, toggleCommentReaction, updateTicketAssignment, updateTicketAttributes, updateTicketPriority, updateTicketStatus, type AggregatedReaction, type TicketComment, type TicketDetail, type TicketPriority, type TicketStatus } from "../api/tickets";
import { ErrorState, LoadingState } from "../ui/states";
import React, { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { getCachedTicketDetail, invalidateTicketsListCache, setCachedTicketDetail } from "../cache/ticketsCache";
import { getCachedTicketStatuses, setCachedTicketStatuses } from "../cache/referenceDataCache";
import { Avatar } from "../ui/components/Avatar";
import { Badge } from "../ui/components/Badge";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { getSecureJson, secureStorage, setSecureJson } from "../storage/secureStorage";
import { getClientMetadataHeaders } from "../device/clientMetadata";
import { createTimeEntry } from "../api/timeEntries";
import { formatDateTimeWithRelative } from "../ui/formatters/dateTime";
import { buildTicketWebUrl } from "../urls/hostedUrls";
import { copyToClipboard } from "../clipboard/clipboard";
import { useNetworkStatus } from "../network/useNetworkStatus";
import { isOffline as isOfflineStatus } from "../network/isOffline";
import { useToast } from "../ui/toast/ToastProvider";
import EmojiPicker from "rn-emoji-keyboard";
import {
  extractPlainTextFromRichEditorJson,
  extractPlainTextFromSerializedRichEditorContent,
  isMalformedRichEditorContent,
  serializeRichEditorJson,
} from "../features/ticketRichText/helpers";
import {
  TicketRichTextEditor,
  type TicketRichTextEditorRef,
} from "../features/ticketRichText/TicketRichTextEditor";
import type { TicketRichTextQaScenario } from "../qa/ticketRichTextQa";

type Props = NativeStackScreenProps<RootStackParamList, "TicketDetail">;

const MAX_COMMENT_LENGTH = 5000;
const QA_LINK_URL = "https://example.com/mobile-rich-text-smoke";
const QA_DESCRIPTION_JSON = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Mobile rich text smoke check: " },
        {
          type: "text",
          text: "open reference link",
          marks: [
            {
              type: "link",
              attrs: {
                href: QA_LINK_URL,
                target: "_blank",
                rel: "noopener noreferrer nofollow",
              },
            },
          ],
        },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Checklist item one" }] }],
        },
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Checklist item two" }] }],
        },
      ],
    },
  ],
} as const;
const QA_COMMENT_JSON = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "QA comment sent from native rich text flow." },
      ],
    },
    {
      type: "orderedList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Confirm editor loads" }] }],
        },
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Confirm save path works" }] }],
        },
      ],
    },
  ],
} as const;
const QA_DESCRIPTION_CONTENT = serializeRichEditorJson(QA_DESCRIPTION_JSON);
const QA_DESCRIPTION_PLAIN_TEXT = extractPlainTextFromRichEditorJson(QA_DESCRIPTION_JSON).trim();
const QA_COMMENT_CONTENT = serializeRichEditorJson(QA_COMMENT_JSON);
const QA_COMMENT_PLAIN_TEXT = extractPlainTextFromRichEditorJson(QA_COMMENT_JSON).trim();

type TicketRichTextQaStatus =
  | {
      scenario: TicketRichTextQaScenario;
      state: "running" | "passed" | "failed";
      step: string;
      detail?: string;
    }
  | null;

export function TicketDetailScreen({ route }: Props) {
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession } = useAuth();
  return (
    <TicketDetailBody
      ticketId={route.params.ticketId}
      qaScenario={route.params.qaScenario}
      config={config}
      session={session}
      refreshSession={refreshSession}
    />
  );
}

export function TicketDetailBody({
  ticketId,
  qaScenario,
  config,
  session,
  refreshSession,
}: {
  ticketId: string;
  qaScenario?: TicketRichTextQaScenario;
  config: ReturnType<typeof getAppConfig>;
  session: ReturnType<typeof useAuth>["session"];
  refreshSession: ReturnType<typeof useAuth>["refreshSession"];
}) {
  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/ticket-detail",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);
  const theme = useTheme();
  const { colors, spacing, typography } = theme;
  const { showToast } = useToast();
  const { t } = useTranslation("tickets");

  const [ticket, setTicket] = useState<TicketDetail | null>(() => {
    const cached = getCachedTicketDetail(ticketId);
    return cached ? (cached as TicketDetail) : null;
  });
  const [initialLoading, setInitialLoading] = useState(ticket === null);
  const [error, setError] = useState<{ title: string; description: string } | null>(null);
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentsVisibleCount, setCommentsVisibleCount] = useState(20);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentDraftPlainText, setCommentDraftPlainText] = useState("");
  const [commentIsInternal, setCommentIsInternal] = useState(true);
  const [commentSendError, setCommentSendError] = useState<string | null>(null);
  const [commentSending, setCommentSending] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [descriptionEditing, setDescriptionEditing] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [descriptionPlainText, setDescriptionPlainText] = useState("");
  const [descriptionSaving, setDescriptionSaving] = useState(false);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [statusOptions, setStatusOptions] = useState<TicketStatus[]>([]);
  const [statusOptionsLoading, setStatusOptionsLoading] = useState(false);
  const [statusOptionsError, setStatusOptionsError] = useState<string | null>(null);
  const [pendingStatusId, setPendingStatusId] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusUpdateError, setStatusUpdateError] = useState<string | null>(null);
  const [priorityPickerOpen, setPriorityPickerOpen] = useState(false);
  const [priorityOptions, setPriorityOptions] = useState<TicketPriority[]>([]);
  const [priorityOptionsLoading, setPriorityOptionsLoading] = useState(false);
  const [priorityOptionsError, setPriorityOptionsError] = useState<string | null>(null);
  const [priorityUpdating, setPriorityUpdating] = useState(false);
  const [priorityUpdateError, setPriorityUpdateError] = useState<string | null>(null);
  const [dueDateOpen, setDueDateOpen] = useState(false);
  const [dueDateDraft, setDueDateDraft] = useState("");
  const [dueDateUpdating, setDueDateUpdating] = useState(false);
  const [dueDateError, setDueDateError] = useState<string | null>(null);
  const [watchUpdating, setWatchUpdating] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [timeEntryOpen, setTimeEntryOpen] = useState(false);
  const [timeEntryDurationMin, setTimeEntryDurationMin] = useState("15");
  const [timeEntryNotes, setTimeEntryNotes] = useState("");
  const [timeEntryUpdating, setTimeEntryUpdating] = useState(false);
  const [timeEntryError, setTimeEntryError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const commentEditorRef = useRef<TicketRichTextEditorRef>(null);
  const descriptionEditorRef = useRef<TicketRichTextEditorRef>(null);
  const network = useNetworkStatus();
  const isOffline = isOfflineStatus(network);
  const commentSendInFlightRef = useRef(false);
  const statusUpdateInFlightRef = useRef(false);
  const qaScenarioStartedRef = useRef(false);
  const qaLinkCallbackRef = useRef<(() => void) | null>(null);
  const [assignmentUpdating, setAssignmentUpdating] = useState(false);
  const [assignmentAction, setAssignmentAction] = useState<"assign" | "unassign" | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [qaStatus, setQaStatus] = useState<TicketRichTextQaStatus>(null);
  const [qaAutoPressLink, setQaAutoPressLink] = useState(false);

  useEffect(() => {
    qaScenarioStartedRef.current = false;
    qaLinkCallbackRef.current = null;
    setQaAutoPressLink(false);
    setQaStatus(null);
  }, [qaScenario, ticketId]);

  const draftKey = useMemo(() => {
    const userId = session?.user?.id ?? "anonymous";
    return `alga.mobile.ticketDraft.${userId}.${ticketId}`;
  }, [session?.user?.id, ticketId]);

  const visibilityPrefKey = useMemo(() => {
    const userId = session?.user?.id ?? "anonymous";
    return `alga.mobile.ticketComment.visibility.${userId}`;
  }, [session?.user?.id]);

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

  useEffect(() => {
    if (descriptionEditing || !ticket) {
      return;
    }

    const currentDescription = extractDescription(ticket) ?? "";
    setDescriptionDraft(currentDescription);
    setDescriptionPlainText(extractPlainTextFromSerializedRichEditorContent(currentDescription));
  }, [descriptionEditing, ticket]);

  useEffect(() => {
    if (!draftLoaded) return;
    void setSecureJson(draftKey, { text: commentDraft, isInternal: commentIsInternal });
  }, [commentDraft, commentIsInternal, draftKey, draftLoaded]);

  useEffect(() => {
    if (!draftLoaded) return;
    void setSecureJson(visibilityPrefKey, commentIsInternal);
  }, [commentIsInternal, draftLoaded, visibilityPrefKey]);

  const fetchTicket = useCallback(async () => {
    if (!client || !session) return;
    setError(null);
    const result = await getTicketById(client, { apiKey: session.accessToken, ticketId });
    if (!result.ok) {
      if (result.error.kind === "http" && result.status === 404) {
        setTicket(null);
        setError({ title: t("detail.ticketNotFound"), description: t("detail.ticketNotFoundDescription") });
        return;
      }
      if (result.error.kind === "permission") {
        setError({ title: t("detail.noAccessTitle"), description: t("detail.noAccessDescription") });
        return;
      }
      setError({ title: t("detail.unableToLoad"), description: t("detail.unableToLoadDescription") });
      return;
    }
    setTicket(result.data.data);
    setCachedTicketDetail(ticketId, result.data.data);
  }, [client, session, ticketId]);

  const fetchComments = useCallback(async () => {
    if (!client || !session) return;
    setCommentsError(null);
    const result = await getTicketComments(client, { apiKey: session.accessToken, ticketId });
    if (!result.ok) {
      setCommentsError(t("comments.errors.loadFailed"));
      return;
    }
    setComments(result.data.data);
  }, [client, session, ticketId]);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchTicket(), fetchComments()]);
  }, [fetchComments, fetchTicket]);

  const scrollToLatest = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, []);

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  const { refreshing, refresh } = usePullToRefresh(refreshAll);

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      if (!client || !session) return;
      if (ticket === null) setInitialLoading(true);
      await fetchTicket();
      await fetchComments();
      if (!canceled) setInitialLoading(false);
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [client, fetchTicket, session, ticketId]);

  const updateQaStatus = useCallback(
    (next: Exclude<TicketRichTextQaStatus, null>) => {
      setQaStatus(next);
      console.info("[TicketRichTextQA]", next.scenario, next.state, next.step, next.detail ?? "");
    },
    [],
  );

  const handleRichTextLinkPress = useCallback(
    (url: string) => {
      if (qaScenario && url === QA_LINK_URL) {
        setQaAutoPressLink(false);
        qaLinkCallbackRef.current?.();
        qaLinkCallbackRef.current = null;
        updateQaStatus({
          scenario: qaScenario,
          state: "passed",
          step: "Triggered rich-text link handoff",
          detail: url,
        });
      }

      void Linking.openURL(url);
    },
    [qaScenario, updateQaStatus],
  );

  const persistDescriptionContent = useCallback(
    async (serializedDescription: string, nextPlainText: string): Promise<boolean> => {
      if (!client || !session || !ticket || descriptionSaving) {
        return false;
      }

      setDescriptionSaving(true);
      setDescriptionError(null);

      try {
        const nextAttributes = getTicketAttributes(ticket);

        if (nextPlainText) {
          nextAttributes.description = serializedDescription;
        } else {
          delete (nextAttributes as any).description;
        }

        const auditHeaders = await getClientMetadataHeaders();
        const result = await updateTicketAttributes(client, {
          apiKey: session.accessToken,
          ticketId,
          attributes: Object.keys(nextAttributes).length === 0 ? null : nextAttributes,
          auditHeaders,
        });

        if (!result.ok) {
          if (result.error.kind === "permission") {
            setDescriptionError(t("description.errors.permission"));
            return false;
          }
          if (result.error.kind === "validation") {
            const msg = getApiErrorMessage(result.error.body);
            setDescriptionError(msg ?? t("description.errors.validation"));
            return false;
          }
          setDescriptionError(t("description.errors.generic"));
          return false;
        }

        setTicket(result.data.data);
        setCachedTicketDetail(ticketId, result.data.data);
        invalidateTicketsListCache();
        setDescriptionDraft(serializedDescription);
        setDescriptionPlainText(nextPlainText);
        setDescriptionEditing(false);
        showToast({ message: t("description.descriptionUpdated"), tone: "success" });
        return true;
      } finally {
        setDescriptionSaving(false);
      }
    },
    [client, descriptionSaving, session, showToast, ticket, ticketId],
  );

  const submitCommentPayload = useCallback(
    async ({
      serializedDraft,
      text,
      originalDraft,
      originalDraftPlainText,
      originalIsInternal,
    }: {
      serializedDraft: string;
      text: string;
      originalDraft: string;
      originalDraftPlainText: string;
      originalIsInternal: boolean;
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
              created_by_name: (result.data.data as any).created_by_name ?? c.created_by_name,
              comment_text: result.data.data.comment_text ?? c.comment_text,
              optimistic: false,
            };
          }),
        );
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
    await submitCommentPayload({
      serializedDraft,
      text,
      originalDraft,
      originalDraftPlainText,
      originalIsInternal,
    });
  };

  const startDescriptionEditing = () => {
    if (!ticket) return;
    const currentDescription = extractDescription(ticket) ?? "";
    setDescriptionDraft(currentDescription);
    setDescriptionPlainText(extractPlainTextFromSerializedRichEditorContent(currentDescription));
    setDescriptionError(null);
    setDescriptionEditing(true);
  };

  const cancelDescriptionEditing = () => {
    if (!ticket) return;
    const currentDescription = extractDescription(ticket) ?? "";
    setDescriptionDraft(currentDescription);
    setDescriptionPlainText(extractPlainTextFromSerializedRichEditorContent(currentDescription));
    setDescriptionError(null);
    setDescriptionEditing(false);
  };

  const saveDescription = async () => {
    if (!client || !session || descriptionSaving) {
      return;
    }

    if (!descriptionEditorRef.current) {
      setDescriptionError(t("description.editorStillLoading"));
      return;
    }

    const nextJson = await descriptionEditorRef.current.getJSON().catch(() => null);
    if (!nextJson) {
      setDescriptionError(t("description.unableToReadEditor"));
      return;
    }

    const serializedDescription = serializeRichEditorJson(nextJson);
    const nextPlainText = extractPlainTextFromRichEditorJson(nextJson).trim();
    await persistDescriptionContent(serializedDescription, nextPlainText);
  };

  useEffect(() => {
    if (!qaScenario || qaScenarioStartedRef.current) {
      return;
    }

    if (initialLoading || !ticket || !draftLoaded) {
      return;
    }

    qaScenarioStartedRef.current = true;

    const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    const waitForQaLink = () =>
      new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          qaLinkCallbackRef.current = null;
          reject(new Error("Timed out waiting for rich-text link handoff"));
        }, 2_000);

        qaLinkCallbackRef.current = () => {
          clearTimeout(timeoutId);
          resolve();
        };
      });

    const runScenario = async () => {
      try {
        if (qaScenario === "malformed-guard") {
          const hasMalformedDescription = Boolean(
            extractDescription(ticket) && isMalformedRichEditorContent(extractDescription(ticket) ?? ""),
          );
          const hasMalformedComment = comments.some((comment) => {
            const kind = (comment as any).kind as TicketComment["kind"] | undefined;
            const eventType = (comment as any).event_type as TicketComment["event_type"] | undefined;
            if (kind === "event" || typeof eventType === "string") return false;
            return isMalformedRichEditorContent(comment.comment_text);
          });

          if (!hasMalformedDescription && !hasMalformedComment) {
            throw new Error("Malformed QA scenario requires malformed description or comment content.");
          }

          updateQaStatus({
            scenario: qaScenario,
            state: "passed",
            step: "Malformed content stayed on safe text fallback",
          });
          return;
        }

        updateQaStatus({
          scenario: qaScenario,
          state: "running",
          step: "Opening description editor",
        });
        startDescriptionEditing();
        setDescriptionDraft(QA_DESCRIPTION_CONTENT);
        setDescriptionPlainText(QA_DESCRIPTION_PLAIN_TEXT);
        await pause(600);

        updateQaStatus({
          scenario: qaScenario,
          state: "running",
          step: "Saving rich description",
        });
        const descriptionSaved = await persistDescriptionContent(
          QA_DESCRIPTION_CONTENT,
          QA_DESCRIPTION_PLAIN_TEXT,
        );
        if (!descriptionSaved) {
          throw new Error("Description save failed");
        }

        await pause(600);
        updateQaStatus({
          scenario: qaScenario,
          state: "running",
          step: "Sending rich comment",
        });
        setCommentDraft(QA_COMMENT_CONTENT);
        setCommentDraftPlainText(QA_COMMENT_PLAIN_TEXT);
        const commentSent = await submitCommentPayload({
          serializedDraft: QA_COMMENT_CONTENT,
          text: QA_COMMENT_PLAIN_TEXT,
          originalDraft: QA_COMMENT_CONTENT,
          originalDraftPlainText: QA_COMMENT_PLAIN_TEXT,
          originalIsInternal: true,
        });
        if (!commentSent) {
          throw new Error("Comment send failed");
        }

        await pause(600);
        updateQaStatus({
          scenario: qaScenario,
          state: "running",
          step: "Triggering rich-text link handoff",
          detail: QA_LINK_URL,
        });
        setQaAutoPressLink(true);
        await waitForQaLink();
      } catch (scenarioError) {
        setQaAutoPressLink(false);
        updateQaStatus({
          scenario: qaScenario,
          state: "failed",
          step: "QA scenario failed",
          detail: scenarioError instanceof Error ? scenarioError.message : "Unknown error",
        });
      }
    };

    void runScenario();
  }, [
    comments,
    draftLoaded,
    initialLoading,
    persistDescriptionContent,
    qaScenario,
    submitCommentPayload,
    ticket,
    updateQaStatus,
  ]);

  if (!config.ok) {
    return <ErrorState title={t("common:configurationError")} description={config.error} />;
  }
  if (!session) {
    return <ErrorState title={t("common:signedOut")} description={t("common:signInAgain")} />;
  }

  if (initialLoading && !ticket) {
    return <LoadingState message={t("detail.loadingTicket")} />;
  }

  if (error && !ticket) {
    return <ErrorState title={error.title} description={error.description} />;
  }

  if (!ticket) {
    return <ErrorState title={t("detail.ticketNotFound")} description={t("detail.ticketUnavailable")} />;
  }

  const statusLabel = pendingStatusId
    ? (statusOptions.find((s) => s.status_id === pendingStatusId)?.name ??
      ticket.status_name ??
      t("common:unknown"))
    : (ticket.status_name ?? t("common:unknown"));

  const meUserId = session.user?.id;
  const isWatching = meUserId ? getWatcherUserIds(ticket).includes(meUserId) : false;
  const assignedToId = (ticket as any).assigned_to as string | null | undefined;
  const isAssignedToMe = Boolean(meUserId && assignedToId && assignedToId === meUserId);

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

  const submitPriority = async (priorityId: string) => {
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
    } finally {
      setPriorityUpdating(false);
    }
  };

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

  const submitDueDateIso = async (nextIso: string | null) => {
    if (!client || !session) return;
    if (dueDateUpdating) return;
    setDueDateError(null);
    setDueDateUpdating(true);
    try {
      const auditHeaders = await getClientMetadataHeaders();
      const base = getTicketAttributes(ticket);
      const next: Record<string, unknown> = { ...base };

      if (nextIso === null) {
        delete (next as any).due_date;
      } else {
        (next as any).due_date = nextIso;
      }

      const attributesToSend = Object.keys(next).length === 0 ? null : next;
      const res = await updateTicketAttributes(client, {
        apiKey: session.accessToken,
        ticketId,
        attributes: attributesToSend,
        auditHeaders,
      });
      if (!res.ok) {
        if (res.error.kind === "permission") {
          setDueDateError(t("detail.errors.dueDatePermission"));
          return;
        }
        if (res.error.kind === "validation") {
          const msg = getApiErrorMessage(res.error.body);
          setDueDateError(msg ?? t("detail.errors.dueDateValidation"));
          return;
        }
        setDueDateError(t("detail.errors.dueDateGeneric"));
        return;
      }
      invalidateTicketsListCache();
      await fetchTicket();
      setDueDateOpen(false);
    } finally {
      setDueDateUpdating(false);
    }
  };

  const saveDueDateFromDraft = async () => {
    const trimmed = dueDateDraft.trim();
    if (!trimmed) {
      await submitDueDateIso(null);
      return;
    }
    const iso = dateInputToIso(trimmed);
    if (!iso) {
      setDueDateError(t("detail.errors.dueDateFormat"));
      return;
    }
    await submitDueDateIso(iso);
  };

  const setDueDateInDays = async (days: number) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    await submitDueDateIso(d.toISOString());
  };

  const toggleWatch = async () => {
    if (!client || !session) return;
    if (watchUpdating) return;
    const me = session.user?.id;
    if (!me) {
      setWatchError(t("detail.errors.watchNoUser"));
      return;
    }

    setWatchError(null);
    setWatchUpdating(true);
    try {
      const base = getTicketAttributes(ticket);
      const existing = getWatcherUserIds(ticket);
      const nextIds = existing.includes(me)
        ? existing.filter((id) => id !== me)
        : [...existing, me];

      const nextAttrs: Record<string, unknown> = { ...base };
      if (nextIds.length > 0) {
        (nextAttrs as any).watcher_user_ids = nextIds;
      } else {
        delete (nextAttrs as any).watcher_user_ids;
      }

      const auditHeaders = await getClientMetadataHeaders();
      const res = await updateTicketAttributes(client, {
        apiKey: session.accessToken,
        ticketId,
        attributes: Object.keys(nextAttrs).length === 0 ? null : nextAttrs,
        auditHeaders,
      });

      if (!res.ok) {
        if (res.error.kind === "permission") {
          setWatchError(t("detail.errors.watchPermission"));
          return;
        }
        if (res.error.kind === "validation") {
          const msg = getApiErrorMessage(res.error.body);
          setWatchError(msg ?? t("detail.errors.watchValidation"));
          return;
        }
        setWatchError(t("detail.errors.watchGeneric"));
        return;
      }

      invalidateTicketsListCache();
      await fetchTicket();
    } finally {
      setWatchUpdating(false);
    }
  };

  const openTimeEntryModal = () => {
    setTimeEntryError(null);
    setTimeEntryDurationMin("15");
    setTimeEntryNotes("");
    setTimeEntryOpen(true);
  };

  const submitTimeEntry = async () => {
    if (!client || !session) return;
    if (timeEntryUpdating) return;

    const duration = Number(timeEntryDurationMin.trim());
    if (!Number.isFinite(duration) || duration <= 0) {
      setTimeEntryError(t("timeEntry.errors.invalidDuration"));
      return;
    }

    setTimeEntryError(null);
    setTimeEntryUpdating(true);
    try {
      const end = new Date();
      const start = new Date(end.getTime() - Math.round(duration) * 60_000);

      const auditHeaders = await getClientMetadataHeaders();
      const res = await createTimeEntry(client, {
        apiKey: session.accessToken,
        work_item_type: "ticket",
        work_item_id: ticketId,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        notes: timeEntryNotes.trim() || undefined,
        is_billable: true,
        auditHeaders,
      });

      if (!res.ok) {
        if (res.error.kind === "permission") {
          setTimeEntryError(t("timeEntry.errors.permission"));
          return;
        }
        if (res.error.kind === "validation") {
          const msg = getApiErrorMessage(res.error.body);
          setTimeEntryError(msg ?? t("timeEntry.errors.validation"));
          return;
        }
        setTimeEntryError(t("timeEntry.errors.generic"));
        return;
      }

      setTimeEntryOpen(false);
      Alert.alert(t("timeEntry.created"), t("timeEntry.createdMessage", { minutes: Math.round(duration) }));
    } finally {
      setTimeEntryUpdating(false);
    }
  };

      return (
        <>
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1, backgroundColor: colors.background }}
            contentContainerStyle={{ padding: spacing.lg }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          >
        {error ? (
          <View
            style={{
              padding: spacing.md,
              borderRadius: 12,
              backgroundColor: colors.badge.warning.bg,
              borderWidth: 1,
              borderColor: colors.warning,
              marginBottom: spacing.md,
            }}
          >
            <Text style={{ ...typography.caption, color: colors.badge.warning.text, fontWeight: "700" }}>{error.title}</Text>
            <Text style={{ ...typography.caption, color: colors.badge.warning.text, marginTop: 2 }}>{error.description}</Text>
          </View>
        ) : null}
        {qaStatus ? (
          <View
            style={{
              padding: spacing.md,
              borderRadius: 12,
              backgroundColor:
                qaStatus.state === "failed"
                  ? colors.badge.danger.bg
                  : qaStatus.state === "passed"
                    ? colors.badge.success.bg
                    : colors.badge.info.bg,
              borderWidth: 1,
              borderColor:
                qaStatus.state === "failed"
                  ? colors.danger
                  : qaStatus.state === "passed"
                    ? colors.success
                    : colors.info,
              marginBottom: spacing.md,
            }}
          >
            <Text style={{ ...typography.caption, color: colors.text, fontWeight: "700" }}>
              QA {qaStatus.scenario}
            </Text>
            <Text style={{ ...typography.caption, color: colors.text, marginTop: 2 }}>
              {qaStatus.state.toUpperCase()} - {qaStatus.step}
            </Text>
            {qaStatus.detail ? (
              <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>
                {qaStatus.detail}
              </Text>
            ) : null}
          </View>
        ) : null}

        <Text style={{ ...typography.caption, color: colors.textSecondary }}>
          {ticket.ticket_number}
          {ticket.client_name ? ` • ${ticket.client_name}` : ""}
          {ticket.contact_name ? ` • ${ticket.contact_name}` : ""}
        </Text>
        <Text accessibilityRole="header" style={{ ...typography.title, marginTop: 2, color: colors.text }}>
          {ticket.title}
        </Text>

        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.md }}>
          <Badge label={statusLabel} tone={ticket.status_is_closed ? "neutral" : "info"} />
          {ticket.priority_name ? <View style={{ width: spacing.sm }} /> : null}
          {ticket.priority_name ? <Badge label={ticket.priority_name} tone="warning" /> : null}
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm }}>
	          <ActionChip
	            label={t("detail.changeStatus")}
	            onPress={() => {
	              void (async () => {
	                if (!client || !session) return;
	                setStatusPickerOpen(true);
	                if (statusOptions.length > 0) return;
	                const tenantKey = session.tenantId ?? "unknownTenant";
	                const cached = getCachedTicketStatuses(tenantKey);
	                if (Array.isArray(cached) && cached.length > 0) {
	                  setStatusOptions(cached as TicketStatus[]);
	                  return;
	                }
	                setStatusOptionsLoading(true);
	                setStatusOptionsError(null);
	                try {
	                  const res = await getTicketStatuses(client, { apiKey: session.accessToken });
	                  if (!res.ok) {
	                    setStatusOptionsError(t("detail.errors.unableToLoadStatuses"));
	                    return;
	                  }
	                  setStatusOptions(res.data.data);
	                  setCachedTicketStatuses(tenantKey, res.data.data);
	                } finally {
	                  setStatusOptionsLoading(false);
	                }
	              })();
	            }}
	          />
          <View style={{ width: spacing.sm }} />
          <ActionChip
            label={t("detail.changePriority")}
            onPress={() => {
              void (async () => {
                if (!client || !session) return;
                setPriorityPickerOpen(true);
                if (priorityOptions.length > 0) return;
                setPriorityOptionsLoading(true);
                setPriorityOptionsError(null);
                try {
                  const res = await getTicketPriorities(client, { apiKey: session.accessToken });
                  if (!res.ok) {
                    setPriorityOptionsError(t("detail.errors.unableToLoadPriorities"));
                    return;
                  }
                  setPriorityOptions(res.data.data);
                } finally {
                  setPriorityOptionsLoading(false);
                }
              })();
            }}
          />
          <View style={{ width: spacing.sm }} />
          <ActionChip
            label={t("detail.dueDate")}
            onPress={() => {
              setDueDateError(null);
              setDueDateDraft(isoToDateInput(getDueDateIso(ticket)) ?? "");
              setDueDateOpen(true);
            }}
          />
          <View style={{ width: spacing.sm }} />
          <ActionChip
            label={isWatching ? t("detail.unwatch") : t("detail.watch")}
            loading={watchUpdating}
            disabled={!meUserId}
            onPress={() => {
              void toggleWatch();
            }}
          />
          <View style={{ width: spacing.sm }} />
          <ActionChip
            label={t("detail.addTime")}
            onPress={() => {
              openTimeEntryModal();
            }}
          />
          <View style={{ width: spacing.sm }} />
          <ActionChip
            label={
              assignmentUpdating && assignmentAction === "assign"
                ? t("detail.assigning")
                : isAssignedToMe
                  ? t("detail.assignedToMe")
                  : t("detail.assignToMe")
            }
            loading={assignmentUpdating && assignmentAction === "assign"}
            disabled={assignmentUpdating || isAssignedToMe}
            onPress={() => {
              void assignToMe();
            }}
          />
          {ticket.assigned_to_name ? (
            <>
              <View style={{ width: spacing.sm }} />
              <ActionChip
                label={assignmentUpdating && assignmentAction === "unassign" ? t("detail.unassigning") : t("detail.unassign")}
                loading={assignmentUpdating && assignmentAction === "unassign"}
                disabled={assignmentUpdating}
                onPress={() => {
                  void unassign();
                }}
              />
            </>
          ) : null}
        </View>

        {watchError ? (
          <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
            {watchError}
          </Text>
        ) : null}

        {assignmentError ? (
          <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
            {assignmentError}
          </Text>
        ) : null}

        <TicketActions
          baseUrl={config.ok ? config.baseUrl : null}
          ticketId={ticket.ticket_id}
          ticketNumber={ticket.ticket_number}
        />

        {ticket.assigned_to_name ? (
          <Text style={{ ...typography.body, marginTop: spacing.md, color: colors.text }}>
            {t("detail.assignedTo", { name: ticket.assigned_to_name })}
          </Text>
        ) : (
          <Text style={{ ...typography.body, marginTop: spacing.md, color: colors.textSecondary }}>
            {t("detail.unassigned")}
          </Text>
        )}

        <View style={{ marginTop: spacing.lg }}>
          <KeyValue label={t("detail.requester")} value={stringOrDash(ticket.contact_name)} />
          <View style={{ height: spacing.sm }} />
          <KeyValue label={t("detail.client")} value={stringOrDash(ticket.client_name)} />
          <View style={{ height: spacing.sm }} />
          <DescriptionSection
            ticket={ticket}
            isEditing={descriptionEditing}
            draftContent={descriptionDraft}
            draftPlainText={descriptionPlainText}
            saving={descriptionSaving}
            error={descriptionError}
            editorRef={descriptionEditorRef}
            onLinkPress={handleRichTextLinkPress}
            qaAutoPressFirstLink={qaAutoPressLink}
            onStartEditing={startDescriptionEditing}
            onCancelEditing={cancelDescriptionEditing}
            onSave={() => void saveDescription()}
            onDraftChange={(nextContent, nextPlainText) => {
              setDescriptionDraft(nextContent);
              setDescriptionPlainText(nextPlainText);
            }}
          />
          <View style={{ height: spacing.sm }} />
          <CommentsSection
            comments={comments}
            visibleCount={commentsVisibleCount}
            onLoadMore={() => setCommentsVisibleCount((c) => c + 20)}
            onJumpToLatest={scrollToLatest}
            onJumpToTop={scrollToTop}
            error={commentsError}
            onLinkPress={handleRichTextLinkPress}
            baseUrl={config.ok ? config.baseUrl : null}
            ticketId={ticketId}
          />
          <View style={{ height: spacing.sm }} />
          <CommentComposer
            draftContent={commentDraft}
            draftPlainText={commentDraftPlainText}
            isInternal={commentIsInternal}
            onChangeIsInternal={setCommentIsInternal}
            onSend={() => void sendComment()}
            sending={commentSending}
            offline={isOffline}
            error={commentSendError}
            editorRef={commentEditorRef}
            onDraftChange={(nextContent, nextPlainText) => {
              setCommentDraft(nextContent);
              setCommentDraftPlainText(nextPlainText);
            }}
          />
          <View style={{ height: spacing.sm }} />
          <KeyValue label={t("detail.created")} value={formatDateTimeWithRelative(ticket.entered_at)} />
          <View style={{ height: spacing.sm }} />
          <KeyValue label={t("detail.updated")} value={formatDateTimeWithRelative(ticket.updated_at)} />
          <View style={{ height: spacing.sm }} />
          <KeyValue label={t("detail.due")} value={formatDateTimeWithRelative(getDueDateIso(ticket))} />
          <View style={{ height: spacing.sm }} />
          <KeyValue label={t("detail.closed")} value={formatDateTimeWithRelative(ticket.closed_at)} />
          <View style={{ height: spacing.sm }} />
          <KeyValue label={t("detail.ticketId")} value={ticket.ticket_id} />
        </View>
      </ScrollView>

      <DueDateModal
        visible={dueDateOpen}
        currentDueDateIso={getDueDateIso(ticket)}
        draft={dueDateDraft}
        onChangeDraft={setDueDateDraft}
        updating={dueDateUpdating}
        error={dueDateError}
        onClear={() => void submitDueDateIso(null)}
        onSave={() => void saveDueDateFromDraft()}
        onSetInDays={(days) => void setDueDateInDays(days)}
        onClose={() => setDueDateOpen(false)}
      />

      <TimeEntryModal
        visible={timeEntryOpen}
        durationMin={timeEntryDurationMin}
        onChangeDurationMin={setTimeEntryDurationMin}
        notes={timeEntryNotes}
        onChangeNotes={setTimeEntryNotes}
        updating={timeEntryUpdating}
        error={timeEntryError}
        onClose={() => setTimeEntryOpen(false)}
        onSubmit={() => void submitTimeEntry()}
      />

      <PriorityPickerModal
        visible={priorityPickerOpen}
        loading={priorityOptionsLoading}
        error={priorityOptionsError}
        priorities={priorityOptions}
        currentPriorityId={(ticket as any).priority_id ?? null}
        updating={priorityUpdating}
        updateError={priorityUpdateError}
        onSelect={(id) => void submitPriority(id)}
        onClose={() => setPriorityPickerOpen(false)}
      />

      <StatusPickerModal
        visible={statusPickerOpen}
        loading={statusOptionsLoading}
        error={statusOptionsError}
        statuses={statusOptions}
        currentStatusId={pendingStatusId ?? ticket.status_id ?? null}
        updating={statusUpdating}
        updateError={statusUpdateError}
        onSelect={(id) => void submitStatus(id)}
        onClose={() => setStatusPickerOpen(false)}
      />
    </>
  );
}

function DueDateModal({
  visible,
  currentDueDateIso,
  draft,
  onChangeDraft,
  updating,
  error,
  onClear,
  onSave,
  onSetInDays,
  onClose,
}: {
  visible: boolean;
  currentDueDateIso: string | null;
  draft: string;
  onChangeDraft: (value: string) => void;
  updating: boolean;
  error: string | null;
  onClear: () => void;
  onSave: () => void;
  onSetInDays: (days: number) => void;
  onClose: () => void;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
        <Text style={{ ...typography.title, color: colors.text }}>{t("dueDateModal.title")}</Text>
        <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.textSecondary }}>
          {t("dueDateModal.current", { date: formatDateTimeWithRelative(currentDueDateIso) })}
        </Text>

        {updating ? (
          <View style={{ marginTop: spacing.lg, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.textSecondary }}>
              {t("common:saving")}
            </Text>
          </View>
        ) : null}

        {error ? (
          <Text style={{ ...typography.caption, marginTop: spacing.md, color: colors.danger }}>
            {error}
          </Text>
        ) : null}

        <View style={{ marginTop: spacing.lg }}>
          <Text style={{ ...typography.caption, color: colors.textSecondary }}>{t("dueDateModal.setDateLabel")}</Text>
          <TextInput
            value={draft}
            onChangeText={onChangeDraft}
            placeholder={t("dueDateModal.datePlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!updating}
            style={{
              marginTop: spacing.sm,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              color: colors.text,
            }}
          />
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.lg }}>
          <ActionChip
            label={t("dueDateModal.today")}
            disabled={updating}
            onPress={() => onSetInDays(0)}
          />
          <View style={{ width: spacing.sm }} />
          <ActionChip
            label={t("dueDateModal.tomorrow")}
            disabled={updating}
            onPress={() => onSetInDays(1)}
          />
          <View style={{ width: spacing.sm }} />
          <ActionChip
            label={t("dueDateModal.plus7Days")}
            disabled={updating}
            onPress={() => onSetInDays(7)}
          />
        </View>

        <View style={{ flex: 1 }} />

        <View style={{ flexDirection: "row" }}>
          <View style={{ flex: 1 }}>
            <PrimaryButton
              onPress={onClear}
              disabled={updating}
            >
              {t("common:clear")}
            </PrimaryButton>
          </View>
          <View style={{ width: spacing.sm }} />
          <View style={{ flex: 1 }}>
            <PrimaryButton
              onPress={onSave}
              disabled={updating}
            >
              {t("common:save")}
            </PrimaryButton>
          </View>
        </View>

        <View style={{ marginTop: spacing.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("dueDateModal.closeAccessibility")}
            onPress={onClose}
            disabled={updating}
            style={({ pressed }) => ({ opacity: updating ? 0.5 : pressed ? 0.85 : 1, marginTop: spacing.sm })}
          >
            <Text style={{ ...typography.caption, color: colors.textSecondary, textAlign: "center" }}>
              {t("common:close")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function TimeEntryModal({
  visible,
  durationMin,
  onChangeDurationMin,
  notes,
  onChangeNotes,
  updating,
  error,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  durationMin: string;
  onChangeDurationMin: (value: string) => void;
  notes: string;
  onChangeNotes: (value: string) => void;
  updating: boolean;
  error: string | null;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
        <Text style={{ ...typography.title, color: colors.text }}>{t("timeEntry.title")}</Text>
        <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.textSecondary }}>
          {t("timeEntry.durationLabel")}
        </Text>
        <TextInput
          value={durationMin}
          onChangeText={onChangeDurationMin}
          keyboardType="number-pad"
          placeholder={t("timeEntry.durationPlaceholder")}
          editable={!updating}
          style={{
            marginTop: spacing.sm,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            color: colors.text,
          }}
        />

        <Text style={{ ...typography.caption, marginTop: spacing.lg, color: colors.textSecondary }}>
          {t("timeEntry.notesLabel")}
        </Text>
        <TextInput
          value={notes}
          onChangeText={onChangeNotes}
          multiline
          placeholder={t("timeEntry.notesPlaceholder")}
          editable={!updating}
          style={{
            marginTop: spacing.sm,
            minHeight: 90,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            color: colors.text,
          }}
        />

        {updating ? (
          <View style={{ marginTop: spacing.lg, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.textSecondary }}>
              {t("common:saving")}
            </Text>
          </View>
        ) : null}

        {error ? (
          <Text style={{ ...typography.caption, marginTop: spacing.md, color: colors.danger }}>
            {error}
          </Text>
        ) : null}

        <View style={{ flex: 1 }} />
        <PrimaryButton onPress={onSubmit} disabled={updating}>
          {t("timeEntry.saveTimeEntry")}
        </PrimaryButton>
        <View style={{ height: spacing.sm }} />
        <PrimaryButton onPress={onClose} disabled={updating}>
          {t("common:cancel")}
        </PrimaryButton>
      </View>
    </Modal>
  );
}

function PriorityPickerModal({
  visible,
  loading,
  error,
  priorities,
  currentPriorityId,
  updating,
  updateError,
  onSelect,
  onClose,
}: {
  visible: boolean;
  loading: boolean;
  error: string | null;
  priorities: TicketPriority[];
  currentPriorityId: string | null;
  updating: boolean;
  updateError: string | null;
  onSelect: (priorityId: string) => void;
  onClose: () => void;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
  const busy = loading || updating;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
        <Text style={{ ...typography.title, color: colors.text }}>{t("priorityPicker.title")}</Text>
        {busy ? (
          <View style={{ marginTop: spacing.lg, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.textSecondary }}>
              {loading ? t("common:loading") : t("common:saving")}
            </Text>
          </View>
        ) : null}
        {error ? (
          <Text style={{ ...typography.caption, marginTop: spacing.md, color: colors.danger }}>
            {error}
          </Text>
        ) : null}
        {updateError ? (
          <Text style={{ ...typography.caption, marginTop: spacing.md, color: colors.danger }}>
            {updateError}
          </Text>
        ) : null}

        <View style={{ marginTop: spacing.lg }}>
          {priorities.map((p) => {
            const isCurrent = p.priority_id === currentPriorityId;
            const disabled = busy || isCurrent;
            return (
              <Pressable
                key={p.priority_id}
                accessibilityRole="button"
                accessibilityLabel={t("priorityPicker.setPriority", { name: p.priority_name })}
                disabled={disabled}
                onPress={() => {
                  onSelect(p.priority_id);
                }}
                style={({ pressed }) => ({
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.md,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: p.priority_id === currentPriorityId ? colors.primary : colors.border,
                  backgroundColor: colors.card,
                  opacity: disabled ? 0.65 : pressed ? 0.95 : 1,
                  marginBottom: spacing.sm,
                })}
              >
                <Text style={{ ...typography.body, color: colors.text }}>
                  {p.priority_name}
                  {p.priority_id === currentPriorityId ? " ✓" : ""}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ flex: 1 }} />
        <PrimaryButton onPress={onClose}>{t("common:done")}</PrimaryButton>
      </View>
    </Modal>
  );
}

function StatusPickerModal({
  visible,
  loading,
  error,
  updating,
  updateError,
  statuses,
  currentStatusId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  loading: boolean;
  error: string | null;
  updating: boolean;
  updateError: string | null;
  statuses: TicketStatus[];
  currentStatusId: string | null | undefined;
  onSelect: (statusId: string) => void;
  onClose: () => void;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
  const busy = loading || updating;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={onClose} />
      <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: spacing.xl, maxHeight: "70%" }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, paddingBottom: spacing.sm }}>
          <Text style={{ ...typography.title, color: colors.text }}>{t("statusPicker.title")}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common:close")} hitSlop={12}>
            <Text style={{ ...typography.body, color: colors.primary, fontWeight: "600" }}>{t("common:close")}</Text>
          </Pressable>
        </View>

        {busy ? (
          <View style={{ paddingVertical: spacing.lg, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.textSecondary }}>
              {loading ? t("common:loading") : t("common:saving")}
            </Text>
          </View>
        ) : null}
        {error ? (
          <Text style={{ ...typography.caption, paddingHorizontal: spacing.lg, color: colors.danger }}>
            {error}
          </Text>
        ) : null}
        {updateError ? (
          <Text style={{ ...typography.caption, paddingHorizontal: spacing.lg, color: colors.danger }}>
            {updateError}
          </Text>
        ) : null}

        <ScrollView style={{ paddingHorizontal: spacing.lg }}>
          {statuses.map((s) => (
            <Pressable
              key={s.status_id}
              accessibilityRole="button"
              accessibilityLabel={t("statusPicker.setStatus", { name: s.name })}
              disabled={busy || s.status_id === currentStatusId}
              onPress={() => {
                onSelect(s.status_id);
              }}
              style={({ pressed }) => ({
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: s.status_id === currentStatusId ? colors.primary : colors.border,
                backgroundColor: s.status_id === currentStatusId ? colors.primaryLight ?? colors.card : colors.card,
                opacity: busy ? 0.65 : pressed ? 0.95 : 1,
                marginBottom: spacing.sm,
              })}
            >
              <Text style={{ ...typography.body, color: colors.text }}>
                {s.name}
                {s.status_id === currentStatusId ? " ✓" : ""}
              </Text>
              <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>
                {s.is_closed ? t("statusPicker.closedLabel") : t("statusPicker.openLabel")}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

export function CommentComposer({
  draftContent,
  draftPlainText,
  isInternal,
  onChangeIsInternal,
  onSend,
  sending,
  offline,
  error,
  editorRef,
  onDraftChange,
}: {
  draftContent: string;
  draftPlainText: string;
  isInternal: boolean;
  onChangeIsInternal: (value: boolean) => void;
  onSend: () => void;
  sending: boolean;
  offline: boolean;
  error: string | null;
  editorRef: RefObject<TicketRichTextEditorRef | null>;
  onDraftChange: (content: string, plainText: string) => void;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
  return (
    <View
      style={{
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
      }}
    >
      <Text style={{ ...typography.caption, color: colors.textSecondary }}>{t("comments.addComment")}</Text>
      <View style={{ marginTop: spacing.sm }}>
        <TicketRichTextEditor
          ref={editorRef}
          content={draftContent}
          editable={!sending}
          showToolbar
          height={180}
          loadingLabel={t("comments.loadingCommentEditor")}
          onContentChange={({ json }) => {
            onDraftChange(
              serializeRichEditorJson(json),
              extractPlainTextFromRichEditorJson(json),
            );
          }}
        />
      </View>
      <Text
        style={{
          ...typography.caption,
          marginTop: spacing.sm,
          color: draftPlainText.length > MAX_COMMENT_LENGTH ? colors.danger : colors.textSecondary,
        }}
      >
        {draftPlainText.length}/{MAX_COMMENT_LENGTH}
      </Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm }}>
        <ActionChip label={isInternal ? t("comments.internalChecked") : t("comments.internal")} onPress={() => onChangeIsInternal(true)} />
        <View style={{ width: spacing.sm }} />
        <ActionChip label={!isInternal ? t("comments.publicChecked") : t("comments.public")} onPress={() => onChangeIsInternal(false)} />
      </View>
      {error ? (
        <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
          {error}
        </Text>
      ) : null}
      {offline ? (
        <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm }}>
          {t("comments.offlineDraftSaved")}
        </Text>
      ) : null}
      <View style={{ marginTop: spacing.sm }}>
        <PrimaryButton
          onPress={onSend}
          disabled={sending || offline || draftPlainText.trim().length === 0 || draftPlainText.length > MAX_COMMENT_LENGTH}
          accessibilityLabel={t("comments.sendComment")}
        >
          {sending ? t("comments.sending") : t("comments.send")}
        </PrimaryButton>
      </View>
    </View>
  );
}

function TicketActions({
  baseUrl,
  ticketId,
  ticketNumber,
}: {
  baseUrl: string | null;
  ticketId: string;
  ticketNumber: string;
}) {
  const { spacing } = useTheme();
  const { t } = useTranslation("tickets");
  const openInWebUrl = baseUrl ? buildTicketWebUrl(baseUrl, ticketId) : null;

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.md }}>
      <ActionChip
        label={t("detail.copyNumber")}
        onPress={() => {
          void (async () => {
            const res = await copyToClipboard("ticket_number", ticketNumber);
            Alert.alert(t("common:copied"), res.copiedText);
          })();
        }}
      />
      <View style={{ width: spacing.sm }} />
      <ActionChip
        label={t("detail.copyId")}
        onPress={() => {
          void (async () => {
            const res = await copyToClipboard("ticket_id", ticketId);
            Alert.alert(t("common:copied"), res.copiedText);
          })();
        }}
      />
      {openInWebUrl ? (
        <>
          <View style={{ width: spacing.sm }} />
          <ActionChip
            label={t("detail.openInWeb")}
            onPress={() => {
              Alert.alert(t("detail.openInWebConfirm"), openInWebUrl, [
                { text: t("common:cancel"), style: "cancel" },
                { text: t("common:open"), onPress: () => void Linking.openURL(openInWebUrl) },
              ]);
            }}
          />
        </>
      ) : null}
    </View>
  );
}

function ActionChip({
  label,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const { colors, spacing, typography } = useTheme();
  const isDisabled = Boolean(disabled || loading);
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        paddingHorizontal: spacing.md,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        opacity: isDisabled ? 0.6 : pressed ? 0.9 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {loading ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
        <Text style={{ ...typography.caption, color: colors.text, fontWeight: "600", marginLeft: loading ? spacing.sm : 0 }}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const QUICK_EMOJIS = ['👍', '👎', '❤️', '😂', '🎉', '👀'];


export function CommentsSection({
  comments,
  visibleCount,
  onLoadMore,
  onJumpToLatest,
  onJumpToTop,
  error,
  onLinkPress,
  baseUrl,
  ticketId,
}: {
  comments: TicketComment[];
  visibleCount: number;
  onLoadMore: () => void;
  onJumpToLatest: () => void;
  onJumpToTop: () => void;
  error: string | null;
  onLinkPress?: (url: string) => void;
  baseUrl?: string | null;
  ticketId: string;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
  const { session } = useAuth();
  const startIndex = Math.max(0, comments.length - visibleCount);
  const visible = comments.slice(startIndex);

  // Local reactions state (initialized from comment data, updated optimistically)
  const [reactionsOverrides, setReactionsOverrides] = useState<Record<string, AggregatedReaction[]>>({});
  const [emojiPickerCommentId, setEmojiPickerCommentId] = useState<string | null>(null);
  const [fullEmojiPickerCommentId, setFullEmojiPickerCommentId] = useState<string | null>(null);

  const config = getAppConfig();
  const client = useMemo(() => {
    if (!config.ok) return null;
    return createApiClient({ baseUrl: config.baseUrl, getUserAgentTag: () => "mobile" });
  }, [config]);

  const getReactions = useCallback(
    (commentId: string | undefined): AggregatedReaction[] => {
      if (!commentId) return [];
      if (reactionsOverrides[commentId]) return reactionsOverrides[commentId];
      const comment = comments.find((c) => c.comment_id === commentId);
      return comment?.reactions ?? [];
    },
    [comments, reactionsOverrides],
  );

  const handleToggleReaction = useCallback(
    async (commentId: string, emoji: string) => {
      if (!client || !session) return;

      const userId = session.user?.id ?? "";

      // Optimistic update
      setReactionsOverrides((prev) => {
        const current = prev[commentId] ?? comments.find((c) => c.comment_id === commentId)?.reactions ?? [];
        const existing = current.find((r) => r.emoji === emoji);
        if (existing?.currentUserReacted) {
          const updated = existing.count === 1
            ? current.filter((r) => r.emoji !== emoji)
            : current.map((r) => r.emoji === emoji ? { ...r, count: r.count - 1, currentUserReacted: false, userIds: r.userIds.filter((id) => id !== userId) } : r);
          return { ...prev, [commentId]: updated };
        }
        if (existing) {
          return { ...prev, [commentId]: current.map((r) => r.emoji === emoji ? { ...r, count: r.count + 1, currentUserReacted: true, userIds: [...r.userIds, userId] } : r) };
        }
        return { ...prev, [commentId]: [...current, { emoji, count: 1, userIds: [userId], currentUserReacted: true }] };
      });

      setEmojiPickerCommentId(null);

      // Fire-and-forget: the next comments refresh will sync server state.
      // No rollback — avoids flicker when server hasn't been deployed yet
      // or on transient network errors.
      void toggleCommentReaction(client, {
        apiKey: session.accessToken,
        ticketId,
        commentId,
        emoji,
      });
    },
    [client, session, ticketId, comments],
  );

  // Clear overrides when comments refresh (server data is now authoritative)
  useEffect(() => {
    setReactionsOverrides({});
  }, [comments.map((c) => c.comment_id).join(",")]);

  return (
    <View
      style={{
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text accessibilityRole="header" style={{ ...typography.caption, color: colors.textSecondary }}>
          {t("comments.label")}
        </Text>
        {comments.length > 0 ? (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {comments.length >= 30 ? (
              <>
                <Pressable
                  onPress={onJumpToTop}
                  accessibilityRole="button"
                  accessibilityLabel={t("comments.jumpToTop")}
                  style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                >
                  <Text style={{ ...typography.caption, color: colors.primary, fontWeight: "600" }}>{t("comments.top")}</Text>
                </Pressable>
                <View style={{ width: spacing.md }} />
              </>
            ) : null}
            <Pressable
              onPress={onJumpToLatest}
              accessibilityRole="button"
              accessibilityLabel={t("comments.jumpToLatest")}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            >
              <Text style={{ ...typography.caption, color: colors.primary, fontWeight: "600" }}>{t("comments.latest")}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {error ? (
        <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.danger }}>{error}</Text>
      ) : null}

      {comments.length === 0 ? (
        <Text style={{ ...typography.body, marginTop: spacing.sm, color: colors.textSecondary }}>{t("comments.noComments")}</Text>
      ) : (
        <View style={{ marginTop: spacing.sm }}>
          {visible.map((c, idx) => {
            const kind = (c as any).kind as TicketComment["kind"] | undefined;
            const eventType = (c as any).event_type as TicketComment["event_type"] | undefined;
            const isSystemEvent = kind === "event" || typeof eventType === "string";
            const isOptimistic = Boolean((c as any).optimistic);
            const commentPlainText = extractPlainTextFromSerializedRichEditorContent(c.comment_text);
            const eventText = ((c as any).event_text as string | undefined) ?? (eventType ? `${eventType}: ${commentPlainText}` : commentPlainText);
            const badgeLabel = isSystemEvent ? t("comments.event") : isOptimistic ? t("comments.sending") : c.is_internal ? t("comments.internal") : t("comments.public");
            const accessibilityLabel = `${badgeLabel}. ${c.created_by_name ?? t("common:unknown")}. ${formatDateTimeWithRelative(c.created_at)}. ${
              isSystemEvent ? eventText : commentPlainText || t("comments.richComment")
            }`;

            return (
              <View
                key={c.comment_id ?? String(idx)}
                accessible
                accessibilityLabel={accessibilityLabel}
                style={{ marginTop: idx === 0 ? 0 : spacing.md, opacity: isOptimistic ? 0.75 : 1 }}
              >
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  {!isSystemEvent ? (
                    <Avatar
                      name={c.created_by_name ?? undefined}
                      imageUri={c.created_by_avatar_url && baseUrl ? `${baseUrl}${c.created_by_avatar_url}` : undefined}
                      authToken={session?.accessToken}
                      size="sm"
                    />
                  ) : null}
                  <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", flex: 1, marginLeft: isSystemEvent ? 0 : spacing.sm }}>
                    <Text style={{ ...typography.caption, color: colors.textSecondary }}>
                      {c.created_by_name ?? t("common:unknown")} • {formatDateTimeWithRelative(c.created_at)}
                    </Text>
                    <View style={{ width: spacing.sm }} />
                    {isSystemEvent ? (
                      <Badge label={t("comments.event")} tone="neutral" />
                    ) : isOptimistic ? (
                      <Badge label={t("comments.sending")} tone="neutral" />
                    ) : (
                      <Badge label={c.is_internal ? t("comments.internal") : t("comments.public")} tone={c.is_internal ? "warning" : "info"} />
                    )}
                  </View>
                </View>
                {isSystemEvent ? (
                  <Text style={{ ...typography.body, color: colors.text, marginTop: 2, fontStyle: "italic" }}>
                    {eventText}
                  </Text>
                ) : (
                  isMalformedRichEditorContent(c.comment_text) ? (
                    <Text style={{ ...typography.body, color: colors.text, marginTop: 2 }}>
                      {commentPlainText || "—"}
                    </Text>
                  ) : (
                    <View style={{ marginTop: spacing.xs }}>
                      <TicketRichTextEditor
                        content={c.comment_text}
                        editable={false}
                        height={96}
                        loadingLabel={t("comments.loadingComment")}
                        onLinkPress={onLinkPress}
                      />
                    </View>
                  )
                )}
                {/* Reaction pills + add button */}
                {!isSystemEvent && c.comment_id ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", marginTop: spacing.xs, gap: 4 }}>
                    {getReactions(c.comment_id).map((r) => (
                      <Pressable
                        key={r.emoji}
                        onPress={() => void handleToggleReaction(c.comment_id!, r.emoji)}
                        accessibilityRole="button"
                        accessibilityLabel={`${r.emoji} ${r.count}${r.currentUserReacted ? ", you reacted" : ""}`}
                        style={({ pressed }) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: r.currentUserReacted ? colors.primary : colors.border,
                          backgroundColor: r.currentUserReacted ? `${colors.primary}18` : colors.background,
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Text style={{ fontSize: 14 }}>{r.emoji}</Text>
                        <Text style={{ fontSize: 12, marginLeft: 3, color: r.currentUserReacted ? colors.primary : colors.textSecondary, fontWeight: r.currentUserReacted ? "600" : "400" }}>
                          {r.count}
                        </Text>
                      </Pressable>
                    ))}
                    <Pressable
                      onPress={() => setEmojiPickerCommentId(emojiPickerCommentId === c.comment_id ? null : c.comment_id!)}
                      accessibilityRole="button"
                      accessibilityLabel="Add reaction"
                      style={({ pressed }) => ({
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: colors.border,
                        backgroundColor: colors.background,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text style={{ fontSize: 14 }}>+</Text>
                    </Pressable>
                  </View>
                ) : null}
                {/* Quick emoji picker */}
                {emojiPickerCommentId === c.comment_id ? (
                  <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4, gap: 2, backgroundColor: colors.background, borderRadius: 16, padding: 4, borderWidth: 1, borderColor: colors.border, alignSelf: "flex-start" }}>
                    {QUICK_EMOJIS.map((emoji) => (
                      <Pressable
                        key={emoji}
                        onPress={() => void handleToggleReaction(c.comment_id!, emoji)}
                        accessibilityRole="button"
                        accessibilityLabel={`React with ${emoji}`}
                        style={({ pressed }) => ({ padding: 4, borderRadius: 8, opacity: pressed ? 0.5 : 1 })}
                      >
                        <Text style={{ fontSize: 20 }}>{emoji}</Text>
                      </Pressable>
                    ))}
                    <Pressable
                      onPress={() => {
                        setEmojiPickerCommentId(null);
                        setFullEmojiPickerCommentId(c.comment_id!);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="More emojis"
                      style={({ pressed }) => ({ padding: 4, borderRadius: 8, opacity: pressed ? 0.5 : 1 })}
                    >
                      <Text style={{ fontSize: 16, color: colors.textSecondary }}>...</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })}

          {startIndex > 0 ? (
            <View style={{ marginTop: spacing.md }}>
              <Pressable
                onPress={onLoadMore}
                accessibilityRole="button"
                accessibilityLabel={t("comments.loadMoreAccessibility")}
                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
              >
                <Text style={{ ...typography.caption, color: colors.primary, fontWeight: "600" }}>
                  {t("comments.loadMore", { count: startIndex })}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      )}

      <EmojiPicker
        onEmojiSelected={(emojiObject) => {
          if (fullEmojiPickerCommentId) {
            void handleToggleReaction(fullEmojiPickerCommentId, emojiObject.emoji);
          }
          setFullEmojiPickerCommentId(null);
        }}
        open={fullEmojiPickerCommentId !== null}
        onClose={() => setFullEmojiPickerCommentId(null)}
      />
    </View>
  );
}

export function DescriptionSection({
  ticket,
  isEditing,
  draftContent,
  draftPlainText,
  saving,
  error,
  editorRef,
  onLinkPress,
  qaAutoPressFirstLink = false,
  onStartEditing,
  onCancelEditing,
  onSave,
  onDraftChange,
}: {
  ticket: TicketDetail;
  isEditing: boolean;
  draftContent: string;
  draftPlainText: string;
  saving: boolean;
  error: string | null;
  editorRef: RefObject<TicketRichTextEditorRef | null>;
  onLinkPress?: (url: string) => void;
  qaAutoPressFirstLink?: boolean;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onSave: () => void;
  onDraftChange: (content: string, plainText: string) => void;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
  const description = extractDescription(ticket);

  return (
    <View
      style={{
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
      }}
    >
      <Text accessibilityRole="header" style={{ ...typography.caption, color: colors.textSecondary }}>
        {t("description.label")}
      </Text>
      <View style={{ marginTop: spacing.sm }}>
        {isEditing ? (
          <>
            <TicketRichTextEditor
              ref={editorRef}
              content={draftContent}
              editable={!saving}
              showToolbar
              height={220}
              loadingLabel={t("description.loadingEditor")}
              onContentChange={({ json }) => {
                onDraftChange(
                  serializeRichEditorJson(json),
                  extractPlainTextFromRichEditorJson(json),
                );
              }}
            />
            <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm }}>
              {t("description.characters", { count: draftPlainText.length })}
            </Text>
            {error ? (
              <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
                {error}
              </Text>
            ) : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm }}>
              <ActionChip label={t("common:cancel")} onPress={onCancelEditing} disabled={saving} />
              <View style={{ width: spacing.sm }} />
              <ActionChip label={saving ? t("common:saving") : t("common:save")} onPress={onSave} disabled={saving} loading={saving} />
            </View>
          </>
        ) : description && !isMalformedRichEditorContent(description) ? (
          <>
            <TicketRichTextEditor
              content={description}
              editable={false}
              height={140}
              loadingLabel={t("description.loadingDescription")}
              onLinkPress={onLinkPress}
              qaAutoPressFirstLink={qaAutoPressFirstLink}
            />
            <View style={{ marginTop: spacing.sm }}>
              <ActionChip label={t("description.edit")} onPress={onStartEditing} />
            </View>
          </>
        ) : (
          <>
            <Text style={{ ...typography.body, color: colors.text }}>
              {description ? extractPlainTextFromSerializedRichEditorContent(description) : draftPlainText || "—"}
            </Text>
            <View style={{ marginTop: spacing.sm }}>
              <ActionChip label={t("description.add")} onPress={onStartEditing} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  const { colors, spacing, typography } = useTheme();
  return (
    <View
      style={{
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
      }}
    >
      <Text style={{ ...typography.caption, color: colors.textSecondary }}>{label}</Text>
      <Text style={{ ...typography.body, color: colors.text, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

function stringOrDash(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : "—";
}

export function extractDescription(ticket: TicketDetail): string | null {
  const attrs = (ticket as any).attributes as unknown;
  if (!attrs || typeof attrs !== "object") return null;
  const obj = attrs as Record<string, unknown>;
  return typeof obj.description === "string" && obj.description.trim()
    ? obj.description.trim()
    : null;
}

function getTicketAttributes(ticket: TicketDetail): Record<string, unknown> {
  const attrs = (ticket as any).attributes as unknown;
  if (!attrs || typeof attrs !== "object") return {};
  return { ...(attrs as Record<string, unknown>) };
}

function getDueDateIso(ticket: TicketDetail): string | null {
  const maybeColumn = (ticket as any).due_date as unknown;
  if (typeof maybeColumn === "string" && maybeColumn.trim()) return maybeColumn;

  const attrs = (ticket as any).attributes as unknown;
  if (!attrs || typeof attrs !== "object") return null;
  const due = (attrs as any).due_date as unknown;
  return typeof due === "string" && due.trim() ? due : null;
}

function getWatcherUserIds(ticket: TicketDetail): string[] {
  const attrs = (ticket as any).attributes as unknown;
  if (!attrs || typeof attrs !== "object") return [];
  const raw = (attrs as any).watcher_user_ids as unknown;
  if (!Array.isArray(raw)) return [];
  return raw.filter((v) => typeof v === "string" && v.trim()) as string[];
}

function isoToDateInput(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function dateInputToIso(input: string): string | null {
  const trimmed = input.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(`${trimmed}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function getApiErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const error = (body as any).error as unknown;
  if (!error || typeof error !== "object") return null;
  const message = (error as any).message as unknown;
  const trimmed = typeof message === "string" ? message.trim() : "";

  const details = (error as any).details as unknown;
  const detailMessage = (() => {
    if (!details) return null;
    if (typeof details === "string" && details.trim()) return details.trim();
    if (Array.isArray(details) && details.length > 0) {
      const first = details[0] as any;
      const msg = typeof first?.message === "string" ? first.message.trim() : "";
      const path = Array.isArray(first?.path) ? first.path.filter((p: any) => typeof p === "string" || typeof p === "number").join(".") : "";
      if (!msg) return null;
      return path ? `${path}: ${msg}` : msg;
    }
    return null;
  })();

  if (detailMessage) return detailMessage;
  return trimmed ? trimmed : null;
}
