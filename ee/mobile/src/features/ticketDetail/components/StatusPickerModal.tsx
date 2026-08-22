import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TicketStatus } from "../../../api/tickets";
import { useTheme } from "../../../ui/ThemeContext";
import {
  activeTicketNotificationSuppression,
  DEFAULT_TICKET_NOTIFICATION_SUPPRESSION,
  TicketUpdateFooter,
} from "./TicketUpdateFooter";

export function StatusPickerModal({
  visible,
  loading,
  error,
  updating,
  updateError,
  statuses,
  currentStatusId,
  onApply,
  onClose,
}: {
  visible: boolean;
  loading: boolean;
  error: string | null;
  updating: boolean;
  updateError: string | null;
  statuses: TicketStatus[];
  currentStatusId: string | null | undefined;
  onApply: (statusId: string, notificationSuppression: ReturnType<typeof activeTicketNotificationSuppression>) => void;
  onClose: () => void;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
  const busy = loading || updating;
  const [selectedStatusId, setSelectedStatusId] = useState<string | null>(currentStatusId ?? null);
  const [suppression, setSuppression] = useState(DEFAULT_TICKET_NOTIFICATION_SUPPRESSION);

  useEffect(() => {
    if (!visible) return;
    setSelectedStatusId(currentStatusId ?? null);
    setSuppression(DEFAULT_TICKET_NOTIFICATION_SUPPRESSION);
  }, [currentStatusId, visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={onClose} />
      <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: spacing.xl, maxHeight: "85%" }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, paddingBottom: spacing.sm }}>
          <Text style={{ ...typography.title, color: colors.text }}>{t("statusPicker.title")}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common:close")} hitSlop={12}>
            <Text style={{ ...typography.body, color: colors.primary, fontWeight: "600" }}>{t("common:close")}</Text>
          </Pressable>
        </View>

        {busy ? (
          <View style={{ paddingVertical: spacing.lg, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.textSecondary }}>
              {loading ? t("common:loading") : t("common:saving")}
            </Text>
          </View>
        ) : null}
        {error ? (
          <Text style={{ ...typography.caption, paddingHorizontal: spacing.lg, color: colors.danger }}>
            {error}
          </Text>
        ) : null}
        {updateError ? (
          <Text style={{ ...typography.caption, paddingHorizontal: spacing.lg, color: colors.danger }}>
            {updateError}
          </Text>
        ) : null}

        <ScrollView style={{ paddingHorizontal: spacing.lg }}>
          {statuses.map((s) => (
            <Pressable
              key={s.status_id}
              accessibilityRole="button"
              accessibilityLabel={t("statusPicker.setStatus", { name: s.name })}
              disabled={busy}
              onPress={() => setSelectedStatusId(s.status_id)}
              style={({ pressed }) => ({
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: s.status_id === selectedStatusId ? colors.primary : colors.border,
                backgroundColor: s.status_id === selectedStatusId ? colors.primaryLight ?? colors.card : colors.card,
                opacity: busy ? 0.65 : pressed ? 0.95 : 1,
                marginBottom: spacing.sm,
              })}
            >
              <Text style={{ ...typography.body, color: colors.text }}>
                {s.name}
                {s.status_id === selectedStatusId ? " ✓" : ""}
              </Text>
              <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>
                {s.is_closed ? t("statusPicker.closedLabel") : t("statusPicker.openLabel")}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={{ paddingHorizontal: spacing.lg }}>
          <TicketUpdateFooter
            suppression={suppression}
            onSuppressionChange={setSuppression}
            onCancel={onClose}
            onApply={() => {
              if (!selectedStatusId) return;
              const commit = () => onApply(selectedStatusId, activeTicketNotificationSuppression(suppression));
              if (statuses.find((status) => status.status_id === selectedStatusId)?.is_closed) {
                Alert.alert(
                  t("confirm.closeTitle", "Close this ticket?"),
                  t("confirm.closeMessage", "This changes the ticket to a closed status."),
                  [
                    { text: t("common:cancel"), style: "cancel" },
                    { text: t("confirm.closeAction", "Close ticket"), style: "destructive", onPress: commit },
                  ],
                );
              } else {
                commit();
              }
            }}
            applyLabel={t("statusPicker.apply", "Change status")}
            applyDisabled={!selectedStatusId || selectedStatusId === currentStatusId}
            busy={busy}
          />
        </View>
      </View>
    </Modal>
  );
}
