import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { DatePickerField } from "../../../ui/components/DatePickerField";
import { TimePickerField } from "../../../ui/components/TimePickerField";
import { combineDateAndTime } from "../../schedule/scheduleUtils";

export type AdHocFormValue = {
  title: string;
  notes: string;
  /** Optional due date. When unset the to-do has no schedule. */
  date?: Date;
  /** When true (and a date is set) start/end times are included. */
  includeTime: boolean;
  startTime: string;
  endTime: string;
};

export function defaultAdHocFormValue(): AdHocFormValue {
  return {
    title: "",
    notes: "",
    date: undefined,
    includeTime: false,
    startTime: "09:00",
    endTime: "10:00",
  };
}

export function AdHocEntryFormModal({
  visible,
  mode,
  initial,
  saving,
  busy,
  error,
  isDone,
  onSubmit,
  onToggleDone,
  onDelete,
  onClose,
}: {
  visible: boolean;
  mode: "create" | "edit";
  initial: AdHocFormValue;
  saving: boolean;
  busy: boolean;
  error: string | null;
  isDone: boolean;
  onSubmit: (value: AdHocFormValue) => void;
  onToggleDone: (done: boolean) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { colors, spacing, typography, borderRadius } = useTheme();
  const { t } = useTranslation("userActivities");
  const [value, setValue] = useState<AdHocFormValue>(initial);

  useEffect(() => {
    if (visible) setValue(initial);
  }, [initial, visible]);

  const timesEnabled = Boolean(value.date) && value.includeTime;
  const start = timesEnabled && value.date ? combineDateAndTime(value.date, value.startTime) : null;
  const end = timesEnabled && value.date ? combineDateAndTime(value.date, value.endTime) : null;
  const timesValid = !timesEnabled || Boolean(start && end && end.getTime() > start.getTime());
  const disabled = saving || busy;
  const canSave = !disabled && value.title.trim() !== "" && timesValid;

  const inputStyle = {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.text,
  } as const;

  const confirmDelete = () => {
    Alert.alert(
      t("adHoc.deleteTitle", { defaultValue: "Delete to-do?" }),
      t("adHoc.deleteMessage", { defaultValue: "This personal to-do will be permanently removed." }),
      [
        { text: t("common:cancel"), style: "cancel" },
        {
          text: t("adHoc.deleteConfirm", { defaultValue: "Delete" }),
          style: "destructive",
          onPress: onDelete,
        },
      ],
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ ...typography.title, color: colors.text }}>
          {mode === "create"
            ? t("adHoc.createTitle", { defaultValue: "New to-do" })
            : t("adHoc.editTitle", { defaultValue: "Edit to-do" })}
        </Text>

        <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg }}>
          {t("adHoc.titleLabel", { defaultValue: "Title" })}
        </Text>
        <TextInput
          value={value.title}
          onChangeText={(title) => setValue((v) => ({ ...v, title }))}
          placeholder={t("adHoc.titlePlaceholder", { defaultValue: "What needs doing?" })}
          placeholderTextColor={colors.placeholder}
          editable={!disabled}
          accessibilityLabel={t("adHoc.titleLabel", { defaultValue: "Title" })}
          style={inputStyle}
        />

        <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg }}>
          {t("adHoc.notesLabel", { defaultValue: "Notes" })}
        </Text>
        <TextInput
          value={value.notes}
          onChangeText={(notes) => setValue((v) => ({ ...v, notes }))}
          multiline
          placeholder={t("adHoc.notesPlaceholder", { defaultValue: "Optional notes" })}
          placeholderTextColor={colors.placeholder}
          editable={!disabled}
          accessibilityLabel={t("adHoc.notesLabel", { defaultValue: "Notes" })}
          style={{ ...inputStyle, minHeight: 90, textAlignVertical: "top" }}
        />

        <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg }}>
          {t("adHoc.dateLabel", { defaultValue: "Date (optional)" })}
        </Text>
        <View style={{ marginTop: spacing.sm }}>
          <DatePickerField
            value={value.date}
            onChange={(date) => setValue((v) => ({ ...v, date, includeTime: date ? v.includeTime : false }))}
            placeholder={t("adHoc.datePlaceholder", { defaultValue: "No date" })}
            disabled={disabled}
            clearable
            label={t("adHoc.dateLabel", { defaultValue: "Date (optional)" })}
          />
        </View>

        {value.date ? (
          <Pressable
            onPress={() => setValue((v) => ({ ...v, includeTime: !v.includeTime }))}
            disabled={disabled}
            accessibilityRole="switch"
            accessibilityState={{ checked: value.includeTime }}
            accessibilityLabel={t("adHoc.addTime", { defaultValue: "Set a time" })}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              marginTop: spacing.md,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: borderRadius.sm,
                borderWidth: 1,
                borderColor: value.includeTime ? colors.primary : colors.border,
                backgroundColor: value.includeTime ? colors.primary : colors.card,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {value.includeTime ? (
                <Text style={{ color: colors.textInverse, fontWeight: "700" }}>{"✓"}</Text>
              ) : null}
            </View>
            <Text style={{ ...typography.body, color: colors.text, marginLeft: spacing.sm }}>
              {t("adHoc.addTime", { defaultValue: "Set a time" })}
            </Text>
          </Pressable>
        ) : null}

        {value.date && value.includeTime ? (
          <>
            <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.caption, color: colors.textSecondary }}>
                  {t("adHoc.startLabel", { defaultValue: "Start" })}
                </Text>
                <View style={{ marginTop: spacing.sm }}>
                  <TimePickerField
                    value={value.startTime}
                    onChange={(startTime) => setValue((v) => ({ ...v, startTime }))}
                    placeholder="HH:MM"
                    disabled={disabled}
                    label={t("adHoc.startLabel", { defaultValue: "Start" })}
                  />
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.caption, color: colors.textSecondary }}>
                  {t("adHoc.endLabel", { defaultValue: "End" })}
                </Text>
                <View style={{ marginTop: spacing.sm }}>
                  <TimePickerField
                    value={value.endTime}
                    onChange={(endTime) => setValue((v) => ({ ...v, endTime }))}
                    placeholder="HH:MM"
                    disabled={disabled}
                    label={t("adHoc.endLabel", { defaultValue: "End" })}
                  />
                </View>
              </View>
            </View>
            {!timesValid ? (
              <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
                {t("adHoc.invalidTimes", { defaultValue: "End time must be after start time." })}
              </Text>
            ) : null}
          </>
        ) : null}

        {error ? (
          <Text style={{ ...typography.caption, marginTop: spacing.md, color: colors.danger }}>{error}</Text>
        ) : null}

        {disabled ? (
          <View style={{ marginTop: spacing.lg, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}

        <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
          <PrimaryButton
            onPress={() => onSubmit(value)}
            disabled={!canSave}
            accessibilityLabel={t("adHoc.save", { defaultValue: "Save" })}
          >
            {t("adHoc.save", { defaultValue: "Save" })}
          </PrimaryButton>

          {mode === "edit" ? (
            <PrimaryButton
              onPress={() => onToggleDone(!isDone)}
              disabled={disabled}
              accessibilityLabel={
                isDone
                  ? t("adHoc.markNotDone", { defaultValue: "Mark not done" })
                  : t("adHoc.markDone", { defaultValue: "Mark done" })
              }
            >
              {isDone
                ? t("adHoc.markNotDone", { defaultValue: "Mark not done" })
                : t("adHoc.markDone", { defaultValue: "Mark done" })}
            </PrimaryButton>
          ) : null}

          {mode === "edit" ? (
            <PrimaryButton
              onPress={confirmDelete}
              disabled={disabled}
              accessibilityLabel={t("adHoc.delete", { defaultValue: "Delete" })}
            >
              {busy
                ? t("adHoc.deleting", { defaultValue: "Deleting…" })
                : t("adHoc.delete", { defaultValue: "Delete" })}
            </PrimaryButton>
          ) : null}

          <PrimaryButton onPress={onClose} disabled={disabled} accessibilityLabel={t("common:cancel")}>
            {t("common:cancel")}
          </PrimaryButton>
        </View>
      </ScrollView>
    </Modal>
  );
}
