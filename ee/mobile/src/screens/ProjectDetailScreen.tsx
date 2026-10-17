import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../ui/ThemeContext";
import { Avatar } from "../ui/components/Avatar";
import { Badge } from "../ui/components/Badge";
import { Card } from "../ui/components/Card";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";
import { formatDateShort } from "../ui/formatters/dateTime";
import { useToast } from "../ui/toast/ToastProvider";
import { ProgressBar } from "../features/projects/components/ProgressBar";
import { CreateTaskModal } from "../features/projects/components/CreateTaskModal";
import { useAuth } from "../auth/AuthContext";
import { useCapabilities } from "../capabilities/CapabilitiesContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import { getClient } from "../api/clients";
import {
  getProject,
  groupTasksByPhase,
  listProjectPhases,
  listProjectStatuses,
  listProjectTasks,
  projectProgress,
  statusTone,
  ORPHAN_PHASE_ID,
  type PhaseWithTasks,
  type ProjectDetail,
  type ProjectTaskSummary,
} from "../api/projects";
import { listTaskStatusMappings, statusMappingLabel, type TaskStatusMapping } from "../api/projectTasks";
import { getUserDisplayName, listUsers } from "../api/users";
import { useAppResume } from "../hooks/useAppResume";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { logger } from "../logging/logger";

type Props = NativeStackScreenProps<RootStackParamList, "ProjectDetail">;

const DESCRIPTION_PREVIEW_LINES = 3;

function isPastDue(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due.getTime() < today.getTime();
}

export function ProjectDetailScreen({ navigation, route }: Props) {
  const { t } = useTranslation("projects");
  const theme = useTheme();
  const { showToast } = useToast();
  const { projectId } = route.params;
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession } = useAuth();
  const { features } = useCapabilities();
  const abortRef = useRef<AbortController | null>(null);

  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/project-detail",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);

  const apiKey = session?.accessToken;

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [tasks, setTasks] = useState<ProjectTaskSummary[]>([]);
  const [mappings, setMappings] = useState<TaskStatusMapping[]>([]);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedDescription, setExpandedDescription] = useState(false);
  const [showCompleted, setShowCompleted] = useState<Record<string, boolean>>({});
  const [createPhase, setCreatePhase] = useState<{ phaseId: string; phaseName: string } | null>(null);
  const [createBlocked, setCreateBlocked] = useState(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  const load = useCallback(async () => {
    if (!client || !apiKey) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);

    const [projectResult, phasesResult, tasksResult, mappingsResult, statusesResult, usersResult] =
      await Promise.all([
        getProject(client, { apiKey, projectId, signal: controller.signal }),
        listProjectPhases(client, { apiKey, projectId, signal: controller.signal }),
        listProjectTasks(client, { apiKey, projectId, signal: controller.signal }),
        listTaskStatusMappings(client, { apiKey, projectId, signal: controller.signal }),
        listProjectStatuses(client, { apiKey, signal: controller.signal }),
        listUsers(client, { apiKey, limit: 200, signal: controller.signal }),
      ]);

    if (abortRef.current === controller) abortRef.current = null;
    if (controller.signal.aborted) return;

    if (!projectResult.ok) {
      if (projectResult.error.kind === "canceled") return;
      logger.warn("Project fetch failed", { error: projectResult.error });
      setError(t("errors.unableToLoad", "Unable to load."));
      return;
    }

    const detail = projectResult.data.data;
    setProject({ ...detail, phases: phasesResult.ok ? phasesResult.data.data : detail.phases });
    setTasks(tasksResult.ok ? tasksResult.data.data : []);
    setMappings(mappingsResult.ok ? mappingsResult.data.data ?? [] : []);
    if (statusesResult.ok) {
      setStatusLabel(
        statusesResult.data.data.find((status) => status.status_id === detail.status)?.name ?? null,
      );
    }
    if (usersResult.ok) {
      setUserNames(new Map(usersResult.data.data.map((user) => [user.user_id, getUserDisplayName(user)])));
    }

    // The project row carries only client_id; the name needs its own read.
    if (detail.client_name) {
      setClientName(detail.client_name);
    } else if (detail.client_id) {
      const clientResult = await getClient(client, { apiKey, clientId: detail.client_id });
      if (clientResult.ok) setClientName(clientResult.data.data.client_name ?? null);
    }
  }, [apiKey, client, projectId, t]);

  // The load closure changes with every fetched field; the effects below must
  // only re-run when the project being viewed changes.
  const loadRef = useRef(load);
  loadRef.current = load;

  const { refreshing, refresh } = usePullToRefresh(async () => {
    await loadRef.current();
  }, { haptics: true });
  useAppResume(() => void refresh());

  useEffect(() => {
    let canceled = false;
    void (async () => {
      if (!client || !apiKey) return;
      setLoading(true);
      await loadRef.current();
      if (!canceled) setLoading(false);
    })();
    return () => {
      canceled = true;
    };
  }, [apiKey, client, projectId]);

  // A task edited on the detail screen must show its new state on the way back.
  useEffect(
    () => navigation.addListener("focus", () => void loadRef.current()),
    [navigation],
  );

  const sections = useMemo(
    () => groupTasksByPhase(project?.phases ?? [], tasks, mappings),
    [mappings, project?.phases, tasks],
  );
  const progress = useMemo(() => projectProgress(sections), [sections]);
  const closedMappings = useMemo(
    () => new Set(mappings.filter((mapping) => mapping.is_closed).map((m) => m.project_status_mapping_id)),
    [mappings],
  );
  const mappingLabels = useMemo(
    () => new Map(mappings.map((mapping) => [mapping.project_status_mapping_id, statusMappingLabel(mapping)])),
    [mappings],
  );
  const defaultMappingId = useMemo(() => {
    const visible = mappings
      .filter((mapping) => mapping.is_visible !== false)
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
    return visible[0]?.project_status_mapping_id ?? null;
  }, [mappings]);

  const openTask = useCallback(
    (taskId: string) => navigation.navigate("ProjectTaskDetail", { taskId }),
    [navigation],
  );

  if (!config.ok) {
    return <ErrorState title={t("common:configurationError", "Configuration error")} description={config.error} />;
  }
  if (!session) {
    return (
      <ErrorState
        title={t("common:signedOut", "Signed out")}
        description={t("common:signInAgain", "Please sign in again.")}
      />
    );
  }
  if (loading && !project) {
    return <LoadingState message={t("detail.loading", "Loading project")} />;
  }
  if (!project) {
    return (
      <ErrorState
        title={t("errors.unableToLoad", "Unable to load.")}
        description={error ?? undefined}
        action={<PrimaryButton onPress={() => void refresh()}>{t("common:retry", "Retry")}</PrimaryButton>}
      />
    );
  }

  const dates = [project.start_date, project.end_date]
    .map((value) => (value ? formatDateShort(value) : null))
    .filter(Boolean)
    .join(" – ");
  const managerName = project.assigned_to ? userNames.get(project.assigned_to) ?? null : null;
  const canCreateTask = features.projects && !createBlocked && Boolean(defaultMappingId);

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
          <Text style={{ ...theme.typography.title, color: theme.colors.text, flex: 1 }}>
            {project.project_name}
          </Text>
          {statusLabel ? <Badge label={statusLabel} tone={statusTone(statusLabel)} /> : null}
        </View>

        {progress.total > 0 ? (
          <View style={{ marginTop: theme.spacing.md }}>
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginBottom: 4 }}>
              {t("list.progress", "{{done}} of {{total}} tasks done", {
                done: progress.done,
                total: progress.total,
              })}
            </Text>
            <ProgressBar testID="project-progress" ratio={progress.ratio} />
          </View>
        ) : null}

        {project.client_id ? (
          <Pressable
            testID="project-client"
            onPress={() =>
              navigation.navigate("ClientDetail", {
                clientId: project.client_id,
                clientName: clientName ?? undefined,
              })
            }
            accessibilityRole="button"
            accessibilityLabel={clientName ?? t("detail.client", "Client")}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: theme.spacing.lg,
              padding: theme.spacing.md,
              borderRadius: theme.borderRadius.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.card,
              opacity: pressed ? 0.95 : 1,
            })}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
                {t("detail.client", "Client")}
              </Text>
              <Text style={{ ...theme.typography.body, color: theme.colors.text }} numberOfLines={1}>
                {clientName ?? project.client_id}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={theme.colors.textSecondary} />
          </Pressable>
        ) : null}

        {dates ? <Field label={t("detail.dates", "Dates")} value={dates} /> : null}
        <Field label={t("detail.manager", "Manager")} value={managerName ?? t("detail.unassigned", "Unassigned")} />

        {project.description ? (
          <>
            <Text
              style={{ ...theme.typography.body, color: theme.colors.text, marginTop: theme.spacing.lg }}
              numberOfLines={expandedDescription ? undefined : DESCRIPTION_PREVIEW_LINES}
            >
              {project.description}
            </Text>
            <Pressable
              testID="project-description-toggle"
              onPress={() => setExpandedDescription((value) => !value)}
              accessibilityRole="button"
              hitSlop={8}
              style={{ marginTop: theme.spacing.xs, alignSelf: "flex-start" }}
            >
              <Text style={{ ...theme.typography.caption, color: theme.colors.primary, fontWeight: "700" }}>
                {expandedDescription ? t("detail.seeLess", "See less") : t("detail.seeMore", "See more")}
              </Text>
            </Pressable>
          </>
        ) : null}

        <View style={{ height: theme.spacing.lg }} />

        {sections.length === 0 ? (
          <EmptyState title={t("detail.noPhases", "No phases yet. Add phases on the web.")} />
        ) : (
          sections.map((section) => (
            <PhaseSection
              key={section.phase.phase_id}
              section={section}
              closedMappings={closedMappings}
              mappingLabels={mappingLabels}
              userNames={userNames}
              showCompleted={showCompleted[section.phase.phase_id] === true}
              onToggleCompleted={() =>
                setShowCompleted((current) => ({
                  ...current,
                  [section.phase.phase_id]: !current[section.phase.phase_id],
                }))
              }
              canCreateTask={canCreateTask && section.phase.phase_id !== ORPHAN_PHASE_ID}
              onAddTask={() =>
                setCreatePhase({ phaseId: section.phase.phase_id, phaseName: section.phase.phase_name })
              }
              onOpenTask={openTask}
            />
          ))
        )}
      </ScrollView>

      <CreateTaskModal
        visible={createPhase !== null}
        client={client}
        apiKey={apiKey}
        projectId={projectId}
        phaseId={createPhase?.phaseId ?? null}
        phaseName={createPhase?.phaseName ?? null}
        statusMappingId={defaultMappingId}
        onClose={() => setCreatePhase(null)}
        onForbidden={() => {
          setCreateBlocked(true);
          setCreatePhase(null);
        }}
        onCreated={(task) => {
          setTasks((current) => [...current, task]);
          setCreatePhase(null);
          showToast({ message: t("task.create.created", "Task created"), tone: "success" });
        }}
      />
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <>
      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.lg }}>
        {label}
      </Text>
      <Text style={{ ...theme.typography.body, color: theme.colors.text, marginTop: theme.spacing.xs }}>
        {value}
      </Text>
    </>
  );
}

function PhaseSection({
  section,
  closedMappings,
  mappingLabels,
  userNames,
  showCompleted,
  onToggleCompleted,
  canCreateTask,
  onAddTask,
  onOpenTask,
}: {
  section: PhaseWithTasks;
  closedMappings: Set<string>;
  mappingLabels: Map<string, string>;
  userNames: Map<string, string>;
  showCompleted: boolean;
  onToggleCompleted: () => void;
  canCreateTask: boolean;
  onAddTask: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const { t } = useTranslation("projects");
  const theme = useTheme();
  const phaseId = section.phase.phase_id;
  const isDone = (task: ProjectTaskSummary) =>
    task.is_closed === true ||
    (task.project_status_mapping_id ? closedMappings.has(task.project_status_mapping_id) : false);
  const openTasks = section.tasks.filter((task) => !isDone(task));
  const doneTasks = section.tasks.filter(isDone);
  const title =
    phaseId === ORPHAN_PHASE_ID ? t("detail.otherPhase", "Other tasks") : section.phase.phase_name;

  return (
    <View style={{ marginBottom: theme.spacing.xl }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
        <Text style={{ ...theme.typography.subtitle, color: theme.colors.text, flex: 1 }} numberOfLines={2}>
          {title}
        </Text>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
          {t("detail.phaseDone", "{{done}} of {{total}} done", {
            done: section.doneCount,
            total: section.totalCount,
          })}
        </Text>
        {canCreateTask ? (
          <Pressable
            testID={`project-phase-${phaseId}-add-task`}
            onPress={onAddTask}
            accessibilityRole="button"
            accessibilityLabel={t("detail.addTask", "Add task")}
            hitSlop={8}
          >
            <Feather name="plus" size={20} color={theme.colors.primary} />
          </Pressable>
        ) : null}
      </View>
      {section.totalCount > 0 ? (
        <View style={{ marginTop: theme.spacing.sm }}>
          <ProgressBar
            testID={`project-phase-${phaseId}-progress`}
            ratio={section.totalCount === 0 ? 0 : section.doneCount / section.totalCount}
          />
        </View>
      ) : null}

      <Card style={{ marginTop: theme.spacing.sm, padding: section.tasks.length === 0 ? theme.spacing.md : 0 }}>
        {section.tasks.length === 0 ? (
          <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary }}>
            {t("detail.noTasks", "No tasks in this phase yet.")}
          </Text>
        ) : (
          <>
            {openTasks.map((task, index) => (
              <TaskRow
                key={task.task_id}
                task={task}
                last={index === openTasks.length - 1 && (doneTasks.length === 0 || !showCompleted)}
                statusLabel={
                  task.project_status_mapping_id
                    ? mappingLabels.get(task.project_status_mapping_id) ?? null
                    : null
                }
                assigneeName={task.assigned_to ? userNames.get(task.assigned_to) ?? null : null}
                done={false}
                onPress={() => onOpenTask(task.task_id)}
              />
            ))}
            {showCompleted
              ? doneTasks.map((task, index) => (
                  <TaskRow
                    key={task.task_id}
                    task={task}
                    last={index === doneTasks.length - 1}
                    statusLabel={
                      task.project_status_mapping_id
                        ? mappingLabels.get(task.project_status_mapping_id) ?? null
                        : null
                    }
                    assigneeName={task.assigned_to ? userNames.get(task.assigned_to) ?? null : null}
                    done
                    onPress={() => onOpenTask(task.task_id)}
                  />
                ))
              : null}
          </>
        )}
      </Card>

      {doneTasks.length > 0 ? (
        <Pressable
          testID={`project-phase-${phaseId}-show-completed`}
          onPress={onToggleCompleted}
          accessibilityRole="button"
          hitSlop={8}
          style={{ marginTop: theme.spacing.sm, alignSelf: "flex-start" }}
        >
          <Text style={{ ...theme.typography.caption, color: theme.colors.primary, fontWeight: "700" }}>
            {showCompleted
              ? t("detail.hideCompleted", "Hide completed")
              : t("detail.showCompleted", "Show {{count}} completed", { count: doneTasks.length })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function TaskRow({
  task,
  statusLabel,
  assigneeName,
  done,
  last,
  onPress,
}: {
  task: ProjectTaskSummary;
  statusLabel: string | null;
  assigneeName: string | null;
  done: boolean;
  last: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const overdue = !done && isPastDue(task.due_date);

  return (
    <Pressable
      testID={`project-task-row-${task.task_id}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={task.task_name}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: theme.colors.borderLight,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {assigneeName ? <Avatar name={assigneeName} size="sm" /> : null}
      <View style={{ flex: 1 }}>
        <Text
          style={{
            ...theme.typography.body,
            color: done ? theme.colors.textSecondary : theme.colors.text,
            textDecorationLine: done ? "line-through" : "none",
          }}
          numberOfLines={2}
        >
          {task.task_name}
        </Text>
        {task.due_date ? (
          <Text
            testID={`project-task-due-${task.task_id}`}
            style={{
              ...theme.typography.caption,
              color: overdue ? theme.colors.danger : theme.colors.textSecondary,
              marginTop: 2,
              fontWeight: overdue ? "700" : "400",
            }}
          >
            {formatDateShort(task.due_date)}
          </Text>
        ) : null}
      </View>
      {statusLabel ? <Badge label={statusLabel} tone={done ? "success" : "info"} /> : null}
    </Pressable>
  );
}
