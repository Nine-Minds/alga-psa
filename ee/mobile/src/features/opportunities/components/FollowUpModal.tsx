import React, { useCallback, useEffect, useState } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api";
import { createScheduleEntry, type CreateScheduleEntryInput } from "../../../api/schedule";
import { useTheme } from "../../../ui/ThemeContext";
import { useToast } from "../../../ui/toast/ToastProvider";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { TextInput } from "../../../ui/components/TextInput";
import { DatePickerField } from "../../../ui/components/DatePickerField";
import { TimePickerField } from "../../../ui/components/TimePickerField";
import { SecondaryButton } from "./SecondaryButton";
import { combineDateTimeIso } from "../opportunityFormat";
import { serverErrorMessage } from "../opportunityErrors";

export function FollowUpModal({
  visible,
  client,
  apiKey,
  userId,
  dealTitle,
  onClose,
  onScheduled,
}: {
  visible: boolean;
  client: ApiClient | null;
  apiKey: string | null;
  userId: string | null;
  dealTitle: string;
  onClose: () => void;
  onScheduled: () => void;
}) {
  const { t } = useTranslation("opportunities");
  const theme = useTheme();
  const { showToast } = useToast();

  const [title, setTitle] = useState("");
  const [date, setDate] = useState<Date>(() => new Date());
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    // t is stable across renders in production; intentionally not a dependency.
    setTitle(t("followUp.defaultTitle", "Follow up: {{deal}}", { deal: dealTitle }));
    setDate(new Date());
    setStartTime("09:00");
    setEndTime("10:00");
    setSubmitting(false);
    setError(null);
  }, [dealTitle, visible]);

  const startIso = combineDateTimeIso(date, startTime);
  const endIso = combineDateTimeIso(date, endTime);
  const timesValid = Boolean(startIso && endIso && new Date(endIso!).getTime() > new Date(startIso!).getTime());
  const canSubmit = !submitting && title.trim() !== "" && timesValid;

  const handleSubmit = useCallback(async () => {
    if (!client || !apiKey || !startIso || !endIso) return;
    setSubmitting(true);
    setError(null);
    // work_item_type is intentionally omitted: the server maps a missing type to
    // ad_hoc. Sending 'ad_hoc' is not a valid ScheduleWorkItemType.
    const entry: CreateScheduleEntryInput = {
      title: title.trim(),
      scheduled_start: startIso,
      scheduled_end: endIso,
      ...(userId ? { assigned_user_ids: [userId] } : {}),
    };
    const result = await createScheduleEntry(client, { apiKey, entry });
    setSubmitting(false);
    if (!result.ok) {
      setError(serverErrorMessage(result.error, t("errors.generic", "Something went wrong. Please try again.")));
      return;
    }
    showToast({ message: t("followUp.success", "Follow-up scheduled"), tone: "success" });
    onScheduled();
    onClose();
  }, [apiKey, client, endIso, onClose, onScheduled, showToast, startIso, t, title, userId]);

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
          {t("followUp.title", "Schedule follow-up")}
        </Text>

        <View style={{ marginTop: theme.spacing.lg }}>
          <TextInput
            label={t("followUp.titleField", "Title")}
            value={title}
            onChangeText={setTitle}
            disabled={submitting}
            accessibilityLabel={t("followUp.titleField", "Title")}
          />
        </View>

        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.lg }}>
          {t("followUp.date", "Date")}
        </Text>
        <View style={{ marginTop: theme.spacing.sm }}>
          <DatePickerField
            value={date}
            onChange={(next) => {
              if (next) setDate(next);
            }}
            disabled={submitting}
            label={t("followUp.date", "Date")}
          />
        </View>

        <View style={{ flexDirection: "row", gap: theme.spacing.md, marginTop: theme.spacing.lg }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
              {t("followUp.start", "Start")}
            </Text>
            <View style={{ marginTop: theme.spacing.sm }}>
              <TimePickerField
                value={startTime}
                onChange={setStartTime}
                placeholder="HH:MM"
                disabled={submitting}
                label={t("followUp.start", "Start")}
              />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
              {t("followUp.end", "End")}
            </Text>
            <View style={{ marginTop: theme.spacing.sm }}>
              <TimePickerField
                value={endTime}
                onChange={setEndTime}
                placeholder="HH:MM"
                disabled={submitting}
                label={t("followUp.end", "End")}
              />
            </View>
          </View>
        </View>
        {!timesValid ? (
          <Text style={{ ...theme.typography.caption, color: theme.colors.danger, marginTop: theme.spacing.sm }}>
            {t("followUp.invalidTimes", "End time must be after start time.")}
          </Text>
        ) : null}

        {error ? (
          <Text style={{ ...theme.typography.caption, color: theme.colors.danger, marginTop: theme.spacing.md }}>{error}</Text>
        ) : null}

        <View style={{ marginTop: theme.spacing.xl, gap: theme.spacing.sm }}>
          <PrimaryButton
            onPress={() => void handleSubmit()}
            disabled={!canSubmit}
            accessibilityLabel={t("followUp.submit", "Add to calendar")}
          >
            {t("followUp.submit", "Add to calendar")}
          </PrimaryButton>
          <View style={{ flexDirection: "row" }}>
            <SecondaryButton
              testID="follow-up-cancel"
              onPress={onClose}
              disabled={submitting}
              accessibilityLabel={t("common.cancel", "Cancel")}
            >
              {t("common.cancel", "Cancel")}
            </SecondaryButton>
          </View>
        </View>
      </ScrollView>
    </Modal>
  );
}
