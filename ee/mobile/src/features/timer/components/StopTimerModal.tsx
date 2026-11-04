import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api";
import { getServices, type ServiceOption } from "../../../api/timeEntries";
import type { StopwatchSession } from "../../../api/stopwatch";
import { useTheme } from "../../../ui/ThemeContext";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { DatePickerField } from "../../../ui/components/DatePickerField";
import { TimePickerField } from "../../../ui/components/TimePickerField";
import { formatDateTimeWithRelative } from "../../../ui/formatters/dateTime";
import { toEntrySpan } from "../stopwatchMath";
import { formatMinutesDuration } from "../timerLogic";

export type TimerStopOverrides = {
  /** Only sent when the user adjusted the end; the server derives the rest from the session. */
  start_time?: string;
  end_time?: string;
  notes?: string;
  service_id?: string;
  is_billable?: boolean;
};

function parseHHMM(value: string, onDate: Date): Date | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const result = new Date(onDate);
  result.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return result;
}

function toHHMM(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function StopTimerModal({
  visible,
  session,
  offsetMs,
  client,
  apiKey,
  submitting,
  error,
  willStartNext,
  onClose,
  onSubmit,
  onDiscard,
}: {
  visible: boolean;
  session: StopwatchSession | null;
  offsetMs: number;
  client: ApiClient | null;
  apiKey: string | null;
  submitting: boolean;
  error: string | null;
  willStartNext: boolean;
  onClose: () => void;
  onSubmit: (overrides: TimerStopOverrides) => void;
  onDiscard?: () => void;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("timeEntries");

  const [notes, setNotes] = useState("");
  const [isBillable, setIsBillable] = useState(true);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [adjustingEnd, setAdjustingEnd] = useState(false);
  const [endDate, setEndDate] = useState(new Date());
  const [endTime, setEndTime] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const [services, setServices] = useState<ServiceOption[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicePickerOpen, setServicePickerOpen] = useState(false);

  const [nowMs, setNowMs] = useState(() => Date.now());

  // D5: prefill from the shared span math. Segment instants are server time; the
  // device clock differs by offsetMs, so local = server - offsetMs.
  const span = useMemo(
    () => (session ? toEntrySpan(session.segments, nowMs + offsetMs) : null),
    [session, nowMs, offsetMs],
  );
  const startServerMs = span ? span.start.getTime() : 0;
  const startLocalMs = startServerMs - offsetMs;

  useEffect(() => {
    if (!visible || !session) return;
    setNotes(session.notes ?? "");
    setIsBillable(true);
    setServiceId(session.service_id);
    setAdjustingEnd(false);
    const initialEnd = new Date(toEntrySpan(session.segments, Date.now() + offsetMs).end.getTime() - offsetMs);
    setEndDate(initialEnd);
    setEndTime(toHHMM(initialEnd));
    setLocalError(null);
    setServicePickerOpen(false);
    // Reset applies per opening, not per session field change.
  }, [visible, session?.session_id]);

  useEffect(() => {
    if (!visible || adjustingEnd || session?.status !== "running") return;
    setNowMs(Date.now());
    const handle = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [visible, adjustingEnd, session?.status]);

  useEffect(() => {
    if (!visible || !client || !apiKey || services.length > 0) return;
    let canceled = false;
    const run = async () => {
      setServicesLoading(true);
      try {
        const result = await getServices(client, { apiKey });
        if (!canceled && result.ok) setServices(result.data.data);
      } finally {
        if (!canceled) setServicesLoading(false);
      }
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [apiKey, client, services.length, visible]);

  const adjustedEnd = useMemo(
    () => (adjustingEnd ? parseHHMM(endTime, endDate) : null),
    [adjustingEnd, endDate, endTime],
  );

  const durationMinutes = useMemo(() => {
    if (!span) return 0;
    if (adjustingEnd) {
      if (!adjustedEnd) return null;
      return Math.round((adjustedEnd.getTime() - startLocalMs) / 60_000);
    }
    return span.billableMinutes;
  }, [adjustedEnd, adjustingEnd, span, startLocalMs]);

  if (!session) return null;

  const selectedServiceName =
    services.find((s) => s.service_id === serviceId)?.service_name ??
    (serviceId === session.service_id ? session.service_name ?? null : null);

  const submit = () => {
    if (submitting) return;
    if (!serviceId) {
      setLocalError(t("timer.stopModal.errors.noService"));
      return;
    }
    let startIso: string | undefined;
    let endIso: string | undefined;
    if (adjustingEnd) {
      if (!adjustedEnd) {
        setLocalError(t("timer.stopModal.errors.invalidEnd"));
        return;
      }
      if (adjustedEnd.getTime() <= startLocalMs) {
        setLocalError(t("timer.stopModal.errors.endBeforeStart"));
        return;
      }
      // Allow rounding up to the next quarter-hour; only reject far-future
      // ends that are likely a wrong date or AM/PM.
      if (adjustedEnd.getTime() > Date.now() + 15 * 60_000) {
        setLocalError(t("timer.stopModal.errors.endInFuture"));
        return;
      }
      // The picker is device-local; the server wants server-clock instants.
      startIso = new Date(startServerMs).toISOString();
      endIso = new Date(adjustedEnd.getTime() + offsetMs).toISOString();
    }
    setLocalError(null);
    onSubmit({
      start_time: startIso,
      end_time: endIso,
      notes: notes.trim() || undefined,
      service_id: serviceId,
      is_billable: isBillable,
    });
  };

  const shownError = localError ?? error;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }}
      >
        <Text style={{ ...typography.title, color: colors.text }}>
          {t("timer.stopModal.title")}
        </Text>

        <View
          style={{
            marginTop: spacing.lg,
            padding: spacing.md,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          <Text style={{ ...typography.body, color: colors.text, fontWeight: "600" }} numberOfLines={2}>
            {session.work_item_title ?? t("timer.stopModal.untitledWorkItem")}
          </Text>
          <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>
            {t("timer.stopModal.startedAt", {
              time: formatDateTimeWithRelative(new Date(startLocalMs).toISOString()),
            })}
          </Text>
          <Text style={{ ...typography.title, color: colors.text, marginTop: spacing.sm }}>
            {durationMinutes === null ? "—" : formatMinutesDuration(durationMinutes)}
          </Text>
          {span && span.pausedMs > 0 ? (
            <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>
              {t("timer.stopModal.pausedNotice", {
                count: span.segmentCount,
                tracked: formatMinutesDuration(span.billableMinutes),
                paused: formatMinutesDuration(Math.round(span.pausedMs / 60_000)),
              })}
            </Text>
          ) : null}
          {durationMinutes !== null && durationMinutes < 1 ? (
            <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>
              {t("timer.stopModal.zeroDurationHint")}
            </Text>
          ) : null}
        </View>

        <Text style={{ ...typography.caption, marginTop: spacing.lg, color: colors.textSecondary }}>
          {t("timer.stopModal.serviceLabel")}
        </Text>
        {servicesLoading ? (
          <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm }}>
            {t("timer.stopModal.loadingServices")}
          </Text>
        ) : (
          <View style={{ marginTop: spacing.sm }}>
            <Pressable
              onPress={() => setServicePickerOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={selectedServiceName ?? t("timer.stopModal.selectService")}
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
                {selectedServiceName ?? t("timer.stopModal.selectService")}
              </Text>
              <Text style={{ ...typography.body, color: colors.textSecondary }}>
                {servicePickerOpen ? "▲" : "▼"}
              </Text>
            </Pressable>
            {servicePickerOpen ? (
              <View
                style={{
                  marginTop: spacing.xs,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  overflow: "hidden",
                  maxHeight: 200,
                }}
              >
                <ScrollView nestedScrollEnabled>
                  {services.map((s, idx) => {
                    const selected = serviceId === s.service_id;
                    return (
                      <Pressable
                        key={s.service_id}
                        onPress={() => {
                          setServiceId(s.service_id);
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
        )}

        <Pressable
          onPress={() => setIsBillable((v) => !v)}
          disabled={submitting}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isBillable }}
          accessibilityLabel={t("timer.stopModal.billableLabel")}
          style={{
            marginTop: spacing.lg,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
          }}
        >
          <Feather
            name={isBillable ? "check-square" : "square"}
            size={20}
            color={isBillable ? colors.primary : colors.textSecondary}
          />
          <Text style={{ ...typography.body, color: colors.text }}>
            {t("timer.stopModal.billableLabel")}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setAdjustingEnd((v) => !v)}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel={t("timer.stopModal.adjustEnd")}
          style={{
            marginTop: spacing.lg,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
          }}
        >
          <Feather
            name={adjustingEnd ? "chevron-down" : "chevron-right"}
            size={16}
            color={colors.textSecondary}
          />
          <Text style={{ ...typography.body, color: colors.text }}>
            {t("timer.stopModal.adjustEnd")}
          </Text>
        </Pressable>
        {adjustingEnd ? (
          <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.sm }}>
            <View style={{ flex: 3 }}>
              <DatePickerField
                value={endDate}
                onChange={(d) => {
                  if (d) setEndDate(d);
                }}
                placeholder={t("timer.stopModal.endDateLabel")}
                disabled={submitting}
                label={t("timer.stopModal.endDateLabel")}
              />
            </View>
            <View style={{ flex: 2 }}>
              <TimePickerField
                value={endTime}
                onChange={setEndTime}
                placeholder="HH:MM"
                disabled={submitting}
                label={t("timer.stopModal.endTimeLabel")}
              />
            </View>
          </View>
        ) : null}

        <Text style={{ ...typography.caption, marginTop: spacing.lg, color: colors.textSecondary }}>
          {t("timer.stopModal.notesLabel")}
        </Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder={t("timer.stopModal.notesPlaceholder")}
          placeholderTextColor={colors.placeholder}
          editable={!submitting}
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

        {willStartNext ? (
          <Text style={{ ...typography.caption, marginTop: spacing.md, color: colors.textSecondary }}>
            {t("timer.stopModal.willStartNext")}
          </Text>
        ) : null}

        {submitting ? (
          <View style={{ marginTop: spacing.lg, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.textSecondary }}>
              {t("common:saving")}
            </Text>
          </View>
        ) : null}

        {shownError ? (
          <Text style={{ ...typography.caption, marginTop: spacing.md, color: colors.danger }}>
            {shownError}
          </Text>
        ) : null}

        <View style={{ marginTop: spacing.xl }}>
          <PrimaryButton onPress={submit} disabled={submitting || !serviceId}>
            {t("timer.stopModal.save")}
          </PrimaryButton>
          <View style={{ height: spacing.sm }} />
          <PrimaryButton onPress={onClose} disabled={submitting}>
            {session.status === "paused" ? t("timer.stopModal.keepPaused") : t("timer.stopModal.keepRunning")}
          </PrimaryButton>
          {onDiscard ? (
            <>
              <View style={{ height: spacing.sm }} />
              <PrimaryButton
                onPress={() =>
                  Alert.alert(t("timer.discard.title"), t("timer.discard.message"), [
                    { text: t("timer.discard.cancel"), style: "cancel" },
                    { text: t("timer.discard.confirm"), style: "destructive", onPress: onDiscard },
                  ])
                }
                disabled={submitting}
              >
                {t("timer.stopModal.discard")}
              </PrimaryButton>
            </>
          ) : null}
        </View>
      </ScrollView>
    </Modal>
  );
}
