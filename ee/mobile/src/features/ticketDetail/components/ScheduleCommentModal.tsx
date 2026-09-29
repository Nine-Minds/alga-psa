import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { DatePickerField } from "../../../ui/components/DatePickerField";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { TimePickerField } from "../../../ui/components/TimePickerField";
import { formatDateTimeWithRelative } from "../../../ui/formatters/dateTime";
import { ActionChip } from "./ActionChip";

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function toHHMM(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Combine a calendar day and an "HH:MM" wall-clock time in the device zone. */
export function combineDateAndTime(day: Date, time: string): Date | null {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const combined = new Date(day);
  combined.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return Number.isNaN(combined.getTime()) ? null : combined;
}

/** Next quarter hour at least an hour out, so the default is always valid. */
export function defaultScheduleTime(now: Date = new Date()): Date {
  const next = new Date(now.getTime() + 60 * 60 * 1000);
  next.setMinutes(Math.ceil(next.getMinutes() / 15) * 15, 0, 0);
  return next;
}

export function ScheduleCommentModal({
  visible,
  initialValue,
  onConfirm,
  onClear,
  onClose,
}: {
  visible: boolean;
  initialValue: Date | null;
  onConfirm: (when: Date) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
  const [day, setDay] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const start = initialValue ?? defaultScheduleTime();
    setDay(new Date(start));
    setTime(toHHMM(start));
    setError(null);
  }, [initialValue, visible]);

  const candidate = useMemo(() => (day ? combineDateAndTime(day, time) : null), [day, time]);

  const selectInDays = (days: number, hour: number) => {
    const next = new Date();
    next.setDate(next.getDate() + days);
    next.setHours(hour, 0, 0, 0);
    setDay(next);
    setTime(toHHMM(next));
    setError(null);
  };

  const confirm = () => {
    if (!candidate || candidate.getTime() <= Date.now()) {
      setError(t("comments.scheduleInPast"));
      return;
    }
    onConfirm(candidate);
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
        <Text style={{ ...typography.title, color: colors.text }}>{t("comments.scheduleTitle")}</Text>
        <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.textSecondary }}>
          {t("comments.scheduleHelper")}
        </Text>

        <View style={{ marginTop: spacing.lg }}>
          <DatePickerField
            value={day}
            onChange={(next) => { setDay(next); setError(null); }}
            label={t("comments.scheduleDate")}
            placeholder={t("comments.scheduleDate")}
            minDate={today}
          />
        </View>
        <View style={{ marginTop: spacing.md }}>
          <TimePickerField
            value={time}
            onChange={(next) => { setTime(next); setError(null); }}
            label={t("comments.scheduleTime")}
            placeholder={t("comments.scheduleTime")}
          />
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg }}>
          <ActionChip label={t("dueDateModal.tomorrow")} onPress={() => selectInDays(1, 9)} />
          <ActionChip label={t("dueDateModal.plus7Days")} onPress={() => selectInDays(7, 9)} />
        </View>

        {candidate ? (
          <Text testID="schedule-comment-preview" style={{ ...typography.caption, marginTop: spacing.lg, color: colors.textSecondary }}>
            {t("comments.publishesAt", { when: formatDateTimeWithRelative(candidate.toISOString()) })}
          </Text>
        ) : null}
        {error ? (
          <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.danger }}>{error}</Text>
        ) : null}

        <View style={{ flex: 1 }} />

        <PrimaryButton onPress={confirm} disabled={!candidate} accessibilityLabel={t("comments.scheduleConfirm")}>
          {t("comments.scheduleConfirm")}
        </PrimaryButton>
        {initialValue ? (
          <Pressable
            onPress={onClear}
            accessibilityRole="button"
            accessibilityLabel={t("comments.scheduleClear")}
            style={{ marginTop: spacing.md, alignItems: "center", padding: spacing.xs }}
          >
            <Text style={{ ...typography.body, color: colors.danger }}>{t("comments.scheduleClear")}</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common:cancel")}
          style={{ marginTop: spacing.sm, alignItems: "center", padding: spacing.xs }}
        >
          <Text style={{ ...typography.body, color: colors.textSecondary }}>{t("common:cancel")}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
