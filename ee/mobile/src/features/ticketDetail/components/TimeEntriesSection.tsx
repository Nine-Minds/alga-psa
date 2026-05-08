import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api";
import {
  getTicketTimeEntries,
  type TicketTimeEntriesSummary,
  type TicketTimeEntrySummaryItem,
} from "../../../api/timeEntries";
import { Badge } from "../../../ui/components/Badge";
import { Card } from "../../../ui/components/Card";
import { SectionHeader } from "../../../ui/components/SectionHeader";
import { useTheme } from "../../../ui/ThemeContext";
import { formatDateTimeWithRelative } from "../../../ui/formatters/dateTime";

function formatMinutes(minutes: number, tShort: (key: string, fallback: string) => string): string {
  if (!minutes || minutes <= 0) {
    return `0 ${tShort("timeEntries.hoursShort", "h")}`;
  }
  const hours = Math.floor(minutes / 60);
  const remaining = Math.round(minutes % 60);
  const hLabel = tShort("timeEntries.hoursShort", "h");
  const mLabel = tShort("timeEntries.minutesShort", "m");
  if (remaining === 0) return `${hours} ${hLabel}`;
  if (hours === 0) return `${remaining} ${mLabel}`;
  return `${hours} ${hLabel} ${remaining} ${mLabel}`;
}

const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  APPROVED: "success",
  CHANGES_REQUESTED: "warning",
};

const STATUS_KEYS: Record<string, string> = {
  DRAFT: "timeEntries.statusDraft",
  SUBMITTED: "timeEntries.statusSubmitted",
  APPROVED: "timeEntries.statusApproved",
  CHANGES_REQUESTED: "timeEntries.statusChangesRequested",
};

const STATUS_FALLBACKS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes Requested",
};

export function TimeEntriesSection({
  client,
  apiKey,
  ticketId,
  refreshKey = 0,
  meUserId,
  onAddPress,
}: {
  client: ApiClient | null;
  apiKey: string | null;
  ticketId: string;
  refreshKey?: number;
  meUserId?: string | null;
  onAddPress?: () => void;
}) {
  const { t } = useTranslation("tickets");
  const tShort = useCallback(
    (key: string, fallback: string) => t(key, { defaultValue: fallback }) as string,
    [t],
  );
  const { colors, spacing, typography } = useTheme();

  const [summary, setSummary] = useState<TicketTimeEntriesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showMine, setShowMine] = useState(true);
  const [showOthers, setShowOthers] = useState(false);

  const load = useCallback(async () => {
    if (!client || !apiKey) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const result = await getTicketTimeEntries(client, { apiKey, ticketId });
    if (!result.ok) {
      setError(t("timeEntries.errors.load", { defaultValue: "Unable to load time entries." }) as string);
      setLoading(false);
      return;
    }
    setSummary(result.data.data);
    setLoading(false);
  }, [apiKey, client, t, ticketId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const ownEntries = useMemo<TicketTimeEntrySummaryItem[]>(
    () =>
      (summary?.entries ?? []).filter((entry) =>
        meUserId ? entry.user_id === meUserId : entry.is_own,
      ),
    [summary?.entries, meUserId],
  );
  const otherEntries = useMemo<TicketTimeEntrySummaryItem[]>(
    () =>
      (summary?.entries ?? []).filter((entry) =>
        meUserId ? entry.user_id !== meUserId : !entry.is_own,
      ),
    [summary?.entries, meUserId],
  );

  return (
    <Card accessibilityLabel={t("timeEntries.title", { defaultValue: "Logged Time" }) as string}>
      <SectionHeader
        title={t("timeEntries.title", { defaultValue: "Logged Time" }) as string}
        action={(
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <Badge
              label={
                summary
                  ? formatMinutes(summary.totalMinutes, tShort)
                  : "—"
              }
              tone="neutral"
            />
            {onAddPress ? (
              <Pressable
                onPress={onAddPress}
                accessibilityRole="button"
                accessibilityLabel={t("timeEntries.addEntry", { defaultValue: "Add time entry" }) as string}
                hitSlop={8}
                style={({ pressed }) => ({
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors.primary,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Feather name="plus" size={16} color={colors.textInverse} />
              </Pressable>
            ) : null}
          </View>
        )}
      />

      {loading ? (
        <View style={{ marginTop: spacing.md, alignItems: "center" }}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : error ? (
        <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
          {error}
        </Text>
      ) : !summary || (summary.ownEntryCount === 0 && summary.othersEntryCount === 0) ? (
        <Text style={{ ...typography.body, color: colors.textSecondary, marginTop: spacing.md }}>
          {t("timeEntries.empty", { defaultValue: "No time has been logged on this ticket yet." })}
        </Text>
      ) : (
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          {summary.ownEntryCount > 0 ? (
            <CollapsibleGroup
              title={
                t("timeEntries.myEntries", { defaultValue: "My entries" }) +
                ` (${summary.ownEntryCount})`
              }
              total={formatMinutes(summary.ownTotalMinutes, tShort)}
              expanded={showMine}
              onToggle={() => setShowMine((value) => !value)}
            >
              {ownEntries.map((entry) => (
                <TimeEntryRow
                  key={entry.entry_id}
                  entry={entry}
                  showUserName={false}
                  tShort={tShort}
                />
              ))}
            </CollapsibleGroup>
          ) : null}

          {summary.othersVisibleCount > 0 ? (
            <CollapsibleGroup
              title={
                t("timeEntries.otherTeam", { defaultValue: "Other team members" }) +
                ` (${summary.othersVisibleCount})`
              }
              total={formatMinutes(summary.othersVisibleMinutes, tShort)}
              expanded={showOthers}
              onToggle={() => setShowOthers((value) => !value)}
            >
              {otherEntries.map((entry) => (
                <TimeEntryRow
                  key={entry.entry_id}
                  entry={entry}
                  showUserName
                  tShort={tShort}
                />
              ))}
            </CollapsibleGroup>
          ) : null}

          {summary.othersHiddenCount > 0 ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                padding: spacing.sm,
                borderRadius: 8,
                borderWidth: 1,
                borderStyle: "dashed",
                borderColor: colors.border,
                backgroundColor: colors.background,
              }}
            >
              <Feather name="eye-off" size={14} color={colors.textSecondary} />
              <Text style={{ ...typography.caption, color: colors.textSecondary, flex: 1 }}>
                {t("timeEntries.othersAnonymized", {
                  defaultValue: "{{count}} entries by other team members ({{duration}})",
                  count: summary.othersHiddenCount,
                  duration: formatMinutes(summary.othersHiddenMinutes, tShort),
                })}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </Card>
  );
}

function CollapsibleGroup({
  title,
  total,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  total: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const { colors, spacing, typography } = useTheme();
  return (
    <View>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={title}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingVertical: spacing.xs,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <Feather
            name={expanded ? "chevron-down" : "chevron-right"}
            size={16}
            color={colors.textSecondary}
          />
          <Text style={{ ...typography.body, color: colors.text }}>{title}</Text>
        </View>
        <Text style={{ ...typography.caption, color: colors.textSecondary }}>{total}</Text>
      </Pressable>
      {expanded ? <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>{children}</View> : null}
    </View>
  );
}

function TimeEntryRow({
  entry,
  showUserName,
  tShort,
}: {
  entry: TicketTimeEntrySummaryItem;
  showUserName: boolean;
  tShort: (key: string, fallback: string) => string;
}) {
  const { colors, spacing, typography } = useTheme();
  const startLabel = formatDateTimeWithRelative(entry.start_time);
  const statusKey = entry.approval_status ?? "DRAFT";
  const statusLabel = tShort(
    STATUS_KEYS[statusKey] ?? "timeEntries.statusUnknown",
    STATUS_FALLBACKS[statusKey] ?? statusKey,
  );

  return (
    <View
      style={{
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.sm,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}>
        <Text style={{ ...typography.body, color: colors.text, flex: 1 }} numberOfLines={1}>
          {showUserName
            ? entry.user_name ?? tShort("timeEntries.unknownUser", "Unknown user")
            : startLabel}
        </Text>
        <Text style={{ ...typography.body, color: colors.text, fontWeight: "600" }}>
          {formatMinutes(entry.billable_duration, tShort)}
        </Text>
      </View>
      {showUserName ? (
        <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>
          {startLabel}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
        <Text style={{ ...typography.caption, color: colors.textSecondary, flex: 1 }} numberOfLines={1}>
          {entry.service_name ?? tShort("timeEntries.noService", "No service")}
        </Text>
        <Badge label={statusLabel} tone={STATUS_TONE[statusKey] ?? "neutral"} />
      </View>
      {entry.notes ? (
        <Text
          style={{ ...typography.caption, color: colors.textSecondary, marginTop: 4 }}
          numberOfLines={2}
        >
          {entry.notes}
        </Text>
      ) : null}
    </View>
  );
}
