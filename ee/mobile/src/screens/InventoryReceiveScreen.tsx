import React from "react";
import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../ui/ThemeContext";
import { PrimaryButton, TextInput } from "../ui/components";
import { receiveStock } from "../api/inventory";
import { useInventoryApi } from "../features/inventory/hooks/useInventoryApi";
import { LocationPickerField } from "../features/inventory/components/LocationPickerField";
import { SerialAccumulator } from "../features/inventory/components/SerialAccumulator";
import { useToast } from "../ui/toast/ToastProvider";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "InventoryReceive">;

export function InventoryReceiveScreen({ route, navigation }: Props) {
  const { serviceId, serviceName, isSerialized } = route.params ?? {};
  const theme = useTheme();
  const { t } = useTranslation("inventory");
  const { client, apiKey } = useInventoryApi();
  const { showToast } = useToast();
  const [locationId, setLocationId] = useState<string | null>(null);
  const [quantityText, setQuantityText] = useState("1");
  const [unitCostText, setUnitCostText] = useState("");
  const [serials, setSerials] = useState<string[]>([]);
  const [scanningSerials, setScanningSerials] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const quantity = Number.parseInt(quantityText, 10) || 0;
  const serialsSatisfied = !isSerialized || serials.length === quantity;
  const canSubmit = Boolean(serviceId && locationId && quantity > 0 && serialsSatisfied && !submitting);

  const onSubmit = useCallback(async () => {
    if (!client || !apiKey || !serviceId || !locationId) return;
    setSubmitting(true);
    const unitCost = unitCostText.trim() ? Math.round(Number.parseFloat(unitCostText) * 100) : undefined;
    const result = await receiveStock(client, {
      apiKey,
      data: {
        service_id: serviceId,
        location_id: locationId,
        quantity,
        unit_cost: Number.isFinite(unitCost) ? unitCost : undefined,
        serials: isSerialized ? serials.map((serial) => ({ serial_number: serial })) : undefined,
      },
    });
    setSubmitting(false);
    if (result.ok) {
      showToast({ tone: "success", message: t("receive.success", "Stock received") });
      navigation.goBack();
    } else if (result.error.kind === "permission") {
      showToast({ tone: "error", message: t("adjust.noAccess", "You can't adjust stock at this location.") });
    } else {
      showToast({ tone: "error", message: result.error.message ?? t("scan.lookupFailed", "Lookup failed. Try again.") });
    }
  }, [client, apiKey, serviceId, locationId, quantity, unitCostText, isSerialized, serials, showToast, t, navigation]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: theme.spacing.md, gap: theme.spacing.md }}>
      <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
        {serviceName ?? t("receive.product", "Product")}
      </Text>
      <View style={{ gap: theme.spacing.xs }}>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{t("receive.location", "Location")}</Text>
        <LocationPickerField value={locationId} onChange={setLocationId} testID="inventory-receive-location" />
      </View>
      <View style={{ gap: theme.spacing.xs }}>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{t("receive.quantity", "Quantity")}</Text>
        <TextInput
          value={quantityText}
          onChangeText={setQuantityText}
          keyboardType="number-pad"
          accessibilityLabel="inventory-receive-quantity"
        />
      </View>
      <View style={{ gap: theme.spacing.xs }}>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{t("receive.unitCost", "Unit cost")}</Text>
        <TextInput
          value={unitCostText}
          onChangeText={setUnitCostText}
          keyboardType="decimal-pad"
          placeholder="0.00"
          accessibilityLabel="inventory-receive-unit-cost"
        />
      </View>
      {isSerialized ? (
        <View style={{ gap: theme.spacing.xs }}>
          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
            {t("receive.serialsProgress", "{{count}} of {{total}} serials", { count: serials.length, total: quantity })}
          </Text>
          <PrimaryButton onPress={() => setScanningSerials(true)} accessibilityLabel="inventory-receive-scan-serials">
            {t("receive.scanSerials", "Scan serials")}
          </PrimaryButton>
        </View>
      ) : null}
      <PrimaryButton onPress={() => void onSubmit()} disabled={!canSubmit} accessibilityLabel="inventory-receive-submit">
        {t("receive.submit", "Receive")}
      </PrimaryButton>
      <SerialAccumulator
        visible={scanningSerials}
        target={quantity > 0 ? quantity : undefined}
        initialSerials={serials}
        onDone={(captured) => {
          setSerials(captured);
          setScanningSerials(false);
        }}
        onCancel={() => setScanningSerials(false)}
      />
    </ScrollView>
  );
}
