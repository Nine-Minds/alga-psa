import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { DatePickerField } from "../../../ui/components/DatePickerField";
import { formatDateTimeWithRelative } from "../../../ui/formatters/dateTime";
import { ActionChip } from "./ActionChip";

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
  onClear,
  onSave,
  onSetInDays,
  onClose,
}: {
  visible: boolean;
  currentDueDateIso: string | null;
  updating: boolean;
  error: string | null;
  onClear: () => void;
  onSave: (iso: string) => void;
  onSetInDays: (days: number) => void;
  onClose: () => void;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);

  // Sync selected date when modal opens or currentDueDateIso changes
  useEffect(() => {
    if (visible) {
      setSelectedDate(parseIsoToDate(currentDueDateIso));
    }
  }, [visible, currentDueDateIso]);

  const handleSave = () => {
    if (selectedDate) {
      const d = new Date(selectedDate);
      d.setHours(0, 0, 0, 0);
      onSave(d.toISOString());
    }
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
            onPress={() => onSetInDays(0)}
          />
          <View style={{ width: spacing.sm }} />
          <ActionChip
            label={t("dueDateModal.tomorrow")}
            disabled={updating}
            onPress={() => onSetInDays(1)}
          />
          <View style={{ width: spacing.sm }} />
          <ActionChip
            label={t("dueDateModal.plus7Days")}
            disabled={updating}
            onPress={() => onSetInDays(7)}
          />
        </View>

        <View style={{ flex: 1 }} />

        <View style={{ flexDirection: "row" }}>
          <View style={{ flex: 1 }}>
            <PrimaryButton
              onPress={onClear}
              disabled={updating}
            >
              {t("common:clear")}
            </PrimaryButton>
          </View>
          <View style={{ width: spacing.sm }} />
          <View style={{ flex: 1 }}>
            <PrimaryButton
              onPress={handleSave}
              disabled={updating || !selectedDate}
            >
              {t("common:save")}
            </PrimaryButton>
          </View>
        </View>

        <View style={{ marginTop: spacing.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("dueDateModal.closeAccessibility")}
            onPress={onClose}
            disabled={updating}
            style={({ pressed }) => ({ opacity: updating ? 0.5 : pressed ? 0.85 : 1, marginTop: spacing.sm })}
          >
            <Text style={{ ...typography.caption, color: colors.textSecondary, textAlign: "center" }}>
              {t("common:close")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
