import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../ui/ThemeContext";
import { Badge, Card, ListRow, PrimaryButton, Separator } from "../ui/components";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";
import {
  listStockLevels,
  listStockUnits,
  type StockLevelRow,
  type StockUnitSummary,
} from "../api/inventory";
import { useInventoryApi } from "../features/inventory/hooks/useInventoryApi";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "StockProductDetail">;

export function StockProductDetailScreen({ route, navigation }: Props) {
  const { serviceId, serviceName } = route.params;
  const theme = useTheme();
  const { t } = useTranslation("inventory");
  const { client, apiKey } = useInventoryApi();
  const [levels, setLevels] = useState<StockLevelRow[]>([]);
  const [units, setUnits] = useState<StockUnitSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    if (!client || !apiKey) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const [levelsResult, unitsResult] = await Promise.all([
      listStockLevels(client, { apiKey, page: 1, limit: 100, serviceId, signal: controller.signal }),
      listStockUnits(client, { apiKey, page: 1, limit: 50, serviceId, status: "in_stock", signal: controller.signal }),
    ]);
    if (!levelsResult.ok) {
      if (levelsResult.error.kind !== "canceled") setStatus("error");
      return;
    }
    setLevels(levelsResult.data.data);
    setUnits(unitsResult.ok ? unitsResult.data.data : []);
    setStatus("ready");
  }, [client, apiKey, serviceId]);

  useEffect(() => {
    void fetchData();
    return () => abortRef.current?.abort();
  }, [fetchData]);

  if (status === "loading") return <LoadingState />;
  if (status === "error") {
    return (
      <ErrorState
        action={
          <Text onPress={() => void fetchData()} style={{ ...theme.typography.body, color: theme.colors.primary }}>
            {t("common.retry", "Retry")}
          </Text>
        }
      />
    );
  }

  const isSerialized = units.length > 0;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: theme.spacing.md, gap: theme.spacing.md }}>
      <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
        {serviceName ?? levels[0]?.service_name ?? serviceId}
      </Text>
      <Card>
        <Text style={{ ...theme.typography.body, color: theme.colors.text, fontWeight: "600", marginBottom: theme.spacing.sm }}>
          {t("stock.byLocation", "By location")}
        </Text>
        {levels.length === 0 ? (
          <EmptyState title={t("stock.empty", "No stock-tracked products yet.")} />
        ) : (
          levels.map((level, index) => (
            <View key={`${level.location_id}`}>
              {index > 0 ? <Separator /> : null}
              <ListRow
                title={level.location_name ?? level.location_id}
                subtitle={`${t("stock.onHand", "On hand")} ${level.quantity_on_hand} · ${t("stock.available", "Available")} ${level.available}`}
                rightContent={level.is_low_stock ? <Badge label={t("stock.lowStock", "Low stock")} tone="warning" /> : undefined}
              />
            </View>
          ))
        )}
      </Card>
      {isSerialized ? (
        <Card>
          <Text style={{ ...theme.typography.body, color: theme.colors.text, fontWeight: "600", marginBottom: theme.spacing.sm }}>
            {t("stock.units", "Units")}
          </Text>
          {units.map((unit, index) => (
            <View key={unit.unit_id}>
              {index > 0 ? <Separator /> : null}
              <ListRow
                title={unit.serial_number}
                subtitle={unit.location_name ?? undefined}
                rightContent={<Badge label={t(`unit.statusValues.${unit.status}`, unit.status)} />}
                onPress={() => navigation.navigate("StockUnitDetail", { unitId: unit.unit_id })}
                accessibilityLabel={`inventory-product-unit-${unit.unit_id}`}
              />
            </View>
          ))}
        </Card>
      ) : null}
      <PrimaryButton
        onPress={() => navigation.navigate("InventoryReceive", { serviceId, serviceName, isSerialized })}
        accessibilityLabel="inventory-product-receive"
      >
        {t("receive.title", "Receive stock")}
      </PrimaryButton>
      <Text
        onPress={() => navigation.navigate("InventoryAdjust", { serviceId, serviceName })}
        testID="inventory-product-adjust"
        style={{ ...theme.typography.body, color: theme.colors.primary, textAlign: "center", padding: theme.spacing.sm }}
      >
        {t("adjust.title", "Adjust stock")}
      </Text>
    </ScrollView>
  );
}
