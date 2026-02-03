import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, Alert, Linking, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { RootStackParamList } from "../navigation/types";
import { colors, spacing, typography } from "../ui/theme";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import { addTicketComment, getTicketById, getTicketComments, getTicketPriorities, getTicketStatuses, updateTicketAssignment, updateTicketAttributes, updateTicketPriority, updateTicketStatus, type TicketComment, type TicketDetail, type TicketPriority, type TicketStatus } from "../api/tickets";
import { ErrorState, LoadingState } from "../ui/states";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { getCachedTicketDetail, setCachedTicketDetail } from "../cache/ticketsCache";
import { Badge } from "../ui/components/Badge";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { getSecureJson, secureStorage, setSecureJson } from "../storage/secureStorage";
import { getClientMetadataHeaders } from "../device/clientMetadata";
import { createTimeEntry } from "../api/timeEntries";

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
  const [assignmentUpdating, setAssignmentUpdating] = useState(false);
  const [assignmentAction, setAssignmentAction] = useState<"assign" | "unassign" | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);

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

  const meUserId = session.user?.id;
  const isWatching = meUserId ? getWatcherUserIds(ticket).includes(meUserId) : false;

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

  const submitStatus = async (statusId: string) => {
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
        if (res.error.kind === "http" && res.status === 403) {
          setPriorityUpdateError("You don’t have permission to change this ticket’s priority.");
          return;
        }
        if (res.error.kind === "http" && res.status === 400) {
          const msg = getApiErrorMessage(res.error.body);
          setPriorityUpdateError(msg ?? "Priority change was rejected by the server.");
          return;
        }
        setPriorityUpdateError("Unable to change priority. Please try again.");
        return;
      }
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
        if (res.error.kind === "http" && res.status === 403) {
          setAssignmentError("You don’t have permission to update this ticket’s assignment.");
          return;
        }
        if (res.error.kind === "http" && res.status === 400) {
          const msg = getApiErrorMessage(res.error.body);
          setAssignmentError(msg ?? "Assignment was rejected by the server.");
          return;
        }
        setAssignmentError("Unable to update assignment. Please try again.");
        return;
      }
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
      setAssignmentError("Unable to determine current user. Please sign in again.");
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
        if (res.error.kind === "http" && res.status === 403) {
          setDueDateError("You don’t have permission to change this ticket’s due date.");
          return;
        }
        if (res.error.kind === "http" && res.status === 400) {
          const msg = getApiErrorMessage(res.error.body);
          setDueDateError(msg ?? "Due date change was rejected by the server.");
          return;
        }
        setDueDateError("Unable to update due date. Please try again.");
        return;
      }
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
      setDueDateError("Enter a date as YYYY-MM-DD.");
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
      setWatchError("Unable to determine current user. Please sign in again.");
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
        if (res.error.kind === "http" && res.status === 403) {
          setWatchError("You don’t have permission to update watchers on this ticket.");
          return;
        }
        if (res.error.kind === "http" && res.status === 400) {
          const msg = getApiErrorMessage(res.error.body);
          setWatchError(msg ?? "Watchers update was rejected by the server.");
          return;
        }
        setWatchError("Unable to update watchers. Please try again.");
        return;
      }

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
      setTimeEntryError("Enter a valid duration in minutes.");
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
        if (res.error.kind === "http" && res.status === 403) {
          setTimeEntryError("You don’t have permission to create time entries.");
          return;
        }
        if (res.error.kind === "http" && res.status === 400) {
          const msg = getApiErrorMessage(res.error.body);
          setTimeEntryError(msg ?? "Time entry was rejected by the server.");
          return;
        }
        setTimeEntryError("Unable to create time entry. Please try again.");
        return;
      }

      setTimeEntryOpen(false);
      Alert.alert("Time entry created", `Added ${Math.round(duration)} minutes.`);
    } finally {
      setTimeEntryUpdating(false);
    }
  };

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
          <View style={{ width: spacing.sm }} />
          <ActionChip
            label="Change priority"
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
                    setPriorityOptionsError("Unable to load priorities.");
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
            label="Due date"
            onPress={() => {
              setDueDateError(null);
              setDueDateDraft(isoToDateInput(getDueDateIso(ticket)) ?? "");
              setDueDateOpen(true);
            }}
          />
          <View style={{ width: spacing.sm }} />
          <ActionChip
            label={watchUpdating ? "Updating…" : isWatching ? "Unwatch" : "Watch"}
            disabled={watchUpdating || !meUserId}
            onPress={() => {
              void toggleWatch();
            }}
          />
          <View style={{ width: spacing.sm }} />
          <ActionChip
            label="Add time"
            onPress={() => {
              openTimeEntryModal();
            }}
          />
          <View style={{ width: spacing.sm }} />
          <ActionChip
            label={assignmentUpdating && assignmentAction === "assign" ? "Assigning…" : "Assign to me"}
            disabled={assignmentUpdating}
            onPress={() => {
              void assignToMe();
            }}
          />
          {ticket.assigned_to_name ? (
            <>
              <View style={{ width: spacing.sm }} />
              <ActionChip
                label={assignmentUpdating && assignmentAction === "unassign" ? "Unassigning…" : "Unassign"}
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
          <KeyValue label="Due" value={formatDateWithRelative(getDueDateIso(ticket))} />
          <View style={{ height: spacing.sm }} />
          <KeyValue label="Closed" value={formatDateWithRelative(ticket.closed_at)} />
          <View style={{ height: spacing.sm }} />
          <KeyValue label="Ticket ID" value={ticket.ticket_id} />
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
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
        <Text style={{ ...typography.title, color: colors.text }}>Due date</Text>
        <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.mutedText }}>
          Current: {formatDateWithRelative(currentDueDateIso)}
        </Text>

        {updating ? (
          <View style={{ marginTop: spacing.lg, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.mutedText }}>
              Saving…
            </Text>
          </View>
        ) : null}

        {error ? (
          <Text style={{ ...typography.caption, marginTop: spacing.md, color: colors.danger }}>
            {error}
          </Text>
        ) : null}

        <View style={{ marginTop: spacing.lg }}>
          <Text style={{ ...typography.caption, color: colors.mutedText }}>Set a date (YYYY-MM-DD)</Text>
          <TextInput
            value={draft}
            onChangeText={onChangeDraft}
            placeholder="2026-02-03"
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
            label="Today"
            disabled={updating}
            onPress={() => onSetInDays(0)}
          />
          <View style={{ width: spacing.sm }} />
          <ActionChip
            label="Tomorrow"
            disabled={updating}
            onPress={() => onSetInDays(1)}
          />
          <View style={{ width: spacing.sm }} />
          <ActionChip
            label="+7 days"
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
              Clear
            </PrimaryButton>
          </View>
          <View style={{ width: spacing.sm }} />
          <View style={{ flex: 1 }}>
            <PrimaryButton
              onPress={onSave}
              disabled={updating}
            >
              Save
            </PrimaryButton>
          </View>
        </View>

        <View style={{ marginTop: spacing.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close due date editor"
            onPress={onClose}
            disabled={updating}
            style={({ pressed }) => ({ opacity: updating ? 0.5 : pressed ? 0.85 : 1, marginTop: spacing.sm })}
          >
            <Text style={{ ...typography.caption, color: colors.mutedText, textAlign: "center" }}>
              Close
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
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
        <Text style={{ ...typography.title, color: colors.text }}>Add time entry</Text>
        <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.mutedText }}>
          Duration (minutes)
        </Text>
        <TextInput
          value={durationMin}
          onChangeText={onChangeDurationMin}
          keyboardType="number-pad"
          placeholder="15"
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

        <Text style={{ ...typography.caption, marginTop: spacing.lg, color: colors.mutedText }}>
          Notes (optional)
        </Text>
        <TextInput
          value={notes}
          onChangeText={onChangeNotes}
          multiline
          placeholder="What did you do?"
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
            <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.mutedText }}>
              Saving…
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
          Save time entry
        </PrimaryButton>
        <View style={{ height: spacing.sm }} />
        <PrimaryButton onPress={onClose} disabled={updating}>
          Cancel
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
  const busy = loading || updating;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
        <Text style={{ ...typography.title, color: colors.text }}>Select priority</Text>
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
          {priorities.map((p) => (
            <Pressable
              key={p.priority_id}
              accessibilityRole="button"
              accessibilityLabel={`Set priority ${p.priority_name}`}
              disabled={busy}
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
                opacity: busy ? 0.65 : pressed ? 0.95 : 1,
                marginBottom: spacing.sm,
              })}
            >
              <Text style={{ ...typography.body, color: colors.text }}>
                {p.priority_name}
                {p.priority_id === currentPriorityId ? " ✓" : ""}
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

function ActionChip({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        paddingHorizontal: spacing.md,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        opacity: disabled ? 0.6 : pressed ? 0.9 : 1,
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
