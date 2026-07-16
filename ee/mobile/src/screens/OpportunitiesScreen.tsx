import type { CompositeScreenProps } from "@react-navigation/native";
import type { DrawerScreenProps } from "@react-navigation/drawer";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { Badge } from "../ui/components/Badge";
import { SectionHeader } from "../ui/components/SectionHeader";
import type { DrawerParamList, RootStackParamList } from "../navigation/types";
import { useAppResume } from "../hooks/useAppResume";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient, type ApiClient } from "../api";
import {
  getWorkQueue,
  listOpportunities,
  type OpportunityListItem,
  type WorkQueue,
  type WorkQueueItem,
} from "../api/opportunities";
import { useTheme } from "../ui/ThemeContext";
import type { Theme } from "../ui/themes";
import { logger } from "../logging/logger";
import { StageBadge } from "../features/opportunities/components/StageBadge";
import { WhySentence } from "../features/opportunities/components/WhySentence";
import { formatCents, formatDate } from "../features/opportunities/opportunityFormat";

type Props = CompositeScreenProps<
  DrawerScreenProps<DrawerParamList, "OpportunitiesTab">,
  NativeStackScreenProps<RootStackParamList>
>;

type Segment = "queue" | "pipeline";
type StatusFilter = "open" | "won" | "lost";

const SEARCH_DEBOUNCE_MS = 300;
const NEXT_PAGE_PREFETCH_THRESHOLD = 0.6;
const QUIET_DAYS_THRESHOLD = 7;

type OpenDeal = (opportunityId: string, title: string) => void;

export function OpportunitiesScreen({ navigation }: Props) {
  const { t } = useTranslation("opportunities");
  const theme = useTheme();
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession } = useAuth();
  const [segment, setSegment] = useState<Segment>("queue");

  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/opportunities",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);

  const openDeal = useCallback<OpenDeal>(
    (opportunityId, title) => {
      navigation.navigate("OpportunityDetail", { opportunityId, title });
    },
    [navigation],
  );

  if (!config.ok) {
    return <ErrorState title={t("common:configurationError", "Configuration error")} description={config.error} />;
  }
  if (!session) {
    return <ErrorState title={t("common:signedOut", "Signed out")} description={t("common:signInAgain", "Please sign in again.")} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <SegmentedControl theme={theme} value={segment} onChange={setSegment} t={t} />
      {segment === "queue" ? (
        <QueueView client={client} apiKey={session.accessToken} onOpenDeal={openDeal} />
      ) : (
        <PipelineView client={client} apiKey={session.accessToken} onOpenDeal={openDeal} />
      )}
    </View>
  );
}

function SegmentedControl({
  theme,
  value,
  onChange,
  t,
}: {
  theme: Theme;
  value: Segment;
  onChange: (segment: Segment) => void;
  t: (key: string, def: string) => string;
}) {
  const segments: { key: Segment; label: string }[] = [
    { key: "queue", label: t("segments.queue", "Queue") },
    { key: "pipeline", label: t("segments.pipeline", "Pipeline") },
  ];
  return (
    <View style={{ flexDirection: "row", padding: theme.spacing.md, gap: theme.spacing.sm }}>
      {segments.map((item) => {
        const selected = value === item.key;
        return (
          <Pressable
            key={item.key}
            testID={`opportunities-segment-${item.key}`}
            onPress={() => onChange(item.key)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={item.label}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: theme.spacing.sm,
              alignItems: "center",
              borderRadius: theme.borderRadius.full,
              borderWidth: 1,
              borderColor: selected ? theme.colors.primary : theme.colors.border,
              backgroundColor: selected ? theme.colors.primary : theme.colors.card,
              opacity: pressed ? 0.95 : 1,
            })}
          >
            <Text
              style={{
                ...theme.typography.caption,
                fontWeight: "600",
                color: selected ? theme.colors.textInverse : theme.colors.text,
              }}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

function QueueView({ client, apiKey, onOpenDeal }: { client: ApiClient | null; apiKey: string; onOpenDeal: OpenDeal }) {
  const { t } = useTranslation("opportunities");
  const theme = useTheme();
  const abortRef = useRef<AbortController | null>(null);

  const [queue, setQueue] = useState<WorkQueue | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);

  const fetchQueue = useCallback(async () => {
    if (!client) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setNoAccess(false);

    const result = await getWorkQueue(client, { apiKey, signal: controller.signal });
    if (abortRef.current === controller) abortRef.current = null;
    if (controller.signal.aborted) return;

    if (!result.ok) {
      if (result.error.kind === "canceled") return;
      logger.warn("Work queue fetch failed", { error: result.error });
      if (result.error.kind === "permission") {
        setQueue(null);
        setNoAccess(true);
        return;
      }
      setError(t("errors.unableToLoad", "Unable to load."));
      return;
    }
    setQueue(result.data.data);
  }, [apiKey, client, t]);

  const { refreshing, refresh } = usePullToRefresh(fetchQueue, { haptics: true });
  useAppResume(() => void refresh());

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    void (async () => {
      setInitialLoading(true);
      await fetchQueue();
      if (!canceled) setInitialLoading(false);
    })();
    return () => {
      canceled = true;
    };
  }, [fetchQueue]);

  if (noAccess) {
    return <ErrorState title={t("common.noAccess", "You don't have access to opportunities.")} />;
  }
  if (initialLoading && !queue) {
    return <LoadingState message={t("queue.loading", "Loading your work")} />;
  }
  if (error && !queue) {
    return (
      <ErrorState
        title={t("errors.unableToLoad", "Unable to load.")}
        description={error}
        action={<PrimaryButton onPress={() => void refresh()}>{t("common:retry", "Retry")}</PrimaryButton>}
      />
    );
  }

  const sections = (queue?.sections ?? []).filter((section) => section.items.length > 0);

  if (sections.length === 0) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={{ flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <EmptyState title={t("queue.empty", "That's everything. Nothing needs you today.")} />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      {queue?.greeting ? (
        <Text style={{ ...theme.typography.subtitle, color: theme.colors.text, marginBottom: theme.spacing.md }}>
          {queue.greeting}
        </Text>
      ) : null}
      {sections.map((section) => (
        <View key={section.key} style={{ marginBottom: theme.spacing.lg }}>
          <SectionHeader title={queueSectionTitle(section.key, section.title, t)} />
          <View style={{ marginTop: theme.spacing.sm }}>
            {section.items.map((item) => (
              <QueueRow key={item.opportunity_id} item={item} onOpenDeal={onOpenDeal} />
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function queueSectionTitle(
  key: string,
  title: string | undefined,
  t: (key: string, def: string) => string,
): string {
  if (title) return title;
  if (key === "due_today" || key === "dueToday") return t("queue.dueToday", "Do these today");
  if (key === "going_quiet" || key === "goingQuiet") return t("queue.goingQuiet", "Going quiet");
  return key;
}

const QueueRow = memo(function QueueRow({ item, onOpenDeal }: { item: WorkQueueItem; onOpenDeal: OpenDeal }) {
  const { t } = useTranslation("opportunities");
  const theme = useTheme();

  const why = normalizeWhy(item.why);
  const dueLabel = formatDate(item.next_action_due);
  const handlePress = useCallback(() => onOpenDeal(item.opportunity_id, item.title), [item.opportunity_id, item.title, onOpenDeal]);

  return (
    <Pressable
      testID={`opportunity-row-${item.opportunity_id}`}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={item.title}
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
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ ...theme.typography.body, color: theme.colors.text, flex: 1, fontWeight: "600" }} numberOfLines={1}>
          {item.title}
        </Text>
        {item.overdue ? (
          <Badge label={t("queue.overdue", "Overdue")} tone="danger" />
        ) : dueLabel ? (
          <Badge label={t("queue.due", "Due")} tone="info" />
        ) : null}
      </View>
      {item.client_name ? (
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }} numberOfLines={1}>
          {item.client_name}
        </Text>
      ) : null}
      {item.next_action ? (
        <Text style={{ ...theme.typography.body, color: theme.colors.text, marginTop: theme.spacing.xs }} numberOfLines={2}>
          {item.next_action}
        </Text>
      ) : null}
      {dueLabel ? (
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
          {t("detail.due", "Due {{date}}", { date: dueLabel })}
        </Text>
      ) : null}
      {why ? (
        <View style={{ marginTop: theme.spacing.xs }}>
          <WhySentence testID={`opportunity-why-${item.opportunity_id}`} text={why.text} emphasis={why.emphasis} />
        </View>
      ) : null}
    </Pressable>
  );
});

function normalizeWhy(why: WorkQueueItem["why"]): { text: string; emphasis?: string } | null {
  if (!why) return null;
  if (typeof why === "string") return why.trim() ? { text: why } : null;
  return why.text ? { text: why.text, emphasis: why.emphasis } : null;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

function PipelineView({ client, apiKey, onOpenDeal }: { client: ApiClient | null; apiKey: string; onOpenDeal: OpenDeal }) {
  const { t } = useTranslation("opportunities");
  const theme = useTheme();
  const abortRef = useRef<AbortController | null>(null);
  const loadingMoreRef = useRef(false);

  const [items, setItems] = useState<OpportunityListItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [status, setStatus] = useState<StatusFilter>("open");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const loadPage = useCallback(
    async ({ pageToLoad, replace }: { pageToLoad: number; replace: boolean }) => {
      if (!client) return;
      setError(null);
      setNoAccess(false);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const result = await listOpportunities(client, {
        apiKey,
        page: pageToLoad,
        pageSize: 25,
        status,
        search: search || undefined,
        signal: controller.signal,
      });

      if (abortRef.current === controller) abortRef.current = null;
      if (controller.signal.aborted) return;

      if (!result.ok) {
        if (result.error.kind === "canceled") return;
        logger.warn("Opportunity list fetch failed", { error: result.error });
        if (result.error.kind === "permission") {
          setItems([]);
          setHasNext(false);
          setNoAccess(true);
          return;
        }
        setError(t("errors.unableToLoad", "Unable to load."));
        return;
      }

      const next = result.data.data;
      setItems((prev) => (replace ? next : [...prev, ...next]));
      setPage(result.data.pagination.page);
      setHasNext(result.data.pagination.hasNext);
    },
    [apiKey, client, search, status, t],
  );

  const { refreshing, refresh } = usePullToRefresh(async () => {
    await loadPage({ pageToLoad: 1, replace: true });
  }, { haptics: true });
  useAppResume(() => void refresh());

  useEffect(() => {
    let canceled = false;
    void (async () => {
      setInitialLoading(true);
      await loadPage({ pageToLoad: 1, replace: true });
      if (!canceled) setInitialLoading(false);
    })();
    return () => {
      canceled = true;
    };
  }, [loadPage]);

  const onEndReached = useCallback(async () => {
    if (!client) return;
    if (initialLoading || refreshing || loadingMoreRef.current || !hasNext) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      await loadPage({ pageToLoad: page + 1, replace: false });
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [client, hasNext, initialLoading, loadPage, page, refreshing]);

  const keyExtractor = useCallback((item: OpportunityListItem) => item.opportunity_id, []);
  const renderItem = useCallback(
    ({ item }: { item: OpportunityListItem }) => <PipelineRow item={item} onOpenDeal={onOpenDeal} />,
    [onOpenDeal],
  );

  const header = (
    <View style={{ marginBottom: theme.spacing.md }}>
      <PipelineSearchField
        theme={theme}
        value={searchInput}
        onChangeText={setSearchInput}
        onClear={() => setSearchInput("")}
        placeholder={t("pipeline.searchPlaceholder", "Search deals")}
      />
      <View style={{ flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
        {(["open", "won", "lost"] as StatusFilter[]).map((value) => {
          const selected = status === value;
          return (
            <Pressable
              key={value}
              testID={`opportunities-filter-${value}`}
              onPress={() => setStatus(value)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={t(`pipeline.filters.${value}`, value)}
              style={({ pressed }) => ({
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.xs,
                borderRadius: theme.borderRadius.full,
                borderWidth: 1,
                borderColor: selected ? theme.colors.primary : theme.colors.border,
                backgroundColor: selected ? theme.colors.primary : theme.colors.card,
                opacity: pressed ? 0.95 : 1,
              })}
            >
              <Text
                style={{
                  ...theme.typography.caption,
                  fontWeight: "600",
                  color: selected ? theme.colors.textInverse : theme.colors.text,
                }}
              >
                {t(`pipeline.filters.${value}`, value)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  if (noAccess) {
    return <ErrorState title={t("common.noAccess", "You don't have access to opportunities.")} />;
  }
  if (initialLoading && items.length === 0) {
    return <LoadingState message={t("pipeline.loading", "Loading deals")} />;
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
    <FlatList
      testID="opportunities-pipeline-list"
      data={items}
      keyExtractor={keyExtractor}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      contentContainerStyle={{ padding: theme.spacing.lg, backgroundColor: theme.colors.background, flexGrow: 1 }}
      onEndReached={() => void onEndReached()}
      onEndReachedThreshold={NEXT_PAGE_PREFETCH_THRESHOLD}
      ListHeaderComponent={header}
      renderItem={renderItem}
      ListEmptyComponent={<EmptyState title={t("pipeline.empty", "No open deals.")} />}
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
  );
}

const PipelineRow = memo(function PipelineRow({ item, onOpenDeal }: { item: OpportunityListItem; onOpenDeal: OpenDeal }) {
  const { t } = useTranslation("opportunities");
  const theme = useTheme();
  const handlePress = useCallback(() => onOpenDeal(item.opportunity_id, item.title), [item.opportunity_id, item.title, onOpenDeal]);

  const mrr = item.mrr_cents != null ? formatCents(item.mrr_cents, item.currency_code) : null;
  const nrr = item.nrr_cents != null ? formatCents(item.nrr_cents, item.currency_code) : null;
  const quietDays = item.days_since_activity ?? 0;

  return (
    <Pressable
      testID={`pipeline-row-${item.opportunity_id}`}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={item.title}
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
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ ...theme.typography.body, color: theme.colors.text, flex: 1, fontWeight: "600" }} numberOfLines={1}>
          {item.title}
        </Text>
        <StageBadge stage={item.stage} />
      </View>
      {item.client_name ? (
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }} numberOfLines={1}>
          {item.client_name}
        </Text>
      ) : null}
      {mrr || nrr ? (
        <Text style={{ ...theme.typography.body, color: theme.colors.text, marginTop: theme.spacing.xs }}>
          {[mrr ? t("format.perMonth", "{{value}}/mo", { value: mrr }) : null, nrr]
            .filter(Boolean)
            .join("  ·  ")}
        </Text>
      ) : null}
      {quietDays >= QUIET_DAYS_THRESHOLD ? (
        <Text style={{ ...theme.typography.caption, color: theme.colors.warning, marginTop: 2 }}>
          {t("pipeline.quietDays", "{{count}} days quiet", { count: quietDays })}
        </Text>
      ) : null}
    </Pressable>
  );
});

function PipelineSearchField({
  theme,
  value,
  onChangeText,
  onClear,
  placeholder,
}: {
  theme: Theme;
  value: string;
  onChangeText: (text: string) => void;
  onClear: () => void;
  placeholder: string;
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
      <Feather name="search" size={16} color={theme.colors.textSecondary} />
      <TextInput
        testID="opportunities-pipeline-search"
        value={value}
        onChangeText={onChangeText}
        returnKeyType="search"
        placeholder={placeholder}
        placeholderTextColor={theme.colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ flex: 1, paddingVertical: theme.spacing.sm, marginLeft: theme.spacing.sm, color: theme.colors.text }}
      />
      {value.length > 0 ? (
        <Pressable
          testID="opportunities-pipeline-search-clear"
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={8}
          style={{ padding: theme.spacing.xs }}
        >
          <Feather name="x" size={16} color={theme.colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}
