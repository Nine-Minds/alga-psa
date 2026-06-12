import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api";
import { listTickets } from "../../../api/tickets";
import { useTheme } from "../../../ui/ThemeContext";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { DatePickerField } from "../../../ui/components/DatePickerField";
import { TimePickerField } from "../../../ui/components/TimePickerField";
import { EntityPickerModal, type EntityPickerItem } from "../../../ui/components/EntityPickerModal";
import { combineDateAndTime } from "../scheduleUtils";

export type ScheduleFormKind = "meeting" | "break" | "other" | "ticket";

export type ScheduleFormValue = {
  kind: ScheduleFormKind;
  title: string;
  date: Date;
  startTime: string;
  endTime: string;
  notes: string;
  ticketId: string | null;
  ticketLabel: string | null;
};

export function ScheduleEntryFormModal({
  visible,
  mode,
  initial,
  client,
  apiKey,
  saving,
  error,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  mode: "create" | "edit";
  initial: ScheduleFormValue;
  client: ApiClient | null;
  apiKey: string | null;
  saving: boolean;
  error: string | null;
  onSubmit: (value: ScheduleFormValue) => void;
  onClose: () => void;
}) {
  const { colors, spacing, typography, borderRadius } = useTheme();
  const { t } = useTranslation("schedule");
  const [value, setValue] = useState<ScheduleFormValue>(initial);
  const [ticketPickerOpen, setTicketPickerOpen] = useState(false);
  const [ticketItems, setTicketItems] = useState<EntityPickerItem[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) setValue(initial);
  }, [initial, visible]);

  const searchTickets = useCallback(
    async (query: string) => {
      if (!client || !apiKey) return;
      setTicketsLoading(true);
      setTicketsError(null);
      const result = await listTickets(client, {
        apiKey,
        page: 1,
        limit: 20,
        search: query || undefined,
      });
      setTicketsLoading(false);
      if (!result.ok) {
        setTicketsError(t("form.unableToLoadTickets", { defaultValue: "Unable to load tickets." }));
        return;
      }
      setTicketItems(
        result.data.data.map((ticket) => ({
          id: ticket.ticket_id,
          label: `${ticket.ticket_number} • ${ticket.title}`,
          subtitle: ticket.client_name ?? null,
        })),
      );
    },
    [apiKey, client, t],
  );

  useEffect(() => {
    if (ticketPickerOpen && ticketItems.length === 0) void searchTickets("");
  }, [searchTickets, ticketItems.length, ticketPickerOpen]);

  const start = combineDateAndTime(value.date, value.startTime);
  const end = combineDateAndTime(value.date, value.endTime);
  const timesValid = Boolean(start && end && end.getTime() > start.getTime());
  const needsTicket = value.kind === "ticket" && !value.ticketId;
  const canSave = !saving && value.title.trim() !== "" && timesValid && !needsTicket;

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

  const kindOptions: { label: string; value: ScheduleFormKind }[] = [
    { label: t("kinds.meeting", { defaultValue: "Meeting" }), value: "meeting" },
    { label: t("kinds.break", { defaultValue: "Break" }), value: "break" },
    { label: t("kinds.other", { defaultValue: "Other" }), value: "other" },
    { label: t("kinds.ticket", { defaultValue: "Ticket" }), value: "ticket" },
  ];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ ...typography.title, color: colors.text }}>
          {mode === "create"
            ? t("form.createTitle", { defaultValue: "New schedule entry" })
            : t("form.editTitle", { defaultValue: "Edit schedule entry" })}
        </Text>

        <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg }}>
          {t("form.kindLabel", { defaultValue: "Type" })}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm }}>
          {kindOptions.map((opt) => {
            const selected = value.kind === opt.value;
            const disabled = saving || mode === "edit";
            return (
              <View key={opt.value} style={{ marginRight: spacing.sm, marginBottom: spacing.sm }}>
                <Pressable
                  onPress={() => setValue((v) => ({ ...v, kind: opt.value }))}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={opt.label}
                  style={({ pressed }) => ({
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    borderRadius: borderRadius.full,
                    borderWidth: 1,
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor: selected ? colors.primary : colors.card,
                    opacity: disabled && !selected ? 0.5 : pressed ? 0.95 : 1,
                  })}
                >
                  <Text style={{ ...typography.caption, color: selected ? colors.textInverse : colors.text, fontWeight: "600" }}>
                    {opt.label}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        {value.kind === "ticket" ? (
          <>
            <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.md }}>
              {t("form.ticketLabel", { defaultValue: "Ticket" })}
            </Text>
            <Pressable
              onPress={() => setTicketPickerOpen(true)}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel={value.ticketLabel ?? t("form.selectTicket", { defaultValue: "Select ticket" })}
              style={({ pressed }) => ({
                marginTop: spacing.sm,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <Text style={{ ...typography.body, color: value.ticketLabel ? colors.text : colors.placeholder }}>
                {value.ticketLabel ?? t("form.selectTicket", { defaultValue: "Select ticket" })}
              </Text>
            </Pressable>
          </>
        ) : null}

        <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg }}>
          {t("form.titleLabel", { defaultValue: "Title" })}
        </Text>
        <TextInput
          value={value.title}
          onChangeText={(title) => setValue((v) => ({ ...v, title }))}
          placeholder={t("form.titlePlaceholder", { defaultValue: "What is this entry for?" })}
          placeholderTextColor={colors.placeholder}
          editable={!saving}
          style={inputStyle}
        />

        <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg }}>
          {t("form.dateLabel", { defaultValue: "Date" })}
        </Text>
        <View style={{ marginTop: spacing.sm }}>
          <DatePickerField
            value={value.date}
            onChange={(d) => {
              if (d) setValue((v) => ({ ...v, date: d }));
            }}
            placeholder={t("form.datePlaceholder", { defaultValue: "Select date" })}
            disabled={saving}
            label={t("form.dateLabel", { defaultValue: "Date" })}
          />
        </View>

        <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.lg }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...typography.caption, color: colors.textSecondary }}>
              {t("form.startTimeLabel", { defaultValue: "Start" })}
            </Text>
            <View style={{ marginTop: spacing.sm }}>
              <TimePickerField
                value={value.startTime}
                onChange={(startTime) => setValue((v) => ({ ...v, startTime }))}
                placeholder="HH:MM"
                disabled={saving}
                label={t("form.startTimeLabel", { defaultValue: "Start" })}
              />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ ...typography.caption, color: colors.textSecondary }}>
              {t("form.endTimeLabel", { defaultValue: "End" })}
            </Text>
            <View style={{ marginTop: spacing.sm }}>
              <TimePickerField
                value={value.endTime}
                onChange={(endTime) => setValue((v) => ({ ...v, endTime }))}
                placeholder="HH:MM"
                disabled={saving}
                label={t("form.endTimeLabel", { defaultValue: "End" })}
              />
            </View>
          </View>
        </View>
        {!timesValid && value.startTime && value.endTime ? (
          <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
            {t("form.invalidTimes", { defaultValue: "End time must be after start time." })}
          </Text>
        ) : null}

        <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg }}>
          {t("form.notesLabel", { defaultValue: "Notes" })}
        </Text>
        <TextInput
          value={value.notes}
          onChangeText={(notes) => setValue((v) => ({ ...v, notes }))}
          multiline
          placeholder={t("form.notesPlaceholder", { defaultValue: "Optional notes" })}
          placeholderTextColor={colors.placeholder}
          editable={!saving}
          style={{ ...inputStyle, minHeight: 90, textAlignVertical: "top" }}
        />

        {saving ? (
          <View style={{ marginTop: spacing.lg, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.textSecondary }}>
              {t("common:saving")}
            </Text>
          </View>
        ) : null}

        {error ? (
          <Text style={{ ...typography.caption, marginTop: spacing.md, color: colors.danger }}>{error}</Text>
        ) : null}

        <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
          <PrimaryButton onPress={() => onSubmit(value)} disabled={!canSave}>
            {t("form.save", { defaultValue: "Save" })}
          </PrimaryButton>
          <PrimaryButton onPress={onClose} disabled={saving}>
            {t("common:cancel")}
          </PrimaryButton>
        </View>
      </ScrollView>

      <EntityPickerModal
        visible={ticketPickerOpen}
        title={t("form.selectTicket", { defaultValue: "Select ticket" })}
        searchPlaceholder={t("form.searchTickets", { defaultValue: "Search tickets" })}
        emptyLabel={t("form.noTickets", { defaultValue: "No tickets found." })}
        items={ticketItems}
        loading={ticketsLoading}
        error={ticketsError}
        selectedId={value.ticketId}
        onSearch={(query) => void searchTickets(query)}
        onSelect={(id, label) => {
          setValue((v) => ({ ...v, ticketId: id, ticketLabel: label, title: v.title.trim() === "" ? label : v.title }));
          setTicketPickerOpen(false);
        }}
        onClose={() => setTicketPickerOpen(false)}
      />
    </Modal>
  );
}
