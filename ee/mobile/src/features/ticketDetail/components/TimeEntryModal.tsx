import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api";
import { getServices, type ServiceOption } from "../../../api/timeEntries";
import { useTheme } from "../../../ui/ThemeContext";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { DatePickerField } from "../../../ui/components/DatePickerField";
import { TimePickerField } from "../../../ui/components/TimePickerField";
import { toMinutesOfDay, minutesToHHMM } from "../utils";

function TimeFields({
  date,
  onChangeDate,
  startTime,
  endTime,
  onChangeStartTime,
  onChangeEndTime,
  updating,
  colors,
  spacing,
  typography,
  t,
}: {
  date: Date;
  onChangeDate: (d: Date) => void;
  startTime: string;
  endTime: string;
  onChangeStartTime: (v: string) => void;
  onChangeEndTime: (v: string) => void;
  updating: boolean;
  colors: ReturnType<typeof useTheme>["colors"];
  spacing: ReturnType<typeof useTheme>["spacing"];
  typography: ReturnType<typeof useTheme>["typography"];
  t: (key: string) => string;
}) {
  const startMin = toMinutesOfDay(startTime);
  const endMin = toMinutesOfDay(endTime);
  const durationMin = startMin !== null && endMin !== null && endMin > startMin
    ? endMin - startMin
    : null;
  const durationStr = durationMin !== null ? String(durationMin) : "";
  const [durationInput, setDurationInput] = useState(durationStr);
  const [durationFocused, setDurationFocused] = useState(false);

  useEffect(() => {
    if (!durationFocused) {
      setDurationInput(durationStr);
    }
  }, [durationStr, durationFocused]);

  const applyDuration = (text: string) => {
    const dur = Number(text);
    if (Number.isFinite(dur) && dur > 0 && startMin !== null) {
      onChangeEndTime(minutesToHHMM(startMin + dur));
    }
  };

  const inputStyle = {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.text,
  };

  return (
    <View style={{ marginTop: spacing.lg }}>
      {/* Date picker */}
      <Text style={{ ...typography.caption, color: colors.textSecondary }}>
        {t("timeEntry.dateLabel")}
      </Text>
      <View style={{ marginTop: spacing.sm }}>
        <DatePickerField
          value={date}
          onChange={(d) => { if (d) onChangeDate(d); }}
          placeholder={t("timeEntry.datePlaceholder")}
          disabled={updating}
          label={t("timeEntry.dateLabel")}
        />
      </View>

      {/* Time pickers */}
      <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.lg }}>
        <View style={{ flex: 1 }}>
          <Text style={{ ...typography.caption, color: colors.textSecondary }}>
            {t("timeEntry.startTimeLabel")}
          </Text>
          <View style={{ marginTop: spacing.sm }}>
            <TimePickerField
              value={startTime}
              onChange={onChangeStartTime}
              placeholder="HH:MM"
              disabled={updating}
              label={t("timeEntry.startTimeLabel")}
            />
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ ...typography.caption, color: colors.textSecondary }}>
            {t("timeEntry.endTimeLabel")}
          </Text>
          <View style={{ marginTop: spacing.sm }}>
            <TimePickerField
              value={endTime}
              onChange={onChangeEndTime}
              placeholder="HH:MM"
              disabled={updating}
              label={t("timeEntry.endTimeLabel")}
            />
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ ...typography.caption, color: colors.textSecondary }}>
            {t("timeEntry.durationLabel")}
          </Text>
          <TextInput
            value={durationFocused ? durationInput : durationStr}
            onChangeText={setDurationInput}
            onFocus={() => setDurationFocused(true)}
            onBlur={() => {
              setDurationFocused(false);
              applyDuration(durationInput);
            }}
            placeholder={t("timeEntry.durationPlaceholder")}
            placeholderTextColor={colors.placeholder}
            keyboardType="number-pad"
            editable={!updating}
            style={inputStyle}
          />
        </View>
      </View>
    </View>
  );
}

export function TimeEntryModal({
  visible,
  date,
  onChangeDate,
  startTime,
  onChangeStartTime,
  endTime,
  onChangeEndTime,
  notes,
  onChangeNotes,
  serviceId,
  onChangeServiceId,
  client,
  apiKey,
  updating,
  error,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  date: Date;
  onChangeDate: (value: Date) => void;
  startTime: string;
  onChangeStartTime: (value: string) => void;
  endTime: string;
  onChangeEndTime: (value: string) => void;
  notes: string;
  onChangeNotes: (value: string) => void;
  serviceId: string | null;
  onChangeServiceId: (value: string | null) => void;
  client: ApiClient | null;
  apiKey: string | null;
  updating: boolean;
  error: string | null;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [servicePickerOpen, setServicePickerOpen] = useState(false);
  const selectedServiceName = services.find((s) => s.service_id === serviceId)?.service_name ?? null;

  useEffect(() => {
    if (!visible || !client || !apiKey) return;
    if (services.length > 0) return;
    let canceled = false;
    const run = async () => {
      setServicesLoading(true);
      setServicesError(null);
      try {
        const res = await getServices(client, { apiKey });
        if (canceled) return;
        if (!res.ok) {
          setServicesError(t("timeEntry.errors.unableToLoadServices"));
          return;
        }
        setServices(res.data.data);
      } finally {
        if (!canceled) setServicesLoading(false);
      }
    };
    void run();
    return () => { canceled = true; };
  }, [apiKey, client, services.length, visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }}>
        <Text style={{ ...typography.title, color: colors.text }}>{t("timeEntry.title")}</Text>

        <Text style={{ ...typography.caption, marginTop: spacing.lg, color: colors.textSecondary }}>
          {t("timeEntry.serviceLabel")}
        </Text>
        {servicesLoading ? (
          <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm }}>
            {t("timeEntry.loadingServices")}
          </Text>
        ) : servicesError ? (
          <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
            {servicesError}
          </Text>
        ) : services.length > 0 ? (
          <View style={{ marginTop: spacing.sm }}>
            <Pressable
              onPress={() => setServicePickerOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={selectedServiceName ?? t("timeEntry.selectService")}
              style={({ pressed }) => ({
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <Text style={{ ...typography.body, color: selectedServiceName ? colors.text : colors.placeholder }}>
                {selectedServiceName ?? t("timeEntry.selectService")}
              </Text>
              <Text style={{ ...typography.body, color: colors.textSecondary }}>
                {servicePickerOpen ? "▲" : "▼"}
              </Text>
            </Pressable>
            {servicePickerOpen ? (
              <View style={{
                marginTop: spacing.xs,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                overflow: "hidden",
                maxHeight: 200,
              }}>
                <ScrollView nestedScrollEnabled>
                  {services.map((s, idx) => {
                    const selected = serviceId === s.service_id;
                    return (
                      <Pressable
                        key={s.service_id}
                        onPress={() => {
                          onChangeServiceId(s.service_id);
                          setServicePickerOpen(false);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={s.service_name}
                        style={({ pressed }) => ({
                          paddingHorizontal: spacing.md,
                          paddingVertical: spacing.sm,
                          backgroundColor: selected ? colors.primary : "transparent",
                          borderTopWidth: idx > 0 ? 1 : 0,
                          borderTopColor: colors.border,
                          opacity: pressed ? 0.9 : 1,
                        })}
                      >
                        <Text style={{ ...typography.body, color: selected ? colors.textInverse : colors.text }}>
                          {s.service_name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}
          </View>
        ) : (
          <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm }}>
            {t("timeEntry.noServices")}
          </Text>
        )}

        <TimeFields
          date={date}
          onChangeDate={onChangeDate}
          startTime={startTime}
          endTime={endTime}
          onChangeStartTime={onChangeStartTime}
          onChangeEndTime={onChangeEndTime}
          updating={updating}
          colors={colors}
          spacing={spacing}
          typography={typography}
          t={(key: string) => t(key)}
        />

        <Text style={{ ...typography.caption, marginTop: spacing.lg, color: colors.textSecondary }}>
          {t("timeEntry.notesLabel")}
        </Text>
        <TextInput
          value={notes}
          onChangeText={onChangeNotes}
          multiline
          placeholder={t("timeEntry.notesPlaceholder")}
          placeholderTextColor={colors.placeholder}
          editable={!updating}
          style={{
            marginTop: spacing.sm,
            minHeight: 90,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            color: colors.text,
            textAlignVertical: "top",
          }}
        />

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

        <View style={{ marginTop: spacing.xl }}>
          <PrimaryButton onPress={onSubmit} disabled={updating || !serviceId}>
            {t("timeEntry.saveTimeEntry")}
          </PrimaryButton>
          <View style={{ height: spacing.sm }} />
          <PrimaryButton onPress={onClose} disabled={updating}>
            {t("common:cancel")}
          </PrimaryButton>
        </View>
      </ScrollView>
    </Modal>
  );
}
