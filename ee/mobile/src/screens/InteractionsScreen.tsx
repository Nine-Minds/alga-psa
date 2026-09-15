import type { CompositeScreenProps } from "@react-navigation/native";
import type { DrawerScreenProps } from "@react-navigation/drawer";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { Badge } from "../ui/components/Badge";
import { BottomSheet } from "../ui/components/BottomSheet";
import type { DrawerParamList, RootStackParamList } from "../navigation/types";
import { useAppResume } from "../hooks/useAppResume";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import {
  listInteractionStatuses,
  listInteractionTypes,
  listInteractions,
  type InteractionItem,
  type InteractionStatus,
  type InteractionType,
} from "../api/interactions";
import { useTheme } from "../ui/ThemeContext";
import type { Theme } from "../ui/themes";
import { formatDateShort } from "../ui/formatters/dateTime";
import { logger } from "../logging/logger";
import { ActionChip } from "../features/ticketDetail/components/ActionChip";
import {
  DEFAULT_INTERACTION_FILTERS,
  filtersToQuery,
  hasActiveInteractionFilters,
  type InteractionFilters,
  type InteractionStatusFilter,
  type InteractionWhenFilter,
} from "../features/interactions/interactionFilters";
import { InteractionDetailSheet } from "../features/interactions/components/InteractionDetailSheet";
import { LogInteractionEntry } from "../features/interactions/components/LogInteractionEntry";
import { resyncScheduleReminders } from "../notifications/reminderSync";

type Props = CompositeScreenProps<
  DrawerScreenProps<DrawerParamList, "InteractionsTab">,
  NativeStackScreenProps<RootStackParamList>
>;

const PAGE_SIZE = 25;
const NEXT_PAGE_PREFETCH_THRESHOLD = 0.6;
const WHEN_OPTIONS: InteractionWhenFilter[] = ["any", "today", "thisWeek", "upcoming", "past30"];
const STATUS_OPTIONS: InteractionStatusFilter[] = ["any", "open", "closed"];

function interactionIcon(interaction: InteractionItem): keyof typeof Feather.glyphMap {
  const name = (interaction.type_name ?? "").toLowerCase();
  if (name.includes("call")) return "phone";
  if (name.includes("email")) return "mail";
  if (name.includes("meeting")) return "users";
  return "message-circle";
}

export function InteractionsScreen({ navigation }: Props) {
  const { t } = useTranslation("interactions");
  const theme = useTheme();
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession } = useAuth();
  const listAbortRef = useRef<AbortController | null>(null);
  const loadingMoreRef = useRef(false);

  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/interactions",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);
  const apiKey = session?.accessToken ?? null;
  const meUserId = session?.user?.id ?? null;

  const [items, setItems] = useState<InteractionItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [filters, setFilters] = useState<InteractionFilters>(DEFAULT_INTERACTION_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [types, setTypes] = useState<InteractionType[]>([]);
  const [statuses, setStatuses] = useState<InteractionStatus[]>([]);
  const [selected, setSelected] = useState<InteractionItem | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  useEffect(() => () => listAbortRef.current?.abort(), []);

  useEffect(() => {
    if (!client || !apiKey) return;
    const controller = new AbortController();
    void listInteractionTypes(client, { apiKey, signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted && result.ok) setTypes(result.data.data);
    });
    void listInteractionStatuses(client, { apiKey, signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted && result.ok) setStatuses(result.data.data);
    });
    return () => controller.abort();
  }, [apiKey, client]);

  const loadPage = useCallback(
    async ({ pageToLoad, replace }: { pageToLoad: number; replace: boolean }) => {
      if (!client || !apiKey) return;
      setError(null);
      setNoAccess(false);

      listAbortRef.current?.abort();
      const abortController = new AbortController();
      listAbortRef.current = abortController;

      const result = await listInteractions(client, {
        apiKey,
        page: pageToLoad,
        limit: PAGE_SIZE,
        ...filtersToQuery(filters, meUserId),
        signal: abortController.signal,
      });

      if (listAbortRef.current === abortController) listAbortRef.current = null;
      if (abortController.signal.aborted) return;

      if (!result.ok) {
        if (result.error.kind === "canceled") return;
        logger.warn("Interactions list fetch failed", { error: result.error });
        if (result.error.kind === "permission") {
          setItems([]);
          setHasNext(false);
          setNoAccess(true);
          return;
        }
        setError(t("list.unableToLoadDescription"));
        return;
      }

      const nextItems = result.data.data;
      setItems((prev) => (replace ? nextItems : [...prev, ...nextItems]));
      setPage(result.data.pagination.page);
      setHasNext(result.data.pagination.hasNext);
    },
    [apiKey, client, filters, meUserId, t],
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
      if (!client || !apiKey) return;
      setInitialLoading(true);
      await loadPage({ pageToLoad: 1, replace: true });
      if (!canceled) setInitialLoading(false);
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [apiKey, client, loadPage]);

  const onEndReached = useCallback(async () => {
    if (!client || !apiKey) return;
    if (initialLoading || refreshing || loadingMoreRef.current || !hasNext) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      await loadPage({ pageToLoad: page + 1, replace: false });
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [apiKey, client, hasNext, initialLoading, loadPage, page, refreshing]);

  const openTicket = useCallback((ticketId: string) => {
    setSelected(null);
    navigation.navigate("TicketDetail", { ticketId });
  }, [navigation]);
  const openClient = useCallback((clientId: string, clientName: string) => {
    setSelected(null);
    navigation.navigate("ClientDetail", { clientId, clientName });
  }, [navigation]);
  const openContact = useCallback((contactId: string, contactName: string) => {
    setSelected(null);
    navigation.navigate("ContactDetail", { contactId, contactName });
  }, [navigation]);

  const showAuthor = filters.scope === "everyone";
  const renderItem = useCallback(
    ({ item }: { item: InteractionItem }) => (
      <InteractionRow item={item} showAuthor={showAuthor} theme={theme} onPress={() => setSelected(item)} />
    ),
    [showAuthor, theme],
  );

  if (!config.ok) {
    return <ErrorState title={t("common:configurationError")} description={config.error} />;
  }
  if (!session) {
    return <ErrorState title={t("common:signedOut")} description={t("common:signInAgain")} />;
  }
  if (noAccess) {
    return <ErrorState title={t("list.noAccess")} description={t("list.noAccessDescription")} />;
  }
  if (initialLoading && items.length === 0) {
    return <LoadingState message={t("list.loading")} />;
  }
  if (error && items.length === 0) {
    return (
      <ErrorState
        title={t("list.unableToLoad")}
        description={error}
        action={<PrimaryButton onPress={() => void refresh()}>{t("common:retry")}</PrimaryButton>}
      />
    );
  }

  const activeFilters = hasActiveInteractionFilters(filters);
  const typeName = filters.typeId ? types.find((type) => type.type_id === filters.typeId)?.type_name ?? null : null;

  const header = (
    <View style={{ marginBottom: theme.spacing.md, gap: theme.spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
        <ScopeToggle theme={theme} value={filters.scope} onChange={(scope) => setFilters((current) => ({ ...current, scope }))} labels={{ mine: t("list.mine"), everyone: t("list.everyone") }} />
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => setFiltersOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t("list.filtersButton")}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.xs,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            borderRadius: theme.borderRadius.full,
            borderWidth: 1,
            borderColor: activeFilters ? theme.colors.primary : theme.colors.border,
            backgroundColor: theme.colors.card,
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <Feather name="filter" size={14} color={activeFilters ? theme.colors.primary : theme.colors.text} />
          <Text style={{ ...theme.typography.caption, color: activeFilters ? theme.colors.primary : theme.colors.text, fontWeight: "600" }}>
            {t("list.filtersButton")}
          </Text>
        </Pressable>
        <PrimaryButton onPress={() => setLogOpen(true)} accessibilityLabel={t("list.logInteraction")}>
          {t("list.log")}
        </PrimaryButton>
      </View>
      {activeFilters ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm }}>
          {filters.status !== "any" ? <Badge label={t("filters.statusLabel", { status: t(`filters.status${filters.status === "open" ? "Open" : "Closed"}`) })} tone="info" /> : null}
          {filters.when !== "any" ? <Badge label={t(`filters.when${filters.when.charAt(0).toUpperCase()}${filters.when.slice(1)}`)} tone="info" /> : null}
          {typeName ? <Badge label={t("filters.typeLabel", { type: typeName })} tone="info" /> : null}
          <Pressable onPress={() => setFilters((current) => ({ ...DEFAULT_INTERACTION_FILTERS, scope: current.scope }))} accessibilityRole="button" accessibilityLabel={t("filters.clearAll")} hitSlop={8}>
            <Text style={{ ...theme.typography.caption, color: theme.colors.primary, fontWeight: "600", paddingVertical: 4 }}>{t("filters.clearAll")}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.interaction_id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          activeFilters
            ? <EmptyState title={t("list.noResults")} description={t("list.noResultsDescription")} />
            : <EmptyState title={t("list.empty")} description={t("list.emptyDescription")} />
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginVertical: theme.spacing.md }} color={theme.colors.primary} /> : null}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        onEndReached={() => void onEndReached()}
        onEndReachedThreshold={NEXT_PAGE_PREFETCH_THRESHOLD}
      />

      <BottomSheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} title={t("filters.title")} snapPoint="full">
        <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.xl, gap: theme.spacing.lg }}>
          <FilterGroup theme={theme} label={t("filters.status")}>
            {STATUS_OPTIONS.map((status) => (
              <ActionChip
                key={status}
                label={`${filters.status === status ? "✓ " : ""}${t(`filters.status${status.charAt(0).toUpperCase()}${status.slice(1)}`)}`}
                onPress={() => setFilters((current) => ({ ...current, status }))}
              />
            ))}
          </FilterGroup>
          <FilterGroup theme={theme} label={t("filters.when")}>
            {WHEN_OPTIONS.map((when) => (
              <ActionChip
                key={when}
                label={`${filters.when === when ? "✓ " : ""}${t(`filters.when${when.charAt(0).toUpperCase()}${when.slice(1)}`)}`}
                onPress={() => setFilters((current) => ({ ...current, when }))}
              />
            ))}
          </FilterGroup>
          <FilterGroup theme={theme} label={t("filters.type")}>
            <ActionChip label={`${filters.typeId === null ? "✓ " : ""}${t("filters.anyType")}`} onPress={() => setFilters((current) => ({ ...current, typeId: null }))} />
            {types.map((type) => (
              <ActionChip
                key={type.type_id}
                label={`${filters.typeId === type.type_id ? "✓ " : ""}${type.type_name}`}
                onPress={() => setFilters((current) => ({ ...current, typeId: type.type_id }))}
              />
            ))}
          </FilterGroup>
          <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
            <View style={{ flex: 1 }}>
              <PrimaryButton onPress={() => setFilters((current) => ({ ...DEFAULT_INTERACTION_FILTERS, scope: current.scope }))} accessibilityLabel={t("filters.clearAll")}>
                {t("filters.clearAll")}
              </PrimaryButton>
            </View>
            <View style={{ flex: 1 }}>
              <PrimaryButton onPress={() => setFiltersOpen(false)} accessibilityLabel={t("filters.apply")}>
                {t("filters.apply")}
              </PrimaryButton>
            </View>
          </View>
        </View>
      </BottomSheet>

      <InteractionDetailSheet
        interaction={selected}
        statuses={statuses}
        client={client}
        apiKey={apiKey}
        onClose={() => setSelected(null)}
        onUpdated={(updated) => {
          setSelected(updated);
          setItems((prev) => prev.map((item) => (item.interaction_id === updated.interaction_id ? { ...item, ...updated } : item)));
        }}
        onOpenTicket={openTicket}
        onOpenClient={openClient}
        onOpenContact={openContact}
      />

      <LogInteractionEntry
        visible={logOpen}
        client={client}
        apiKey={apiKey}
        userId={meUserId}
        onClose={() => setLogOpen(false)}
        onLogged={() => {
          void refresh();
          if (session?.accessToken) {
            void resyncScheduleReminders({ accessToken: session.accessToken, tenantId: session.tenantId, userId: session.user?.id, refreshSession });
          }
        }}
      />
    </View>
  );
}

function FilterGroup({ theme, label, children }: { theme: Theme; label: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginBottom: theme.spacing.sm }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm }}>{children}</View>
    </View>
  );
}

function ScopeToggle({
  theme,
  value,
  onChange,
  labels,
}: {
  theme: Theme;
  value: "mine" | "everyone";
  onChange: (value: "mine" | "everyone") => void;
  labels: { mine: string; everyone: string };
}) {
  return (
    <View style={{ flexDirection: "row", borderRadius: theme.borderRadius.full, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden" }}>
      {(["mine", "everyone"] as const).map((scope) => {
        const active = value === scope;
        return (
          <Pressable
            key={scope}
            onPress={() => onChange(scope)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={labels[scope]}
            style={{
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.sm,
              backgroundColor: active ? theme.colors.primary : theme.colors.card,
            }}
          >
            <Text style={{ ...theme.typography.caption, fontWeight: "600", color: active ? theme.colors.textInverse : theme.colors.text }}>
              {labels[scope]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const InteractionRow = memo(function InteractionRow({
  item,
  showAuthor,
  theme,
  onPress,
}: {
  item: InteractionItem;
  showAuthor: boolean;
  theme: Theme;
  onPress: () => void;
}) {
  const { t } = useTranslation("interactions");
  const label = item.title || item.type_name || t("detail.interaction");
  const who = item.contact_name || item.client_name || null;
  const when = item.start_time ? `${t("list.scheduledPrefix")} ${formatDateShort(item.start_time)}` : formatDateShort(item.interaction_date);
  const meta = [item.type_name, who, showAuthor ? item.user_name : null, when].filter(Boolean).join(" • ");
  const closed = Boolean(item.is_status_closed);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("list.rowAccessibility", { title: label, meta })}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        padding: theme.spacing.md,
        marginBottom: theme.spacing.sm,
        borderRadius: theme.borderRadius.lg,
        backgroundColor: theme.colors.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: pressed ? 0.96 : 1,
      })}
    >
      <Feather name={interactionIcon(item)} size={18} color={theme.colors.textSecondary} />
      <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
        <Text style={{ ...theme.typography.body, color: theme.colors.text }} numberOfLines={1}>{label}</Text>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }} numberOfLines={1}>{meta}</Text>
      </View>
      <Badge label={item.status_name ?? (closed ? t("list.closed") : t("list.open"))} tone={closed ? "success" : "warning"} />
      <Feather name="chevron-right" size={18} color={theme.colors.textSecondary} style={{ marginLeft: theme.spacing.sm }} />
    </Pressable>
  );
});
