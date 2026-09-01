import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { DatePickerField } from "../../../ui/components/DatePickerField";
import { formatDateTimeWithRelative } from "../../../ui/formatters/dateTime";
import { ActionChip } from "./ActionChip";
import {
  activeTicketNotificationSuppression,
  DEFAULT_TICKET_NOTIFICATION_SUPPRESSION,
  TicketUpdateFooter,
} from "./TicketUpdateFooter";

function parseIsoToDate(iso: string | null): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function DueDateModal({
  visible,
  currentDueDateIso,
  updating,
  error,
  onSave,
  onClose,
}: {
  visible: boolean;
  currentDueDateIso: string | null;
  updating: boolean;
  error: string | null;
  onSave: (iso: string | null, notificationSuppression: ReturnType<typeof activeTicketNotificationSuppression>) => void;
  onClose: () => void;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [suppression, setSuppression] = useState(DEFAULT_TICKET_NOTIFICATION_SUPPRESSION);

  // Sync selected date when modal opens or currentDueDateIso changes
  useEffect(() => {
    if (visible) {
      setSelectedDate(parseIsoToDate(currentDueDateIso));
      setSuppression(DEFAULT_TICKET_NOTIFICATION_SUPPRESSION);
    }
  }, [visible, currentDueDateIso]);

  const handleSave = () => {
    if (selectedDate) {
      const d = new Date(selectedDate);
      d.setHours(0, 0, 0, 0);
      onSave(d.toISOString(), activeTicketNotificationSuppression(suppression));
    } else {
      onSave(null, activeTicketNotificationSuppression(suppression));
    }
  };

  const selectInDays = (days: number) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    setSelectedDate(d);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
        <Text style={{ ...typography.title, color: colors.text }}>{t("dueDateModal.title")}</Text>
        <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.textSecondary }}>
          {t("dueDateModal.current", { date: formatDateTimeWithRelative(currentDueDateIso) })}
        </Text>

        {updating ? (
          <View style={{ marginTop: spacing.lg, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.textSecondary }}>
              {t("common:saving")}
            </Text>
          </View>
        ) : null}

        {error ? (
          <Text style={{ ...typography.caption, marginTop: spacing.md, color: colors.danger }}>
            {error}
          </Text>
        ) : null}

        <View style={{ marginTop: spacing.lg }}>
          <Text style={{ ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm }}>
            {t("dueDateModal.setDateLabel")}
          </Text>
          <DatePickerField
            value={selectedDate}
            onChange={(d) => setSelectedDate(d)}
            placeholder={t("dueDateModal.datePlaceholder")}
            disabled={updating}
            clearable
            label={t("dueDateModal.setDateLabel")}
          />
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.lg }}>
          <ActionChip
            label={t("dueDateModal.today")}
            disabled={updating}
            onPress={() => selectInDays(0)}
          />
          <View style={{ width: spacing.sm }} />
          <ActionChip
            label={t("dueDateModal.tomorrow")}
            disabled={updating}
            onPress={() => selectInDays(1)}
          />
          <View style={{ width: spacing.sm }} />
          <ActionChip
            label={t("dueDateModal.plus7Days")}
            disabled={updating}
            onPress={() => selectInDays(7)}
          />
        </View>

        <View style={{ flex: 1 }} />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common:clear")}
          onPress={() => setSelectedDate(undefined)}
          disabled={updating || !selectedDate}
          style={({ pressed }) => ({ alignSelf: "flex-start", opacity: updating || !selectedDate ? 0.5 : pressed ? 0.8 : 1 })}
        >
          <Text style={{ ...typography.body, color: colors.danger }}>{t("common:clear")}</Text>
        </Pressable>

        <TicketUpdateFooter
          suppression={suppression}
          onSuppressionChange={setSuppression}
          onCancel={onClose}
          onApply={handleSave}
          applyLabel={t("dueDateModal.apply", "Save due date")}
          busy={updating}
        />
      </View>
    </Modal>
  );
}
