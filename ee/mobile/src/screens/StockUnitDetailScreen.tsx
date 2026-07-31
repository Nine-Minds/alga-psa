import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../ui/ThemeContext";
import { Badge, Card, Separator } from "../ui/components";
import { ErrorState, LoadingState } from "../ui/states";
import { getStockUnit, type StockUnitDetail } from "../api/inventory";
import { useInventoryApi } from "../features/inventory/hooks/useInventoryApi";
import { formatDateTime } from "../ui/formatters/dateTime";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "StockUnitDetail">;

function FieldRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: theme.spacing.xs }}>
      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{label}</Text>
      <Text style={{ ...theme.typography.body, color: theme.colors.text, flexShrink: 1, textAlign: "right" }}>{value}</Text>
    </View>
  );
}

export function StockUnitDetailScreen({ route }: Props) {
  const { unitId } = route.params;
  const theme = useTheme();
  const { t } = useTranslation("inventory");
  const { client, apiKey } = useInventoryApi();
  const [unit, setUnit] = useState<StockUnitDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const abortRef = useRef<AbortController | null>(null);

  const fetchUnit = useCallback(async () => {
    if (!client || !apiKey) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const result = await getStockUnit(client, { apiKey, unitId, signal: controller.signal });
    if (!result.ok) {
      if (result.error.kind !== "canceled") setStatus("error");
      return;
    }
    setUnit(result.data.data);
    setStatus("ready");
  }, [client, apiKey, unitId]);

  useEffect(() => {
    void fetchUnit();
    return () => abortRef.current?.abort();
  }, [fetchUnit]);

  if (status === "loading") return <LoadingState />;
  if (status === "error" || !unit) {
    return (
      <ErrorState
        action={
          <Text onPress={() => void fetchUnit()} style={{ ...theme.typography.body, color: theme.colors.primary }}>
            {t("common.retry", "Retry")}
          </Text>
        }
      />
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: theme.spacing.md, gap: theme.spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
        <Text style={{ ...theme.typography.title, color: theme.colors.text, flex: 1 }}>
          {unit.service_name ?? unit.serial_number}
        </Text>
        <Badge label={t(`unit.statusValues.${unit.status}`, unit.status)} />
      </View>
      <Card>
        <FieldRow label={t("unit.serial", "Serial")} value={unit.serial_number} />
        {unit.mac_address ? <FieldRow label={t("unit.mac", "MAC")} value={unit.mac_address} /> : null}
        {unit.location_name ? <FieldRow label={t("unit.location", "Location")} value={unit.location_name} /> : null}
        {unit.client_name ? <FieldRow label={t("unit.client", "Client")} value={unit.client_name} /> : null}
        <FieldRow
          label={t("unit.warranty", "Warranty")}
          value={
            unit.warranty_expires_at
              ? t("unit.warrantyUntil", "Until {{date}}", { date: unit.warranty_expires_at.slice(0, 10) })
              : t("unit.noWarranty", "No warranty on record")
          }
        />
      </Card>
      <Card>
        <Text style={{ ...theme.typography.body, color: theme.colors.text, fontWeight: "600", marginBottom: theme.spacing.sm }}>
          {t("unit.history", "History")}
        </Text>
        {unit.movements.map((movement, index) => (
          <View key={movement.movement_id}>
            {index > 0 ? <Separator /> : null}
            <View style={{ paddingVertical: theme.spacing.sm }} testID={`inventory-unit-movement-${movement.movement_id}`}>
              <Text style={{ ...theme.typography.body, color: theme.colors.text }}>
                {movement.movement_type}
                {movement.reason ? ` · ${movement.reason}` : ""}
              </Text>
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
                {formatDateTime(movement.created_at)}
                {movement.performed_by_name ? ` · ${movement.performed_by_name}` : ""}
              </Text>
            </View>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}
