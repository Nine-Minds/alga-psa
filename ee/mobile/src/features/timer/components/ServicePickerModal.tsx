import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api";
import { getServices, type ServiceOption } from "../../../api/timeEntries";
import { useTheme } from "../../../ui/ThemeContext";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";

/** One-time service choice before the first timer start; remembered afterwards. */
export function ServicePickerModal({
  visible,
  client,
  apiKey,
  onSelect,
  onClose,
}: {
  visible: boolean;
  client: ApiClient | null;
  apiKey: string | null;
  onSelect: (service: ServiceOption) => void;
  onClose: () => void;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("timeEntries");
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !client || !apiKey || services.length > 0) return;
    let canceled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await getServices(client, { apiKey });
        if (canceled) return;
        if (!result.ok) {
          setError(t("timer.servicePicker.loadError"));
          return;
        }
        setServices(result.data.data);
      } finally {
        if (!canceled) setLoading(false);
      }
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [apiKey, client, services.length, t, visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
        <Text style={{ ...typography.title, color: colors.text }}>
          {t("timer.servicePicker.title")}
        </Text>
        <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm }}>
          {t("timer.servicePicker.subtitle")}
        </Text>

        {loading ? (
          <View style={{ marginTop: spacing.xl, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : error ? (
          <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.lg }}>
            {error}
          </Text>
        ) : services.length === 0 ? (
          <Text style={{ ...typography.body, color: colors.textSecondary, marginTop: spacing.lg }}>
            {t("timer.servicePicker.empty")}
          </Text>
        ) : (
          <ScrollView
            style={{
              marginTop: spacing.lg,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
            }}
          >
            {services.map((service, idx) => (
              <Pressable
                key={service.service_id}
                onPress={() => onSelect(service)}
                accessibilityRole="button"
                accessibilityLabel={service.service_name}
                style={({ pressed }) => ({
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.md,
                  borderTopWidth: idx > 0 ? 1 : 0,
                  borderTopColor: colors.border,
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <Text style={{ ...typography.body, color: colors.text }}>
                  {service.service_name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <View style={{ marginTop: spacing.lg }}>
          <PrimaryButton onPress={onClose}>{t("common:cancel")}</PrimaryButton>
        </View>
      </View>
    </Modal>
  );
}
