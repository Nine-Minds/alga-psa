import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { DrawerScreenProps } from "@react-navigation/drawer";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { DrawerParamList, RootStackParamList } from "../navigation/types";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import type { ApiError } from "../api";
import {
  createAdHocEntry,
  deleteAdHocEntry,
  listActivities,
  setAdHocDone,
  updateAdHocEntry,
  isAdHocActivity,
  type Activity,
  type ActivityStatusFilter,
  type MobileActivityType,
  type ScheduleActivity,
} from "../api/activities";
import {
  getCachedUserActivities,
  setCachedUserActivities,
} from "../cache/userActivitiesCache";
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

type Props = CompositeScreenProps<
  DrawerScreenProps<DrawerParamList, "UserActivitiesTab">,
  NativeStackScreenProps<RootStackParamList>
>;

const PAGE_SIZE = 25;
const NEXT_PAGE_PREFETCH_THRESHOLD = 0.6;

const TYPE_FILTERS: MobileActivityType[] = [
  "ticket",
  "projectTask",
  "schedule",
  "workflowTask",
  "timeEntry",
];

type ActivityFilterState = {
  status: ActivityStatusFilter;
  types: MobileActivityType[];
  search: string;
};

const DEFAULT_FILTERS: ActivityFilterState = {
  status: "open",
  types: [],
  search: "",
};

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

export function UserActivitiesScreen({ navigation }: Props) {
  const { t } = useTranslation("userActivities");
  const theme = useTheme();
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession, logout } = useAuth();
  const listAbortRef = useRef<AbortController | null>(null);
  const loadingMoreRef = useRef(false);

  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/user-activities",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);

  const [items, setItems] = useState<Activity[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);

  const [filters, setFilters] = useState<ActivityFilterState>(DEFAULT_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  // Ad-hoc create/edit sheet
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

  const cacheKey = useMemo(() => {
    if (!session) return null;
    const userId = session.user?.id ?? "anon";
    return `alga.mobile.activities.list.${userId}.${JSON.stringify({
      status: filters.status,
      types: [...filters.types].sort(),
      search,
    })}`;
  }, [filters.status, filters.types, search, session]);

  useEffect(() => {
    if (!cacheKey) return;
    const cached = getCachedUserActivities(cacheKey);
    if (!cached) {
      setItems([]);
      setPage(1);
      setHasNext(true);
      setError(null);
      setNoAccess(false);
      return;
    }
    setItems(cached.items);
    setPage(cached.page);
    setHasNext(cached.hasNext);
  }, [cacheKey]);

  const loadPage = useCallback(
    async ({ pageToLoad, replace }: { pageToLoad: number; replace: boolean }) => {
      if (!client || !session) return;
      setError(null);
      setNoAccess(false);

      listAbortRef.current?.abort();
      const abortController = new AbortController();
      listAbortRef.current = abortController;

      const result = await listActivities(client, {
        apiKey: session.accessToken,
        page: pageToLoad,
        pageSize: PAGE_SIZE,
        status: filters.status,
        type: filters.types.length > 0 ? filters.types : undefined,
        search: search || undefined,
        signal: abortController.signal,
      });

      if (listAbortRef.current === abortController) listAbortRef.current = null;
      if (abortController.signal.aborted) return;

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

      if (replace && pageToLoad === 1 && cacheKey) {
        setCachedUserActivities(cacheKey, {
          items: nextItems,
          page: result.data.pagination.page,
          hasNext: result.data.pagination.hasNext,
          lastRefreshedAtIso: new Date().toISOString(),
        });
      }
    },
    [cacheKey, client, filters.status, filters.types, search, session, t],
  );

  const { refreshing, refresh } = usePullToRefresh(async () => {
    await loadPage({ pageToLoad: 1, replace: true });
  }, { haptics: true });

  useAppResume(() => {
    void refresh();
  });

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      if (!client || !session) return;
      setInitialLoading(true);
      await loadPage({ pageToLoad: 1, replace: true });
      if (!canceled) setInitialLoading(false);
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [client, loadPage, session]);

  const onEndReached = useCallback(async () => {
    if (!client || !session) return;
    if (initialLoading || refreshing || loadingMoreRef.current) return;
    if (!hasNext) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      await loadPage({ pageToLoad: page + 1, replace: false });
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [client, hasNext, initialLoading, loadPage, page, refreshing, session]);

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

  const toggleType = useCallback((type: MobileActivityType) => {
    setFilters((prev) => {
      const has = prev.types.includes(type);
      return { ...prev, types: has ? prev.types.filter((tpe) => tpe !== type) : [...prev.types, type] };
    });
  }, []);

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
      </View>

      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.md }}>
        {t("filters.status", { defaultValue: "Status" })}
      </Text>
      <ChipRow
        theme={theme}
        options={[
          { label: t("filters.open", { defaultValue: "Open" }), value: "open" },
          { label: t("filters.closed", { defaultValue: "Closed" }), value: "closed" },
          { label: t("filters.all", { defaultValue: "All" }), value: "all" },
        ]}
        selected={filters.status}
        onSelect={(status) => setFilters((prev) => ({ ...prev, status }))}
      />

      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.md }}>
        {t("filters.types", { defaultValue: "Types" })}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: theme.spacing.sm, gap: theme.spacing.sm }}>
        {TYPE_FILTERS.map((type) => {
          const selected = filters.types.includes(type);
          return (
            <Chip
              key={type}
              theme={theme}
              label={t(`types.${type}`, { defaultValue: type })}
              selected={selected}
              onPress={() => toggleType(type)}
            />
          );
        })}
      </View>
    </View>
  );

  let body;
  if (initialLoading && items.length === 0) {
    body = <LoadingState message={t("list.loading", { defaultValue: "Loading your activities…" })} />;
  } else if (error && items.length === 0) {
    body = (
      <ErrorState
        title={t("list.unableToLoad", { defaultValue: "Unable to load activities" })}
        description={error}
        action={<PrimaryButton onPress={() => void refresh()}>{t("common:retry")}</PrimaryButton>}
      />
    );
  } else {
    body = (
      <FlatList
        data={items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl, backgroundColor: theme.colors.background }}
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
    </View>
  );
}

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

const Chip = memo(function Chip({
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

function ChipRow<T extends string>({
  theme,
  options,
  selected,
  onSelect,
}: {
  theme: Theme;
  options: { label: string; value: T }[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: theme.spacing.sm, gap: theme.spacing.sm }}>
      {options.map((opt) => (
        <Chip key={opt.value} theme={theme} label={opt.label} selected={selected === opt.value} onPress={() => onSelect(opt.value)} />
      ))}
    </View>
  );
}
