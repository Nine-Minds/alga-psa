import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TicketPriority } from "../../../api/tickets";
import { useTheme } from "../../../ui/ThemeContext";
import {
  activeTicketNotificationSuppression,
  DEFAULT_TICKET_NOTIFICATION_SUPPRESSION,
  TicketUpdateFooter,
} from "./TicketUpdateFooter";

export function PriorityPickerModal({
  visible,
  loading,
  error,
  priorities,
  currentPriorityId,
  updating,
  updateError,
  onApply,
  onClose,
}: {
  visible: boolean;
  loading: boolean;
  error: string | null;
  priorities: TicketPriority[];
  currentPriorityId: string | null;
  updating: boolean;
  updateError: string | null;
  onApply: (priorityId: string, notificationSuppression: ReturnType<typeof activeTicketNotificationSuppression>) => void;
  onClose: () => void;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
  const busy = loading || updating;
  const [selectedPriorityId, setSelectedPriorityId] = useState<string | null>(currentPriorityId);
  const [suppression, setSuppression] = useState(DEFAULT_TICKET_NOTIFICATION_SUPPRESSION);

  useEffect(() => {
    if (!visible) return;
    setSelectedPriorityId(currentPriorityId);
    setSuppression(DEFAULT_TICKET_NOTIFICATION_SUPPRESSION);
  }, [currentPriorityId, visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
        <Text style={{ ...typography.title, color: colors.text }}>{t("priorityPicker.title")}</Text>
        {busy ? (
          <View style={{ marginTop: spacing.lg, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.textSecondary }}>
              {loading ? t("common:loading") : t("common:saving")}
            </Text>
          </View>
        ) : null}
        {error ? (
          <Text style={{ ...typography.caption, marginTop: spacing.md, color: colors.danger }}>
            {error}
          </Text>
        ) : null}
        {updateError ? (
          <Text style={{ ...typography.caption, marginTop: spacing.md, color: colors.danger }}>
            {updateError}
          </Text>
        ) : null}

        <View style={{ marginTop: spacing.lg }}>
          {priorities.map((p) => {
            const isSelected = p.priority_id === selectedPriorityId;
            const disabled = busy;
            return (
              <Pressable
                key={p.priority_id}
                accessibilityRole="button"
                accessibilityLabel={t("priorityPicker.setPriority", { name: p.priority_name })}
                disabled={disabled}
                onPress={() => setSelectedPriorityId(p.priority_id)}
                style={({ pressed }) => ({
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.md,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: isSelected ? colors.primary : colors.border,
                  backgroundColor: colors.card,
                  opacity: disabled ? 0.65 : pressed ? 0.95 : 1,
                  marginBottom: spacing.sm,
                })}
              >
                <Text style={{ ...typography.body, color: colors.text }}>
                  {p.priority_name}
                  {isSelected ? " ✓" : ""}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ flex: 1 }} />
        <TicketUpdateFooter
          suppression={suppression}
          onSuppressionChange={setSuppression}
          onCancel={onClose}
          onApply={() => {
            if (selectedPriorityId) onApply(selectedPriorityId, activeTicketNotificationSuppression(suppression));
          }}
          applyLabel={t("priorityPicker.apply", "Change priority")}
          applyDisabled={!selectedPriorityId || selectedPriorityId === currentPriorityId}
          busy={busy}
        />
      </View>
    </Modal>
  );
}
