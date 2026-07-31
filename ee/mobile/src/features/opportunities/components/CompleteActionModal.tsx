import React, { useCallback, useEffect, useState } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api";
import { completeNextAction } from "../../../api/opportunities";
import { useTheme } from "../../../ui/ThemeContext";
import { useToast } from "../../../ui/toast/ToastProvider";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { TextInput } from "../../../ui/components/TextInput";
import { DatePickerField } from "../../../ui/components/DatePickerField";
import { TimePickerField } from "../../../ui/components/TimePickerField";
import { SecondaryButton } from "./SecondaryButton";
import { combineDateTimeIso } from "../opportunityFormat";
import { serverErrorMessage } from "../opportunityErrors";

export function CompleteActionModal({
  visible,
  currentAction,
  client,
  apiKey,
  opportunityId,
  onClose,
  onCompleted,
}: {
  visible: boolean;
  currentAction?: string | null;
  client: ApiClient | null;
  apiKey: string | null;
  opportunityId: string;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const { t } = useTranslation("opportunities");
  const theme = useTheme();
  const { showToast } = useToast();

  const [nextAction, setNextAction] = useState("");
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [dueTime, setDueTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setNextAction("");
      setDueDate(undefined);
      setDueTime("");
      setSubmitting(false);
      setError(null);
    }
  }, [visible]);

  const dueIso = combineDateTimeIso(dueDate, dueTime);
  const canSubmit = !submitting && nextAction.trim() !== "" && dueIso !== null;

  const handleSubmit = useCallback(async () => {
    if (!client || !apiKey || !dueIso || nextAction.trim() === "") return;
    setSubmitting(true);
    setError(null);
    const result = await completeNextAction(client, {
      apiKey,
      opportunityId,
      data: { next_action: nextAction.trim(), next_action_due: dueIso },
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(serverErrorMessage(result.error, t("errors.generic", "Something went wrong. Please try again.")));
      return;
    }
    showToast({ message: t("completeAction.success", "Action completed"), tone: "success" });
    onCompleted();
    onClose();
  }, [apiKey, client, dueIso, nextAction, onClose, onCompleted, opportunityId, showToast, t]);

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
          {t("completeAction.title", "Complete action")}
        </Text>

        {currentAction ? (
          <View style={{ marginTop: theme.spacing.md }}>
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
              {t("completeAction.completing", "Completing")}
            </Text>
            <Text style={{ ...theme.typography.body, color: theme.colors.text, marginTop: 2 }}>{currentAction}</Text>
          </View>
        ) : null}

        <View style={{ marginTop: theme.spacing.lg }}>
          <TextInput
            label={t("completeAction.nextAction", "Next action")}
            value={nextAction}
            onChangeText={setNextAction}
            placeholder={t("completeAction.whatDidYouDo", "What happened?")}
            helperText={t("completeAction.nextActionRequired", "Every open deal needs a next action.")}
            disabled={submitting}
            accessibilityLabel={t("completeAction.nextAction", "Next action")}
          />
        </View>

        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.lg }}>
          {t("completeAction.dueDate", "Due date")}
        </Text>
        <View style={{ marginTop: theme.spacing.sm }}>
          <DatePickerField
            value={dueDate}
            onChange={setDueDate}
            disabled={submitting}
            label={t("completeAction.dueDate", "Due date")}
          />
        </View>

        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.lg }}>
          {t("completeAction.dueTime", "Time")}
        </Text>
        <View style={{ marginTop: theme.spacing.sm }}>
          <TimePickerField
            value={dueTime}
            onChange={setDueTime}
            placeholder="HH:MM"
            disabled={submitting}
            label={t("completeAction.dueTime", "Time")}
          />
        </View>

        {error ? (
          <Text style={{ ...theme.typography.caption, color: theme.colors.danger, marginTop: theme.spacing.md }}>{error}</Text>
        ) : null}

        <View style={{ marginTop: theme.spacing.xl, gap: theme.spacing.sm }}>
          <PrimaryButton
            onPress={() => void handleSubmit()}
            disabled={!canSubmit}
            accessibilityLabel={t("completeAction.submit", "Complete and set next")}
          >
            {t("completeAction.submit", "Complete and set next")}
          </PrimaryButton>
          <View style={{ flexDirection: "row" }}>
            <SecondaryButton
              testID="complete-action-cancel"
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
