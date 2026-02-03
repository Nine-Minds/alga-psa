import type { CompositeScreenProps } from "@react-navigation/native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import type { RootStackParamList, TabsParamList, TicketsStackParamList } from "../navigation/types";
import { useAppResume } from "../hooks/useAppResume";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import { listTickets, type TicketListItem } from "../api/tickets";
import { colors, spacing, typography } from "../ui/theme";
import { useCallback, useEffect, useMemo, useState } from "react";
import { logger } from "../logging/logger";
import { Badge } from "../ui/components/Badge";

type Props = CompositeScreenProps<
  NativeStackScreenProps<TicketsStackParamList, "TicketsList">,
  CompositeScreenProps<
    BottomTabScreenProps<TabsParamList, "TicketsTab">,
    NativeStackScreenProps<RootStackParamList>
  >
>;

export function TicketsListScreen({ navigation }: Props) {
  const config = useMemo(() => getAppConfig(), []);
  const { session } = useAuth();

  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/tickets",
    });
  }, [config, session]);

  const [items, setItems] = useState<TicketListItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const loadPage = useCallback(
    async ({ pageToLoad, replace }: { pageToLoad: number; replace: boolean }) => {
      if (!client || !session) return;
      setError(null);
      const result = await listTickets(client, {
        apiKey: session.accessToken,
        page: pageToLoad,
        limit: 25,
        search: search || undefined,
      });
      if (!result.ok) {
        logger.warn("Ticket list fetch failed", { error: result.error });
        setError("Unable to load tickets. Please try again.");
        return;
      }

      const nextItems = result.data.data;
      setItems((prev) => (replace ? nextItems : [...prev, ...nextItems]));
      setPage(result.data.pagination.page);
      setHasNext(result.data.pagination.hasNext);
    },
    [client, search, session],
  );

  const { refreshing, refresh } = usePullToRefresh(async () => {
    await loadPage({ pageToLoad: 1, replace: true });
  });

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
  }, [client, loadPage, session, search]);

  const onEndReached = async () => {
    if (!client || !session) return;
    if (initialLoading || refreshing || loadingMore) return;
    if (!hasNext) return;
    setLoadingMore(true);
    try {
      await loadPage({ pageToLoad: page + 1, replace: false });
    } finally {
      setLoadingMore(false);
    }
  };

  if (!config.ok) {
    return <ErrorState title="Configuration error" description={config.error} />;
  }

  if (!session) {
    return <ErrorState title="Signed out" description="Please sign in again." />;
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

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.ticket_id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      contentContainerStyle={{ padding: spacing.lg, backgroundColor: colors.background }}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.4}
      ListHeaderComponent={
        <View style={{ marginBottom: spacing.md }}>
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
      }
      renderItem={({ item }) => (
        <TicketRow
          item={item}
          onPress={() => navigation.navigate("TicketDetail", { ticketId: item.ticket_id })}
        />
      )}
      ListFooterComponent={
        loadingMore ? (
          <View style={{ paddingVertical: spacing.lg, alignItems: "center" }}>
            <ActivityIndicator />
          </View>
        ) : null
      }
    />
  );
}

function TicketRow({ item, onPress }: { item: TicketListItem; onPress: () => void }) {
  const updated = item.updated_at ?? item.entered_at;
  const updatedLabel = updated ? new Date(updated).toLocaleDateString() : "";
  const status = item.status_name ?? "Unknown";
  const priority = item.priority_name ?? null;

  return (
    <Pressable
      onPress={onPress}
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
        {priority ? (
          <View style={{ width: spacing.sm }} />
        ) : null}
        {priority ? <Badge label={priority} tone={priorityTone(priority)} /> : null}
      </View>

      {item.assigned_to_name ? (
        <Text style={{ ...typography.caption, color: colors.mutedText, marginTop: spacing.sm }}>
          Assigned to {item.assigned_to_name}
        </Text>
      ) : null}
    </Pressable>
  );
}

function priorityTone(priorityName: string): "neutral" | "success" | "warning" | "danger" {
  const normalized = priorityName.trim().toLowerCase();
  if (normalized.includes("high") || normalized.includes("urgent") || normalized.includes("critical")) return "danger";
  if (normalized.includes("medium") || normalized.includes("normal")) return "warning";
  if (normalized.includes("low")) return "success";
  return "neutral";
}
