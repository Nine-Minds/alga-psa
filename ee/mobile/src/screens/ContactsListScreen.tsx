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
import type { DrawerParamList, RootStackParamList } from "../navigation/types";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import { buildContactAvatarUri, getContactReachLine, listContacts, type ContactListItem } from "../api/contacts";
import { useTheme } from "../ui/ThemeContext";
import type { Theme } from "../ui/themes";
import { logger } from "../logging/logger";

type Props = CompositeScreenProps<
  DrawerScreenProps<DrawerParamList, "ContactsTab">,
  NativeStackScreenProps<RootStackParamList>
>;

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 350;
const NEXT_PAGE_PREFETCH_THRESHOLD = 0.6;

export function ContactsListScreen({ navigation }: Props) {
  const { t } = useTranslation("contacts");
  const theme = useTheme();
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession } = useAuth();
  const listAbortRef = useRef<AbortController | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingMoreRef = useRef(false);

  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/contacts",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);

  const [items, setItems] = useState<ContactListItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    return () => {
      listAbortRef.current?.abort();
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  const handleSearchChange = useCallback((text: string) => {
    setSearchInput(text);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setSearch(text.trim());
    }, SEARCH_DEBOUNCE_MS);
  }, []);

  const clearSearch = useCallback(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    setSearchInput("");
    setSearch("");
  }, []);

  const loadPage = useCallback(
    async ({ pageToLoad, replace }: { pageToLoad: number; replace: boolean }) => {
      if (!client || !session) return;
      setError(null);
      setNoAccess(false);

      listAbortRef.current?.abort();
      const abortController = new AbortController();
      listAbortRef.current = abortController;

      const result = await listContacts(client, {
        apiKey: session.accessToken,
        page: pageToLoad,
        limit: PAGE_SIZE,
        search: search || undefined,
        signal: abortController.signal,
      });

      if (listAbortRef.current === abortController) {
        listAbortRef.current = null;
      }
      if (abortController.signal.aborted) return;

      if (!result.ok) {
        if (result.error.kind === "canceled") return;
        logger.warn("Contact list fetch failed", { error: result.error });
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

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      if (!client || !session) return;
      setSearching(true);
      await loadPage({ pageToLoad: 1, replace: true });
      if (canceled) return;
      setSearching(false);
      setInitialLoading(false);
      setLoadedOnce(true);
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [client, loadPage, session]);

  const onPressContact = useCallback(
    (contactId: string, contactName: string) => {
      navigation.navigate("ContactDetail", { contactId, contactName });
    },
    [navigation],
  );

  const keyExtractor = useCallback((item: ContactListItem) => item.contact_name_id, []);

  const renderItem = useCallback(
    ({ item }: { item: ContactListItem }) => (
      <ContactRow
        item={item}
        baseUrl={config.ok ? config.baseUrl : null}
        authToken={session?.accessToken}
        onPress={onPressContact}
      />
    ),
    [config, onPressContact, session?.accessToken],
  );

  const onEndReached = useCallback(async () => {
    if (!client || !session) return;
    if (initialLoading || searching || refreshing || loadingMoreRef.current) return;
    if (!hasNext) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      await loadPage({ pageToLoad: page + 1, replace: false });
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [client, hasNext, initialLoading, loadPage, page, refreshing, searching, session]);

  if (!config.ok) {
    return <ErrorState title={t("common:configurationError")} description={config.error} />;
  }

  if (!session) {
    return <ErrorState title={t("common:signedOut")} description={t("common:signInAgain")} />;
  }

  if (noAccess) {
    return <ErrorState title={t("list.noAccess")} description={t("list.noAccessDescription")} />;
  }

  if (initialLoading && !loadedOnce && !error) {
    return <LoadingState message={t("list.loadingContacts")} />;
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
      <SearchField
        theme={theme}
        value={searchInput}
        onChangeText={handleSearchChange}
        onClear={clearSearch}
        placeholder={t("list.searchPlaceholder")}
        accessibilityLabel={t("list.searchAccessibility")}
        searching={searching}
      />
      {error ? (
        <Text style={{ ...theme.typography.caption, color: theme.colors.danger, marginTop: theme.spacing.sm }}>
          {error}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={items}
        keyExtractor={keyExtractor}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={{ padding: theme.spacing.lg, flexGrow: 1, backgroundColor: theme.colors.background }}
        onEndReached={onEndReached}
        onEndReachedThreshold={NEXT_PAGE_PREFETCH_THRESHOLD}
        ListHeaderComponent={header}
        renderItem={renderItem}
        ListEmptyComponent={
          searching ? null : (
            <EmptyState
              title={search ? t("list.noResults") : t("list.noContacts")}
              description={search ? t("list.noResultsDescription") : t("list.noContactsDescription")}
              action={
                search ? (
                  <PrimaryButton onPress={clearSearch}>{t("common:clear")}</PrimaryButton>
                ) : (
                  <PrimaryButton onPress={() => void refresh()}>{t("common:refresh")}</PrimaryButton>
                )
              }
            />
          )
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
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        updateCellsBatchingPeriod={50}
        windowSize={7}
      />
    </View>
  );
}

const ContactRow = memo(function ContactRow({
  item,
  baseUrl,
  authToken,
  onPress,
}: {
  item: ContactListItem;
  baseUrl: string | null;
  authToken?: string;
  onPress: (contactId: string, contactName: string) => void;
}) {
  const { t } = useTranslation("contacts");
  const theme = useTheme();
  const contactId = item.contact_name_id;
  const fullName = item.full_name;
  const handlePress = useCallback(() => onPress(contactId, fullName), [contactId, fullName, onPress]);
  const reachLine = getContactReachLine(item);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={t("list.contactAccessibility", { name: fullName })}
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
      <Avatar
        name={fullName}
        imageUri={buildContactAvatarUri(baseUrl, item.avatarUrl)}
        authToken={authToken}
        size="md"
      />
      <View style={{ marginLeft: theme.spacing.md, flex: 1 }}>
        <Text style={{ ...theme.typography.body, color: theme.colors.text, fontWeight: "600" }} numberOfLines={1}>
          {fullName}
        </Text>
        {item.client_name ? (
          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }} numberOfLines={1}>
            {item.client_name}
          </Text>
        ) : null}
        {reachLine ? (
          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }} numberOfLines={1}>
            {reachLine}
          </Text>
        ) : null}
      </View>
      <Feather name="chevron-right" size={18} color={theme.colors.textSecondary} />
    </Pressable>
  );
});

function SearchField({
  theme,
  value,
  onChangeText,
  onClear,
  placeholder,
  accessibilityLabel,
  searching,
}: {
  theme: Theme;
  value: string;
  onChangeText: (text: string) => void;
  onClear: () => void;
  placeholder: string;
  accessibilityLabel?: string;
  searching: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        borderRadius: theme.borderRadius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.card,
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
      {searching ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : null}
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
