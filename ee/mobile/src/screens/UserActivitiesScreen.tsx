import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { DrawerScreenProps } from "@react-navigation/drawer";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { DrawerParamList, RootStackParamList } from "../navigation/types";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient, type ApiClient } from "../api";
import type { ApiError } from "../api";
import {
  createAdHocEntry,
  deleteAdHocEntry,
  listActivities,
  listActivitiesGrouped,
  listActivityGroups,
  moveActivityToGroup,
  removeActivityFromGroups,
  reorderActivitiesInGroup,
  setAdHocDone,
  updateAdHocEntry,
  isAdHocActivity,
  type Activity,
  type ActivityGroup,
  type MobileActivityType,
  type ScheduleActivity,
} from "../api/activities";
import { buildCustomGroups, UNGROUPED_KEY } from "../features/userActivities/activityHelpers";
import { DraggableGroupedList } from "../features/userActivities/components/DraggableGroupedList";
import type { GroupDragPlan } from "../features/userActivities/groupDragPlan";
import { listPriorities, type MobilePriority } from "../api/priorities";
import {
  getCachedUserActivities,
  setCachedUserActivities,
} from "../cache/userActivitiesCache";
import { getSecureJson, setSecureJson } from "../storage/secureStorage";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { useAppResume } from "../hooks/useAppResume";
import { useTheme } from "../ui/ThemeContext";
import type { Theme } from "../ui/themes";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { combineDateAndTime, startOfDay, toHHMM } from "../features/schedule/scheduleUtils";
import { ActivityRow } from "../features/userActivities/components/ActivityRow";
import {
  AdHocEntryFormModal,
  defaultAdHocFormValue,
  type AdHocFormValue,
} from "../features/userActivities/components/AdHocEntryFormModal";
import {
  ACTIVITY_SORT_FIELDS,
  ACTIVITY_TYPE_FILTERS,
  DEFAULT_ACTIVITY_FILTERS,
  activitiesApiParams,
  countActiveFilters,
  groupFieldsFor,
  scopedPriorityItemType,
  type ActivitiesFilterState,
  type ActivityDueFilter,
  type ActivityGroupField,
} from "../features/userActivities/activityFilters";

type Props = CompositeScreenProps<
  DrawerScreenProps<DrawerParamList, "UserActivitiesTab">,
  NativeStackScreenProps<RootStackParamList>
>;

const PAGE_SIZE = 25;
const NEXT_PAGE_PREFETCH_THRESHOLD = 0.6;

const DUE_FILTERS: ActivityDueFilter[] = ["any", "overdue", "today", "week"];

function adHocActivityToFormValue(activity: ScheduleActivity): AdHocFormValue {
  const startDate = activity.startDate ? new Date(activity.startDate) : undefined;
  const validStart = startDate && !Number.isNaN(startDate.getTime()) ? startDate : undefined;
  const endDate = activity.endDate ? new Date(activity.endDate) : undefined;
  const validEnd = endDate && !Number.isNaN(endDate.getTime()) ? endDate : undefined;
  const hasTimes = Boolean(validStart && validEnd);
  return {
    title: activity.title,
    notes: activity.description ?? "",
    date: validStart ? startOfDay(validStart) : undefined,
    includeTime: hasTimes,
    startTime: validStart ? toHHMM(validStart) : "09:00",
    endTime: validEnd ? toHHMM(validEnd) : "10:00",
  };
}

function formScheduleTimes(value: AdHocFormValue): { scheduledStart: string | null; scheduledEnd: string | null } {
  if (!value.date) return { scheduledStart: null, scheduledEnd: null };
  if (!value.includeTime) {
    const startMidnight = combineDateAndTime(value.date, "00:00");
    return { scheduledStart: startMidnight ? startMidnight.toISOString() : null, scheduledEnd: null };
  }
  const start = combineDateAndTime(value.date, value.startTime);
  const end = combineDateAndTime(value.date, value.endTime);
  return {
    scheduledStart: start ? start.toISOString() : null,
    scheduledEnd: end ? end.toISOString() : null,
  };
}

/** Localized section title for a server group bucket (falls back to the server label). */
function useGroupTitle(): (groupBy: ActivityGroupField, group: ActivityGroup) => string {
  const { t } = useTranslation("userActivities");
  return useCallback(
    (groupBy: ActivityGroupField, group: ActivityGroup) => {
      switch (groupBy) {
        case "type":
          return t(`types.${group.key}`, { defaultValue: group.label });
        case "priority":
          return t(`groups.priority.${group.key}`, { defaultValue: group.label });
        case "dueDate":
          return t(`groups.due.${group.key}`, { defaultValue: group.label });
        case "custom":
          // Saved group names are user-authored; only the synthetic "Ungrouped" is localized.
          return group.key === UNGROUPED_KEY
            ? t("groups.ungrouped", { defaultValue: "Ungrouped" })
            : group.label;
        case "status":
        case "none":
        default:
          return group.label;
      }
    },
    [t],
  );
}

export function UserActivitiesScreen({ navigation }: Props) {
  const { t } = useTranslation("userActivities");
  const theme = useTheme();
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession, logout } = useAuth();
  const listAbortRef = useRef<AbortController | null>(null);
  const loadingMoreRef = useRef(false);
  const groupTitleFor = useGroupTitle();

  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/user-activities",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);

  // Flat (paginated) state.
  const [items, setItems] = useState<Activity[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(true);
  const [total, setTotal] = useState<number | null>(null);

  // Grouped state.
  const [groups, setGroups] = useState<ActivityGroup[]>([]);
  const [groupTotal, setGroupTotal] = useState<number | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);

  const [filters, setFilters] = useState<ActivitiesFilterState>(DEFAULT_ACTIVITY_FILTERS);
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const grouped = filters.groupBy !== "none";
  const resultsTotal = grouped ? groupTotal : total;

  // Ad-hoc create/edit sheet.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<"create" | "edit">("create");
  const [sheetInitial, setSheetInitial] = useState<AdHocFormValue>(() => defaultAdHocFormValue());
  const [editingActivity, setEditingActivity] = useState<ScheduleActivity | null>(null);
  const [sheetSaving, setSheetSaving] = useState(false);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  useEffect(() => {
    return () => listAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (searchInput === "" && search !== "") setSearch("");
  }, [searchInput, search]);

  // Load persisted filters once per user.
  useEffect(() => {
    let canceled = false;
    const run = async () => {
      const userId = session?.user?.id;
      if (!userId) {
        setFiltersLoaded(true);
        return;
      }
      const saved = await getSecureJson<ActivitiesFilterState>(`alga.mobile.activities.filters.${userId}`);
      if (canceled) return;
      if (saved) {
        setFilters({
          ...DEFAULT_ACTIVITY_FILTERS,
          ...saved,
          types: Array.isArray(saved.types) ? saved.types : [],
          priorityIds: Array.isArray(saved.priorityIds) ? saved.priorityIds : [],
        });
      }
      setFiltersLoaded(true);
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!filtersLoaded || !userId) return;
    void setSecureJson(`alga.mobile.activities.filters.${userId}`, filters);
  }, [filters, filtersLoaded, session?.user?.id]);

  // Priorities are per-type and only meaningful when scoped to a single prioritized type.
  // When that scope is lost (multi-type / non-prioritized), drop stale priority filters and
  // the now-invalid priority grouping so the query and view stay coherent.
  useEffect(() => {
    if (scopedPriorityItemType(filters)) return;
    if (filters.priorityIds.length === 0 && filters.groupBy !== "priority") return;
    setFilters((prev) => ({
      ...prev,
      priorityIds: [],
      groupBy: prev.groupBy === "priority" ? "none" : prev.groupBy,
    }));
  }, [filters]);

  const cacheKey = useMemo(() => {
    if (!session) return null;
    const userId = session.user?.id ?? "anon";
    return `alga.mobile.activities.list.${userId}.${JSON.stringify({
      status: filters.status,
      types: [...filters.types].sort(),
      priorityIds: [...filters.priorityIds].sort(),
      due: filters.due,
      sortField: filters.sortField,
      sortOrder: filters.sortOrder,
      search,
    })}`;
  }, [filters.status, filters.types, filters.priorityIds, filters.due, filters.sortField, filters.sortOrder, search, session]);

  // Seed the flat list from cache when the (flat) cache key changes.
  useEffect(() => {
    if (grouped) return;
    if (!cacheKey) return;
    const cached = getCachedUserActivities(cacheKey);
    setTotal(null);
    if (!cached) {
      setItems([]);
      setPage(1);
      setHasNext(true);
      return;
    }
    setItems(cached.items);
    setPage(cached.page);
    setHasNext(cached.hasNext);
  }, [cacheKey, grouped]);

  const loadFlat = useCallback(
    async ({ pageToLoad, replace }: { pageToLoad: number; replace: boolean }) => {
      if (!client || !session) return;
      setError(null);
      setNoAccess(false);

      listAbortRef.current?.abort();
      const ac = new AbortController();
      listAbortRef.current = ac;

      const result = await listActivities(client, {
        apiKey: session.accessToken,
        page: pageToLoad,
        pageSize: PAGE_SIZE,
        search: search || undefined,
        ...activitiesApiParams(filters),
        signal: ac.signal,
      });

      if (listAbortRef.current === ac) listAbortRef.current = null;
      if (ac.signal.aborted) return;

      if (!result.ok) {
        if (result.error.kind === "canceled") return;
        if (result.error.kind === "permission") {
          setItems([]);
          setHasNext(false);
          setNoAccess(true);
          return;
        }
        setError(t("list.unableToLoadDescription", { defaultValue: "We couldn't load your activities. Pull to refresh or try again." }));
        return;
      }

      const nextItems = result.data.data;
      setItems((prev) => (replace ? nextItems : [...prev, ...nextItems]));
      setPage(result.data.pagination.page);
      setHasNext(result.data.pagination.hasNext);
      setTotal(typeof result.data.pagination.total === "number" ? result.data.pagination.total : null);

      if (replace && pageToLoad === 1 && cacheKey) {
        setCachedUserActivities(cacheKey, {
          items: nextItems,
          page: result.data.pagination.page,
          hasNext: result.data.pagination.hasNext,
          lastRefreshedAtIso: new Date().toISOString(),
        });
      }
    },
    [cacheKey, client, filters, search, session, t],
  );

  const loadGrouped = useCallback(async () => {
    if (!client || !session) return;
    // `custom` is handled by loadCustomGroups; loadGrouped only serves the server dimensions.
    if (filters.groupBy === "none" || filters.groupBy === "custom") return;
    setError(null);
    setNoAccess(false);

    listAbortRef.current?.abort();
    const ac = new AbortController();
    listAbortRef.current = ac;

    const result = await listActivitiesGrouped(client, {
      apiKey: session.accessToken,
      search: search || undefined,
      ...activitiesApiParams(filters),
      groupBy: filters.groupBy,
      signal: ac.signal,
    });

    if (listAbortRef.current === ac) listAbortRef.current = null;
    if (ac.signal.aborted) return;

    if (!result.ok) {
      if (result.error.kind === "canceled") return;
      if (result.error.kind === "permission") {
        setGroups([]);
        setNoAccess(true);
        return;
      }
      setError(t("list.unableToLoadDescription", { defaultValue: "We couldn't load your activities. Pull to refresh or try again." }));
      return;
    }

    setGroups(result.data.data.groups);
    setGroupTotal(result.data.data.totalCount);
    setTruncated(result.data.data.truncated);
  }, [client, filters, search, session, t]);

  const loadCustomGroups = useCallback(async () => {
    if (!client || !session) return;
    setError(null);
    setNoAccess(false);

    listAbortRef.current?.abort();
    const ac = new AbortController();
    listAbortRef.current = ac;

    // Reuse the (unpaginated) grouped endpoint to pull the full filtered activity set, then
    // re-bucket it into the user's saved groups (fetched read-only from /activities/groups).
    const [listResult, groupsResult] = await Promise.all([
      listActivitiesGrouped(client, {
        apiKey: session.accessToken,
        search: search || undefined,
        ...activitiesApiParams(filters),
        groupBy: "type",
        signal: ac.signal,
      }),
      listActivityGroups(client, { apiKey: session.accessToken, signal: ac.signal }),
    ]);

    if (listAbortRef.current === ac) listAbortRef.current = null;
    if (ac.signal.aborted) return;

    if (!listResult.ok || !groupsResult.ok) {
      const failure = !listResult.ok ? listResult.error : !groupsResult.ok ? groupsResult.error : null;
      if (failure?.kind === "canceled") return;
      if (failure?.kind === "permission") {
        setGroups([]);
        setNoAccess(true);
        return;
      }
      setError(t("list.unableToLoadDescription", { defaultValue: "We couldn't load your activities. Pull to refresh or try again." }));
      return;
    }

    const allActivities = listResult.data.data.groups.flatMap((g) => g.activities);
    setGroups(buildCustomGroups(allActivities, groupsResult.data.data));
    setGroupTotal(listResult.data.data.totalCount);
    setTruncated(listResult.data.data.truncated);
  }, [client, filters, search, session, t]);

  // Persist a drag-to-organize gesture: render the optimistic arrangement immediately, fire
  // the single mutation it maps to, then reconcile against the server (or revert on failure).
  const handleGroupDragCommit = useCallback(
    async (plan: GroupDragPlan) => {
      if (!client || !session) return;
      const previous = groups;
      setGroups(plan.nextGroups);

      const m = plan.mutation;
      const result =
        m.kind === "reorder"
          ? await reorderActivitiesInGroup(client, { apiKey: session.accessToken, groupId: m.groupKey, items: m.items })
          : m.kind === "move"
            ? await moveActivityToGroup(client, {
                apiKey: session.accessToken,
                activityId: m.activityId,
                activityType: m.activityType,
                groupId: m.groupKey,
                sortOrder: m.sortOrder,
              })
            : m.kind === "remove"
              ? await removeActivityFromGroups(client, {
                  apiKey: session.accessToken,
                  activityId: m.activityId,
                  activityType: m.activityType,
                })
              : null;

      if (!result) return;
      if (!result.ok) {
        setGroups(previous);
        setError(t("groups.saveFailed", { defaultValue: "Couldn't save your change. Pull to refresh and try again." }));
        return;
      }
      // Reconcile counts / ungrouped membership / cross-group ordering with the server.
      await loadCustomGroups();
    },
    [client, groups, loadCustomGroups, session, t],
  );

  const reload = useCallback(async () => {
    if (filters.groupBy === "none") await loadFlat({ pageToLoad: 1, replace: true });
    else if (filters.groupBy === "custom") await loadCustomGroups();
    else await loadGrouped();
  }, [filters.groupBy, loadFlat, loadGrouped, loadCustomGroups]);

  const { refreshing, refresh } = usePullToRefresh(reload, { haptics: true });

  useAppResume(() => {
    void refresh();
  });

  useEffect(() => {
    if (!filtersLoaded) return;
    let canceled = false;
    const run = async () => {
      if (!client || !session) return;
      setInitialLoading(true);
      await reload();
      if (!canceled) setInitialLoading(false);
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [client, filtersLoaded, reload, session]);

  const onEndReached = useCallback(async () => {
    if (grouped) return;
    if (!client || !session) return;
    if (initialLoading || refreshing || loadingMoreRef.current) return;
    if (!hasNext) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      await loadFlat({ pageToLoad: page + 1, replace: false });
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [client, grouped, hasNext, initialLoading, loadFlat, page, refreshing, session]);

  const errorMessageFor = useCallback(
    (apiError: ApiError, fallback: string): string => {
      if (apiError.kind === "permission") {
        return t("errors.noPermission", { defaultValue: "You don't have permission to do that." });
      }
      if (apiError.kind === "validation" && apiError.message && !apiError.message.startsWith("HTTP")) {
        return apiError.message;
      }
      return fallback;
    },
    [t],
  );

  const openCreateAdHoc = useCallback(() => {
    setSheetMode("create");
    setEditingActivity(null);
    setSheetInitial(defaultAdHocFormValue());
    setSheetError(null);
    setSheetOpen(true);
  }, []);

  const openEditAdHoc = useCallback((activity: ScheduleActivity) => {
    setSheetMode("edit");
    setEditingActivity(activity);
    setSheetInitial(adHocActivityToFormValue(activity));
    setSheetError(null);
    setSheetOpen(true);
  }, []);

  const handleSubmitAdHoc = useCallback(
    async (value: AdHocFormValue) => {
      if (!client || !session) return;
      const title = value.title.trim();
      const notes = value.notes.trim();
      const { scheduledStart, scheduledEnd } = formScheduleTimes(value);

      setSheetSaving(true);
      setSheetError(null);

      const result =
        sheetMode === "edit" && editingActivity
          ? await updateAdHocEntry(client, {
              apiKey: session.accessToken,
              id: editingActivity.id,
              entry: { title, notes: notes || null, scheduledStart, scheduledEnd },
            })
          : await createAdHocEntry(client, {
              apiKey: session.accessToken,
              entry: { title, ...(notes ? { notes } : {}), scheduledStart, scheduledEnd },
            });

      setSheetSaving(false);
      if (!result.ok) {
        setSheetError(errorMessageFor(result.error, t("errors.saveFailed", { defaultValue: "Unable to save. Please try again." })));
        return;
      }
      setSheetOpen(false);
      setEditingActivity(null);
      await refresh();
    },
    [client, editingActivity, errorMessageFor, refresh, session, sheetMode, t],
  );

  const handleToggleDone = useCallback(
    async (done: boolean) => {
      if (!client || !session || !editingActivity) return;
      setSheetBusy(true);
      setSheetError(null);
      const result = await setAdHocDone(client, { apiKey: session.accessToken, id: editingActivity.id, done });
      setSheetBusy(false);
      if (!result.ok) {
        setSheetError(errorMessageFor(result.error, t("errors.doneFailed", { defaultValue: "Unable to update. Please try again." })));
        return;
      }
      setSheetOpen(false);
      setEditingActivity(null);
      await refresh();
    },
    [client, editingActivity, errorMessageFor, refresh, session, t],
  );

  const handleDeleteAdHoc = useCallback(async () => {
    if (!client || !session || !editingActivity) return;
    setSheetBusy(true);
    setSheetError(null);
    const result = await deleteAdHocEntry(client, { apiKey: session.accessToken, id: editingActivity.id });
    setSheetBusy(false);
    if (!result.ok) {
      setSheetError(errorMessageFor(result.error, t("errors.deleteFailed", { defaultValue: "Unable to delete. Please try again." })));
      return;
    }
    setSheetOpen(false);
    setEditingActivity(null);
    await refresh();
  }, [client, editingActivity, errorMessageFor, refresh, session, t]);

  const onPressActivity = useCallback(
    (activity: Activity) => {
      switch (activity.type) {
        case "ticket":
          navigation.navigate("TicketDetail", { ticketId: activity.id });
          return;
        case "projectTask":
          navigation.navigate("ProjectTaskDetail", { activity });
          return;
        case "workflowTask":
          navigation.navigate("WorkflowTaskDetail", { taskId: activity.id });
          return;
        case "schedule":
          if (isAdHocActivity(activity)) {
            openEditAdHoc(activity);
            return;
          }
          if (activity.workItemType === "ticket" && activity.workItemId) {
            navigation.navigate("TicketDetail", { ticketId: activity.workItemId });
            return;
          }
          navigation.navigate("ScheduleTab");
          return;
        default:
          // notification / document / timeEntry have no dedicated mobile detail in this release.
          return;
      }
    },
    [navigation, openEditAdHoc],
  );

  const renderItem = useCallback(
    ({ item }: { item: Activity }) => <ActivityRow activity={item} onPress={onPressActivity} />,
    [onPressActivity],
  );

  const keyExtractor = useCallback((item: Activity) => `${item.type}:${item.id}`, []);

  const commitSearch = useCallback(() => setSearch(searchInput.trim()), [searchInput]);
  const clearSearch = useCallback(() => {
    setSearchInput("");
    setSearch("");
  }, []);

  const toggleCollapsed = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters(DEFAULT_ACTIVITY_FILTERS);
    clearSearch();
  }, [clearSearch]);

  const sections = useMemo(
    () =>
      groups.map((group) => ({
        key: group.key,
        title: groupTitleFor(filters.groupBy, group),
        count: group.count,
        data: collapsed.has(group.key) ? [] : group.activities,
      })),
    [collapsed, filters.groupBy, groups, groupTitleFor],
  );

  if (!config.ok) {
    return <ErrorState title={t("common:configurationError")} description={config.error} />;
  }
  if (!session) {
    return <ErrorState title={t("common:signedOut")} description={t("common:signInAgain")} />;
  }
  if (noAccess) {
    return (
      <ErrorState
        title={t("list.noAccess", { defaultValue: "No access" })}
        description={t("list.noAccessDescription", { defaultValue: "Your account does not have permission to view activities." })}
        action={<PrimaryButton onPress={() => void logout()}>{t("list.signOut", { defaultValue: "Sign out" })}</PrimaryButton>}
      />
    );
  }

  const header = (
    <View style={{ marginBottom: theme.spacing.md }}>
      <View style={{ flexDirection: "row" }}>
        <View style={{ flex: 1 }}>
          <SearchField
            theme={theme}
            value={searchInput}
            onChangeText={setSearchInput}
            onSubmit={commitSearch}
            onClear={clearSearch}
            placeholder={t("filters.searchPlaceholder", { defaultValue: "Search activities" })}
            accessibilityLabel={t("filters.searchAccessibility", { defaultValue: "Search activities" })}
          />
        </View>
        <View style={{ width: theme.spacing.sm }} />
        <Pressable
          onPress={commitSearch}
          accessibilityRole="button"
          accessibilityLabel={t("filters.searchAccessibility", { defaultValue: "Search activities" })}
          style={({ pressed }) => ({
            paddingHorizontal: theme.spacing.md,
            borderRadius: theme.borderRadius.lg,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.card,
            justifyContent: "center",
            opacity: pressed ? 0.95 : 1,
          })}
        >
          <Feather name="search" size={16} color={theme.colors.text} />
        </Pressable>
        <View style={{ width: theme.spacing.sm }} />
        <FiltersButton
          theme={theme}
          label={t("filters.button", { defaultValue: "Filters" })}
          count={countActiveFilters(filters)}
          onPress={() => setFiltersOpen(true)}
        />
      </View>

      {/* Quick filters on the left; the "My groups" grouping toggle tucked to the right under
          the Filters button. Other groupings (Type/Status/Due date) live in the Filters modal. */}
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: theme.spacing.sm, gap: theme.spacing.sm }}>
        <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm }}>
          <QuickChip
            theme={theme}
            label={t("quickFilters.overdue", { defaultValue: "Overdue" })}
            selected={filters.due === "overdue"}
            onPress={() => setFilters((prev) => ({ ...prev, due: prev.due === "overdue" ? "any" : "overdue" }))}
          />
          <QuickChip
            theme={theme}
            label={t("quickFilters.dueToday", { defaultValue: "Due today" })}
            selected={filters.due === "today"}
            onPress={() => setFilters((prev) => ({ ...prev, due: prev.due === "today" ? "any" : "today" }))}
          />
        </View>
        <QuickChip
          theme={theme}
          label={t("filters.groupBy.custom", { defaultValue: "My groups" })}
          selected={filters.groupBy === "custom"}
          onPress={() => setFilters((prev) => ({ ...prev, groupBy: prev.groupBy === "custom" ? "none" : "custom" }))}
        />
      </View>

      <FilterChipBar theme={theme} filters={filters} onPress={() => setFiltersOpen(true)} onClearAll={clearAllFilters} />

      {resultsTotal !== null ? (
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.sm }}>
          {t("list.resultsCount", { count: resultsTotal, defaultValue: "{{count}} activities" })}
          {truncated && grouped ? ` • ${t("list.truncated", { defaultValue: "showing the first results" })}` : ""}
        </Text>
      ) : null}
    </View>
  );

  let body: ReactNode;
  if (initialLoading && items.length === 0 && groups.length === 0) {
    body = <LoadingState message={t("list.loading", { defaultValue: "Loading your activities…" })} />;
  } else if (error && items.length === 0 && groups.length === 0) {
    body = (
      <ErrorState
        title={t("list.unableToLoad", { defaultValue: "Unable to load activities" })}
        description={error}
        action={<PrimaryButton onPress={() => void refresh()}>{t("common:retry")}</PrimaryButton>}
      />
    );
  } else if (grouped && filters.groupBy === "custom") {
    body = (
      <DraggableGroupedList
        theme={theme}
        groups={groups}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        titleForGroup={(group) => groupTitleFor(filters.groupBy, group)}
        onPressActivity={onPressActivity}
        onCommit={(plan) => void handleGroupDragCommit(plan)}
        refreshing={refreshing}
        onRefresh={refresh}
        header={header}
        emptyComponent={
          <EmptyState
            title={t("list.empty", { defaultValue: "Nothing here yet" })}
            description={t("list.emptyDescription", { defaultValue: "You have no activities matching these filters." })}
          />
        }
        dragHint={t("groups.dragHint", { defaultValue: "Hold a card to drag it between groups" })}
      />
    );
  } else if (grouped) {
    body = (
      <SectionList
        sections={sections}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl, flexGrow: 1, backgroundColor: theme.colors.background }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState
            title={t("list.empty", { defaultValue: "Nothing here yet" })}
            description={t("list.emptyDescription", { defaultValue: "You have no activities matching these filters." })}
          />
        }
        renderSectionHeader={({ section }) => (
          <GroupHeader
            theme={theme}
            title={section.title}
            count={section.count}
            collapsed={collapsed.has(section.key)}
            onPress={() => toggleCollapsed(section.key)}
          />
        )}
        stickySectionHeadersEnabled={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
      />
    );
  } else {
    body = (
      <FlatList
        data={items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl, flexGrow: 1, backgroundColor: theme.colors.background }}
        onEndReached={onEndReached}
        onEndReachedThreshold={NEXT_PAGE_PREFETCH_THRESHOLD}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState
            title={t("list.empty", { defaultValue: "Nothing here yet" })}
            description={t("list.emptyDescription", { defaultValue: "You have no activities matching these filters." })}
          />
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={{ paddingVertical: theme.spacing.lg, alignItems: "center" }}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : null
        }
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {body}

      <Pressable
        onPress={openCreateAdHoc}
        accessibilityRole="button"
        accessibilityLabel={t("list.addEntry", { defaultValue: "New to-do" })}
        style={({ pressed }) => ({
          position: "absolute",
          right: theme.spacing.lg,
          bottom: theme.spacing.xl,
          width: 56,
          height: 56,
          borderRadius: 28,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.primary,
          opacity: pressed ? 0.9 : 1,
          ...theme.shadows.md,
        })}
      >
        <Feather name="plus" size={24} color={theme.colors.textInverse} />
      </Pressable>

      <AdHocEntryFormModal
        visible={sheetOpen}
        mode={sheetMode}
        initial={sheetInitial}
        saving={sheetSaving}
        busy={sheetBusy}
        error={sheetError}
        isDone={editingActivity?.isClosed === true}
        onSubmit={(value) => void handleSubmitAdHoc(value)}
        onToggleDone={(done) => void handleToggleDone(done)}
        onDelete={() => void handleDeleteAdHoc()}
        onClose={() => {
          if (!sheetSaving && !sheetBusy) {
            setSheetOpen(false);
            setEditingActivity(null);
          }
        }}
      />

      <FiltersModal
        theme={theme}
        visible={filtersOpen}
        client={client}
        apiKey={session.accessToken}
        filters={filters}
        setFilters={setFilters}
        resultsTotal={resultsTotal}
        resultsLoading={initialLoading}
        onClose={() => setFiltersOpen(false)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Header pieces
// ---------------------------------------------------------------------------

function FiltersButton({
  theme,
  label,
  count,
  onPress,
}: {
  theme: Theme;
  label: string;
  count: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.borderRadius.lg,
        borderWidth: 1,
        borderColor: count > 0 ? theme.colors.primary : theme.colors.border,
        backgroundColor: theme.colors.card,
        opacity: pressed ? 0.95 : 1,
      })}
    >
      <Feather name="filter" size={14} color={count > 0 ? theme.colors.primary : theme.colors.text} />
      <Text
        style={{
          ...theme.typography.caption,
          color: count > 0 ? theme.colors.primary : theme.colors.text,
          fontWeight: "600",
          marginLeft: theme.spacing.xs,
        }}
      >
        {label}
        {count > 0 ? ` (${count})` : ""}
      </Text>
    </Pressable>
  );
}

function GroupHeader({
  theme,
  title,
  count,
  collapsed,
  onPress,
}: {
  theme: Theme;
  title: string;
  count: number;
  collapsed: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      accessibilityLabel={title}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: theme.spacing.sm,
        backgroundColor: theme.colors.background,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Feather
        name={collapsed ? "chevron-right" : "chevron-down"}
        size={16}
        color={theme.colors.textSecondary}
      />
      <Text style={{ ...theme.typography.body, color: theme.colors.text, fontWeight: "700", marginLeft: theme.spacing.xs, flex: 1 }}>
        {title}
      </Text>
      <View
        style={{
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: 2,
          borderRadius: theme.borderRadius.full,
          backgroundColor: theme.colors.badge.neutral.bg,
          borderWidth: 1,
          borderColor: theme.colors.badge.neutral.border,
        }}
      >
        <Text style={{ ...theme.typography.caption, color: theme.colors.badge.neutral.text, fontWeight: "700" }}>{count}</Text>
      </View>
    </Pressable>
  );
}

function FilterChipBar({
  theme,
  filters,
  onPress,
  onClearAll,
}: {
  theme: Theme;
  filters: ActivitiesFilterState;
  onPress: () => void;
  onClearAll: () => void;
}) {
  const { t } = useTranslation("userActivities");
  const chips: string[] = [];
  if (filters.status !== DEFAULT_ACTIVITY_FILTERS.status) {
    chips.push(t(`filters.${filters.status}`, { defaultValue: filters.status }));
  }
  if (filters.types.length > 0) chips.push(t("filters.typesCount", { count: filters.types.length, defaultValue: "Types ({{count}})" }));
  if (filters.priorityIds.length > 0) chips.push(t("filters.priorityCount", { count: filters.priorityIds.length, defaultValue: "Priority ({{count}})" }));
  if (filters.due !== "any") chips.push(t(`filters.due.${filters.due}`, { defaultValue: filters.due }));
  // Grouping (incl. "My groups") is shown by the dedicated toggle pill, not as a chip here.
  if (filters.sortField !== "default") {
    chips.push(t("filters.sortedBy", { field: t(`filters.sort.${filters.sortField}`, { defaultValue: filters.sortField }), defaultValue: "Sort: {{field}}" }));
  }

  if (chips.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: theme.spacing.sm, gap: theme.spacing.sm }}>
      {chips.map((label) => (
        <QuickChip key={label} theme={theme} label={label} onPress={onPress} />
      ))}
      <QuickChip theme={theme} label={t("filters.clearAll", { defaultValue: "Clear all" })} onPress={onClearAll} emphasized />
    </View>
  );
}

function QuickChip({
  theme,
  label,
  onPress,
  selected = false,
  emphasized = false,
}: {
  theme: Theme;
  label: string;
  onPress: () => void;
  selected?: boolean;
  emphasized?: boolean;
}) {
  const active = selected || emphasized;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        paddingHorizontal: theme.spacing.md,
        paddingVertical: 6,
        borderRadius: theme.borderRadius.full,
        borderWidth: 1,
        borderColor: active ? theme.colors.primary : theme.colors.border,
        backgroundColor: selected ? theme.colors.primary : theme.colors.card,
        opacity: pressed ? 0.95 : 1,
      })}
    >
      <Text
        style={{
          ...theme.typography.caption,
          color: selected ? theme.colors.textInverse : emphasized ? theme.colors.primary : theme.colors.text,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Filters modal
// ---------------------------------------------------------------------------

function FiltersModal({
  theme,
  visible,
  client,
  apiKey,
  filters,
  setFilters,
  resultsTotal,
  resultsLoading,
  onClose,
}: {
  theme: Theme;
  visible: boolean;
  client: ApiClient | null;
  apiKey: string;
  filters: ActivitiesFilterState;
  setFilters: Dispatch<SetStateAction<ActivitiesFilterState>>;
  resultsTotal: number | null;
  resultsLoading: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("userActivities");
  const insets = useSafeAreaInsets();

  // The priority filter is only meaningful when scoped to a single prioritized type; load
  // that type's real tenant priorities so a custom scheme (P1..P5, 1..5) is filterable.
  const priorityItemType = scopedPriorityItemType(filters);
  const [priorityOptions, setPriorityOptions] = useState<MobilePriority[]>([]);
  const [prioritiesLoading, setPrioritiesLoading] = useState(false);
  const [prioritiesError, setPrioritiesError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      if (!visible || !client || !priorityItemType) return;
      setPrioritiesLoading(true);
      setPrioritiesError(null);
      const result = await listPriorities(client, { apiKey, itemType: priorityItemType });
      if (canceled) return;
      setPrioritiesLoading(false);
      if (!result.ok) {
        setPriorityOptions([]);
        setPrioritiesError(t("filters.prioritiesError", { defaultValue: "Couldn't load priorities." }));
        return;
      }
      setPriorityOptions(result.data.data);
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [apiKey, client, priorityItemType, t, visible]);

  const viewResultsLabel = resultsLoading
    ? t("filters.viewResultsLoading", { defaultValue: "Loading…" })
    : resultsTotal !== null
      ? t("filters.viewResultsCount", { count: resultsTotal, defaultValue: "View {{count}} results" })
      : t("filters.viewResults", { defaultValue: "View results" });

  const toggleType = (type: MobileActivityType) =>
    setFilters((prev) => {
      const types = prev.types.includes(type) ? prev.types.filter((x) => x !== type) : [...prev.types, type];
      // Priorities are per-type; any type change invalidates the selected priority IDs.
      return { ...prev, types, priorityIds: [] };
    });

  const togglePriorityId = (priorityId: string) =>
    setFilters((prev) => ({
      ...prev,
      priorityIds: prev.priorityIds.includes(priorityId)
        ? prev.priorityIds.filter((x) => x !== priorityId)
        : [...prev.priorityIds, priorityId],
    }));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            paddingHorizontal: theme.spacing.lg,
            paddingTop: insets.top + theme.spacing.sm,
            paddingBottom: theme.spacing.sm,
          }}
        >
          <Text style={{ ...theme.typography.title, color: theme.colors.text }}>{t("filters.title", { defaultValue: "Filters" })}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common:close")} hitSlop={12}>
            <Feather name="x" size={22} color={theme.colors.text} />
          </Pressable>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.xl }}>
          <FilterLabel theme={theme} text={t("filters.status", { defaultValue: "Status" })} />
          <OptionRow
            theme={theme}
            options={[
              { label: t("filters.open", { defaultValue: "Open" }), value: "open" },
              { label: t("filters.closed", { defaultValue: "Closed" }), value: "closed" },
              { label: t("filters.all", { defaultValue: "All" }), value: "all" },
            ]}
            value={filters.status}
            onChange={(status) => setFilters((prev) => ({ ...prev, status }))}
          />

          <FilterLabel theme={theme} text={t("filters.types", { defaultValue: "Types" })} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: theme.spacing.sm, gap: theme.spacing.sm }}>
            {ACTIVITY_TYPE_FILTERS.map((type) => (
              <ToggleChip
                key={type}
                theme={theme}
                label={t(`types.${type}`, { defaultValue: type })}
                selected={filters.types.includes(type)}
                onPress={() => toggleType(type)}
              />
            ))}
          </View>

          <FilterLabel theme={theme} text={t("filters.priority", { defaultValue: "Priority" })} />
          {!priorityItemType ? (
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.sm }}>
              {t("filters.priorityScopeHint", { defaultValue: "Select a single type — Tickets or Project tasks — to filter by priority." })}
            </Text>
          ) : prioritiesLoading ? (
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.sm }}>
              {t("filters.prioritiesLoading", { defaultValue: "Loading priorities…" })}
            </Text>
          ) : prioritiesError ? (
            <Text style={{ ...theme.typography.caption, color: theme.colors.danger, marginTop: theme.spacing.sm }}>
              {prioritiesError}
            </Text>
          ) : priorityOptions.length === 0 ? (
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.sm }}>
              {t("filters.prioritiesEmpty", { defaultValue: "No priorities defined for this type." })}
            </Text>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: theme.spacing.sm, gap: theme.spacing.sm }}>
              {priorityOptions.map((p) => (
                <ToggleChip
                  key={p.priority_id}
                  theme={theme}
                  label={p.priority_name}
                  selected={filters.priorityIds.includes(p.priority_id)}
                  onPress={() => togglePriorityId(p.priority_id)}
                />
              ))}
            </View>
          )}

          <FilterLabel theme={theme} text={t("filters.dueDate", { defaultValue: "Due date" })} />
          <OptionRow
            theme={theme}
            options={DUE_FILTERS.map((due) => ({ label: t(`filters.due.${due}`, { defaultValue: due }), value: due }))}
            value={filters.due}
            onChange={(due) => setFilters((prev) => ({ ...prev, due }))}
          />

          <FilterLabel theme={theme} text={t("filters.groupByLabel", { defaultValue: "Group by" })} />
          <OptionRow
            theme={theme}
            options={groupFieldsFor(filters).map((g) => ({ label: t(`filters.groupBy.${g}`, { defaultValue: g }), value: g }))}
            value={filters.groupBy}
            onChange={(groupBy) => setFilters((prev) => ({ ...prev, groupBy }))}
          />

          <FilterLabel theme={theme} text={t("filters.sortLabel", { defaultValue: "Sort by" })} />
          <OptionRow
            theme={theme}
            options={ACTIVITY_SORT_FIELDS.map((s) => ({ label: t(`filters.sort.${s}`, { defaultValue: s }), value: s }))}
            value={filters.sortField}
            onChange={(sortField) => setFilters((prev) => ({ ...prev, sortField }))}
          />

          {filters.sortField !== "default" ? (
            <>
              <FilterLabel theme={theme} text={t("filters.order", { defaultValue: "Order" })} />
              <OptionRow
                theme={theme}
                options={[
                  { label: t("filters.asc", { defaultValue: "Ascending" }), value: "asc" },
                  { label: t("filters.desc", { defaultValue: "Descending" }), value: "desc" },
                ]}
                value={filters.sortOrder}
                onChange={(sortOrder) => setFilters((prev) => ({ ...prev, sortOrder }))}
              />
            </>
          ) : null}
        </ScrollView>

        <View
          style={{
            flexDirection: "row",
            gap: theme.spacing.sm,
            padding: theme.spacing.lg,
            paddingBottom: Math.max(insets.bottom, theme.spacing.lg),
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            backgroundColor: theme.colors.background,
          }}
        >
          <Pressable
            onPress={() => setFilters(DEFAULT_ACTIVITY_FILTERS)}
            accessibilityRole="button"
            accessibilityLabel={t("filters.clearAll", { defaultValue: "Clear all" })}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: theme.spacing.md,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.card,
              alignItems: "center",
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <Text style={{ ...theme.typography.body, color: theme.colors.text, fontWeight: "600" }}>{t("filters.clearAll", { defaultValue: "Clear all" })}</Text>
          </Pressable>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={viewResultsLabel}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: theme.spacing.md,
              borderRadius: 10,
              backgroundColor: theme.colors.primary,
              alignItems: "center",
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <Text style={{ ...theme.typography.body, color: theme.colors.textInverse, fontWeight: "600" }}>{viewResultsLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function FilterLabel({ theme, text }: { theme: Theme; text: string }) {
  return (
    <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.lg }}>{text}</Text>
  );
}

function OptionRow<T extends string>({
  theme,
  options,
  value,
  onChange,
}: {
  theme: Theme;
  options: { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: theme.spacing.sm, gap: theme.spacing.sm }}>
      {options.map((opt) => (
        <ToggleChip key={opt.value} theme={theme} label={opt.label} selected={value === opt.value} onPress={() => onChange(opt.value)} />
      ))}
    </View>
  );
}

const ToggleChip = memo(function ToggleChip({
  theme,
  label,
  selected,
  onPress,
}: {
  theme: Theme;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        borderRadius: theme.borderRadius.full,
        borderWidth: 1,
        borderColor: selected ? theme.colors.primary : theme.colors.border,
        backgroundColor: selected ? theme.colors.primary : theme.colors.card,
        opacity: pressed ? 0.95 : 1,
      })}
    >
      <Text style={{ ...theme.typography.caption, color: selected ? theme.colors.textInverse : theme.colors.text, fontWeight: "600" }}>
        {selected ? "✓ " : ""}
        {label}
      </Text>
    </Pressable>
  );
});

function SearchField({
  theme,
  value,
  onChangeText,
  onSubmit,
  onClear,
  placeholder,
  accessibilityLabel,
}: {
  theme: Theme;
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  placeholder: string;
  accessibilityLabel?: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        borderRadius: theme.borderRadius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.background,
        paddingHorizontal: theme.spacing.md,
      }}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        returnKeyType="search"
        placeholder={placeholder}
        placeholderTextColor={theme.colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={accessibilityLabel}
        style={{ flex: 1, paddingVertical: theme.spacing.sm, color: theme.colors.text }}
      />
      {value.length > 0 ? (
        <Pressable onPress={onClear} accessibilityRole="button" accessibilityLabel={accessibilityLabel} hitSlop={8} style={{ padding: theme.spacing.xs }}>
          <Feather name="x" size={16} color={theme.colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}
