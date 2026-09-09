import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api";
import { createInteraction, listInteractionTypes, type InteractionType } from "../../../api/interactions";
import { getUserPermissions, listUsers, getUserDisplayName } from "../../../api/users";
import { useTheme } from "../../../ui/ThemeContext";
import { useToast } from "../../../ui/toast/ToastProvider";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { TextInput } from "../../../ui/components/TextInput";
import { Select, type SelectOption } from "../../../ui/components/Select";
import { DatePickerField } from "../../../ui/components/DatePickerField";
import { TimePickerField } from "../../../ui/components/TimePickerField";
import { EntityPickerModal, type EntityPickerItem } from "../../../ui/components/EntityPickerModal";
import { SecondaryButton } from "./SecondaryButton";
import { serverErrorMessage } from "../opportunityErrors";
import { combineDateTimeIso } from "../opportunityFormat";

export function LogInteractionModal({
  visible,
  client,
  apiKey,
  userId,
  opportunityId,
  clientId,
  contactNameId,
  initialDuration,
  preferTypeName,
  onClose,
  onLogged,
}: {
  visible: boolean;
  client: ApiClient | null;
  apiKey: string | null;
  userId?: string | null;
  opportunityId: string;
  clientId?: string | null;
  contactNameId?: string | null;
  initialDuration?: number;
  preferTypeName?: string;
  onClose: () => void;
  onLogged: () => void;
}) {
  const { t } = useTranslation("opportunities");
  const theme = useTheme();
  const { showToast } = useToast();

  const [types, setTypes] = useState<InteractionType[]>([]);
  const [typesLoading, setTypesLoading] = useState(false);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [selectOpen, setSelectOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [duration, setDuration] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addToSchedule, setAddToSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<Date>(() => new Date());
  const [startTime, setStartTime] = useState("09:00");
  const [canAssignOthers, setCanAssignOthers] = useState(false);
  const [assignees, setAssignees] = useState<EntityPickerItem[]>([]);
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [users, setUsers] = useState<EntityPickerItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setAddToSchedule(false);
    setScheduleDate(new Date());
    setStartTime("09:00");
    setAssignees(userId ? [{ id: userId, label: t("logInteraction.schedule.you", "You") }] : []);
    setAssigneePickerOpen(false);
    setUserSearch("");
    setUsers([]);
    setUsersError(null);
    setCanAssignOthers(false);
    if (!client || !apiKey || !userId) return;
    const controller = new AbortController();
    void getUserPermissions(client, { apiKey, userId, signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted && result.ok) {
        setCanAssignOthers(result.data.data.effective_permissions.includes("user_schedule:update"));
      }
    });
    return () => controller.abort();
  }, [apiKey, client, t, userId, visible]);

  useEffect(() => {
    if (!visible || !addToSchedule || !canAssignOthers || !assigneePickerOpen || !client || !apiKey) return;
    const controller = new AbortController();
    setUsersLoading(true);
    setUsersError(null);
    void listUsers(client, { apiKey, search: userSearch, signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setUsersLoading(false);
      if (!result.ok) {
        setUsersError(serverErrorMessage(result.error, t("logInteraction.schedule.usersError", "Could not load users.")));
        return;
      }
      setUsers(result.data.data.map((user) => ({ id: user.user_id, label: getUserDisplayName(user) })));
    });
    return () => controller.abort();
  }, [addToSchedule, apiKey, assigneePickerOpen, canAssignOthers, client, t, userSearch, visible]);

  useEffect(() => {
    if (!visible) return;
    setTitle("");
    setNotes("");
    setDuration(initialDuration != null ? String(initialDuration) : "");
    setTypeId(null);
    setError(null);
    setSubmitting(false);

    if (!client || !apiKey) return;
    let canceled = false;
    setTypesLoading(true);
    void (async () => {
      const result = await listInteractionTypes(client, { apiKey });
      if (canceled) return;
      setTypesLoading(false);
      if (!result.ok) return;
      const loaded = result.data.data;
      setTypes(loaded);
      if (preferTypeName) {
        const preferred =
          loaded.find((type) => type.type_name.toLowerCase() === preferTypeName.toLowerCase()) ?? loaded[0];
        if (preferred) setTypeId(preferred.type_id);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [apiKey, client, initialDuration, preferTypeName, visible]);

  const typeOptions = useMemo<SelectOption<string>[]>(
    () => types.map((type) => ({ label: type.type_name, value: type.type_id })),
    [types],
  );
  const selectedTypeName = types.find((type) => type.type_id === typeId)?.type_name ?? null;

  const startIso = combineDateTimeIso(scheduleDate, startTime);
  const scheduleDurationValid = duration.trim() === "" || (/^\d+$/.test(duration) && Number(duration) > 0);
  const canSubmit = !submitting && typeId !== null && (!addToSchedule || (Boolean(startIso) && scheduleDurationValid));
  const schedulingOthers = canAssignOthers && assignees.some((item) => item.id !== userId);

  const handleSubmit = useCallback(async () => {
    if (!client || !apiKey || !typeId || !canSubmit) return;
    const parsedDuration = Number.parseInt(duration, 10);
    setSubmitting(true);
    setError(null);
    const result = await createInteraction(client, {
      apiKey,
      data: {
        type_id: typeId,
        title: title.trim() || undefined,
        notes: notes.trim() || undefined,
        duration: Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : undefined,
        opportunity_id: opportunityId,
        client_id: clientId ?? undefined,
        contact_name_id: contactNameId ?? undefined,
        interaction_date: new Date().toISOString(),
        ...(addToSchedule && startIso ? {
          create_schedule_entry: true,
          start_time: startIso,
          schedule_assigned_user_ids: canAssignOthers && assignees.length > 0
            ? assignees.map((item) => item.id)
            : userId ? [userId] : undefined,
        } : {}),
      },
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(serverErrorMessage(result.error, t("errors.generic", "Something went wrong. Please try again.")));
      return;
    }
    showToast({ message: t("logInteraction.success", "Interaction logged"), tone: "success" });
    onLogged();
    onClose();
  }, [addToSchedule, apiKey, assignees, canAssignOthers, canSubmit, client, clientId, contactNameId, duration, notes, onClose, onLogged, opportunityId, showToast, startIso, t, title, typeId, userId]);

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
          {t("logInteraction.title", "Log interaction")}
        </Text>

        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.lg }}>
          {t("logInteraction.type", "Type")}
        </Text>
        <Pressable
          testID="log-interaction-type-trigger"
          onPress={() => setSelectOpen(true)}
          disabled={submitting || typesLoading}
          accessibilityRole="button"
          accessibilityLabel={selectedTypeName ?? t("logInteraction.selectType", "Select a type")}
          style={({ pressed }) => ({
            marginTop: theme.spacing.sm,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.md,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.card,
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <Text style={{ ...theme.typography.body, color: selectedTypeName ? theme.colors.text : theme.colors.placeholder }}>
            {selectedTypeName ?? t("logInteraction.selectType", "Select a type")}
          </Text>
          <Feather name="chevron-down" size={18} color={theme.colors.textSecondary} />
        </Pressable>

        <View style={{ marginTop: theme.spacing.lg }}>
          <TextInput
            label={t("logInteraction.titleField", "Title")}
            value={title}
            onChangeText={setTitle}
            disabled={submitting}
            accessibilityLabel={t("logInteraction.titleField", "Title")}
          />
        </View>

        <View style={{ marginTop: theme.spacing.lg }}>
          <TextInput
            label={t("logInteraction.notes", "Notes")}
            value={notes}
            onChangeText={setNotes}
            multiline
            minHeight={90}
            disabled={submitting}
            accessibilityLabel={t("logInteraction.notes", "Notes")}
          />
        </View>

        <View style={{ marginTop: theme.spacing.lg }}>
          <TextInput
            label={t("logInteraction.duration", "Duration (minutes)")}
            value={duration}
            onChangeText={setDuration}
            numericMode="integer"
            disabled={submitting}
            accessibilityLabel={t("logInteraction.duration", "Duration (minutes)")}
          />
        </View>

        <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ ...theme.typography.body, color: theme.colors.text }}>
              {t("logInteraction.schedule.label", "Add to schedule")}
            </Text>
            <Switch
              testID="log-interaction-schedule-toggle"
              value={addToSchedule}
              onValueChange={setAddToSchedule}
              disabled={submitting}
              accessibilityLabel={t("logInteraction.schedule.label", "Add to schedule")}
            />
          </View>
          {addToSchedule ? (
            <>
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
                {t("logInteraction.schedule.date", "Schedule date")}
              </Text>
              <DatePickerField
                value={scheduleDate}
                onChange={(value) => { if (value) setScheduleDate(value); }}
                disabled={submitting}
                label={t("logInteraction.schedule.date", "Schedule date")}
              />
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
                {t("logInteraction.schedule.start", "Start time")}
              </Text>
              <TimePickerField
                value={startTime}
                onChange={setStartTime}
                disabled={submitting}
                label={t("logInteraction.schedule.start", "Start time")}
              />
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
                {t("logInteraction.schedule.durationHint", "Uses the duration above, or 30 minutes if blank.")}
              </Text>
              {!scheduleDurationValid || !startIso ? (
                <Text style={{ ...theme.typography.caption, color: theme.colors.danger }}>
                  {t("logInteraction.schedule.invalidTime", "Choose a valid start time and a positive whole-minute duration.")}
                </Text>
              ) : null}
              {canAssignOthers ? (
                <>
                  <SecondaryButton
                    testID="log-interaction-schedule-assignees"
                    onPress={() => { setUserSearch(""); setAssigneePickerOpen(true); }}
                    disabled={submitting}
                  >
                    {t("logInteraction.schedule.assignees", "Schedule for")}
                  </SecondaryButton>
                  {assignees.map((item) => (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      accessibilityLabel={t("logInteraction.schedule.removeUser", "Remove {{name}}", { name: item.label })}
                      disabled={submitting}
                      onPress={() => setAssignees((selected) => selected.filter((user) => user.id !== item.id))}
                    >
                      <Text style={{ ...theme.typography.body, color: theme.colors.text }}>{item.label} ×</Text>
                    </Pressable>
                  ))}
                </>
              ) : null}
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
                {schedulingOthers
                  ? t("logInteraction.schedule.selectedHint", "A schedule entry will be added to the selected users' AlgaPSA calendars.")
                  : t("logInteraction.schedule.selfHint", "A schedule entry will be added to your AlgaPSA calendar.")}
              </Text>
            </>
          ) : null}
        </View>

        {error ? (
          <Text style={{ ...theme.typography.caption, color: theme.colors.danger, marginTop: theme.spacing.md }}>{error}</Text>
        ) : null}

        <View style={{ marginTop: theme.spacing.xl, gap: theme.spacing.sm }}>
          <PrimaryButton
            onPress={() => void handleSubmit()}
            disabled={!canSubmit}
            accessibilityLabel={t("logInteraction.submit", "Log it")}
          >
            {t("logInteraction.submit", "Log it")}
          </PrimaryButton>
          <View style={{ flexDirection: "row" }}>
            <SecondaryButton
              testID="log-interaction-cancel"
              onPress={onClose}
              disabled={submitting}
              accessibilityLabel={t("common.cancel", "Cancel")}
            >
              {t("common.cancel", "Cancel")}
            </SecondaryButton>
          </View>
        </View>
      </ScrollView>

      <EntityPickerModal
        visible={assigneePickerOpen && addToSchedule && canAssignOthers}
        title={t("logInteraction.schedule.assignees", "Schedule for")}
        items={users.filter((user) => !assignees.some((item) => item.id === user.id))}
        loading={usersLoading}
        error={usersError}
        onSearch={setUserSearch}
        onSelect={(id, label) => {
          setAssignees((selected) => selected.some((item) => item.id === id) ? selected : [...selected, { id, label }]);
          setAssigneePickerOpen(false);
        }}
        onClose={() => setAssigneePickerOpen(false)}
      />
      <Select
        visible={selectOpen}
        value={typeId}
        options={typeOptions}
        title={t("logInteraction.type", "Type")}
        onSelect={(value) => setTypeId(value)}
        onClose={() => setSelectOpen(false)}
      />
    </Modal>
  );
}
