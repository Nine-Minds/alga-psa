import React, { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api";
import {
  completeNextAction,
  completeOpportunityStep,
  type OpportunityStep,
} from "../../../api/opportunities";
import { useTheme } from "../../../ui/ThemeContext";
import { useToast } from "../../../ui/toast/ToastProvider";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { TextInput } from "../../../ui/components/TextInput";
import { DatePickerField } from "../../../ui/components/DatePickerField";
import { TimePickerField } from "../../../ui/components/TimePickerField";
import { Select } from "../../../ui/components/Select";
import { SecondaryButton } from "./SecondaryButton";
import { combineDateTimeIso } from "../opportunityFormat";
import { serverErrorMessage } from "../opportunityErrors";

export function CompleteActionModal({
  visible,
  currentAction,
  currentStep,
  plannedSteps = [],
  client,
  apiKey,
  opportunityId,
  onClose,
  onCompleted,
}: {
  visible: boolean;
  currentAction?: string | null;
  currentStep?: OpportunityStep | null;
  plannedSteps?: OpportunityStep[];
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
  const [nextStepId, setNextStepId] = useState<string | null>(null);
  const [stepPickerOpen, setStepPickerOpen] = useState(false);
  const [writeNew, setWriteNew] = useState(true);
  const [attestCheckpoint, setAttestCheckpoint] = useState(false);
  const firstPlannedStepId = plannedSteps[0]?.step_id ?? null;

  useEffect(() => {
    if (visible) {
      setNextAction("");
      setDueDate(undefined);
      setDueTime("");
      setSubmitting(false);
      setError(null);
      setNextStepId(firstPlannedStepId);
      setWriteNew(firstPlannedStepId === null);
      setAttestCheckpoint(false);
    }
  }, [firstPlannedStepId, visible]);

  const dueIso = combineDateTimeIso(dueDate, dueTime);
  const canSubmit = !submitting && (writeNew ? nextAction.trim() !== "" && dueIso !== null : nextStepId !== null);

  const handleSubmit = useCallback(async () => {
    if (!client || !apiKey || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    const checkpoint = attestCheckpoint && currentStep?.checkpoint && currentStep.checkpoint !== "won"
      ? currentStep.checkpoint
      : null;
    const result = currentStep
      ? await completeOpportunityStep(client, {
          apiKey,
          opportunityId,
          stepId: currentStep.step_id,
          data: writeNew
            ? { next_action: nextAction.trim(), next_action_due: dueIso, checkpoint }
            : { next_step_id: nextStepId, checkpoint },
        })
      : await completeNextAction(client, {
          apiKey,
          opportunityId,
          data: { next_action: nextAction.trim(), next_action_due: dueIso! },
        });
    setSubmitting(false);
    if (!result.ok) {
      setError(serverErrorMessage(result.error, t("errors.generic", "Something went wrong. Please try again.")));
      return;
    }
    showToast({ message: t("completeAction.success", "Action completed"), tone: "success" });
    onCompleted();
    onClose();
  }, [apiKey, attestCheckpoint, canSubmit, client, currentStep, dueIso, nextAction, nextStepId, onClose, onCompleted, opportunityId, showToast, t, writeNew]);

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

        {plannedSteps.length > 0 ? (
          <View style={{ marginTop: theme.spacing.lg }}>
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginBottom: theme.spacing.xs }}>
              {t("completeAction.pickNext", "Next step")}
            </Text>
            <Pressable
              testID="complete-action-next-step"
              onPress={() => setStepPickerOpen(true)}
              accessibilityRole="button"
              style={{ padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.borderRadius.md, backgroundColor: theme.colors.card }}
            >
              <Text style={{ ...theme.typography.body, color: theme.colors.text }}>
                {writeNew
                  ? t("completeAction.writeNew", "Write a new one…")
                  : plannedSteps.find((step) => step.step_id === nextStepId)?.title ?? t("completeAction.pickNext", "Next step")}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {writeNew ? (
          <>
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
          </>
        ) : null}

        {currentStep?.checkpoint && currentStep.checkpoint !== "won" ? (
          <Pressable
            testID="complete-action-checkpoint"
            onPress={() => setAttestCheckpoint((value) => !value)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: attestCheckpoint }}
            style={{ flexDirection: "row", alignItems: "center", marginTop: theme.spacing.lg }}
          >
            <Text style={{ ...theme.typography.body, color: theme.colors.primary, marginRight: theme.spacing.sm }}>
              {attestCheckpoint ? "☑" : "☐"}
            </Text>
            <Text style={{ ...theme.typography.body, color: theme.colors.text, flex: 1 }}>
              {t("completeAction.reachesStage", "This also reaches {{stage}}", { stage: t(`stage.${currentStep.checkpoint}`, currentStep.checkpoint) })}
            </Text>
          </Pressable>
        ) : null}

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
      <Select
        visible={stepPickerOpen}
        onClose={() => setStepPickerOpen(false)}
        title={t("completeAction.pickNext", "Next step")}
        value={writeNew ? "__new__" : nextStepId}
        onSelect={(value) => {
          if (value === "__new__") {
            setWriteNew(true);
            setNextStepId(null);
          } else {
            setWriteNew(false);
            setNextStepId(value);
          }
        }}
        options={[
          ...plannedSteps.map((step) => ({ value: step.step_id, label: step.title, subtitle: formatStepDue(step.due_at) })),
          { value: "__new__", label: t("completeAction.writeNew", "Write a new one…") },
        ]}
      />
    </Modal>
  );
}

function formatStepDue(value?: string | null): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleDateString();
}
