import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, Alert, Linking, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { RootStackParamList } from "../navigation/types";
import { colors, spacing, typography } from "../ui/theme";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import { addTicketComment, getTicketById, getTicketComments, getTicketStatuses, updateTicketStatus, type TicketComment, type TicketDetail, type TicketStatus } from "../api/tickets";
import { ErrorState, LoadingState } from "../ui/states";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { getCachedTicketDetail, setCachedTicketDetail } from "../cache/ticketsCache";
import { Badge } from "../ui/components/Badge";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { getSecureJson, secureStorage, setSecureJson } from "../storage/secureStorage";
import { getClientMetadataHeaders } from "../device/clientMetadata";

type Props = NativeStackScreenProps<RootStackParamList, "TicketDetail">;

const MAX_COMMENT_LENGTH = 5000;

export function TicketDetailScreen({ route }: Props) {
  const config = useMemo(() => getAppConfig(), []);
  const { session } = useAuth();
  return (
    <TicketDetailBody ticketId={route.params.ticketId} config={config} session={session} />
  );
}

function TicketDetailBody({
  ticketId,
  config,
  session,
}: {
  ticketId: string;
  config: ReturnType<typeof getAppConfig>;
  session: ReturnType<typeof useAuth>["session"];
}) {
  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/ticket-detail",
    });
  }, [config, session]);

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
  const [commentIsInternal, setCommentIsInternal] = useState(true);
  const [commentSendError, setCommentSendError] = useState<string | null>(null);
  const [commentSending, setCommentSending] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [statusOptions, setStatusOptions] = useState<TicketStatus[]>([]);
  const [statusOptionsLoading, setStatusOptionsLoading] = useState(false);
  const [statusOptionsError, setStatusOptionsError] = useState<string | null>(null);
  const [pendingStatusId, setPendingStatusId] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusUpdateError, setStatusUpdateError] = useState<string | null>(null);

  const draftKey = useMemo(() => {
    const userId = session?.user?.id ?? "anonymous";
    return `alga.mobile.ticketDraft.${userId}.${ticketId}`;
  }, [session?.user?.id, ticketId]);

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      const saved = await getSecureJson<{ text: string; isInternal: boolean }>(draftKey);
      if (canceled) return;
      if (saved) {
        setCommentDraft(saved.text);
        setCommentIsInternal(saved.isInternal);
      }
      setDraftLoaded(true);
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [draftKey]);

  useEffect(() => {
    if (!draftLoaded) return;
    void setSecureJson(draftKey, { text: commentDraft, isInternal: commentIsInternal });
  }, [commentDraft, commentIsInternal, draftKey, draftLoaded]);

  const fetchTicket = useCallback(async () => {
    if (!client || !session) return;
    setError(null);
    const result = await getTicketById(client, { apiKey: session.accessToken, ticketId });
    if (!result.ok) {
      if (result.error.kind === "http" && result.status === 404) {
        setTicket(null);
        setError({ title: "Ticket not found", description: "This ticket may have been deleted." });
        return;
      }
      if (result.error.kind === "http" && result.status === 403) {
        setError({ title: "No access", description: "You don’t have permission to view this ticket." });
        return;
      }
      setError({ title: "Unable to load ticket", description: "Please try again." });
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
      setCommentsError("Unable to load comments.");
      return;
    }
    setComments(result.data.data);
  }, [client, session, ticketId]);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchTicket(), fetchComments()]);
  }, [fetchComments, fetchTicket]);

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

  if (!config.ok) {
    return <ErrorState title="Configuration error" description={config.error} />;
  }
  if (!session) {
    return <ErrorState title="Signed out" description="Please sign in again." />;
  }

  if (initialLoading && !ticket) {
    return <LoadingState message="Loading ticket…" />;
  }

  if (error && !ticket) {
    return <ErrorState title={error.title} description={error.description} />;
  }

  if (!ticket) {
    return <ErrorState title="Ticket not found" description="This ticket is unavailable." />;
  }

  const statusLabel = pendingStatusId
    ? (statusOptions.find((s) => s.status_id === pendingStatusId)?.name ??
      ticket.status_name ??
      "Unknown")
    : (ticket.status_name ?? "Unknown");

  const sendComment = async () => {
    if (!client || !session) return;
    if (commentSending) return;
    const text = commentDraft.trim();
    if (!text) {
      setCommentSendError("Comment cannot be empty.");
      return;
    }
    if (text.length > MAX_COMMENT_LENGTH) {
      setCommentSendError(`Comment is too long (max ${MAX_COMMENT_LENGTH} characters).`);
      return;
    }
      setCommentSending(true);
      setCommentSendError(null);
    try {
      const auditHeaders = await getClientMetadataHeaders();
      const result = await addTicketComment(client, {
        apiKey: session.accessToken,
        ticketId,
        comment_text: text,
        is_internal: commentIsInternal,
        auditHeaders,
      });
      if (!result.ok) {
        if (result.error.kind === "http" && result.status === 403) {
          setCommentSendError("You don’t have permission to add comments to this ticket.");
          return;
        }
        if (result.error.kind === "http" && result.status === 400) {
          const msg = getApiErrorMessage(result.error.body);
          setCommentSendError(msg ?? "Comment was rejected by the server.");
          return;
        }
        setCommentSendError("Unable to send comment. Please try again.");
        return;
      }
      setCommentDraft("");
      await secureStorage.deleteItem(draftKey);
      await fetchComments();
    } finally {
      setCommentSending(false);
    }
  };

  const submitStatus = useCallback(
    async (statusId: string) => {
      if (!client || !session) return;
      if (statusUpdating) return;
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
            setStatusUpdateError("Ticket changed elsewhere. Refresh and try again.");
            Alert.alert(
              "Ticket updated elsewhere",
              "This ticket changed on the server. Refresh and try your update again.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Refresh",
                  onPress: () => {
                    void fetchTicket();
                  },
                },
              ],
            );
            return;
          }
          if (res.error.kind === "http" && res.status === 403) {
            setStatusUpdateError("You don’t have permission to change this ticket’s status.");
            return;
          }
          if (res.error.kind === "http" && res.status === 400) {
            const msg = getApiErrorMessage(res.error.body);
            setStatusUpdateError(msg ?? "Status change was rejected by the server.");
            return;
          }
          setStatusUpdateError("Unable to change status. Please try again.");
          return;
        }
        await fetchTicket();
        setPendingStatusId(null);
        setStatusPickerOpen(false);
      } finally {
        setStatusUpdating(false);
      }
    },
    [client, fetchTicket, session, statusUpdating, ticketId],
  );

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {error ? (
          <View
            style={{
              padding: spacing.md,
              borderRadius: 12,
              backgroundColor: "#FEF3C7",
              borderWidth: 1,
              borderColor: "#F59E0B",
              marginBottom: spacing.md,
            }}
          >
            <Text style={{ ...typography.caption, color: "#7C2D12", fontWeight: "700" }}>{error.title}</Text>
            <Text style={{ ...typography.caption, color: "#7C2D12", marginTop: 2 }}>{error.description}</Text>
          </View>
        ) : null}

        <Text style={{ ...typography.caption, color: colors.mutedText }}>
          {ticket.ticket_number}
          {ticket.client_name ? ` • ${ticket.client_name}` : ""}
          {ticket.contact_name ? ` • ${ticket.contact_name}` : ""}
        </Text>
        <Text style={{ ...typography.title, marginTop: 2, color: colors.text }}>
          {ticket.title}
        </Text>

        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.md }}>
          <Badge label={statusLabel} tone={ticket.status_is_closed ? "neutral" : "info"} />
          {ticket.priority_name ? <View style={{ width: spacing.sm }} /> : null}
          {ticket.priority_name ? <Badge label={ticket.priority_name} tone="warning" /> : null}
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm }}>
          <ActionChip
            label="Change status"
            onPress={() => {
              void (async () => {
                if (!client || !session) return;
                setStatusPickerOpen(true);
                if (statusOptions.length > 0) return;
                setStatusOptionsLoading(true);
                setStatusOptionsError(null);
                try {
                  const res = await getTicketStatuses(client, { apiKey: session.accessToken });
                  if (!res.ok) {
                    setStatusOptionsError("Unable to load statuses.");
                    return;
                  }
                  setStatusOptions(res.data.data);
                } finally {
                  setStatusOptionsLoading(false);
                }
              })();
            }}
          />
        </View>

        <TicketActions
          baseUrl={config.ok ? config.baseUrl : null}
          ticketId={ticket.ticket_id}
          ticketNumber={ticket.ticket_number}
        />

        {ticket.assigned_to_name ? (
          <Text style={{ ...typography.body, marginTop: spacing.md, color: colors.text }}>
            Assigned to {ticket.assigned_to_name}
          </Text>
        ) : (
          <Text style={{ ...typography.body, marginTop: spacing.md, color: colors.mutedText }}>
            Unassigned
          </Text>
        )}

        <View style={{ marginTop: spacing.lg }}>
          <KeyValue label="Requester" value={stringOrDash(ticket.contact_name)} />
          <View style={{ height: spacing.sm }} />
          <KeyValue label="Client" value={stringOrDash(ticket.client_name)} />
          <View style={{ height: spacing.sm }} />
          <DescriptionSection ticket={ticket} />
          <View style={{ height: spacing.sm }} />
          <CommentsSection
            comments={comments}
            visibleCount={commentsVisibleCount}
            onLoadMore={() => setCommentsVisibleCount((c) => c + 20)}
            error={commentsError}
          />
          <View style={{ height: spacing.sm }} />
          <CommentComposer
            draft={commentDraft}
            onChangeDraft={setCommentDraft}
            isInternal={commentIsInternal}
            onChangeIsInternal={setCommentIsInternal}
            onSend={() => void sendComment()}
            sending={commentSending}
            error={commentSendError}
          />
          <View style={{ height: spacing.sm }} />
          <KeyValue label="Created" value={formatDateWithRelative(ticket.entered_at)} />
          <View style={{ height: spacing.sm }} />
          <KeyValue label="Updated" value={formatDateWithRelative(ticket.updated_at)} />
          <View style={{ height: spacing.sm }} />
          <KeyValue label="Closed" value={formatDateWithRelative(ticket.closed_at)} />
          <View style={{ height: spacing.sm }} />
          <KeyValue label="Ticket ID" value={ticket.ticket_id} />
        </View>
      </ScrollView>

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
  const busy = loading || updating;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
        <Text style={{ ...typography.title, color: colors.text }}>Select status</Text>
        {busy ? (
          <View style={{ marginTop: spacing.lg, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.mutedText }}>
              {loading ? "Loading…" : "Saving…"}
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
          {statuses.map((s) => (
            <Pressable
              key={s.status_id}
              accessibilityRole="button"
              accessibilityLabel={`Set status ${s.name}`}
              disabled={busy}
              onPress={() => {
                onSelect(s.status_id);
              }}
              style={({ pressed }) => ({
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: s.status_id === currentStatusId ? colors.primary : colors.border,
                backgroundColor: colors.card,
                opacity: busy ? 0.65 : pressed ? 0.95 : 1,
                marginBottom: spacing.sm,
              })}
            >
              <Text style={{ ...typography.body, color: colors.text }}>
                {s.name}
                {s.status_id === currentStatusId ? " ✓" : ""}
              </Text>
              <Text style={{ ...typography.caption, color: colors.mutedText, marginTop: 2 }}>
                {s.is_closed ? "Closed" : "Open"}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={{ flex: 1 }} />
        <PrimaryButton onPress={onClose}>Done</PrimaryButton>
      </View>
    </Modal>
  );
}

function CommentComposer({
  draft,
  onChangeDraft,
  isInternal,
  onChangeIsInternal,
  onSend,
  sending,
  error,
}: {
  draft: string;
  onChangeDraft: (value: string) => void;
  isInternal: boolean;
  onChangeIsInternal: (value: boolean) => void;
  onSend: () => void;
  sending: boolean;
  error: string | null;
}) {
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
      <Text style={{ ...typography.caption, color: colors.mutedText }}>Add comment</Text>
      <TextInput
        value={draft}
        onChangeText={onChangeDraft}
        multiline
        placeholder="Write an update…"
        accessibilityLabel="Comment text"
        style={{
          minHeight: 80,
          marginTop: spacing.sm,
          padding: spacing.sm,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 10,
          backgroundColor: colors.background,
          color: colors.text,
          textAlignVertical: "top",
        }}
      />
      <Text
        style={{
          ...typography.caption,
          marginTop: spacing.sm,
          color: draft.length > MAX_COMMENT_LENGTH ? colors.danger : colors.mutedText,
        }}
      >
        {draft.length}/{MAX_COMMENT_LENGTH}
      </Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm }}>
        <ActionChip label={isInternal ? "Internal ✓" : "Internal"} onPress={() => onChangeIsInternal(true)} />
        <View style={{ width: spacing.sm }} />
        <ActionChip label={!isInternal ? "Public ✓" : "Public"} onPress={() => onChangeIsInternal(false)} />
      </View>
      {error ? (
        <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
          {error}
        </Text>
      ) : null}
      <View style={{ marginTop: spacing.sm }}>
        <PrimaryButton onPress={onSend} disabled={sending} accessibilityLabel="Send comment">
          {sending ? "Sending…" : "Send"}
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
  const openInWebUrl = baseUrl ? new URL(`/msp/tickets/${ticketId}`, baseUrl).toString() : null;

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.md }}>
      <ActionChip
        label="Copy #"
        onPress={() => {
          void (async () => {
            await Clipboard.setStringAsync(ticketNumber);
            Alert.alert("Copied", ticketNumber);
          })();
        }}
      />
      <View style={{ width: spacing.sm }} />
      <ActionChip
        label="Copy ID"
        onPress={() => {
          void (async () => {
            await Clipboard.setStringAsync(ticketId);
            Alert.alert("Copied", ticketId);
          })();
        }}
      />
      {openInWebUrl ? (
        <>
          <View style={{ width: spacing.sm }} />
          <ActionChip
            label="Open in web"
            onPress={() => {
              Alert.alert("Open in web?", openInWebUrl, [
                { text: "Cancel", style: "cancel" },
                { text: "Open", onPress: () => void Linking.openURL(openInWebUrl) },
              ]);
            }}
          />
        </>
      ) : null}
    </View>
  );
}

function ActionChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        paddingHorizontal: spacing.md,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <Text style={{ ...typography.caption, color: colors.text, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

function CommentsSection({
  comments,
  visibleCount,
  onLoadMore,
  error,
}: {
  comments: TicketComment[];
  visibleCount: number;
  onLoadMore: () => void;
  error: string | null;
}) {
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
      <Text style={{ ...typography.caption, color: colors.mutedText }}>Comments</Text>

      {error ? (
        <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.danger }}>{error}</Text>
      ) : null}

      {comments.length === 0 ? (
        <Text style={{ ...typography.body, marginTop: spacing.sm, color: colors.mutedText }}>No comments.</Text>
      ) : (
        <View style={{ marginTop: spacing.sm }}>
          {comments.slice(0, visibleCount).map((c, idx) => (
            <View key={c.comment_id ?? String(idx)} style={{ marginTop: idx === 0 ? 0 : spacing.md }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
                <Text style={{ ...typography.caption, color: colors.mutedText }}>
                  {c.created_by_name ?? "Unknown"} • {formatDateWithRelative(c.created_at)}
                </Text>
                <View style={{ width: spacing.sm }} />
                <Badge label={c.is_internal ? "Internal" : "Public"} tone={c.is_internal ? "warning" : "info"} />
              </View>
              <Text style={{ ...typography.body, color: colors.text, marginTop: 2 }}>
                {c.comment_text}
              </Text>
            </View>
          ))}

          {visibleCount < comments.length ? (
            <View style={{ marginTop: spacing.md }}>
              <Pressable
                onPress={onLoadMore}
                accessibilityRole="button"
                accessibilityLabel="Load more comments"
                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
              >
                <Text style={{ ...typography.caption, color: colors.primary, fontWeight: "600" }}>
                  Load more ({comments.length - visibleCount} remaining)
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

function DescriptionSection({ ticket }: { ticket: TicketDetail }) {
  const description = extractDescription(ticket);
  const links = extractLinks(description ?? "");

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
      <Text style={{ ...typography.caption, color: colors.mutedText }}>Description</Text>
      <Text style={{ ...typography.body, color: colors.text, marginTop: 2 }}>
        {description ?? "—"}
      </Text>

      {links.length > 0 ? (
        <View style={{ marginTop: spacing.sm }}>
          <Text style={{ ...typography.caption, color: colors.mutedText }}>Links</Text>
          {links.slice(0, 5).map((url) => (
            <Pressable
              key={url}
              accessibilityRole="button"
              accessibilityLabel={`Open link ${url}`}
              onPress={() => {
                Alert.alert("Open link?", url, [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Open",
                    onPress: () => {
                      void Linking.openURL(url);
                    },
                  },
                ]);
              }}
              style={({ pressed }) => ({
                marginTop: spacing.sm,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ ...typography.caption, color: colors.primary }}>{url}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
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
      <Text style={{ ...typography.caption, color: colors.mutedText }}>{label}</Text>
      <Text style={{ ...typography.body, color: colors.text, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

function formatDate(value: unknown): string {
  if (!value || typeof value !== "string") return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function formatDateWithRelative(value: unknown): string {
  const absolute = formatDate(value);
  if (absolute === "—" || typeof value !== "string") return "—";
  const d = new Date(value);
  const relative = formatRelative(d);
  return relative ? `${relative} • ${absolute}` : absolute;
}

function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime();
  if (!Number.isFinite(ms)) return "";
  const abs = Math.abs(ms);

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  const suffix = ms >= 0 ? "ago" : "from now";

  if (abs < minute) return `just now`;
  if (abs < hour) return `${Math.round(abs / minute)}m ${suffix}`;
  if (abs < day) return `${Math.round(abs / hour)}h ${suffix}`;
  return `${Math.round(abs / day)}d ${suffix}`;
}

function stringOrDash(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : "—";
}

function extractDescription(ticket: TicketDetail): string | null {
  const attrs = (ticket as any).attributes as unknown;
  if (!attrs || typeof attrs !== "object") return null;
  const obj = attrs as Record<string, unknown>;
  const candidates = [obj.description, obj.details, obj.summary];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

function extractLinks(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)\]]+/g) ?? [];
  const unique = Array.from(new Set(matches));
  return unique;
}

function getApiErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const error = (body as any).error as unknown;
  if (!error || typeof error !== "object") return null;
  const message = (error as any).message as unknown;
  if (typeof message !== "string") return null;
  const trimmed = message.trim();
  return trimmed ? trimmed : null;
}
