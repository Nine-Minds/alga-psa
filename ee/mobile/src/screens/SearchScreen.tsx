import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../ui/ThemeContext";
import { Card } from "../ui/components/Card";
import { SearchBar } from "../ui/components/SearchBar";
import { ErrorState } from "../ui/states";
import { useAuth } from "../auth/AuthContext";
import { useCapabilities } from "../capabilities/CapabilitiesContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import {
  routeForResult,
  search as runSearch,
  searchableTypes,
  SEARCHABLE_TYPES,
  type SearchResult,
  type SearchableType,
} from "../api/search";
import {
  nextRecentSearches,
  readRecentSearches,
  recentSearchesKey,
  writeRecentSearches,
} from "../features/search/recentSearches";
import { isOffline as isOfflineStatus } from "../network/isOffline";
import { useNetworkStatus } from "../network/useNetworkStatus";
import { logger } from "../logging/logger";

type Props = NativeStackScreenProps<RootStackParamList, "Search">;

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const PER_GROUP = 5;

export function SearchScreen({ navigation }: Props) {
  const { t } = useTranslation("search");
  const theme = useTheme();
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession } = useAuth();
  const { features } = useCapabilities();
  const network = useNetworkStatus();
  const offline = isOfflineStatus(network);
  const abortRef = useRef<AbortController | null>(null);
  // Every response carries the query it was for; an older one is discarded.
  const latestQueryRef = useRef("");

  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/search",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);

  const apiKey = session?.accessToken;
  const userId = session?.user?.id;
  const types = useMemo(() => searchableTypes(features), [features]);

  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [cursors, setCursors] = useState<Partial<Record<SearchableType, string>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  // Retry has to change something the effect depends on; React bails out of a
  // setState that lands on the same string, so the query alone cannot do it.
  const [retryToken, setRetryToken] = useState(0);

  const storageKey = config.ok && userId ? recentSearchesKey(config.baseUrl, userId) : null;

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!storageKey) return;
    let canceled = false;
    void (async () => {
      const saved = await readRecentSearches(storageKey);
      if (canceled) return;
      setRecent(saved);
    })();
    return () => {
      canceled = true;
    };
  }, [storageKey]);

  useEffect(() => {
    const handle = setTimeout(() => setQuery(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [input]);

  const rememberQuery = useCallback(
    (value: string) => {
      if (!storageKey) return;
      setRecent((current) => {
        const next = nextRecentSearches(current, value);
        void writeRecentSearches(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  useEffect(() => {
    if (!client || !apiKey) return;
    if (query.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setError(false);
      setLoading(false);
      return;
    }
    if (offline) {
      setResults([]);
      setError(true);
      return;
    }

    latestQueryRef.current = query;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    void (async () => {
      setLoading(true);
      setError(false);
      const result = await runSearch(client, {
        apiKey,
        query,
        types,
        limit: PER_GROUP * types.length,
        signal: controller.signal,
      });
      if (controller.signal.aborted || latestQueryRef.current !== query) return;
      setLoading(false);
      if (!result.ok) {
        if (result.error.kind === "canceled") return;
        logger.warn("Search failed", { error: result.error });
        setError(true);
        return;
      }
      const page = result.data.data;
      setResults(page.results ?? []);
      // One combined cursor comes back for the mixed page; each group's More
      // continues from it, narrowed to that type.
      setCursors(
        page.nextCursor
          ? (Object.fromEntries(types.map((type) => [type, page.nextCursor])) as Partial<
              Record<SearchableType, string>
            >)
          : {},
      );
      rememberQuery(query);
    })();

    return () => controller.abort();
  }, [apiKey, client, offline, query, rememberQuery, retryToken, types]);

  const loadMore = useCallback(
    async (type: SearchableType) => {
      if (!client || !apiKey) return;
      const result = await runSearch(client, {
        apiKey,
        query,
        types: [type],
        limit: PER_GROUP,
        cursor: cursors[type],
      });
      if (!result.ok) return;
      const page = result.data.data;
      setResults((current) => [...current, ...(page.results ?? [])]);
      setCursors((current) => ({ ...current, [type]: page.nextCursor ?? undefined }));
    },
    [apiKey, client, cursors, query],
  );

  const open = useCallback(
    (result: SearchResult) => {
      const route = routeForResult(result);
      if (!route) return;
      // The union of screen+params is exact per member, but the navigate()
      // overloads cannot see that through the discriminant.
      (navigation.navigate as (screen: string, params: unknown) => void)(route.screen, route.params);
    },
    [navigation],
  );

  if (!config.ok) {
    return <ErrorState title={t("unableToLoad", "Unable to search.")} description={config.error} />;
  }
  if (!session) {
    return <ErrorState title={t("unableToLoad", "Unable to search.")} />;
  }

  const grouped = SEARCHABLE_TYPES.filter((type) => types.includes(type)).map((type) => ({
    type,
    items: results.filter((result) => result.type === type),
  }));
  const hasResults = grouped.some((group) => group.items.length > 0);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ padding: theme.spacing.lg }}>
        <SearchBar
          value={input}
          onChangeText={setInput}
          autoFocus
          placeholder={t("placeholder", "Search tickets, clients, devices…")}
          accessibilityLabel={t("title", "Search")}
        />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.xxxl }}>
        {query.length < MIN_QUERY_LENGTH ? (
          recent.length > 0 ? (
            <View>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, fontWeight: "700" }}>
                  {t("recent", "Recent searches")}
                </Text>
                <Pressable
                  testID="search-clear-recent"
                  onPress={() => {
                    setRecent([]);
                    if (storageKey) void writeRecentSearches(storageKey, []);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t("clearRecent", "Clear")}
                  hitSlop={8}
                  style={{ marginLeft: "auto" }}
                >
                  <Text style={{ ...theme.typography.caption, color: theme.colors.primary, fontWeight: "700" }}>
                    {t("clearRecent", "Clear")}
                  </Text>
                </Pressable>
              </View>
              <Card style={{ marginTop: theme.spacing.sm, padding: 0 }}>
                {recent.map((entry, index) => (
                  <Pressable
                    key={entry}
                    testID={`search-recent-${index}`}
                    onPress={() => setInput(entry)}
                    accessibilityRole="button"
                    accessibilityLabel={entry}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: theme.spacing.sm,
                      padding: theme.spacing.md,
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: theme.colors.borderLight,
                      opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <Feather name="clock" size={14} color={theme.colors.textSecondary} />
                    <Text style={{ ...theme.typography.body, color: theme.colors.text }}>{entry}</Text>
                  </Pressable>
                ))}
              </Card>
            </View>
          ) : (
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
              {t("minChars", "Keep typing to search.")}
            </Text>
          )
        ) : null}

        {loading ? (
          <View testID="search-loading" style={{ paddingVertical: theme.spacing.lg, alignItems: "center" }}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : null}

        {error ? (
          <View
            testID="search-error"
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: theme.spacing.lg }}
          >
            <Text style={{ ...theme.typography.caption, color: theme.colors.danger }}>
              {offline ? t("offline", "Search needs a connection.") : t("unableToLoad", "Unable to search.")}
            </Text>
            <Pressable
              testID="search-retry"
              onPress={() => setRetryToken((current) => current + 1)}
              accessibilityRole="button"
              accessibilityLabel={t("retry", "Retry")}
              hitSlop={8}
            >
              <Text style={{ ...theme.typography.caption, color: theme.colors.primary, fontWeight: "700" }}>
                {t("retry", "Retry")}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !error && query.length >= MIN_QUERY_LENGTH && !hasResults ? (
          <Text testID="search-empty" style={{ ...theme.typography.body, color: theme.colors.textSecondary }}>
            {t("empty", 'No results for "{{query}}"', { query })}
          </Text>
        ) : null}

        {grouped.map((group) =>
          group.items.length === 0 ? null : (
            <View key={group.type} style={{ marginBottom: theme.spacing.lg }}>
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, fontWeight: "700" }}>
                {t(`groups.${group.type}`, group.type)}
              </Text>
              <Card style={{ marginTop: theme.spacing.sm, padding: 0 }}>
                {group.items.map((result, index) => (
                  <Pressable
                    key={`${result.type}-${result.id}`}
                    testID={`search-result-${result.type}-${result.id}`}
                    onPress={() => open(result)}
                    accessibilityRole="button"
                    accessibilityLabel={result.title}
                    style={({ pressed }) => ({
                      padding: theme.spacing.md,
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: theme.colors.borderLight,
                      opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <Text style={{ ...theme.typography.body, color: theme.colors.text }} numberOfLines={1}>
                      {result.title}
                    </Text>
                    {result.subtitle ? (
                      <Text
                        style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}
                        numberOfLines={1}
                      >
                        {result.subtitle}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </Card>
              {group.items.length >= PER_GROUP ? (
                <Pressable
                  testID={`search-more-${group.type}`}
                  onPress={() => void loadMore(group.type)}
                  accessibilityRole="button"
                  accessibilityLabel={t("more", "More")}
                  hitSlop={8}
                  style={{ marginTop: theme.spacing.sm, alignSelf: "flex-start" }}
                >
                  <Text style={{ ...theme.typography.caption, color: theme.colors.primary, fontWeight: "700" }}>
                    {t("more", "More")}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ),
        )}
      </ScrollView>
    </View>
  );
}
