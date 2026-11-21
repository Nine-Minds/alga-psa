import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../ui/ThemeContext";
import { Avatar } from "../ui/components/Avatar";
import { Badge } from "../ui/components/Badge";
import { FilterChip } from "../ui/components/FilterChip";
import { SearchBar } from "../ui/components/SearchBar";
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
import {
  EMPTY_TASK_FILTERS,
  assigneeOptions,
  filterProjectTasks,
  hasActiveTaskFilters,
  type ProjectTaskFilters,
} from "./projectTaskFilters";

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
  const [taskFilters, setTaskFilters] = useState<ProjectTaskFilters>(EMPTY_TASK_FILTERS);
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
        listUsers(client, { apiKey, limit: 100, signal: controller.signal }),
      ]);

    if (abortRef.current === controller) abortRef.current = null;
    if (controller.signal.aborted) return;

    // Only a load that ran to completion may clear the spinner: an aborted
    // one would otherwise flash "Unable to load" while its replacement runs.
    setLoading(false);
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
      if (!client || !apiKey || canceled) return;
      setLoading(true);
      await loadRef.current();
    })();
    return () => {
      canceled = true;
    };
  }, [apiKey, client, projectId]);

  // A task edited on the detail screen must show its new state on the way back.
  // The first focus arrives while the mount load is still running; reloading
  // then would only abort it.
  useEffect(
    () =>
      navigation.addListener("focus", () => {
        if (abortRef.current) return;
        void loadRef.current();
      }),
    [navigation],
  );

  const allSections = useMemo(
    () => groupTasksByPhase(project?.phases ?? [], tasks, mappings),
    [mappings, project?.phases, tasks],
  );
  // Progress always counts every task; search and filters only change what is listed.
  const progress = useMemo(() => projectProgress(allSections), [allSections]);
  const meUserId = session?.user?.id ?? null;
  const filtersActive = hasActiveTaskFilters(taskFilters);
  const visibleTasks = useMemo(
    () => (filtersActive ? filterProjectTasks(tasks, taskFilters, { meUserId, assigneeNames: userNames }) : tasks),
    [filtersActive, meUserId, taskFilters, tasks, userNames],
  );
  const sections = useMemo(() => {
    if (!filtersActive) return allSections;
    return groupTasksByPhase(project?.phases ?? [], visibleTasks, mappings).filter((section) => section.tasks.length > 0);
  }, [allSections, filtersActive, mappings, project?.phases, visibleTasks]);
  const assignees = useMemo(() => assigneeOptions(tasks, userNames), [tasks, userNames]);
  const statusChoices = useMemo(
    () =>
      mappings
        .filter((mapping) => mapping.is_visible !== false)
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)),
    [mappings],
  );
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

        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: theme.spacing.sm,
            marginTop: theme.spacing.md,
          }}
        >
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
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <MetaItem icon="briefcase" text={clientName ?? project.client_id} link />
            </Pressable>
          ) : null}
          <MetaItem
            icon="user"
            text={managerName ?? t("detail.unassigned", "Unassigned")}
            accessibilityLabel={`${t("detail.manager", "Manager")}: ${managerName ?? t("detail.unassigned", "Unassigned")}`}
          />
          {dates ? <MetaItem icon="calendar" text={dates} /> : null}
        </View>

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

        <View style={{ marginTop: theme.spacing.xl }}>
          <Text style={{ ...theme.typography.subtitle, color: theme.colors.text, marginBottom: theme.spacing.sm }}>
            {t("detail.tasks", "Tasks")}
          </Text>
          <SearchBar
            value={taskFilters.query}
            onChangeText={(query) => setTaskFilters((current) => ({ ...current, query }))}
            placeholder={t("detail.searchTasks", "Search tasks")}
            accessibilityLabel={t("detail.searchTasksAccessibility", "Search tasks by name, description or assignee")}
          />
          <ChipRow>
            <FilterChip
              testID="project-task-status-all"
              label={t("detail.allStatuses", "All statuses")}
              selected={taskFilters.statusMappingIds.length === 0}
              onPress={() => setTaskFilters((current) => ({ ...current, statusMappingIds: [] }))}
            />
            {statusChoices.map((mapping) => {
              const id = mapping.project_status_mapping_id;
              const selected = taskFilters.statusMappingIds.includes(id);
              return (
                <FilterChip
                  key={id}
                  testID={`project-task-status-${id}`}
                  label={statusMappingLabel(mapping)}
                  selected={selected}
                  onPress={() =>
                    setTaskFilters((current) => ({
                      ...current,
                      statusMappingIds: selected
                        ? current.statusMappingIds.filter((value) => value !== id)
                        : [...current.statusMappingIds, id],
                    }))
                  }
                />
              );
            })}
          </ChipRow>
          <ChipRow>
            <FilterChip
              testID="project-task-assignee-any"
              label={t("detail.anyAssignee", "Anyone")}
              selected={taskFilters.assignee === "any"}
              onPress={() => setTaskFilters((current) => ({ ...current, assignee: "any" }))}
            />
            {meUserId ? (
              <FilterChip
                testID="project-task-assignee-me"
                label={t("detail.assignedToMe", "Me")}
                selected={taskFilters.assignee === "me"}
                onPress={() => setTaskFilters((current) => ({ ...current, assignee: "me" }))}
              />
            ) : null}
            <FilterChip
              testID="project-task-assignee-unassigned"
              label={t("detail.unassigned", "Unassigned")}
              selected={taskFilters.assignee === "unassigned"}
              onPress={() => setTaskFilters((current) => ({ ...current, assignee: "unassigned" }))}
            />
            {assignees.map((person) => (
              <FilterChip
                key={person.userId}
                testID={`project-task-assignee-${person.userId}`}
                label={person.name}
                count={person.count}
                selected={typeof taskFilters.assignee === "object" && taskFilters.assignee.userId === person.userId}
                onPress={() => setTaskFilters((current) => ({ ...current, assignee: { userId: person.userId } }))}
              />
            ))}
          </ChipRow>
          {filtersActive ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: theme.spacing.sm,
              }}
            >
              <Text testID="project-task-match-count" style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
                {t("detail.matchCount", { count: visibleTasks.length })}
              </Text>
              <Pressable
                testID="project-task-filters-clear"
                onPress={() => setTaskFilters(EMPTY_TASK_FILTERS)}
                accessibilityRole="button"
                hitSlop={8}
              >
                <Text style={{ ...theme.typography.caption, color: theme.colors.primary, fontWeight: "700" }}>
                  {t("detail.clearFilters", "Clear")}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={{ height: theme.spacing.md }} />

        {sections.length === 0 ? (
          <EmptyState
            title={
              filtersActive
                ? t("detail.noMatches", "No tasks match these filters.")
                : t("detail.noPhases", "No phases yet. Add phases on the web.")
            }
          />
        ) : (
          sections.map((section) => (
            <PhaseSection
              key={section.phase.phase_id}
              section={section}
              closedMappings={closedMappings}
              mappingLabels={mappingLabels}
              userNames={userNames}
              showCompleted={showCompleted[section.phase.phase_id] === true}
              filtered={filtersActive}
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

function MetaItem({
  icon,
  text,
  link = false,
  accessibilityLabel,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  text: string;
  link?: boolean;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const color = link ? theme.colors.primary : theme.colors.textSecondary;
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.xs, paddingRight: theme.spacing.sm }}
    >
      <Feather name={icon} size={14} color={color} />
      <Text style={{ ...theme.typography.caption, color, fontWeight: link ? "600" : "400" }} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={{ marginTop: theme.spacing.sm }}
      contentContainerStyle={{ gap: theme.spacing.sm, paddingRight: theme.spacing.lg }}
    >
      {children}
    </ScrollView>
  );
}

function PhaseSection({
  section,
  closedMappings,
  mappingLabels,
  userNames,
  showCompleted,
  filtered,
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
  /** Search/filters active: show every matching task and drop the completed toggle. */
  filtered: boolean;
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
  const showDone = filtered || showCompleted;
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
                last={index === openTasks.length - 1 && (doneTasks.length === 0 || !showDone)}
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
            {showDone
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

      {doneTasks.length > 0 && !filtered ? (
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
        {assigneeName || task.due_date ? (
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: theme.spacing.xs, marginTop: 2 }}>
            {assigneeName ? (
              <Text
                testID={`project-task-assignee-${task.task_id}`}
                style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}
                numberOfLines={1}
              >
                {assigneeName}
              </Text>
            ) : null}
            {assigneeName && task.due_date ? (
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>·</Text>
            ) : null}
            {task.due_date ? (
              <Text
                testID={`project-task-due-${task.task_id}`}
                style={{
                  ...theme.typography.caption,
                  color: overdue ? theme.colors.danger : theme.colors.textSecondary,
                  fontWeight: overdue ? "700" : "400",
                }}
              >
                {formatDateShort(task.due_date)}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      {statusLabel ? <Badge label={statusLabel} tone={done ? "success" : "info"} /> : null}
    </Pressable>
  );
}
