import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useTheme } from "../../../ui/ThemeContext";
import { Badge, Card, ListRow, PrimaryButton, Separator } from "../../../ui/components";
import { LoadingState } from "../../../ui/states";
import {
  listCountSessions,
  listPurchaseOrders,
  listStockLevels,
  listTransfers,
  type CountSessionSummary,
  type PurchaseOrderSummary,
  type StockLevelRow,
  type StockTransferSummary,
} from "../../../api/inventory";
import { useInventoryApi } from "../hooks/useInventoryApi";
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";
import { useAppResume } from "../../../hooks/useAppResume";
import { formatDateShort } from "../../../ui/formatters/dateTime";
import type { RootStackParamList } from "../../../navigation/types";
import type { InventorySegment } from "../segments";

type HomeData = {
  lowStock: StockLevelRow[];
  pos: PurchaseOrderSummary[];
  transfers: StockTransferSummary[];
  counts: CountSessionSummary[];
};

export function HomeView({ onOpenSegment }: { onOpenSegment: (segment: InventorySegment) => void }) {
  const theme = useTheme();
  const { t } = useTranslation("inventory");
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { client, apiKey } = useInventoryApi();
  const [data, setData] = useState<HomeData | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchAll = useCallback(async () => {
    if (!client || !apiKey) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;
    const [lowStock, pos, transfers, counts] = await Promise.all([
      listStockLevels(client, { apiKey, page: 1, limit: 5, lowStock: true, signal }),
      listPurchaseOrders(client, { apiKey, page: 1, limit: 5, status: "open,partially_received", signal }),
      listTransfers(client, { apiKey, page: 1, limit: 5, status: "dispatched", signal }),
      listCountSessions(client, { apiKey, page: 1, limit: 5, signal }),
    ]);
    if (signal.aborted) return;
    if (!lowStock.ok && lowStock.error.kind === "permission") {
      setNoAccess(true);
      return;
    }
    setData({
      lowStock: lowStock.ok ? lowStock.data.data : [],
      pos: pos.ok ? pos.data.data : [],
      transfers: transfers.ok ? transfers.data.data : [],
      counts: counts.ok ? counts.data.data.filter((session) => session.status === "open") : [],
    });
  }, [client, apiKey]);

  useEffect(() => {
    void fetchAll();
    return () => abortRef.current?.abort();
  }, [fetchAll]);
  useAppResume(useCallback(() => void fetchAll(), [fetchAll]));
  const { refreshing, refresh } = usePullToRefresh(fetchAll);

  if (noAccess) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: theme.spacing.xl }}>
        <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary, textAlign: "center" }}>
          {t("common.noAccess", "You don't have access to inventory.")}
        </Text>
      </View>
    );
  }
  if (!data) return <LoadingState />;

  const sectionTitle = (label: string) => (
    <Text style={{ ...theme.typography.body, color: theme.colors.text, fontWeight: "600", marginBottom: theme.spacing.sm }}>
      {label}
    </Text>
  );

  const nothingNeedsYou =
    data.lowStock.length === 0 && data.pos.length === 0 && data.transfers.length === 0 && data.counts.length === 0;

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: theme.spacing.md, gap: theme.spacing.md, paddingBottom: theme.spacing.xl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      testID="inventory-home"
    >
      <PrimaryButton onPress={() => onOpenSegment("scan")} accessibilityLabel="inventory-home-scan">
        {t("home.scanCta", "Scan a barcode")}
      </PrimaryButton>

      {nothingNeedsYou ? (
        <Card>
          <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary, textAlign: "center" }} testID="inventory-home-empty">
            {t("home.empty", "Nothing needs your attention. Stock is quiet.")}
          </Text>
        </Card>
      ) : null}

      {data.lowStock.length > 0 ? (
        <Card>
          {sectionTitle(t("home.lowStock", "Running low"))}
          {data.lowStock.map((row, index) => (
            <View key={`${row.service_id}-${row.location_id}`}>
              {index > 0 ? <Separator /> : null}
              <ListRow
                title={row.service_name ?? row.service_id}
                subtitle={`${row.location_name ?? ""} · ${t("stock.available", "Available")} ${row.available}${row.reorder_point != null ? ` / ${t("home.reorderAt", "reorder at")} ${row.reorder_point}` : ""}`}
                rightContent={<Badge label={t("stock.lowStock", "Low stock")} tone="warning" />}
                onPress={() =>
                  navigation.navigate("StockProductDetail", { serviceId: row.service_id, serviceName: row.service_name })
                }
                accessibilityLabel={`inventory-home-lowstock-${row.service_id}`}
              />
            </View>
          ))}
        </Card>
      ) : null}

      {data.pos.length > 0 ? (
        <Card>
          {sectionTitle(t("home.arriving", "Arriving"))}
          {data.pos.map((po, index) => (
            <View key={po.po_id}>
              {index > 0 ? <Separator /> : null}
              <ListRow
                title={po.po_number}
                subtitle={`${po.vendor_name ?? ""}${po.expected_date ? ` · ${t("home.expected", "expected")} ${formatDateShort(po.expected_date)}` : ""}`}
                rightContent={
                  <Badge
                    label={po.status === "partially_received" ? t("home.partial", "Partial") : t("home.open", "Open")}
                    tone={po.status === "partially_received" ? "info" : "neutral"}
                  />
                }
                onPress={() => navigation.navigate("PurchaseOrderDetail", { poId: po.po_id, poNumber: po.po_number })}
                accessibilityLabel={`inventory-home-po-${po.po_id}`}
              />
            </View>
          ))}
        </Card>
      ) : null}

      {data.transfers.length > 0 ? (
        <Card>
          {sectionTitle(t("home.inTransit", "In transit to you"))}
          {data.transfers.map((transfer, index) => (
            <View key={transfer.transfer_id}>
              {index > 0 ? <Separator /> : null}
              <ListRow
                title={transfer.to_location_name ?? transfer.to_location_id}
                subtitle={t("transfers.from", "From {{location}}", {
                  location: transfer.from_location_name ?? transfer.from_location_id,
                })}
                rightContent={<MaterialCommunityIcons name="truck-delivery-outline" size={20} color={theme.colors.textSecondary} />}
                onPress={() => onOpenSegment("transfers")}
                accessibilityLabel={`inventory-home-transfer-${transfer.transfer_id}`}
              />
            </View>
          ))}
        </Card>
      ) : null}

      {data.counts.length > 0 ? (
        <Card>
          {sectionTitle(t("home.countsInProgress", "Counts in progress"))}
          {data.counts.map((session, index) => (
            <View key={session.session_id}>
              {index > 0 ? <Separator /> : null}
              <ListRow
                title={session.location_name ?? session.location_id}
                subtitle={session.created_at ? formatDateShort(session.created_at) : undefined}
                rightContent={<Badge label={t("counts.status.open", "Open")} tone="warning" />}
                onPress={() =>
                  navigation.navigate("CountSession", { sessionId: session.session_id, locationName: session.location_name })
                }
                accessibilityLabel={`inventory-home-count-${session.session_id}`}
              />
            </View>
          ))}
        </Card>
      ) : null}

      <Text
        onPress={() => navigation.navigate("InventoryReceive", undefined)}
        testID="inventory-home-receive"
        style={{ ...theme.typography.body, color: theme.colors.primary, textAlign: "center", padding: theme.spacing.sm }}
      >
        {t("receive.title", "Receive stock")}
      </Text>
    </ScrollView>
  );
}
