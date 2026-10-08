import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../ui/ThemeContext";
import { Badge } from "../ui/components/Badge";
import { Card } from "../ui/components/Card";
import { EntityPickerModal } from "../ui/components/EntityPickerModal";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { ErrorState, LoadingState } from "../ui/states";
import { formatDateShort, formatDateTime } from "../ui/formatters/dateTime";
import { useToast } from "../ui/toast/ToastProvider";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import {
  getProjectTask,
  getTaskChecklist,
  listTaskStatusMappings,
  statusMappingLabel,
  updateProjectTask,
  updateTaskChecklistItem,
  type ProjectTaskDetail,
  type ProjectTaskServiceSource,
  type TaskChecklistItem,
  type TaskStatusMapping,
} from "../api/projectTasks";
import { getServices, listTimeEntries, type ServiceOption, type TimeEntryListItem } from "../api/timeEntries";
import type { TicketComment } from "../api/tickets";
import { getUserDisplayName, listUsers } from "../api/users";
import { useCapabilities } from "../capabilities/CapabilitiesContext";
import { getClientMetadataHeaders } from "../device/clientMetadata";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { logger } from "../logging/logger";
import { isOffline as isOfflineStatus } from "../network/isOffline";
import { useNetworkStatus } from "../network/useNetworkStatus";
import { priorityTone } from "../features/userActivities/activityHelpers";
import { createCommentApi, taskTarget } from "../features/comments/commentTarget";
import { CommentComposer } from "../features/ticketDetail/components/CommentComposer";
import { CommentsSection } from "../features/ticketDetail/components/CommentsSection";
import { TimeEntryModal } from "../features/ticketDetail/components/TimeEntryModal";
import { useCommentDraft } from "../features/ticketDetail/hooks/useCommentDraft";
import { useTimeEntry } from "../features/ticketDetail/hooks/useTimeEntry";
import { getApiErrorMessage } from "../features/ticketDetail/utils";
import type { MentionSuggestionItem } from "../features/ticketRichText/MentionSuggestionList";
import { WorkItemTimerChip } from "../features/timer/components/TicketTimerChip";
import { useTimer } from "../features/timer/TimerContext";
import { formatMinutesDuration } from "../features/timer/timerLogic";

type Props = NativeStackScreenProps<RootStackParamList, "ProjectTaskDetail">;

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Time entry minutes, whichever of the two duration fields the API filled in. */
export function timeEntryMinutes(entry: Pick<TimeEntryListItem, "billable_duration" | "duration_hours" | "start_time" | "end_time">): number {
  if (typeof entry.billable_duration === "number" && entry.billable_duration > 0) return entry.billable_duration;
  if (typeof entry.duration_hours === "number" && entry.duration_hours > 0) return Math.round(entry.duration_hours * 60);
  if (entry.start_time && entry.end_time) {
    const ms = new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime();
    return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 60_000) : 0;
  }
  return 0;
}

export function ProjectTaskDetailScreen({ route }: Props) {
  const { t } = useTranslation("userActivities");
  const { t: tTickets } = useTranslation("tickets");
  const { colors, spacing, typography } = useTheme();
  const { showToast } = useToast();
  const { taskId, activity } = route.params;
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession } = useAuth();
  const { features } = useCapabilities();
  const timer = useTimer();
  const network = useNetworkStatus();
  const isOffline = isOfflineStatus(network);
  const abortRef = useRef<AbortController | null>(null);

  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/project-task",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);

  const [task, setTask] = useState<ProjectTaskDetail | null>(null);
  const [entries, setEntries] = useState<TimeEntryListItem[]>([]);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [checklist, setChecklist] = useState<TaskChecklistItem[]>([]);
  const [checklistError, setChecklistError] = useState<string | null>(null);
  const [checklistBusyId, setChecklistBusyId] = useState<string | null>(null);
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [statusMappings, setStatusMappings] = useState<TaskStatusMapping[]>([]);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [composerCollapsed, setComposerCollapsed] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canAct = features.projects;
  const commentApi = useMemo(() => createCommentApi(taskTarget(taskId)), [taskId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const fetchComments = useCallback(async () => {
    if (!client || !session || !canAct) return;
    const result = await commentApi.list(client, { apiKey: session.accessToken });
    if (!result.ok) {
      if (result.error.kind === "canceled") return;
      logger.warn("Project task comments fetch failed", { error: result.error });
      setCommentsError(t("projectTask.commentsFailed"));
      return;
    }
    setCommentsError(null);
    setComments(result.data.data);
  }, [canAct, client, commentApi, session, t]);

  const load = useCallback(async () => {
    if (!client || !session) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setEntriesError(null);

    const [taskResult, entriesResult, servicesResult, checklistResult] = await Promise.all([
      getProjectTask(client, { apiKey: session.accessToken, taskId, signal: controller.signal }),
      listTimeEntries(client, { apiKey: session.accessToken, page: 1, limit: 50, work_item_id: taskId, work_item_type: "project_task", signal: controller.signal }),
      services.length > 0 ? Promise.resolve(null) : getServices(client, { apiKey: session.accessToken }),
      canAct ? getTaskChecklist(client, { apiKey: session.accessToken, taskId, signal: controller.signal }) : Promise.resolve(null),
      fetchComments(),
    ]);
    if (controller.signal.aborted) return;

    if (!taskResult.ok) {
      if (taskResult.error.kind === "canceled") return;
      logger.warn("Project task fetch failed", { error: taskResult.error });
      setError(t("projectTask.unableToLoadDescription"));
    } else {
      setTask(taskResult.data.data);
    }
    if (entriesResult.ok && Array.isArray(entriesResult.data.data)) {
      setEntries(entriesResult.data.data);
    } else if (!entriesResult.ok && entriesResult.error.kind !== "canceled") {
      logger.warn("Project task time entries fetch failed", { error: entriesResult.error });
      setEntriesError(t("projectTask.timeEntriesFailed"));
    }
    if (servicesResult?.ok && Array.isArray(servicesResult.data.data)) {
      setServices(servicesResult.data.data);
    }
    if (checklistResult) {
      if (checklistResult.ok && Array.isArray(checklistResult.data.data)) {
        setChecklist([...checklistResult.data.data].sort((a, b) => (a.order_number ?? 0) - (b.order_number ?? 0)));
        setChecklistError(null);
      } else if (!checklistResult.ok && checklistResult.error.kind !== "canceled") {
        setChecklistError(t("projectTask.checklistFailed"));
      }
    }
  }, [canAct, client, fetchComments, services.length, session, t, taskId]);

  const { refreshing, refresh } = usePullToRefresh(load, { haptics: true });

  useEffect(() => {
    let canceled = false;
    void (async () => {
      if (!client || !session) return;
      setLoading(true);
      await load();
      if (!canceled) setLoading(false);
    })();
    return () => {
      canceled = true;
    };
    // Reload once per task; later refreshes come from the user or the timer.
  }, [client, session, taskId]);

  // A timer stopped on this task has just written an entry.
  const timerLastStoppedAt = timer.lastStopped?.workItemId === taskId ? timer.lastStopped.at : null;
  useEffect(() => {
    if (timerLastStoppedAt) void load();
  }, [timerLastStoppedAt]);

  // The service a time entry here should prefill: the task's own, else its
  // phase's default, else its project's. The API resolves that fallback; a
  // server without it sends only the task's own service_id.
  const effectiveServiceId = task?.effective_service_id ?? task?.service_id ?? null;
  const effectiveServiceSource: ProjectTaskServiceSource | null = effectiveServiceId
    ? task?.service_source ?? (task?.service_id ? "task" : null)
    : null;
  const effectiveService = useMemo<ServiceOption | null>(() => {
    if (!effectiveServiceId) return null;
    const name = task?.service_name ?? services.find((service) => service.service_id === effectiveServiceId)?.service_name;
    return name ? { service_id: effectiveServiceId, service_name: name } : null;
  }, [effectiveServiceId, services, task?.service_name]);

  const timeEntryHook = useTimeEntry(
    { client, session, ticketId: taskId, showToast, t: tTickets },
    {
      workItem: { id: taskId, type: "project_task" },
      defaultServiceId: effectiveServiceId,
      defaultServiceSource: effectiveServiceSource,
      onCreated: () => void load(),
    },
  );

  const commentDraftHook = useCommentDraft({
    client,
    session,
    ticketId: taskId,
    showToast,
    t: tTickets,
    isOffline,
    fetchTicket: async () => {},
    fetchComments,
    setComments,
    target: taskTarget(taskId),
  });

  const mentionUsersCache = useRef<MentionSuggestionItem[]>([]);
  const handleMentionSearch = useCallback(async (query: string, signal: AbortSignal): Promise<MentionSuggestionItem[]> => {
    if (!client || !session) return [];
    const results: MentionSuggestionItem[] = [];
    if (!query || "everyone".includes(query.toLowerCase())) {
      results.push({ user_id: "@everyone", username: "everyone", display_name: "Everyone", avatar_url: null });
    }
    if (!query) {
      const res = await listUsers(client, { apiKey: session.accessToken, limit: 50, signal });
      if (res.ok) {
        const mapped = res.data.data.map((u) => ({ user_id: u.user_id, username: u.username, display_name: getUserDisplayName(u), avatar_url: u.avatarUrl }));
        mentionUsersCache.current = mapped;
        results.push(...mapped);
      }
      return results;
    }
    const lower = query.toLowerCase();
    const filtered = mentionUsersCache.current.filter((u) => u.display_name.toLowerCase().includes(lower) || u.username.toLowerCase().includes(lower));
    if (filtered.length > 0) {
      results.push(...filtered);
      return results;
    }
    const res = await listUsers(client, { apiKey: session.accessToken, search: query, limit: 10, signal });
    if (res.ok) {
      results.push(...res.data.data.map((u) => ({ user_id: u.user_id, username: u.username, display_name: getUserDisplayName(u), avatar_url: u.avatarUrl })));
    }
    return results;
  }, [client, session]);

  const openStatusPicker = useCallback(async () => {
    if (!client || !session || !task?.project_id) return;
    setStatusError(null);
    setStatusPickerOpen(true);
    if (statusMappings.length > 0) return;
    setStatusLoading(true);
    const result = await listTaskStatusMappings(client, { apiKey: session.accessToken, projectId: task.project_id });
    setStatusLoading(false);
    if (!result.ok) {
      setStatusError(t("projectTask.statusesFailed"));
      return;
    }
    setStatusMappings(
      (result.data.data ?? [])
        .filter((mapping) => mapping.is_visible !== false)
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)),
    );
  }, [client, session, statusMappings.length, t, task?.project_id]);

  const changeStatus = useCallback(async (mappingId: string) => {
    if (!client || !session || statusUpdating) return;
    setStatusUpdating(true);
    try {
      const auditHeaders = await getClientMetadataHeaders();
      const result = await updateProjectTask(client, { apiKey: session.accessToken, taskId, data: { project_status_mapping_id: mappingId }, auditHeaders });
      if (!result.ok) {
        const message = result.error.kind === "permission"
          ? t("projectTask.statusPermission")
          : (result.error.kind === "validation" ? getApiErrorMessage(result.error.body) : null) ?? t("projectTask.statusFailed");
        setStatusError(message);
        return;
      }
      setStatusPickerOpen(false);
      showToast({ message: t("projectTask.statusUpdated"), tone: "success" });
      await load();
    } finally {
      setStatusUpdating(false);
    }
  }, [client, load, session, showToast, statusUpdating, t, taskId]);

  const toggleChecklistItem = useCallback(async (item: TaskChecklistItem) => {
    if (!client || !session || checklistBusyId) return;
    const next = !item.completed;
    setChecklistBusyId(item.checklist_item_id);
    setChecklist((current) => current.map((row) => (row.checklist_item_id === item.checklist_item_id ? { ...row, completed: next } : row)));
    try {
      const auditHeaders = await getClientMetadataHeaders();
      const result = await updateTaskChecklistItem(client, { apiKey: session.accessToken, taskId, itemId: item.checklist_item_id, data: { completed: next }, auditHeaders });
      if (!result.ok) {
        setChecklist((current) => current.map((row) => (row.checklist_item_id === item.checklist_item_id ? { ...row, completed: item.completed } : row)));
        showToast({ message: t("projectTask.checklistItemFailed"), tone: "error" });
      }
    } finally {
      setChecklistBusyId(null);
    }
  }, [checklistBusyId, client, session, showToast, t, taskId]);

  const imageAuth = useMemo(() => (config.ok && session ? { baseUrl: config.baseUrl, apiKey: session.accessToken } : undefined), [config, session]);

  if (!config.ok) {
    return <ErrorState title={t("common:configurationError")} description={config.error} />;
  }
  if (!session) {
    return <ErrorState title={t("common:signedOut")} description={t("common:signInAgain")} />;
  }
  if (loading && !task && !activity) {
    return <LoadingState message={t("projectTask.loading")} />;
  }
  if (!task && !activity) {
    return (
      <ErrorState
        title={t("projectTask.unableToLoad")}
        description={error ?? t("projectTask.unableToLoadDescription")}
        action={<PrimaryButton onPress={() => void refresh()}>{t("common:retry")}</PrimaryButton>}
      />
    );
  }

  const title = task?.task_name ?? activity?.title ?? "";
  const description = task ? task.description ?? null : activity?.description ?? null;
  const statusLabel = task?.status_name ?? (activity ? humanize(activity.status) : null) ?? t("common:unknown");
  const isClosed = task?.is_closed ?? activity?.isClosed ?? false;
  const projectLine = [task?.project_name ?? activity?.projectName, task?.phase_name ?? activity?.phaseName].filter(Boolean).join(" • ");
  // The activity feed carries no start date, so it only shows once the task has loaded.
  const startDate = task?.start_date ?? null;
  const dueDate = task ? task.due_date ?? null : activity?.dueDate ?? null;
  const assignees = task?.assigned_user_name ? [task.assigned_user_name] : activity?.assignedToNames ?? [];
  const estimated = task ? task.estimated_hours ?? null : activity?.estimatedHours ?? null;
  const totalMinutes = entries.reduce((sum, entry) => sum + timeEntryMinutes(entry), 0);
  const actual = totalMinutes > 0 ? totalMinutes : (task ? task.actual_hours ?? 0 : activity?.actualHours ?? 0);
  const canChangeStatus = canAct && Boolean(task?.project_id);
  const checklistDone = checklist.filter((item) => item.completed).length;

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ ...typography.title, color: colors.text }}>{title}</Text>

        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, marginTop: spacing.md }}>
          <Pressable
            testID="project-task-status"
            onPress={canChangeStatus ? () => void openStatusPicker() : undefined}
            disabled={!canChangeStatus}
            accessibilityRole={canChangeStatus ? "button" : undefined}
            accessibilityLabel={canChangeStatus ? t("projectTask.changeStatus") : undefined}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", opacity: pressed ? 0.7 : 1 })}
          >
            <Badge label={statusLabel} tone={isClosed ? "neutral" : "info"} />
            {canChangeStatus ? <Feather name="chevron-down" size={14} color={colors.textSecondary} style={{ marginLeft: 2 }} /> : null}
          </Pressable>
          {activity ? <Badge label={humanize(activity.priorityName ?? activity.priority)} tone={priorityTone(activity.priority)} /> : null}
          <View style={{ marginLeft: "auto" }}>
            <WorkItemTimerChip workItemId={taskId} workItemType="project_task" preferredService={effectiveService} />
          </View>
        </View>

        {error ? (
          <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.md }}>{error}</Text>
        ) : null}

        {projectLine ? <Section label={t("projectTask.projectLabel")} value={projectLine} /> : null}
        {startDate ? <Section label={t("projectTask.startDateLabel")} value={formatDateShort(startDate)} /> : null}
        {dueDate ? <Section label={t("projectTask.dueDateLabel")} value={formatDateShort(dueDate)} /> : null}
        {assignees.length > 0 ? <Section label={t("projectTask.assignedLabel")} value={assignees.join(", ")} /> : null}
        <Section
          label={t("projectTask.hoursLabel")}
          value={t("projectTask.hoursValue", {
            estimated: estimated !== null && estimated > 0 ? formatMinutesDuration(estimated) : t("projectTask.notEstimated"),
            actual: formatMinutesDuration(actual),
          })}
        />
        {effectiveService ? (
          <Section
            label={t("projectTask.serviceLabel")}
            value={effectiveServiceSource && effectiveServiceSource !== "task"
              ? t(`projectTask.serviceFrom.${effectiveServiceSource}`, { service: effectiveService.service_name })
              : effectiveService.service_name}
          />
        ) : null}

        <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg }}>{t("projectTask.descriptionLabel")}</Text>
        <Text style={{ ...typography.body, color: description ? colors.text : colors.textSecondary, marginTop: spacing.xs }}>
          {description ?? t("projectTask.noDescription")}
        </Text>

        {canAct ? (
          <>
            <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.xl }}>
              {t("projectTask.checklist")}{checklist.length > 0 ? ` • ${t("projectTask.checklistProgress", { done: checklistDone, total: checklist.length })}` : ""}
            </Text>
            {checklistError ? (
              <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.xs }}>{checklistError}</Text>
            ) : null}
            <Card style={{ marginTop: spacing.sm, padding: checklist.length === 0 ? spacing.md : 0 }}>
              {checklist.length === 0 ? (
                <Text style={{ ...typography.body, color: colors.textSecondary }}>{t("projectTask.noChecklist")}</Text>
              ) : (
                checklist.map((item, index) => (
                  <Pressable
                    key={item.checklist_item_id}
                    testID={`project-task-checklist-${item.checklist_item_id}`}
                    onPress={() => void toggleChecklistItem(item)}
                    disabled={checklistBusyId !== null}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: item.completed }}
                    accessibilityLabel={item.completed ? t("projectTask.markNotDone", { item: item.item_name }) : t("projectTask.markDone", { item: item.item_name })}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      padding: spacing.md,
                      borderBottomWidth: index === checklist.length - 1 ? 0 : 1,
                      borderBottomColor: colors.borderLight,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Feather name={item.completed ? "check-square" : "square"} size={20} color={item.completed ? colors.primary : colors.textSecondary} />
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                      <Text style={{ ...typography.body, color: item.completed ? colors.textSecondary : colors.text, textDecorationLine: item.completed ? "line-through" : "none" }}>
                        {item.item_name}
                      </Text>
                      {item.description ? (
                        <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>{item.description}</Text>
                      ) : null}
                    </View>
                  </Pressable>
                ))
              )}
            </Card>
          </>
        ) : null}

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl }}>
          <Text style={{ ...typography.caption, color: colors.textSecondary }}>
            {t("projectTask.timeEntries")}{totalMinutes > 0 ? ` • ${formatMinutesDuration(totalMinutes)}` : ""}
          </Text>
          <Pressable
            testID="project-task-log-time"
            onPress={() => timeEntryHook.openTimeEntryModal()}
            accessibilityRole="button"
            accessibilityLabel={t("projectTask.logTime")}
            hitSlop={8}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", opacity: pressed ? 0.7 : 1 })}
          >
            <Feather name="plus" size={14} color={colors.primary} />
            <Text style={{ ...typography.caption, color: colors.primary, fontWeight: "600", marginLeft: 2 }}>{t("projectTask.logTime")}</Text>
          </Pressable>
        </View>
        {entriesError ? (
          <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.xs }}>{entriesError}</Text>
        ) : null}
        <Card style={{ marginTop: spacing.sm, padding: entries.length === 0 ? spacing.md : 0 }}>
          {entries.length === 0 ? (
            <Text style={{ ...typography.body, color: colors.textSecondary }}>{t("projectTask.noTimeEntries")}</Text>
          ) : (
            entries.map((entry, index) => (
              <View
                key={entry.entry_id}
                testID={`project-task-time-entry-${entry.entry_id}`}
                style={{ padding: spacing.md, borderBottomWidth: index === entries.length - 1 ? 0 : 1, borderBottomColor: colors.borderLight }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ ...typography.body, color: colors.text, fontWeight: "600" }}>{formatMinutesDuration(timeEntryMinutes(entry))}</Text>
                  <Text style={{ ...typography.caption, color: colors.textSecondary }}>
                    {entry.start_time ? formatDateTime(entry.start_time) : entry.work_date ? formatDateShort(entry.work_date) : ""}
                  </Text>
                </View>
                {[entry.user_name, entry.service_name].filter(Boolean).length > 0 ? (
                  <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>
                    {[entry.user_name, entry.service_name].filter(Boolean).join(" • ")}
                  </Text>
                ) : null}
                {entry.notes ? (
                  <Text style={{ ...typography.body, color: colors.text, marginTop: spacing.xs }}>{entry.notes}</Text>
                ) : null}
              </View>
            ))
          )}
        </Card>

        {canAct ? (
          <>
            <View style={{ height: spacing.xl }} />
            <CommentsSection
              comments={comments}
              visibleCount={commentDraftHook.commentsVisibleCount}
              onLoadMore={() => commentDraftHook.setCommentsVisibleCount((c) => c + 20)}
              error={commentsError}
              imageAuth={imageAuth}
              baseUrl={config.baseUrl}
              ticketId={taskId}
              target={taskTarget(taskId)}
              onCommentUpdated={() => void fetchComments()}
              onSubmitReply={commentDraftHook.submitReply}
            />
            <View style={{ height: spacing.sm }} />
            <CommentComposer
              variant="task"
              draftContent={commentDraftHook.commentDraft}
              draftPlainText={commentDraftHook.commentDraftPlainText}
              isInternal
              onChangeIsInternal={() => {}}
              onSend={() => void commentDraftHook.sendComment()}
              sending={commentDraftHook.commentSending}
              offline={isOffline}
              error={commentDraftHook.commentSendError}
              editorRef={commentDraftHook.commentEditorRef}
              onDraftChange={(nextContent, nextPlainText) => {
                commentDraftHook.setCommentDraft(nextContent);
                commentDraftHook.setCommentDraftPlainText(nextPlainText);
              }}
              collapsed={composerCollapsed}
              onToggleCollapse={() => setComposerCollapsed((value) => !value)}
              onMentionSearch={handleMentionSearch}
              mentionBaseUrl={config.baseUrl}
              mentionAuthToken={session.accessToken}
            />
          </>
        ) : null}
      </ScrollView>

      <TimeEntryModal
        visible={timeEntryHook.timeEntryOpen}
        date={timeEntryHook.timeEntryDate}
        onChangeDate={timeEntryHook.setTimeEntryDate}
        startTime={timeEntryHook.timeEntryStartTime}
        onChangeStartTime={timeEntryHook.setTimeEntryStartTime}
        endTime={timeEntryHook.timeEntryEndTime}
        onChangeEndTime={timeEntryHook.setTimeEntryEndTime}
        notes={timeEntryHook.timeEntryNotes}
        onChangeNotes={timeEntryHook.setTimeEntryNotes}
        serviceId={timeEntryHook.timeEntryServiceId}
        onChangeServiceId={timeEntryHook.setTimeEntryServiceId}
        serviceSource={timeEntryHook.timeEntryServiceSource}
        client={client}
        apiKey={session.accessToken}
        updating={timeEntryHook.timeEntryUpdating}
        error={timeEntryHook.timeEntryError}
        onClose={() => timeEntryHook.setTimeEntryOpen(false)}
        onSubmit={() => void timeEntryHook.submitTimeEntry()}
      />
      <EntityPickerModal
        visible={statusPickerOpen}
        title={t("projectTask.selectStatus")}
        emptyLabel={t("projectTask.noStatuses")}
        items={statusMappings.map((mapping) => ({ id: mapping.project_status_mapping_id, label: statusMappingLabel(mapping) || t("common:unknown") }))}
        loading={statusLoading || statusUpdating}
        error={statusError}
        searchable={false}
        selectedId={task?.project_status_mapping_id ?? null}
        onSelect={(id) => void changeStatus(id)}
        onClose={() => setStatusPickerOpen(false)}
      />
    </>
  );
}

function Section({ label, value }: { label: string; value: string }) {
  const { colors, spacing, typography } = useTheme();
  return (
    <>
      <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg }}>{label}</Text>
      <Text style={{ ...typography.body, color: colors.text, marginTop: spacing.xs }}>{value}</Text>
    </>
  );
}
