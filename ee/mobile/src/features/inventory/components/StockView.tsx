import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../../../ui/ThemeContext";
import { Badge, ListRow, SearchBar, Separator } from "../../../ui/components";
import { EmptyState, ErrorState, LoadingState } from "../../../ui/states";
import { listStockLevels, type StockLevelRow } from "../../../api/inventory";
import { useInventoryApi } from "../hooks/useInventoryApi";
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";
import { useAppResume } from "../../../hooks/useAppResume";
import type { RootStackParamList } from "../../../navigation/types";

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 30;

type AggregatedProduct = {
  service_id: string;
  service_name?: string;
  sku?: string | null;
  onHand: number;
  available: number;
  lowStock: boolean;
};

function aggregateByProduct(rows: StockLevelRow[]): AggregatedProduct[] {
  const byProduct = new Map<string, AggregatedProduct>();
  for (const row of rows) {
    const existing = byProduct.get(row.service_id);
    if (existing) {
      existing.onHand += row.quantity_on_hand;
      existing.available += row.available;
      existing.lowStock = existing.lowStock || row.is_low_stock === true;
    } else {
      byProduct.set(row.service_id, {
        service_id: row.service_id,
        service_name: row.service_name,
        sku: row.sku,
        onHand: row.quantity_on_hand,
        available: row.available,
        lowStock: row.is_low_stock === true,
      });
    }
  }
  return [...byProduct.values()];
}

export function StockView() {
  const theme = useTheme();
  const { t } = useTranslation("inventory");
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { client, apiKey } = useInventoryApi();
  const [rows, setRows] = useState<StockLevelRow[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "no-access">("loading");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPage = useCallback(
    async (nextPage: number, replace: boolean, searchTerm: string) => {
      if (!client || !apiKey) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      if (replace) setStatus("loading");
      const result = await listStockLevels(client, {
        apiKey,
        page: nextPage,
        limit: PAGE_SIZE,
        search: searchTerm || undefined,
        signal: controller.signal,
      });
      if (!result.ok) {
        if (result.error.kind === "canceled") return;
        setStatus(result.error.kind === "permission" ? "no-access" : "error");
        return;
      }
      setRows((current) => (replace ? result.data.data : [...current, ...result.data.data]));
      setPage(nextPage);
      setHasNext(Boolean(result.data.pagination?.hasNext ?? result.data.data.length === PAGE_SIZE));
      setStatus("ready");
    },
    [client, apiKey],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchPage(1, true, search), SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, fetchPage]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const refetch = useCallback(() => void fetchPage(1, true, search), [fetchPage, search]);
  useAppResume(refetch);
  const { refreshing, refresh } = usePullToRefresh(async () => {
    await fetchPage(1, true, search);
  });

  const products = useMemo(() => aggregateByProduct(rows), [rows]);

  if (status === "no-access") {
    return <EmptyState title={t("common.noAccess", "You don't have access to inventory.")} />;
  }
  if (status === "error") {
    return (
      <ErrorState
        action={
          <Text onPress={refetch} style={{ ...theme.typography.body, color: theme.colors.primary }}>
            {t("common.retry", "Retry")}
          </Text>
        }
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: theme.spacing.md }}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder={t("stock.searchPlaceholder", "Search products or SKU")}
          accessibilityLabel="inventory-stock-search"
        />
      </View>
      {status === "loading" && products.length === 0 ? (
        <LoadingState />
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.service_id}
          ItemSeparatorComponent={Separator}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (hasNext && status === "ready") void fetchPage(page + 1, false, search);
          }}
          ListEmptyComponent={<EmptyState title={t("stock.empty", "No stock-tracked products yet.")} />}
          renderItem={({ item }) => (
            <ListRow
              title={item.service_name ?? item.service_id}
              subtitle={`${t("stock.onHand", "On hand")} ${item.onHand} · ${t("stock.available", "Available")} ${item.available}${item.sku ? ` · ${item.sku}` : ""}`}
              rightContent={item.lowStock ? <Badge label={t("stock.lowStock", "Low stock")} tone="warning" /> : undefined}
              onPress={() =>
                navigation.navigate("StockProductDetail", {
                  serviceId: item.service_id,
                  serviceName: item.service_name,
                })
              }
              accessibilityLabel={`inventory-stock-row-${item.service_id}`}
            />
          )}
        />
      )}
    </View>
  );
}
