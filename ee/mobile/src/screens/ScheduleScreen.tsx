import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { DrawerScreenProps } from "@react-navigation/drawer";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { DrawerParamList, RootStackParamList } from "../navigation/types";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import type { ApiError } from "../api";
import {
  createScheduleEntry,
  deleteScheduleEntry,
  updateScheduleEntry,
  type CreateScheduleEntryInput,
  type ScheduleEntry,
  type UpdateScheduleEntryInput,
} from "../api/schedule";
import { clearScheduleCache } from "../cache/scheduleCache";
import { useScheduleWeek } from "../features/schedule/useScheduleWeek";
import {
  combineDateAndTime,
  dateFromKey,
  dateKey,
  entryKindOf,
  formatTimeRange,
  getWeekDays,
  hasRecurrence,
  startOfDay,
  startOfWeek,
  toHHMM,
} from "../features/schedule/scheduleUtils";
import {
  ScheduleEntryDetailModal,
  entryKindIcon,
  useEntryKindLabel,
} from "../features/schedule/components/ScheduleEntryDetailModal";
import {
  ScheduleEntryFormModal,
  type ScheduleFormValue,
} from "../features/schedule/components/ScheduleEntryFormModal";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { useAppResume } from "../hooks/useAppResume";
import { useTheme } from "../ui/ThemeContext";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { Badge } from "../ui/components/Badge";
import { formatDateShort } from "../ui/formatters/dateTime";

type Props = CompositeScreenProps<
  DrawerScreenProps<DrawerParamList, "ScheduleTab">,
  NativeStackScreenProps<RootStackParamList>
>;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function defaultFormValue(dayKey: string): ScheduleFormValue {
  const date = dateFromKey(dayKey) ?? startOfDay(new Date());
  const startHour = Math.min(new Date().getHours() + 1, 22);
  return {
    kind: "meeting",
    title: "",
    date,
    startTime: `${pad2(startHour)}:00`,
    endTime: `${pad2(startHour + 1)}:00`,
    notes: "",
    ticketId: null,
    ticketLabel: null,
  };
}

function formValueFromEntry(entry: ScheduleEntry): ScheduleFormValue {
  const start = new Date(entry.scheduled_start);
  const end = new Date(entry.scheduled_end);
  const kind =
    entry.work_item_type === "ticket"
      ? "ticket"
      : entry.work_item_type === "meeting" || entry.work_item_type === "break"
        ? entry.work_item_type
        : "other";
  return {
    kind,
    title: entry.title,
    date: startOfDay(Number.isNaN(start.getTime()) ? new Date() : start),
    startTime: Number.isNaN(start.getTime()) ? "09:00" : toHHMM(start),
    endTime: Number.isNaN(end.getTime()) ? "10:00" : toHHMM(end),
    notes: entry.notes ?? "",
    ticketId: entry.work_item_type === "ticket" ? entry.work_item_id : null,
    ticketLabel: entry.work_item?.title ?? null,
  };
}

export function ScheduleScreen({ navigation }: Props) {
  const { t } = useTranslation("schedule");
  const theme = useTheme();
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession } = useAuth();
  const kindLabel = useEntryKindLabel();

  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/schedule",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);

  const userId = session?.user?.id ?? null;
  const today = useMemo(() => new Date(), []);
  const [weekStartKey, setWeekStartKey] = useState(() => dateKey(startOfWeek(new Date())));
  const [selectedDayKey, setSelectedDayKey] = useState(() => dateKey(new Date()));

  const { entriesByDay, loading, error, noAccess, refresh } = useScheduleWeek({
    client,
    apiKey: session?.accessToken ?? null,
    userId,
    weekStartKey,
  });

  const weekStart = useMemo(() => dateFromKey(weekStartKey) ?? startOfWeek(new Date()), [weekStartKey]);
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);
  const dayEntries = entriesByDay.get(selectedDayKey) ?? [];

  const [detailEntry, setDetailEntry] = useState<ScheduleEntry | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ScheduleEntry | null>(null);
  const [formInitial, setFormInitial] = useState<ScheduleFormValue>(() => defaultFormValue(selectedDayKey));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { refreshing, refresh: pullRefresh } = usePullToRefresh(refresh, { haptics: true });

  useAppResume(() => {
    void refresh();
  });

  const goToWeek = useCallback(
    (offsetDays: number) => {
      const nextWeekStart = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + offsetDays);
      const selectedIdx = weekDays.findIndex((d) => dateKey(d) === selectedDayKey);
      const idx = selectedIdx >= 0 ? selectedIdx : 0;
      setWeekStartKey(dateKey(nextWeekStart));
      setSelectedDayKey(
        dateKey(new Date(nextWeekStart.getFullYear(), nextWeekStart.getMonth(), nextWeekStart.getDate() + idx)),
      );
    },
    [selectedDayKey, weekDays, weekStart],
  );

  const goToToday = useCallback(() => {
    const now = new Date();
    setWeekStartKey(dateKey(startOfWeek(now)));
    setSelectedDayKey(dateKey(now));
  }, []);

  const errorMessageFor = useCallback(
    (apiError: ApiError, fallback: string): string => {
      if (apiError.kind === "permission") {
        return t("errors.noPermission", { defaultValue: "You don't have permission to do that." });
      }
      if (apiError.kind === "validation" && apiError.message && !apiError.message.startsWith("HTTP")) {
        return apiError.message;
      }
      return fallback;
    },
    [t],
  );

  const openCreate = useCallback(() => {
    setEditingEntry(null);
    setFormInitial(defaultFormValue(selectedDayKey));
    setFormError(null);
    setFormOpen(true);
  }, [selectedDayKey]);

  const openEdit = useCallback((entry: ScheduleEntry) => {
    setDetailEntry(null);
    setEditingEntry(entry);
    setFormInitial(formValueFromEntry(entry));
    setFormError(null);
    setFormOpen(true);
  }, []);

  const afterMutation = useCallback(
    async (targetDate: Date | null) => {
      clearScheduleCache();
      if (targetDate) {
        const targetWeekKey = dateKey(startOfWeek(targetDate));
        setSelectedDayKey(dateKey(targetDate));
        if (targetWeekKey !== weekStartKey) {
          setWeekStartKey(targetWeekKey);
          return;
        }
      }
      await refresh();
    },
    [refresh, weekStartKey],
  );

  const handleSubmit = useCallback(
    async (value: ScheduleFormValue) => {
      if (!client || !session) return;
      const start = combineDateAndTime(value.date, value.startTime);
      const end = combineDateAndTime(value.date, value.endTime);
      if (!start || !end || end.getTime() <= start.getTime()) {
        setFormError(t("form.invalidTimes", { defaultValue: "End time must be after start time." }));
        return;
      }

      setSaving(true);
      setFormError(null);

      let result;
      if (editingEntry) {
        const body: UpdateScheduleEntryInput = {
          title: value.title.trim(),
          scheduled_start: start.toISOString(),
          scheduled_end: end.toISOString(),
          notes: value.notes.trim(),
        };
        if (
          editingEntry.work_item_type === "ticket" &&
          value.ticketId &&
          value.ticketId !== editingEntry.work_item_id
        ) {
          body.work_item_id = value.ticketId;
        }
        result = await updateScheduleEntry(client, {
          apiKey: session.accessToken,
          entryId: editingEntry.entry_id,
          entry: body,
        });
      } else {
        const body: CreateScheduleEntryInput = {
          title: value.title.trim(),
          scheduled_start: start.toISOString(),
          scheduled_end: end.toISOString(),
          work_item_type: value.kind,
          ...(value.kind === "ticket" && value.ticketId ? { work_item_id: value.ticketId } : {}),
          ...(value.notes.trim() ? { notes: value.notes.trim() } : {}),
          ...(userId ? { assigned_user_ids: [userId] } : {}),
        };
        result = await createScheduleEntry(client, { apiKey: session.accessToken, entry: body });
      }

      setSaving(false);
      if (!result.ok) {
        setFormError(
          errorMessageFor(result.error, t("errors.saveFailed", { defaultValue: "Unable to save. Please try again." })),
        );
        return;
      }

      setFormOpen(false);
      setEditingEntry(null);
      await afterMutation(value.date);
    },
    [afterMutation, client, editingEntry, errorMessageFor, session, t, userId],
  );

  const handleDelete = useCallback(
    async (entry: ScheduleEntry) => {
      if (!client || !session) return;
      setDeleting(true);
      setDetailError(null);
      const result = await deleteScheduleEntry(client, {
        apiKey: session.accessToken,
        entryId: entry.entry_id,
      });
      setDeleting(false);
      if (!result.ok) {
        setDetailError(
          errorMessageFor(
            result.error,
            t("errors.deleteFailed", { defaultValue: "Unable to delete. Please try again." }),
          ),
        );
        return;
      }
      setDetailEntry(null);
      await afterMutation(null);
    },
    [afterMutation, client, errorMessageFor, session, t],
  );

  const openTicket = useCallback(
    (ticketId: string) => {
      setDetailEntry(null);
      navigation.navigate("TicketDetail", { ticketId });
    },
    [navigation],
  );

  const renderEntry = useCallback(
    ({ item }: { item: ScheduleEntry }) => (
      <Pressable
        onPress={() => {
          setDetailError(null);
          setDetailEntry(item);
        }}
        accessibilityRole="button"
        accessibilityLabel={item.title}
        style={({ pressed }) => ({
          padding: theme.spacing.md,
          marginBottom: theme.spacing.sm,
          borderRadius: theme.borderRadius.lg,
          backgroundColor: theme.colors.card,
          borderWidth: 1,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.96 : 1,
        })}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Feather name={entryKindIcon(item)} size={14} color={theme.colors.primary} />
          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginLeft: theme.spacing.sm, flex: 1 }}>
            {formatTimeRange(item.scheduled_start, item.scheduled_end)}
          </Text>
          {hasRecurrence(item) ? (
            <Feather name="repeat" size={14} color={theme.colors.textSecondary} style={{ marginLeft: theme.spacing.sm }} />
          ) : null}
          {item.is_private ? (
            <Feather name="lock" size={14} color={theme.colors.textSecondary} style={{ marginLeft: theme.spacing.sm }} />
          ) : null}
        </View>
        <Text style={{ ...theme.typography.body, color: theme.colors.text, marginTop: 2 }} numberOfLines={2}>
          {item.title}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: theme.spacing.sm }}>
          <Badge label={kindLabel(item)} tone={entryKindOf(item) === "ticket" ? "info" : "neutral"} />
        </View>
      </Pressable>
    ),
    [kindLabel, theme],
  );

  if (!config.ok) {
    return <ErrorState title={t("common:configurationError")} description={config.error} />;
  }

  if (!session) {
    return <ErrorState title={t("common:signedOut")} description={t("common:signInAgain")} />;
  }

  if (noAccess) {
    return (
      <ErrorState
        title={t("list.noAccess", { defaultValue: "No schedule access" })}
        description={t("list.noAccessDescription", {
          defaultValue: "Your account does not have permission to view schedules.",
        })}
      />
    );
  }

  if (loading && entriesByDay.size === 0 && !error) {
    return <LoadingState message={t("list.loading", { defaultValue: "Loading your schedule…" })} />;
  }

  if (error && entriesByDay.size === 0) {
    return (
      <ErrorState
        title={t("list.unableToLoad", { defaultValue: "Unable to load schedule" })}
        description={error}
        action={<PrimaryButton onPress={() => void pullRefresh()}>{t("common:retry")}</PrimaryButton>}
      />
    );
  }

  const weekRangeLabel = `${formatDateShort(dateKey(weekDays[0]))} – ${formatDateShort(dateKey(weekDays[6]))}`;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Pressable
            onPress={() => goToWeek(-7)}
            accessibilityRole="button"
            accessibilityLabel={t("week.previous", { defaultValue: "Previous week" })}
            hitSlop={8}
            style={({ pressed }) => ({ padding: theme.spacing.sm, opacity: pressed ? 0.6 : 1 })}
          >
            <Feather name="chevron-left" size={20} color={theme.colors.text} />
          </Pressable>
          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{weekRangeLabel}</Text>
          <Pressable
            onPress={() => goToWeek(7)}
            accessibilityRole="button"
            accessibilityLabel={t("week.next", { defaultValue: "Next week" })}
            hitSlop={8}
            style={({ pressed }) => ({ padding: theme.spacing.sm, opacity: pressed ? 0.6 : 1 })}
          >
            <Feather name="chevron-right" size={20} color={theme.colors.text} />
          </Pressable>
        </View>

        <View style={{ flexDirection: "row", marginTop: theme.spacing.sm }}>
          {weekDays.map((day) => {
            const key = dateKey(day);
            const selected = key === selectedDayKey;
            const isToday = key === dateKey(today);
            const hasEntries = entriesByDay.has(key);
            return (
              <Pressable
                key={key}
                onPress={() => setSelectedDayKey(key)}
                accessibilityRole="button"
                accessibilityLabel={formatDateShort(key)}
                style={({ pressed }) => ({
                  flex: 1,
                  alignItems: "center",
                  paddingVertical: theme.spacing.sm,
                  marginHorizontal: 2,
                  borderRadius: theme.borderRadius.md,
                  backgroundColor: selected ? theme.colors.primary : "transparent",
                  borderWidth: 1,
                  borderColor: selected ? theme.colors.primary : isToday ? theme.colors.primary : "transparent",
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <Text
                  style={{
                    ...theme.typography.small,
                    color: selected ? theme.colors.textInverse : theme.colors.textSecondary,
                  }}
                >
                  {day.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2)}
                </Text>
                <Text
                  style={{
                    ...theme.typography.bodyBold,
                    color: selected ? theme.colors.textInverse : theme.colors.text,
                    marginTop: 2,
                  }}
                >
                  {day.getDate()}
                </Text>
                <View
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 3,
                    marginTop: 3,
                    backgroundColor: hasEntries
                      ? selected
                        ? theme.colors.textInverse
                        : theme.colors.primary
                      : "transparent",
                  }}
                />
              </Pressable>
            );
          })}
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: theme.spacing.sm }}>
          <Text style={{ ...theme.typography.subtitle, color: theme.colors.text }}>
            {formatDateShort(selectedDayKey)}
          </Text>
          <Pressable
            onPress={goToToday}
            accessibilityRole="button"
            accessibilityLabel={t("week.today", { defaultValue: "Today" })}
            style={({ pressed }) => ({
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.xs,
              borderRadius: theme.borderRadius.full,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.card,
              opacity: pressed ? 0.95 : 1,
            })}
          >
            <Text style={{ ...theme.typography.caption, color: theme.colors.text, fontWeight: "600" }}>
              {t("week.today", { defaultValue: "Today" })}
            </Text>
          </Pressable>
        </View>

        {error ? (
          <Text style={{ ...theme.typography.caption, color: theme.colors.danger, marginTop: theme.spacing.sm }}>
            {error}
          </Text>
        ) : null}
      </View>

      <FlatList
        data={dayEntries}
        keyExtractor={(item) => item.entry_id}
        renderItem={renderEntry}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullRefresh} />}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl }}
        ListEmptyComponent={
          <EmptyState
            title={t("list.emptyDay", { defaultValue: "Nothing scheduled" })}
            description={t("list.emptyDayDescription", { defaultValue: "No entries for this day." })}
          />
        }
      />

      <Pressable
        onPress={openCreate}
        accessibilityRole="button"
        accessibilityLabel={t("list.addEntry", { defaultValue: "Add schedule entry" })}
        style={({ pressed }) => ({
          position: "absolute",
          right: theme.spacing.lg,
          bottom: theme.spacing.xl,
          width: 56,
          height: 56,
          borderRadius: 28,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.primary,
          opacity: pressed ? 0.9 : 1,
          ...theme.shadows.md,
        })}
      >
        <Feather name="plus" size={24} color={theme.colors.textInverse} />
      </Pressable>

      <ScheduleEntryDetailModal
        visible={detailEntry !== null}
        entry={detailEntry}
        currentUserId={userId}
        busy={deleting}
        error={detailError}
        onOpenTicket={openTicket}
        onEdit={openEdit}
        onDelete={(entry) => void handleDelete(entry)}
        onClose={() => {
          if (!deleting) setDetailEntry(null);
        }}
      />

      <ScheduleEntryFormModal
        visible={formOpen}
        mode={editingEntry ? "edit" : "create"}
        initial={formInitial}
        client={client}
        apiKey={session.accessToken}
        saving={saving}
        error={formError}
        onSubmit={(value) => void handleSubmit(value)}
        onClose={() => {
          if (!saving) {
            setFormOpen(false);
            setEditingEntry(null);
          }
        }}
      />
    </View>
  );
}
