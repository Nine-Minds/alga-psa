import { useFocusEffect, type CompositeScreenProps } from "@react-navigation/native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import type { RootStackParamList, TabsParamList, TicketsStackParamList } from "../navigation/types";
import { useAppResume } from "../hooks/useAppResume";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient, type ApiClient } from "../api";
import { getTicketById, getTicketPriorities, getTicketStats, getTicketStatuses, listTickets, type TicketListItem, type TicketPriority, type TicketStats, type TicketStatus } from "../api/tickets";
import { colors, spacing, typography } from "../ui/theme";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { logger } from "../logging/logger";
import { Badge } from "../ui/components/Badge";
import { getSecureJson, setSecureJson } from "../storage/secureStorage";
import { getCachedTicketDetail, setCachedTicketDetail } from "../cache/ticketsCache";
import { formatDateShort } from "../ui/formatters/dateTime";

type Props = CompositeScreenProps<
  NativeStackScreenProps<TicketsStackParamList, "TicketsList">,
  CompositeScreenProps<
    BottomTabScreenProps<TabsParamList, "TicketsTab">,
    NativeStackScreenProps<RootStackParamList>
  >
>;

type TicketListFilters = {
  status: "any" | "open" | "closed";
  statusIds: string[];
  assignee: "any" | "me" | "unassigned";
  priorityName: string;
  updatedSinceDays: number | null;
};

const DEFAULT_FILTERS: TicketListFilters = {
  status: "any",
  statusIds: [],
  assignee: "any",
  priorityName: "",
  updatedSinceDays: null,
};

export function TicketsListScreen({ navigation }: Props) {
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession, logout } = useAuth();
  const listAbortRef = useRef<AbortController | null>(null);

  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/tickets",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);

  const [items, setItems] = useState<TicketListItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<TicketListFilters>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filtersLoaded, setFiltersLoaded] = useState(false);

  useEffect(() => {
    return () => {
      listAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      const userId = session?.user?.id;
      if (!userId) {
        setFiltersLoaded(true);
        return;
      }
      const saved = await getSecureJson<TicketListFilters>(`alga.mobile.tickets.filters.${userId}`);
      if (canceled) return;
      if (saved) {
        const statusIds = Array.isArray((saved as any).statusIds) ? ((saved as any).statusIds as string[]) : [];
        setFilters({ ...DEFAULT_FILTERS, ...saved, statusIds });
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
    void setSecureJson(`alga.mobile.tickets.filters.${userId}`, filters);
  }, [filters, filtersLoaded, session?.user?.id]);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const apiFilters = useMemo(() => {
    if (!session) return undefined;
    const out: Record<string, unknown> = {};
    const statusIds = (filters.statusIds ?? []).filter(Boolean);
    if (statusIds.length > 0) {
      out.status_ids = statusIds.join(",");
    } else {
      if (filters.status === "open") out.is_open = true;
      if (filters.status === "closed") out.is_closed = true;
    }

    if (filters.assignee === "me") {
      const me = session.user?.id;
      if (me) out.assigned_to = me;
    }
    if (filters.assignee === "unassigned") out.has_assignment = false;

    const priority = filters.priorityName.trim();
    if (priority) out.priority_name = priority;

    if (filters.updatedSinceDays) {
      out.updated_from = new Date(Date.now() - filters.updatedSinceDays * 24 * 60 * 60 * 1000).toISOString();
    }

    return out;
  }, [filters, session]);

  const loadPage = useCallback(
    async ({ pageToLoad, replace }: { pageToLoad: number; replace: boolean }) => {
      if (!client || !session) return;
      setError(null);
      setNoAccess(false);

      listAbortRef.current?.abort();
      const abortController = new AbortController();
      listAbortRef.current = abortController;

      const result = await listTickets(client, {
        apiKey: session.accessToken,
        page: pageToLoad,
        limit: 25,
        search: search || undefined,
        signal: abortController.signal,
        filters: apiFilters,
      });

      if (listAbortRef.current === abortController) {
        listAbortRef.current = null;
      }
      if (abortController.signal.aborted) return;

      if (!result.ok) {
        if (result.error.kind === "canceled") return;
        logger.warn("Ticket list fetch failed", { error: result.error });
        if (result.error.kind === "permission") {
          setItems([]);
          setHasNext(false);
          setNoAccess(true);
          return;
        }
        setError("Unable to load tickets. Please try again.");
        return;
      }

      const nextItems = result.data.data;
      setItems((prev) => (replace ? nextItems : [...prev, ...nextItems]));
      setPage(result.data.pagination.page);
      setHasNext(result.data.pagination.hasNext);

      if (replace && pageToLoad === 1) {
        const toPrefetch = nextItems.slice(0, 5);
        void Promise.all(
          toPrefetch.map(async (t) => {
            if (getCachedTicketDetail(t.ticket_id)) return;
            const detail = await getTicketById(client, { apiKey: session.accessToken, ticketId: t.ticket_id });
            if (detail.ok) setCachedTicketDetail(t.ticket_id, detail.data.data);
          }),
        );
      }
    },
    [apiFilters, client, search, session],
  );

  const fetchStats = useCallback(async () => {
    if (!client || !session) return;
    const result = await getTicketStats(client, { apiKey: session.accessToken });
    if (!result.ok) {
      if (result.error.kind === "permission") setNoAccess(true);
      return;
    }
    setStats(result.data.data);
  }, [client, session]);

  const { refreshing, refresh } = usePullToRefresh(async () => {
    await Promise.all([loadPage({ pageToLoad: 1, replace: true }), fetchStats()]);
  });

  useAppResume(() => {
    void refresh();
  });

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      if (!client || !session) return;
      setInitialLoading(true);
      await Promise.all([loadPage({ pageToLoad: 1, replace: true }), fetchStats()]);
      if (!canceled) setInitialLoading(false);
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [client, fetchStats, loadPage, session, search]);

  useFocusEffect(
    useCallback(() => {
      setItems((prev) => {
        let changed = false;
        const next = prev.map((item) => {
          const cached = getCachedTicketDetail(item.ticket_id);
          if (!cached || typeof cached !== "object") return item;
          const detail = cached as Partial<TicketListItem>;

          const merged: TicketListItem = { ...item };
          const keys: (keyof TicketListItem)[] = [
            "status_id",
            "status_name",
            "status_is_closed",
            "priority_name",
            "assigned_to_name",
            "updated_at",
            "closed_at",
          ];
          for (const key of keys) {
            if (Object.prototype.hasOwnProperty.call(detail, key)) {
              (merged as any)[key] = (detail as any)[key];
            }
          }

          if (
            merged.status_id !== item.status_id ||
            merged.status_name !== item.status_name ||
            merged.status_is_closed !== item.status_is_closed ||
            merged.priority_name !== item.priority_name ||
            merged.assigned_to_name !== item.assigned_to_name ||
            merged.updated_at !== item.updated_at ||
            merged.closed_at !== item.closed_at
          ) {
            changed = true;
            return merged;
          }
          return item;
        });
        return changed ? next : prev;
      });
    }, []),
  );

  const onPressTicket = useCallback(
    (ticketId: string) => {
      navigation.navigate("TicketDetail", { ticketId });
    },
    [navigation],
  );

  const keyExtractor = useCallback((item: TicketListItem) => item.ticket_id, []);

  const renderItem = useCallback(
    ({ item }: { item: TicketListItem }) => <TicketRow item={item} onPressTicket={onPressTicket} />,
    [onPressTicket],
  );

  const onEndReached = useCallback(async () => {
    if (!client || !session) return;
    if (initialLoading || refreshing || loadingMore) return;
    if (!hasNext) return;
    setLoadingMore(true);
    try {
      await loadPage({ pageToLoad: page + 1, replace: false });
    } finally {
      setLoadingMore(false);
    }
  }, [client, hasNext, initialLoading, loadPage, loadingMore, page, refreshing, session]);

  if (!config.ok) {
    return <ErrorState title="Configuration error" description={config.error} />;
  }

  if (!session) {
    return <ErrorState title="Signed out" description="Please sign in again." />;
  }

  if (noAccess) {
    return (
      <ErrorState
        title="No access"
        description="You don’t have permission to view tickets."
        action={<PrimaryButton onPress={() => void logout()}>Sign out</PrimaryButton>}
      />
    );
  }

  if (initialLoading && items.length === 0) {
    return <LoadingState message="Loading tickets…" />;
  }

  if (error && items.length === 0) {
    return (
      <ErrorState
        title="Unable to load tickets"
        description={error}
        action={<PrimaryButton onPress={() => void refresh()}>Retry</PrimaryButton>}
      />
    );
  }

  if (!error && items.length === 0) {
    return (
      <EmptyState
        title="No tickets"
        description="No tickets matched your current filters."
        action={<PrimaryButton onPress={() => void refresh()}>Refresh</PrimaryButton>}
      />
    );
  }

  const header = useMemo(() => {
    return (
      <View style={{ marginBottom: spacing.md }}>
        {stats ? (
          <View
            style={{
              padding: spacing.md,
              borderRadius: 12,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              marginBottom: spacing.md,
            }}
          >
            <Text style={{ ...typography.caption, color: colors.mutedText }}>Summary</Text>
            <Text style={{ ...typography.body, color: colors.text, marginTop: 2 }}>
              Open {stats.open_tickets} • Unassigned {stats.unassigned_tickets} • Overdue {stats.overdue_tickets}
            </Text>
          </View>
        ) : null}
        <View style={{ flexDirection: "row" }}>
          <View style={{ flex: 1 }}>
            <TextInput
              value={searchInput}
              onChangeText={setSearchInput}
              placeholder="Search tickets"
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Search tickets"
              style={{
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.background,
                color: colors.text,
              }}
            />
          </View>
          <View style={{ width: spacing.sm }} />
          <Pressable
            onPress={() => setFiltersOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Open filters"
            style={({ pressed }) => ({
              paddingHorizontal: spacing.md,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              justifyContent: "center",
              opacity: pressed ? 0.95 : 1,
            })}
          >
            <Text style={{ ...typography.caption, color: colors.text, fontWeight: "600" }}>Filters</Text>
          </Pressable>
        </View>
        <ActiveFiltersSummary filters={filters} />
        <QuickFilters
          onSelect={(kind) => {
            if (kind === "mine") setFilters({ ...filters, assignee: "me" });
            if (kind === "unassigned") setFilters({ ...filters, assignee: "unassigned" });
            if (kind === "highPriority") setFilters({ ...filters, priorityName: "high" });
            if (kind === "recent") setFilters({ ...filters, updatedSinceDays: 7 });
          }}
        />
      </View>
    );
  }, [filters, searchInput, stats]);

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={items}
        keyExtractor={keyExtractor}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={{ padding: spacing.lg, backgroundColor: colors.background }}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={header}
        renderItem={renderItem}
        ListFooterComponent={
          loadingMore ? (
            <View style={{ paddingVertical: spacing.lg, alignItems: "center" }}>
              <ActivityIndicator />
            </View>
          ) : null
        }
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={50}
        windowSize={7}
      />

      <FiltersModal
        visible={filtersOpen}
        client={client}
        apiKey={session.accessToken}
        filters={filters}
        setFilters={setFilters}
        canFilterMe={Boolean(session?.user?.id)}
        onClose={() => setFiltersOpen(false)}
      />
    </View>
  );
}

function ActiveFiltersSummary({
  filters,
}: {
  filters: {
    status: "any" | "open" | "closed";
    statusIds: string[];
    assignee: "any" | "me" | "unassigned";
    priorityName: string;
    updatedSinceDays: number | null;
  };
}) {
  const parts: string[] = [];
  if (filters.statusIds.length > 0) parts.push(`statuses:${filters.statusIds.length}`);
  else if (filters.status !== "any") parts.push(filters.status);
  if (filters.assignee !== "any") parts.push(filters.assignee);
  if (filters.priorityName.trim()) parts.push(`priority:${filters.priorityName.trim()}`);
  if (filters.updatedSinceDays) parts.push(`updated:${filters.updatedSinceDays}d`);

  if (parts.length === 0) return null;
  return (
    <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.mutedText }}>
      Filters: {parts.join(" • ")}
    </Text>
  );
}

function QuickFilters({
  onSelect,
}: {
  onSelect: (kind: "mine" | "unassigned" | "highPriority" | "recent") => void;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm }}>
      <QuickChip label="My tickets" onPress={() => onSelect("mine")} />
      <View style={{ width: spacing.sm }} />
      <QuickChip label="Unassigned" onPress={() => onSelect("unassigned")} />
      <View style={{ width: spacing.sm }} />
      <QuickChip label="High priority" onPress={() => onSelect("highPriority")} />
      <View style={{ width: spacing.sm }} />
      <QuickChip label="Recently updated" onPress={() => onSelect("recent")} />
    </View>
  );
}

function QuickChip({ label, onPress }: { label: string; onPress: () => void }) {
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
        opacity: pressed ? 0.95 : 1,
      })}
    >
      <Text style={{ ...typography.caption, color: colors.text, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

function FiltersModal({
  visible,
  client,
  apiKey,
  filters,
  setFilters,
  canFilterMe,
  onClose,
}: {
  visible: boolean;
  client: ApiClient | null;
  apiKey: string | null;
  filters: {
    status: "any" | "open" | "closed";
    statusIds: string[];
    assignee: "any" | "me" | "unassigned";
    priorityName: string;
    updatedSinceDays: number | null;
  };
  setFilters: Dispatch<
    SetStateAction<{
      status: "any" | "open" | "closed";
      statusIds: string[];
      assignee: "any" | "me" | "unassigned";
      priorityName: string;
      updatedSinceDays: number | null;
    }>
  >;
  canFilterMe: boolean;
  onClose: () => void;
}) {
  const [statusOptions, setStatusOptions] = useState<TicketStatus[]>([]);
  const [statusOptionsLoading, setStatusOptionsLoading] = useState(false);
  const [statusOptionsError, setStatusOptionsError] = useState<string | null>(null);
  const [priorityOptions, setPriorityOptions] = useState<TicketPriority[]>([]);
  const [priorityOptionsLoading, setPriorityOptionsLoading] = useState(false);
  const [priorityOptionsError, setPriorityOptionsError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      if (!visible) return;
      if (!client || !apiKey) return;
      if (statusOptions.length > 0) return;
      setStatusOptionsLoading(true);
      setStatusOptionsError(null);
      const res = await getTicketStatuses(client, { apiKey });
      if (canceled) return;
      if (!res.ok) {
        setStatusOptionsError("Unable to load statuses.");
        return;
      }
      setStatusOptions(res.data.data);
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [apiKey, client, statusOptions.length, visible]);

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      if (!visible) return;
      if (!client || !apiKey) return;
      if (priorityOptions.length > 0) return;
      setPriorityOptionsLoading(true);
      setPriorityOptionsError(null);
      const res = await getTicketPriorities(client, { apiKey });
      if (canceled) return;
      if (!res.ok) {
        setPriorityOptionsError("Unable to load priorities.");
        return;
      }
      setPriorityOptions(res.data.data);
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [apiKey, client, priorityOptions.length, visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, padding: spacing.lg, backgroundColor: colors.background }}>
        <Text style={{ ...typography.title, color: colors.text }}>Filters</Text>

        <Text style={{ ...typography.caption, color: colors.mutedText, marginTop: spacing.lg }}>Status</Text>
        <OptionRow
          options={[
            { label: "Any", value: "any" },
            { label: "Open", value: "open" },
            { label: "Closed", value: "closed" },
          ]}
          value={filters.status}
          onChange={(status) => setFilters({ ...filters, status, statusIds: [] })}
        />

        <Text style={{ ...typography.caption, color: colors.mutedText, marginTop: spacing.md }}>Specific statuses</Text>
        {statusOptionsLoading ? (
          <Text style={{ ...typography.caption, color: colors.mutedText, marginTop: spacing.sm }}>
            Loading statuses…
          </Text>
        ) : statusOptionsError ? (
          <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
            {statusOptionsError}
          </Text>
        ) : statusOptions.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm }}>
            {statusOptions.map((s) => {
              const selected = filters.statusIds.includes(s.status_id);
              return (
                <View key={s.status_id} style={{ marginRight: spacing.sm, marginBottom: spacing.sm }}>
                  <Pressable
                    onPress={() => {
                      const next = selected
                        ? filters.statusIds.filter((id) => id !== s.status_id)
                        : [...filters.statusIds, s.status_id];
                      setFilters({ ...filters, status: "any", statusIds: next });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={s.name}
                    style={({ pressed }) => ({
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primary : colors.card,
                      opacity: pressed ? 0.95 : 1,
                    })}
                  >
                    <Text style={{ ...typography.caption, color: selected ? "#fff" : colors.text, fontWeight: "600" }}>
                      {selected ? "✓ " : ""}
                      {s.name}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={{ ...typography.caption, color: colors.mutedText, marginTop: spacing.sm }}>
            No statuses available.
          </Text>
        )}

        <Text style={{ ...typography.caption, color: colors.mutedText, marginTop: spacing.lg }}>Assignee</Text>
        <OptionRow
          options={[
            { label: "Any", value: "any" },
            { label: "Me", value: "me", disabled: !canFilterMe },
            { label: "Unassigned", value: "unassigned" },
          ]}
          value={filters.assignee}
          onChange={(assignee) => setFilters({ ...filters, assignee })}
        />
        {!canFilterMe ? (
          <Text style={{ ...typography.caption, color: colors.mutedText, marginTop: spacing.sm }}>
            “Me” filter requires user identity from sign-in.
          </Text>
        ) : null}

        <Text style={{ ...typography.caption, color: colors.mutedText, marginTop: spacing.lg }}>Priority</Text>
        {priorityOptionsLoading ? (
          <Text style={{ ...typography.caption, color: colors.mutedText, marginTop: spacing.sm }}>
            Loading priorities…
          </Text>
        ) : priorityOptionsError ? (
          <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
            {priorityOptionsError}
          </Text>
        ) : priorityOptions.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm }}>
            {priorityOptions.map((p) => {
              const selected =
                filters.priorityName.trim().toLowerCase() === p.priority_name.trim().toLowerCase();
              return (
                <View key={p.priority_id} style={{ marginRight: spacing.sm, marginBottom: spacing.sm }}>
                  <Pressable
                    onPress={() => {
                      setFilters({
                        ...filters,
                        priorityName: selected ? "" : p.priority_name,
                      });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={p.priority_name}
                    style={({ pressed }) => ({
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primary : colors.card,
                      opacity: pressed ? 0.95 : 1,
                    })}
                  >
                    <Text style={{ ...typography.caption, color: selected ? "#fff" : colors.text, fontWeight: "600" }}>
                      {p.priority_name}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : null}
        <TextInput
          value={filters.priorityName}
          onChangeText={(priorityName) => setFilters({ ...filters, priorityName })}
          placeholder="Priority name (e.g. High)"
          accessibilityLabel="Priority filter"
          style={{
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.background,
            color: colors.text,
            marginTop: spacing.sm,
          }}
        />

        <Text style={{ ...typography.caption, color: colors.mutedText, marginTop: spacing.lg }}>Updated since</Text>
        <OptionRow
          options={[
            { label: "Any", value: null },
            { label: "24h", value: 1 },
            { label: "7d", value: 7 },
            { label: "30d", value: 30 },
          ]}
          value={filters.updatedSinceDays}
          onChange={(updatedSinceDays) => setFilters({ ...filters, updatedSinceDays })}
        />

        <View style={{ flex: 1 }} />

        <View style={{ flexDirection: "row" }}>
          <PrimaryButton
            onPress={() =>
              setFilters({
                status: "any",
                statusIds: [],
                assignee: "any",
                priorityName: "",
                updatedSinceDays: null,
              })
            }
          >
            Clear
          </PrimaryButton>
          <View style={{ width: spacing.sm }} />
          <PrimaryButton onPress={onClose}>Done</PrimaryButton>
        </View>
      </View>
    </Modal>
  );
}

function OptionRow<T extends string | number | null>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm }}>
      {options.map((opt) => (
        <View key={String(opt.value)} style={{ marginRight: spacing.sm, marginBottom: spacing.sm }}>
          <Pressable
            onPress={() => onChange(opt.value)}
            disabled={opt.disabled}
            accessibilityRole="button"
            accessibilityLabel={opt.label}
            style={({ pressed }) => ({
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: value === opt.value ? colors.primary : colors.border,
              backgroundColor: value === opt.value ? colors.primary : colors.card,
              opacity: pressed && !opt.disabled ? 0.95 : opt.disabled ? 0.5 : 1,
            })}
          >
            <Text style={{ ...typography.caption, color: value === opt.value ? colors.primaryText : colors.text }}>
              {opt.label}
            </Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const TicketRow = memo(function TicketRow({
  item,
  onPressTicket,
}: {
  item: TicketListItem;
  onPressTicket: (ticketId: string) => void;
}) {
  const ticketId = item.ticket_id;
  const handlePress = useCallback(() => onPressTicket(ticketId), [onPressTicket, ticketId]);

  const updated = item.updated_at ?? item.entered_at;
  const updatedLabel = useMemo(() => (updated ? formatDateShort(updated) : ""), [updated]);
  const status = item.status_name ?? "Unknown";
  const priority = item.priority_name ?? null;

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Ticket ${item.ticket_number}: ${item.title}`}
      style={({ pressed }) => ({
        padding: spacing.md,
        marginBottom: spacing.sm,
        borderRadius: 12,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: pressed ? 0.96 : 1,
      })}
    >
      <Text style={{ ...typography.caption, color: colors.mutedText }}>
        {item.ticket_number}
        {item.client_name ? ` • ${item.client_name}` : ""}
        {updatedLabel ? ` • ${updatedLabel}` : ""}
      </Text>
      <Text style={{ ...typography.body, color: colors.text, marginTop: 2 }} numberOfLines={2}>
        {item.title}
      </Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm }}>
        <Badge label={status} tone={item.status_is_closed ? "neutral" : "info"} />
        {priority ? <View style={{ width: spacing.sm }} /> : null}
        {priority ? <Badge label={priority} tone={priorityTone(priority)} /> : null}
      </View>

      {item.assigned_to_name ? (
        <Text style={{ ...typography.caption, color: colors.mutedText, marginTop: spacing.sm }}>
          Assigned to {item.assigned_to_name}
        </Text>
      ) : null}
    </Pressable>
  );
});

function priorityTone(priorityName: string): "neutral" | "success" | "warning" | "danger" {
  const normalized = priorityName.trim().toLowerCase();
  if (normalized.includes("high") || normalized.includes("urgent") || normalized.includes("critical")) return "danger";
  if (normalized.includes("medium") || normalized.includes("normal")) return "warning";
  if (normalized.includes("low")) return "success";
  return "neutral";
}
