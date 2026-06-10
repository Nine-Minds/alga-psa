import type { CompositeScreenProps } from "@react-navigation/native";
import type { DrawerScreenProps } from "@react-navigation/drawer";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { Avatar } from "../ui/components/Avatar";
import { Badge } from "../ui/components/Badge";
import type { DrawerParamList, RootStackParamList } from "../navigation/types";
import { useAppResume } from "../hooks/useAppResume";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import { listClients, type ClientListItem } from "../api/clients";
import { useTheme } from "../ui/ThemeContext";
import type { Theme } from "../ui/themes";
import { logger } from "../logging/logger";

type Props = CompositeScreenProps<
  DrawerScreenProps<DrawerParamList, "ClientsTab">,
  NativeStackScreenProps<RootStackParamList>
>;

const SEARCH_DEBOUNCE_MS = 300;
const NEXT_PAGE_PREFETCH_THRESHOLD = 0.6;

export function ClientsListScreen({ navigation }: Props) {
  const { t } = useTranslation("clients");
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
      getUserAgentTag: () => "mobile/clients",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);

  const [items, setItems] = useState<ClientListItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    return () => {
      listAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const loadPage = useCallback(
    async ({ pageToLoad, replace }: { pageToLoad: number; replace: boolean }) => {
      if (!client || !session) return;
      setError(null);
      setNoAccess(false);

      listAbortRef.current?.abort();
      const abortController = new AbortController();
      listAbortRef.current = abortController;

      const result = await listClients(client, {
        apiKey: session.accessToken,
        page: pageToLoad,
        limit: 25,
        search: search || undefined,
        signal: abortController.signal,
      });

      if (listAbortRef.current === abortController) {
        listAbortRef.current = null;
      }
      if (abortController.signal.aborted) return;

      if (!result.ok) {
        if (result.error.kind === "canceled") return;
        logger.warn("Client list fetch failed", { error: result.error });
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
    [client, search, session, t],
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

  const onPressClient = useCallback(
    (clientId: string, clientName: string) => {
      navigation.navigate("ClientDetail", { clientId, clientName });
    },
    [navigation],
  );

  const keyExtractor = useCallback((item: ClientListItem) => item.client_id, []);

  const renderItem = useCallback(
    ({ item }: { item: ClientListItem }) => (
      <ClientRow
        item={item}
        baseUrl={config.ok ? config.baseUrl : null}
        apiKey={session?.accessToken ?? null}
        onPressClient={onPressClient}
      />
    ),
    [config, onPressClient, session?.accessToken],
  );

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
    return <LoadingState message={t("list.loadingClients")} />;
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

  const header = (
    <View style={{ marginBottom: theme.spacing.md }}>
      <ClientSearchField
        theme={theme}
        value={searchInput}
        onChangeText={setSearchInput}
        onClear={() => setSearchInput("")}
        placeholder={t("list.searchPlaceholder")}
        accessibilityLabel={t("list.searchAccessibility")}
      />
    </View>
  );

  if (!error && items.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={{ padding: theme.spacing.lg }}>{header}</View>
        {search ? (
          <EmptyState title={t("list.noResults")} description={t("list.noResultsDescription")} />
        ) : (
          <EmptyState
            title={t("list.noClients")}
            description={t("list.noClientsDescription")}
            action={<PrimaryButton onPress={() => void refresh()}>{t("common:refresh")}</PrimaryButton>}
          />
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={items}
        keyExtractor={keyExtractor}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={{ padding: theme.spacing.lg, backgroundColor: theme.colors.background }}
        onEndReached={onEndReached}
        onEndReachedThreshold={NEXT_PAGE_PREFETCH_THRESHOLD}
        ListHeaderComponent={header}
        renderItem={renderItem}
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
        updateCellsBatchingPeriod={50}
        windowSize={7}
      />
    </View>
  );
}

const ClientRow = memo(function ClientRow({
  item,
  baseUrl,
  apiKey,
  onPressClient,
}: {
  item: ClientListItem;
  baseUrl: string | null;
  apiKey: string | null;
  onPressClient: (clientId: string, clientName: string) => void;
}) {
  const { t } = useTranslation("clients");
  const theme = useTheme();
  const clientId = item.client_id;
  const clientName = item.client_name;
  const handlePress = useCallback(() => onPressClient(clientId, clientName), [clientId, clientName, onPressClient]);

  const snippet = [item.phone_no, item.email].filter(Boolean).join(" • ");
  const imageUri = item.logoUrl && baseUrl ? `${baseUrl}${item.logoUrl}` : null;

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={t("list.clientAccessibility", { name: clientName })}
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
      <Avatar name={clientName} imageUri={imageUri} authToken={apiKey} size="md" />
      <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
        <Text style={{ ...theme.typography.body, color: theme.colors.text }} numberOfLines={1}>
          {clientName}
        </Text>
        {snippet ? (
          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }} numberOfLines={1}>
            {snippet}
          </Text>
        ) : null}
        {item.is_inactive ? (
          <View style={{ marginTop: theme.spacing.xs }}>
            <Badge label={t("detail.inactive")} tone="warning" />
          </View>
        ) : null}
      </View>
      <Feather name="chevron-right" size={18} color={theme.colors.textSecondary} />
    </Pressable>
  );
});

function ClientSearchField({
  theme,
  value,
  onChangeText,
  onClear,
  placeholder,
  accessibilityLabel,
}: {
  theme: Theme;
  value: string;
  onChangeText: (text: string) => void;
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
      <Feather name="search" size={16} color={theme.colors.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        returnKeyType="search"
        placeholder={placeholder}
        placeholderTextColor={theme.colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={accessibilityLabel}
        style={{
          flex: 1,
          paddingVertical: theme.spacing.sm,
          marginLeft: theme.spacing.sm,
          color: theme.colors.text,
        }}
      />
      {value.length > 0 ? (
        <Pressable
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
