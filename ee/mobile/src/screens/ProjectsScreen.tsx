import type { CompositeScreenProps } from "@react-navigation/native";
import type { DrawerScreenProps } from "@react-navigation/drawer";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";
import { Badge } from "../ui/components/Badge";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { SecondaryButton } from "../features/opportunities/components/SecondaryButton";
import { SearchBar } from "../ui/components/SearchBar";
import { EntityPickerModal, type EntityPickerItem } from "../ui/components/EntityPickerModal";
import type { DrawerParamList, RootStackParamList } from "../navigation/types";
import { useAppResume } from "../hooks/useAppResume";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient, type ApiClient } from "../api";
import { listClients, type ClientListItem } from "../api/clients";
import {
  listProjectStatuses,
  listProjects,
  statusTone,
  type ProjectListItem,
  type ProjectStatusOption,
} from "../api/projects";
import { collectFilteredPage } from "../api/narrowedPaging";
import { getCachedProjects, setCachedProjects } from "../cache/projectsCache";
import { getSecureJson, setSecureJson } from "../storage/secureStorage";
import { useNetworkStatus } from "../network/useNetworkStatus";
import { isOffline as isOfflineStatus } from "../network/isOffline";
import { useTheme } from "../ui/ThemeContext";
import { formatDateShort } from "../ui/formatters/dateTime";
import { logger } from "../logging/logger";

type Props = CompositeScreenProps<
  DrawerScreenProps<DrawerParamList, "ProjectsTab">,
  NativeStackScreenProps<RootStackParamList>
>;

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 25;

export type ProjectListFilters = {
  /** status_ids; empty means "whatever the default scope resolves to". */
  statusIds: string[];
  clientId: string | null;
  clientName: string | null;
  managedByMe: boolean;
};

export const DEFAULT_PROJECT_FILTERS: ProjectListFilters = {
  statusIds: [],
  clientId: null,
  clientName: null,
  managedByMe: false,
};

/** Open work by default: the finished and abandoned statuses are opt-in. */
export function defaultStatusIds(statuses: ProjectStatusOption[]): string[] {
  return statuses.filter((status) => !status.is_closed).map((status) => status.status_id);
}

export function activeProjectFilterCount(
  filters: ProjectListFilters,
  statuses: ProjectStatusOption[],
): number {
  let count = 0;
  if (filters.clientId) count += 1;
  if (filters.managedByMe) count += 1;
  const selected = filters.statusIds.length > 0 ? filters.statusIds : defaultStatusIds(statuses);
  if ([...selected].sort().join(",") !== [...defaultStatusIds(statuses)].sort().join(",")) count += 1;
  return count;
}

export function ProjectsScreen({ navigation }: Props) {
  const { t } = useTranslation("projects");
  const theme = useTheme();
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession } = useAuth();
  const network = useNetworkStatus();
  const offline = isOfflineStatus(network);
  const abortRef = useRef<AbortController | null>(null);
  const loadingMoreRef = useRef(false);

  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/projects",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);

  const userId = session?.user?.id;
  const apiKey = session?.accessToken;

  const [items, setItems] = useState<ProjectListItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  const [hasNext, setHasNext] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ProjectListFilters>(DEFAULT_PROJECT_FILTERS);
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statuses, setStatuses] = useState<ProjectStatusOption[]>([]);
  const [statusesLoaded, setStatusesLoaded] = useState(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    let canceled = false;
    void (async () => {
      if (!userId) {
        setFiltersLoaded(true);
        return;
      }
      const saved = await getSecureJson<ProjectListFilters>(`alga.mobile.projects.filters.${userId}`);
      if (canceled) return;
      if (saved) {
        const statusIds = Array.isArray(saved.statusIds)
          ? saved.statusIds.filter((id): id is string => typeof id === "string")
          : [];
        setFilters({ ...DEFAULT_PROJECT_FILTERS, ...saved, statusIds });
      }
      setFiltersLoaded(true);
    })();
    return () => {
      canceled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!filtersLoaded || !userId) return;
    void setSecureJson(`alga.mobile.projects.filters.${userId}`, filters);
  }, [filters, filtersLoaded, userId]);

  useEffect(() => {
    if (!client || !apiKey) return;
    let canceled = false;
    void (async () => {
      const result = await listProjectStatuses(client, { apiKey });
      if (canceled) return;
      if (result.ok) setStatuses(result.data.data);
      setStatusesLoaded(true);
    })();
    return () => {
      canceled = true;
    };
  }, [apiKey, client]);

  const selectedStatusIds = useMemo(
    () => (filters.statusIds.length > 0 ? filters.statusIds : defaultStatusIds(statuses)),
    [filters.statusIds, statuses],
  );

  const cacheKey = useMemo(
    () =>
      `${session?.tenantId ?? "-"}|${userId ?? "-"}|${search}|${filters.clientId ?? "-"}|${
        filters.managedByMe ? "mine" : "all"
      }|${[...selectedStatusIds].sort().join(",")}`,
    [filters.clientId, filters.managedByMe, search, selectedStatusIds, session?.tenantId, userId],
  );

  const loadPage = useCallback(
    async ({ pageToLoad, replace }: { pageToLoad: number; replace: boolean }) => {
      if (!client || !apiKey || !filtersLoaded || !statusesLoaded) return;
      setError(null);
      setNoAccess(false);

      if (offline && pageToLoad === 1) {
        const cached = getCachedProjects(cacheKey);
        if (cached) {
          setItems(cached.items);
          setTotal(cached.total);
          setHasNext(false);
          return;
        }
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // The v1 list takes a single status_id; a multi-select sends none and
      // narrows on the device, so the page is filled from as many server pages
      // as it takes and the server's total — which counts every status — is not
      // shown.
      const singleStatus = selectedStatusIds.length === 1 ? selectedStatusIds[0] : undefined;
      const selected = new Set<string>(selectedStatusIds);
      const narrowing = !singleStatus && selected.size > 0;

      const collected = await collectFilteredPage<ProjectListItem>({
        startPage: pageToLoad,
        keep: narrowing ? (project) => selected.has(project.status) : undefined,
        loadPage: async (page) => {
          const result = await listProjects(client, {
            apiKey,
            page,
            limit: PAGE_SIZE,
            project_name: search || undefined,
            status: singleStatus,
            client_id: filters.clientId ?? undefined,
            assigned_to: filters.managedByMe ? userId : undefined,
            signal: controller.signal,
          });

          if (controller.signal.aborted) return null;
          if (!result.ok) {
            if (result.error.kind === "canceled") return null;
            logger.warn("Project list fetch failed", { error: result.error });
            if (result.error.kind === "permission") {
              setItems([]);
              setHasNext(false);
              setNoAccess(true);
              return null;
            }
            setError(t("errors.unableToLoad", "Unable to load."));
            return null;
          }

          return {
            items: result.data.data,
            page: result.data.pagination.page,
            hasNext: result.data.pagination.hasNext,
            total: result.data.pagination.total,
          };
        },
      });

      if (abortRef.current === controller) abortRef.current = null;
      if (!collected || controller.signal.aborted) return;

      setItems(replace ? collected.items : [...items, ...collected.items]);
      setPage(collected.page);
      setTotal(collected.total);
      setHasNext(collected.hasNext);
      if (pageToLoad === 1) {
        setCachedProjects(cacheKey, { items: collected.items, total: collected.total });
      }
    },
    [
      apiKey,
      cacheKey,
      client,
      filters.clientId,
      filters.managedByMe,
      filtersLoaded,
      items,
      offline,
      search,
      selectedStatusIds,
      statusesLoaded,
      t,
      userId,
    ],
  );

  // loadPage closes over `items` for appends; the effect must only re-run on
  // query changes, so the first page is loaded through a stable ref.
  const loadPageRef = useRef(loadPage);
  loadPageRef.current = loadPage;

  const { refreshing, refresh } = usePullToRefresh(
    async () => {
      await loadPageRef.current({ pageToLoad: 1, replace: true });
    },
    { haptics: true },
  );
  useAppResume(() => void refresh());

  useEffect(() => {
    let canceled = false;
    void (async () => {
      setInitialLoading(true);
      await loadPageRef.current({ pageToLoad: 1, replace: true });
      if (!canceled) setInitialLoading(false);
    })();
    return () => {
      canceled = true;
    };
  }, [cacheKey, filtersLoaded, statusesLoaded]);

  const onEndReached = useCallback(async () => {
    if (initialLoading || refreshing || loadingMoreRef.current || !hasNext) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      await loadPageRef.current({ pageToLoad: page + 1, replace: false });
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasNext, initialLoading, page, refreshing]);

  const openProject = useCallback(
    (project: ProjectListItem) => {
      navigation.navigate("ProjectDetail", {
        projectId: project.project_id,
        projectName: project.project_name,
      });
    },
    [navigation],
  );

  const keyExtractor = useCallback((item: ProjectListItem) => item.project_id, []);
  const statusNameById = useMemo(
    () => new Map(statuses.map((status) => [status.status_id, status.name])),
    [statuses],
  );

  const renderItem = useCallback(
    ({ item }: { item: ProjectListItem }) => (
      <ProjectRow
        item={item}
        statusLabel={statusNameById.get(item.status) ?? item.status_name ?? null}
        onOpen={openProject}
      />
    ),
    [openProject, statusNameById],
  );

  const filterCount = activeProjectFilterCount(filters, statuses);

  const header = (
    <View style={{ marginBottom: theme.spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <SearchBar
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder={t("list.searchPlaceholder", "Search projects")}
            accessibilityLabel={t("list.searchPlaceholder", "Search projects")}
          />
        </View>
        <Pressable
          testID="projects-filters"
          onPress={() => setFiltersOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t("list.filters", "Filters")}
          hitSlop={8}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            borderRadius: theme.borderRadius.md,
            borderWidth: 1,
            borderColor: filterCount > 0 ? theme.colors.primary : theme.colors.border,
            backgroundColor: theme.colors.card,
            opacity: pressed ? 0.95 : 1,
          })}
        >
          <Feather name="filter" size={16} color={filterCount > 0 ? theme.colors.primary : theme.colors.textSecondary} />
          {filterCount > 0 ? (
            <Text testID="projects-filter-count" style={{ ...theme.typography.caption, color: theme.colors.primary, fontWeight: "700" }}>
              {filterCount}
            </Text>
          ) : null}
        </Pressable>
      </View>
      {total != null ? (
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.sm }}>
          {t("list.count", "{{count}} total", { count: total })}
        </Text>
      ) : null}
    </View>
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
  if (noAccess) {
    return <ErrorState title={t("list.noAccess", "You don't have access to projects.")} />;
  }
  if (initialLoading && items.length === 0) {
    return <LoadingState message={t("list.loading", "Loading projects")} />;
  }
  if (error && items.length === 0) {
    return (
      <ErrorState
        title={t("errors.unableToLoad", "Unable to load.")}
        description={error}
        action={<PrimaryButton onPress={() => void refresh()}>{t("common:retry", "Retry")}</PrimaryButton>}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        testID="projects-list"
        data={items}
        keyExtractor={keyExtractor}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={{ padding: theme.spacing.lg, flexGrow: 1 }}
        onEndReached={() => void onEndReached()}
        onEndReachedThreshold={0.6}
        ListHeaderComponent={header}
        renderItem={renderItem}
        ListEmptyComponent={
          <EmptyState
            title={t("list.empty", "No projects match")}
            description={filterCount > 0 ? t("list.emptyHint", "Try clearing the filters.") : undefined}
            action={
              filterCount > 0 ? (
                <PrimaryButton
                  testID="projects-clear-filters"
                  onPress={() => setFilters(DEFAULT_PROJECT_FILTERS)}
                >
                  {t("list.clearFilters", "Clear filters")}
                </PrimaryButton>
              ) : undefined
            }
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
      />
      <ProjectFiltersSheet
        visible={filtersOpen}
        filters={{ ...filters, statusIds: selectedStatusIds }}
        statuses={statuses}
        client={client}
        apiKey={apiKey}
        onClose={() => setFiltersOpen(false)}
        onApply={(next) => {
          setFilters(next);
          setFiltersOpen(false);
        }}
      />
    </View>
  );
}

const ProjectRow = memo(function ProjectRow({
  item,
  statusLabel,
  onOpen,
}: {
  item: ProjectListItem;
  statusLabel: string | null;
  onOpen: (project: ProjectListItem) => void;
}) {
  const { t } = useTranslation("projects");
  const theme = useTheme();
  const due = item.end_date ? formatDateShort(item.end_date) : "";

  return (
    <Pressable
      testID={`project-row-${item.project_id}`}
      onPress={() => onOpen(item)}
      accessibilityRole="button"
      accessibilityLabel={item.project_name}
      style={({ pressed }) => ({
        padding: theme.spacing.md,
        marginBottom: theme.spacing.sm,
        borderRadius: theme.borderRadius.lg,
        backgroundColor: theme.colors.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: pressed ? 0.96 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
        <Text style={{ ...theme.typography.body, color: theme.colors.text, flex: 1, fontWeight: "600" }} numberOfLines={1}>
          {item.project_name}
        </Text>
        {statusLabel ? <Badge label={statusLabel} tone={statusTone(statusLabel)} /> : null}
      </View>
      {item.client_name ? (
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }} numberOfLines={1}>
          {item.client_name}
        </Text>
      ) : null}
      {due ? (
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
          {t("list.dueOn", "Due {{date}}", { date: due })}
        </Text>
      ) : null}
    </Pressable>
  );
});

function ProjectFiltersSheet({
  visible,
  filters,
  statuses,
  client,
  apiKey,
  onClose,
  onApply,
}: {
  visible: boolean;
  filters: ProjectListFilters;
  statuses: ProjectStatusOption[];
  client: ApiClient | null;
  apiKey?: string;
  onClose: () => void;
  onApply: (filters: ProjectListFilters) => void;
}) {
  const { t } = useTranslation("projects");
  const theme = useTheme();
  const [draft, setDraft] = useState<ProjectListFilters>(filters);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) setDraft(filters);
  }, [filters, visible]);

  const loadClients = useCallback(
    async (search?: string) => {
      if (!client || !apiKey) return;
      setClientsLoading(true);
      setClientsError(null);
      const result = await listClients(client, { apiKey, page: 1, limit: 50, search: search || undefined });
      setClientsLoading(false);
      if (!result.ok) {
        setClientsError(t("filters.unableToLoadClients", "Unable to load clients."));
        return;
      }
      setClients(result.data.data);
    },
    [apiKey, client, t],
  );

  const clientItems = useMemo<EntityPickerItem[]>(
    () => clients.map((item) => ({ id: item.client_id, label: item.client_name, imageUri: item.logoUrl })),
    [clients],
  );

  const toggleStatus = (statusId: string) => {
    setDraft((current) => ({
      ...current,
      statusIds: current.statusIds.includes(statusId)
        ? current.statusIds.filter((value) => value !== statusId)
        : [...current.statusIds, statusId],
    }));
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} testID="projects-filter-sheet">
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            padding: theme.spacing.lg,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <Text style={{ ...theme.typography.subtitle, color: theme.colors.text }}>
            {t("filters.title", "Filter projects")}
          </Text>
          <Pressable
            testID="projects-filter-close"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t("common:close", "Close")}
            hitSlop={8}
          >
            <Feather name="x" size={22} color={theme.colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg }}>
          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, fontWeight: "700" }}>
            {t("filters.status", "Status")}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
            {statuses.map((status) => {
              const selected = draft.statusIds.includes(status.status_id);
              return (
                <Pressable
                  key={status.status_id}
                  testID={`projects-filter-status-${status.status_id}`}
                  onPress={() => toggleStatus(status.status_id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={status.name}
                  style={{
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: theme.spacing.xs,
                    borderRadius: theme.borderRadius.full,
                    borderWidth: 1,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                    backgroundColor: selected ? theme.colors.primary : theme.colors.card,
                  }}
                >
                  <Text
                    style={{
                      ...theme.typography.caption,
                      fontWeight: "600",
                      color: selected ? theme.colors.textInverse : theme.colors.text,
                    }}
                  >
                    {status.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text
            style={{
              ...theme.typography.caption,
              color: theme.colors.textSecondary,
              fontWeight: "700",
              marginTop: theme.spacing.lg,
            }}
          >
            {t("filters.client", "Client")}
          </Text>
          <Pressable
            testID="projects-filter-client"
            onPress={() => {
              setClientPickerOpen(true);
              void loadClients();
            }}
            accessibilityRole="button"
            accessibilityLabel={t("filters.selectClient", "Select a client")}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: theme.spacing.sm,
              padding: theme.spacing.md,
              borderRadius: theme.borderRadius.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.card,
            }}
          >
            <Text style={{ ...theme.typography.body, color: theme.colors.text }} numberOfLines={1}>
              {draft.clientName ?? t("filters.anyClient", "Any client")}
            </Text>
            {draft.clientId ? (
              <Pressable
                testID="projects-filter-client-clear"
                onPress={() => setDraft((current) => ({ ...current, clientId: null, clientName: null }))}
                accessibilityRole="button"
                accessibilityLabel={t("task.clear", "Clear")}
                hitSlop={8}
              >
                <Feather name="x" size={16} color={theme.colors.textSecondary} />
              </Pressable>
            ) : (
              <Feather name="chevron-right" size={18} color={theme.colors.textSecondary} />
            )}
          </Pressable>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: theme.spacing.lg,
            }}
          >
            <View style={{ flex: 1, paddingRight: theme.spacing.md }}>
              <Text style={{ ...theme.typography.body, color: theme.colors.text }}>
                {t("filters.managedByMe", "Managed by me")}
              </Text>
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
                {t("filters.managedByMeHint", "Only projects where I am the manager")}
              </Text>
            </View>
            <Switch
              testID="projects-filter-managed-by-me"
              value={draft.managedByMe}
              onValueChange={(value) => setDraft((current) => ({ ...current, managedByMe: value }))}
              accessibilityLabel={t("filters.managedByMe", "Managed by me")}
            />
          </View>
        </ScrollView>
        <View
          style={{
            flexDirection: "row",
            gap: theme.spacing.md,
            padding: theme.spacing.lg,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
          }}
        >
          <View style={{ flex: 1 }}>
            <SecondaryButton
              testID="projects-filter-reset"
              onPress={() => setDraft({ ...DEFAULT_PROJECT_FILTERS, statusIds: defaultStatusIds(statuses) })}
            >
              {t("filters.reset", "Reset")}
            </SecondaryButton>
          </View>
          <View style={{ flex: 1 }}>
            <PrimaryButton testID="projects-filter-apply" onPress={() => onApply(draft)}>
              {t("filters.apply", "Apply")}
            </PrimaryButton>
          </View>
        </View>
      </View>
      <EntityPickerModal
        visible={clientPickerOpen}
        title={t("filters.selectClient", "Select a client")}
        items={clientItems}
        loading={clientsLoading}
        error={clientsError}
        selectedId={draft.clientId}
        authToken={apiKey}
        onSearch={(value) => void loadClients(value)}
        onSelect={(id, label) => {
          setDraft((current) => ({ ...current, clientId: id, clientName: label }));
          setClientPickerOpen(false);
        }}
        onClose={() => setClientPickerOpen(false)}
      />
    </Modal>
  );
}
