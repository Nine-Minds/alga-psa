import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, RefreshControl, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../../../ui/ThemeContext";
import { Badge, ListRow, Separator } from "../../../ui/components";
import { EmptyState, ErrorState, LoadingState } from "../../../ui/states";
import { listPurchaseOrders, type PurchaseOrderSummary } from "../../../api/inventory";
import { useInventoryApi } from "../hooks/useInventoryApi";
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";
import type { RootStackParamList } from "../../../navigation/types";

const PAGE_SIZE = 30;

export function PosView() {
  const theme = useTheme();
  const { t } = useTranslation("inventory");
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { client, apiKey } = useInventoryApi();
  const [pos, setPos] = useState<PurchaseOrderSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "no-access">("loading");
  const abortRef = useRef<AbortController | null>(null);

  const fetchPos = useCallback(async () => {
    if (!client || !apiKey) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const result = await listPurchaseOrders(client, {
      apiKey,
      page: 1,
      limit: PAGE_SIZE,
      status: "open,partially_received",
      signal: controller.signal,
    });
    if (!result.ok) {
      if (result.error.kind === "canceled") return;
      setStatus(result.error.kind === "permission" ? "no-access" : "error");
      return;
    }
    setPos(result.data.data);
    setStatus("ready");
  }, [client, apiKey]);

  useEffect(() => {
    void fetchPos();
    return () => abortRef.current?.abort();
  }, [fetchPos]);

  const { refreshing, refresh } = usePullToRefresh(fetchPos);

  if (status === "no-access") {
    return <EmptyState title={t("common.noAccess", "You don't have access to inventory.")} />;
  }
  if (status === "error") {
    return (
      <ErrorState
        action={
          <Text onPress={() => void fetchPos()} style={{ ...theme.typography.body, color: theme.colors.primary }}>
            {t("common.retry", "Retry")}
          </Text>
        }
      />
    );
  }
  if (status === "loading") return <LoadingState />;

  return (
    <FlatList
      data={pos}
      keyExtractor={(item) => item.po_id}
      ItemSeparatorComponent={Separator}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      ListEmptyComponent={<EmptyState title={t("pos.empty", "No open purchase orders.")} />}
      renderItem={({ item }) => (
        <ListRow
          title={item.po_number}
          subtitle={item.vendor_name ?? undefined}
          rightContent={<Badge label={item.status} tone={item.status === "partially_received" ? "info" : "neutral"} />}
          onPress={() => navigation.navigate("PurchaseOrderDetail", { poId: item.po_id, poNumber: item.po_number })}
          accessibilityLabel={`inventory-po-row-${item.po_id}`}
        />
      )}
    />
  );
}
