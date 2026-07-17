import React from "react";
import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../ui/ThemeContext";
import { PrimaryButton, TextInput } from "../ui/components";
import { adjustStock } from "../api/inventory";
import { useInventoryApi } from "../features/inventory/hooks/useInventoryApi";
import { LocationPickerField } from "../features/inventory/components/LocationPickerField";
import { useToast } from "../ui/toast/ToastProvider";
import { sanitizeSignedQuantityInput } from "../features/inventory/numericInput";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "InventoryAdjust">;

export function InventoryAdjustScreen({ route, navigation }: Props) {
  const { serviceId, serviceName } = route.params ?? {};
  const theme = useTheme();
  const { t } = useTranslation("inventory");
  const { client, apiKey } = useInventoryApi();
  const { showToast } = useToast();
  const [locationId, setLocationId] = useState<string | null>(null);
  const [deltaText, setDeltaText] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [noAccess, setNoAccess] = useState(false);

  const delta = Number.parseInt(deltaText, 10);
  const canSubmit = Boolean(serviceId && locationId && Number.isFinite(delta) && delta !== 0 && reason.trim() && !submitting);

  const onSubmit = useCallback(async () => {
    if (!client || !apiKey || !serviceId || !locationId || !reason.trim()) return;
    setSubmitting(true);
    const result = await adjustStock(client, {
      apiKey,
      data: {
        service_id: serviceId,
        location_id: locationId,
        quantity_delta: delta,
        reason: reason.trim(),
      },
    });
    setSubmitting(false);
    if (result.ok) {
      showToast({ tone: "success", message: t("adjust.success", "Stock adjusted") });
      navigation.goBack();
    } else if (result.error.kind === "permission") {
      setNoAccess(true);
    } else {
      showToast({ tone: "error", message: result.error.message ?? t("scan.lookupFailed", "Lookup failed. Try again.") });
    }
  }, [client, apiKey, serviceId, locationId, delta, reason, showToast, t, navigation]);

  if (noAccess) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: theme.spacing.xl }}>
        <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary, textAlign: "center" }} testID="inventory-adjust-no-access">
          {t("adjust.noAccess", "You can't adjust stock at this location.")}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: theme.spacing.md, gap: theme.spacing.md }}>
      <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
        {serviceName ?? t("adjust.title", "Adjust stock")}
      </Text>
      <View style={{ gap: theme.spacing.xs }}>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{t("receive.location", "Location")}</Text>
        <LocationPickerField value={locationId} onChange={setLocationId} testID="inventory-adjust-location" />
      </View>
      <View style={{ gap: theme.spacing.xs }}>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{t("adjust.quantity", "Adjustment (+/-)")}</Text>
        <TextInput
          value={deltaText}
          onChangeText={(text) => setDeltaText(sanitizeSignedQuantityInput(text))}
          keyboardType="numbers-and-punctuation"
          placeholder="-1"
          accessibilityLabel="inventory-adjust-delta"
        />
      </View>
      <View style={{ gap: theme.spacing.xs }}>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{t("adjust.reason", "Reason")}</Text>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder={t("adjust.reasonRequired", "A reason is required")}
          accessibilityLabel="inventory-adjust-reason"
        />
      </View>
      <PrimaryButton onPress={() => void onSubmit()} disabled={!canSubmit} accessibilityLabel="inventory-adjust-submit">
        {t("adjust.submit", "Adjust")}
      </PrimaryButton>
    </ScrollView>
  );
}
