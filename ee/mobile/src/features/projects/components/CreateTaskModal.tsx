import React, { useCallback, useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { DatePickerField } from "../../../ui/components/DatePickerField";
import { EntityPickerModal } from "../../../ui/components/EntityPickerModal";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { TextInput } from "../../../ui/components/TextInput";
import { AgentPickerModal } from "../../ticketDetail/components/AgentPickerModal";
import type { ApiClient } from "../../../api/client";
import { createProjectTask, type ProjectTaskSummary } from "../../../api/projects";
import { listPriorities, type MobilePriority } from "../../../api/priorities";
import { getClientMetadataHeaders } from "../../../device/clientMetadata";
import { logger } from "../../../logging/logger";

/** Local date as YYYY-MM-DD; the API's date fields are day-granular. */
function toDateOnly(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function CreateTaskModal({
  visible,
  client,
  apiKey,
  projectId,
  phaseId,
  phaseName,
  statusMappingId,
  onClose,
  onCreated,
  onForbidden,
}: {
  visible: boolean;
  client: ApiClient | null;
  apiKey?: string;
  projectId: string;
  phaseId: string | null;
  phaseName: string | null;
  /** The phase's first visible status mapping; the route rejects a task without one. */
  statusMappingId: string | null;
  onClose: () => void;
  onCreated: (task: ProjectTaskSummary) => void;
  onForbidden: () => void;
}) {
  const { t } = useTranslation("projects");
  const theme = useTheme();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState<{ id: string; name: string } | null>(null);
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [priority, setPriority] = useState<MobilePriority | null>(null);
  const [priorities, setPriorities] = useState<MobilePriority[]>([]);
  const [estimatedHours, setEstimatedHours] = useState("");
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName("");
    setDescription("");
    setAssignee(null);
    setDueDate(undefined);
    setPriority(null);
    setEstimatedHours("");
    setError(null);
    setSubmitting(false);
  }, [visible]);

  useEffect(() => {
    if (!visible || !client || !apiKey || priorities.length > 0) return;
    let canceled = false;
    void (async () => {
      const result = await listPriorities(client, { apiKey, itemType: "project_task" });
      if (canceled || !result.ok) return;
      setPriorities(result.data.data);
    })();
    return () => {
      canceled = true;
    };
  }, [apiKey, client, priorities.length, visible]);

  const canSave = name.trim().length > 0 && !submitting && Boolean(statusMappingId);

  const submit = useCallback(async () => {
    if (!client || !apiKey || !phaseId || !statusMappingId) return;
    setSubmitting(true);
    setError(null);
    // project_tasks.estimated_hours is a bigint of minutes, whatever its name
    // says, so the hours typed here are converted before they are sent.
    const hours = Number.parseFloat(estimatedHours);
    const estimatedMinutes = Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : null;
    const auditHeaders = await getClientMetadataHeaders();
    const result = await createProjectTask(client, {
      apiKey,
      projectId,
      phaseId,
      data: {
        task_name: name.trim(),
        project_status_mapping_id: statusMappingId,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(assignee ? { assigned_to: assignee.id } : {}),
        ...(dueDate ? { due_date: toDateOnly(dueDate) } : {}),
        ...(priority ? { priority_id: priority.priority_id } : {}),
        ...(estimatedMinutes !== null ? { estimated_hours: estimatedMinutes } : {}),
      },
      auditHeaders,
    });
    setSubmitting(false);

    if (!result.ok) {
      logger.warn("Project task create failed", { error: result.error });
      if (result.error.kind === "permission") {
        onForbidden();
        return;
      }
      setError(t("task.create.failed", "Unable to create the task."));
      return;
    }
    onCreated(result.data.data);
  }, [
    apiKey,
    assignee,
    client,
    description,
    dueDate,
    estimatedHours,
    name,
    onCreated,
    onForbidden,
    phaseId,
    priority,
    projectId,
    statusMappingId,
    t,
  ]);

  const priorityItems = useMemo(
    () => priorities.map((item) => ({ id: item.priority_id, label: item.priority_name })),
    [priorities],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} testID="create-task-modal">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, backgroundColor: theme.colors.background }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            padding: theme.spacing.lg,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ ...theme.typography.subtitle, color: theme.colors.text }}>
              {t("task.create.title", "New task")}
            </Text>
            {phaseName ? (
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }} numberOfLines={1}>
                {phaseName}
              </Text>
            ) : null}
          </View>
          <Pressable
            testID="create-task-close"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t("task.create.cancel", "Cancel")}
            hitSlop={8}
          >
            <Feather name="x" size={22} color={theme.colors.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg }} keyboardShouldPersistTaps="handled">
          <TextInput
            testID="create-task-name"
            label={t("task.create.name", "Task name")}
            value={name}
            onChangeText={setName}
            placeholder={t("task.create.namePlaceholder", "What needs doing?")}
          />
          <View style={{ height: theme.spacing.md }} />
          <TextInput
            testID="create-task-description"
            label={t("task.create.description", "Description")}
            value={description}
            onChangeText={setDescription}
            multiline
            minHeight={88}
          />

          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.lg }}>
            {t("task.create.assignee", "Assignee")}
          </Text>
          <Pressable
            testID="create-task-assignee"
            onPress={() => setAssigneeOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t("task.create.assignee", "Assignee")}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: theme.spacing.xs,
              padding: theme.spacing.md,
              borderRadius: theme.borderRadius.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.card,
            }}
          >
            <Text style={{ ...theme.typography.body, color: assignee ? theme.colors.text : theme.colors.placeholder }}>
              {assignee?.name ?? t("task.none", "None")}
            </Text>
            <Feather name="chevron-right" size={18} color={theme.colors.textSecondary} />
          </Pressable>

          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.lg }}>
            {t("task.create.dueDate", "Due date")}
          </Text>
          <View style={{ marginTop: theme.spacing.xs }}>
            <DatePickerField
              value={dueDate}
              onChange={setDueDate}
              clearable
              label={t("task.create.dueDate", "Due date")}
            />
          </View>

          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.lg }}>
            {t("task.create.priority", "Priority")}
          </Text>
          <Pressable
            testID="create-task-priority"
            onPress={() => setPriorityOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t("task.create.priority", "Priority")}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: theme.spacing.xs,
              padding: theme.spacing.md,
              borderRadius: theme.borderRadius.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.card,
            }}
          >
            <Text style={{ ...theme.typography.body, color: priority ? theme.colors.text : theme.colors.placeholder }}>
              {priority?.priority_name ?? t("task.none", "None")}
            </Text>
            <Feather name="chevron-right" size={18} color={theme.colors.textSecondary} />
          </Pressable>

          <View style={{ height: theme.spacing.md }} />
          <TextInput
            testID="create-task-estimated-hours"
            label={t("task.create.estimatedHours", "Estimated hours")}
            value={estimatedHours}
            onChangeText={setEstimatedHours}
            numericMode="decimal"
          />

          {!statusMappingId ? (
            <Text style={{ ...theme.typography.caption, color: theme.colors.danger, marginTop: theme.spacing.md }}>
              {t("task.create.noStatus", "This project has no task statuses yet. Add one on the web.")}
            </Text>
          ) : null}
          {error ? (
            <Text
              testID="create-task-error"
              style={{ ...theme.typography.caption, color: theme.colors.danger, marginTop: theme.spacing.md }}
            >
              {error}
            </Text>
          ) : null}
        </ScrollView>

        <View style={{ padding: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
          <PrimaryButton testID="create-task-save" onPress={() => void submit()} disabled={!canSave}>
            {t("task.create.save", "Create task")}
          </PrimaryButton>
        </View>
      </KeyboardAvoidingView>

      <AgentPickerModal
        visible={assigneeOpen}
        updating={false}
        updateError={null}
        currentAssignedToId={assignee?.id ?? null}
        currentAssignedToName={assignee?.name ?? null}
        onSelect={(userId, displayName) => {
          setAssignee({ id: userId, name: displayName });
          setAssigneeOpen(false);
        }}
        onUnassign={() => {
          setAssignee(null);
          setAssigneeOpen(false);
        }}
        onClose={() => setAssigneeOpen(false)}
        client={client}
        apiKey={apiKey ?? ""}
        baseUrl={null}
      />
      <EntityPickerModal
        visible={priorityOpen}
        title={t("task.selectPriority", "Select a priority")}
        items={priorityItems}
        loading={false}
        error={null}
        searchable={false}
        selectedId={priority?.priority_id ?? null}
        onSelect={(id, label) => {
          setPriority({ priority_id: id, priority_name: label });
          setPriorityOpen(false);
        }}
        onClose={() => setPriorityOpen(false)}
      />
    </Modal>
  );
}
