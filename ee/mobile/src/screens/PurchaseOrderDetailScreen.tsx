import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../ui/ThemeContext";
import { Badge, Card, PrimaryButton, Separator, TextInput } from "../ui/components";
import { ErrorState, LoadingState } from "../ui/states";
import {
  getPurchaseOrder,
  receivePurchaseOrderLine,
  type PurchaseOrderLineRow,
  type PurchaseOrderSummary,
} from "../api/inventory";
import { useInventoryApi } from "../features/inventory/hooks/useInventoryApi";
import { SerialAccumulator } from "../features/inventory/components/SerialAccumulator";
import { LocationPickerField } from "../features/inventory/components/LocationPickerField";
import { useToast } from "../ui/toast/ToastProvider";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "PurchaseOrderDetail">;

export function PurchaseOrderDetailScreen({ route }: Props) {
  const { poId } = route.params;
  const theme = useTheme();
  const { t } = useTranslation("inventory");
  const { client, apiKey } = useInventoryApi();
  const { showToast } = useToast();
  const [po, setPo] = useState<PurchaseOrderSummary | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [receivingLine, setReceivingLine] = useState<PurchaseOrderLineRow | null>(null);
  const [quantityText, setQuantityText] = useState("");
  const [scanningLine, setScanningLine] = useState<PurchaseOrderLineRow | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPo = useCallback(async () => {
    if (!client || !apiKey) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const result = await getPurchaseOrder(client, { apiKey, poId, signal: controller.signal });
    if (!result.ok) {
      if (result.error.kind !== "canceled") setStatus("error");
      return;
    }
    setPo(result.data.data);
    setStatus("ready");
  }, [client, apiKey, poId]);

  useEffect(() => {
    void fetchPo();
    return () => abortRef.current?.abort();
  }, [fetchPo]);

  const receiveLine = useCallback(
    async (line: PurchaseOrderLineRow, quantity: number, serials?: string[]) => {
      if (!client || !apiKey) return;
      const remaining = line.quantity_ordered - line.quantity_received;
      const submit = async () => {
        const result = await receivePurchaseOrderLine(client, {
          apiKey,
          poId,
          lineId: line.po_line_id,
          data: {
            quantity,
            location_id: locationId ?? undefined,
            serials: serials?.map((serial) => ({ serial_number: serial })),
          },
        });
        if (result.ok) {
          showToast({ tone: "success", message: t("pos.received", "Received") });
          setReceivingLine(null);
          setScanningLine(null);
          setQuantityText("");
          void fetchPo();
        } else if (result.error.kind === "permission") {
          showToast({ tone: "error", message: t("adjust.noAccess", "You can't adjust stock at this location.") });
        } else {
          showToast({ tone: "error", message: result.error.message ?? t("scan.lookupFailed", "Lookup failed. Try again.") });
        }
      };
      if (quantity > remaining) {
        Alert.alert(t("pos.overReceipt", "This exceeds the remaining quantity on the line."), undefined, [
          { text: t("common.cancel", "Cancel"), style: "cancel" },
          { text: t("pos.receiveLine", "Receive"), onPress: () => void submit() },
        ]);
        return;
      }
      await submit();
    },
    [client, apiKey, poId, locationId, showToast, t, fetchPo],
  );

  if (status === "loading") return <LoadingState />;
  if (status === "error" || !po) {
    return (
      <ErrorState
        action={
          <Text onPress={() => void fetchPo()} style={{ ...theme.typography.body, color: theme.colors.primary }}>
            {t("common.retry", "Retry")}
          </Text>
        }
      />
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: theme.spacing.md, gap: theme.spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
        <Text style={{ ...theme.typography.title, color: theme.colors.text, flex: 1 }}>{po.po_number}</Text>
        <Badge label={po.status} tone={po.status === "partially_received" ? "info" : "neutral"} />
      </View>
      {po.vendor_name ? (
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{po.vendor_name}</Text>
      ) : null}
      <View style={{ gap: theme.spacing.xs }}>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{t("receive.location", "Location")}</Text>
        <LocationPickerField value={locationId} onChange={setLocationId} testID="inventory-po-location" />
      </View>
      <Card>
        {(po.lines ?? []).map((line, index) => {
          const remaining = line.quantity_ordered - line.quantity_received;
          const done = remaining <= 0;
          return (
            <View key={line.po_line_id}>
              {index > 0 ? <Separator /> : null}
              <View style={{ paddingVertical: theme.spacing.sm, gap: theme.spacing.xs }} testID={`inventory-po-line-${line.po_line_id}`}>
                <Text style={{ ...theme.typography.body, color: theme.colors.text, fontWeight: "600" }}>
                  {line.service_name ?? line.service_id}
                </Text>
                <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
                  {t("pos.receivedProgress", "{{received}} of {{ordered}} received", {
                    received: line.quantity_received,
                    ordered: line.quantity_ordered,
                  })}
                  {line.sku ? ` · ${line.sku}` : ""}
                </Text>
                {!done ? (
                  receivingLine?.po_line_id === line.po_line_id && !line.is_serialized ? (
                    <View style={{ flexDirection: "row", gap: theme.spacing.sm, alignItems: "center" }}>
                      <View style={{ flex: 1 }}>
                        <TextInput
                          value={quantityText}
                          onChangeText={setQuantityText}
                          keyboardType="number-pad"
                          placeholder={String(remaining)}
                          accessibilityLabel={`inventory-po-line-qty-${line.po_line_id}`}
                        />
                      </View>
                      <PrimaryButton
                        onPress={() => {
                          const quantity = Number.parseInt(quantityText, 10);
                          if (Number.isFinite(quantity) && quantity > 0) void receiveLine(line, quantity);
                        }}
                        accessibilityLabel={`inventory-po-line-confirm-${line.po_line_id}`}
                      >
                        {t("pos.receiveLine", "Receive")}
                      </PrimaryButton>
                    </View>
                  ) : (
                    <Text
                      onPress={() => {
                        if (line.is_serialized) {
                          setScanningLine(line);
                        } else {
                          setReceivingLine(line);
                          setQuantityText(String(remaining));
                        }
                      }}
                      testID={`inventory-po-line-receive-${line.po_line_id}`}
                      style={{ ...theme.typography.body, color: theme.colors.primary }}
                    >
                      {t("pos.receiveLine", "Receive")}
                    </Text>
                  )
                ) : null}
              </View>
            </View>
          );
        })}
      </Card>
      <SerialAccumulator
        visible={scanningLine !== null}
        target={scanningLine ? scanningLine.quantity_ordered - scanningLine.quantity_received : undefined}
        onDone={(serials) => {
          if (scanningLine) void receiveLine(scanningLine, serials.length, serials);
        }}
        onCancel={() => setScanningLine(null)}
      />
    </ScrollView>
  );
}
