import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, SectionList, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { Badge } from "../ui/components/Badge";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import { listTimeEntries, listTimePeriods, type TimeEntryListItem, type WorkItemType } from "../api/timeEntries";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { useAppResume } from "../hooks/useAppResume";
import { useTheme } from "../ui/ThemeContext";
import { logger } from "../logging/logger";
import { formatDateShort, getDateTimeLocale } from "../ui/formatters/dateTime";
import {
  formatPeriodRange,
  inclusiveEndDate,
  localDateOnly,
  resolveCurrentPeriod,
  type ResolvedPeriod,
} from "../features/timeEntries/currentPeriod";
import {
  entryDurationMinutes,
  formatMinutesDuration,
  groupEntriesByDay,
  totalLoggedMinutes,
} from "../features/timeEntries/entryGrouping";

const PAGE_LIMIT = 100;
const MAX_PAGES = 5;

const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  APPROVED: "success",
  CHANGES_REQUESTED: "warning",
};

function statusLabel(status: string, t: TFunction): string {
  switch (status) {
    case "DRAFT":
      return t("status.draft", { defaultValue: "Draft" });
    case "SUBMITTED":
      return t("status.submitted", { defaultValue: "Submitted" });
    case "APPROVED":
      return t("status.approved", { defaultValue: "Approved" });
    case "CHANGES_REQUESTED":
      return t("status.changesRequested", { defaultValue: "Changes Requested" });
    default:
      return status;
  }
}

function workItemTypeLabel(type: WorkItemType | string | null | undefined, t: TFunction): string | null {
  switch (type) {
    case "ticket":
      return t("workItemTypes.ticket", { defaultValue: "Ticket" });
    case "project_task":
      return t("workItemTypes.projectTask", { defaultValue: "Project task" });
    case "non_billable_category":
      return t("workItemTypes.nonBillable", { defaultValue: "Non-billable" });
    case "ad_hoc":
      return t("workItemTypes.adHoc", { defaultValue: "Ad hoc" });
    case "interaction":
      return t("workItemTypes.interaction", { defaultValue: "Interaction" });
    default:
      return typeof type === "string" && type ? type : null;
  }
}

function formatTimeRange(start?: string | null, end?: string | null): string | null {
  if (!start || !end) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  try {
    const fmt = new Intl.DateTimeFormat(getDateTimeLocale(), { timeStyle: "short" });
    return `${fmt.format(startDate)} – ${fmt.format(endDate)}`;
  } catch {
    return null;
  }
}

export function TimeEntriesScreen() {
  const { t } = useTranslation("timeEntries");
  const theme = useTheme();
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession } = useAuth();
  const abortRef = useRef<AbortController | null>(null);

  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/timeEntries",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);

  const [period, setPeriod] = useState<ResolvedPeriod | null>(null);
  const [entries, setEntries] = useState<TimeEntryListItem[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const load = useCallback(async () => {
    if (!client || !session) return;
    setError(null);
    setNoAccess(false);

    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    const signal = abortController.signal;

    const today = localDateOnly();
    const periodsResult = await listTimePeriods(client, { apiKey: session.accessToken, signal });
    if (signal.aborted) return;

    let resolved: ResolvedPeriod;
    if (periodsResult.ok) {
      resolved = resolveCurrentPeriod(periodsResult.data.data ?? [], today);
    } else {
      if (periodsResult.error.kind === "canceled") return;
      logger.warn("Time periods fetch failed", { error: periodsResult.error });
      if (periodsResult.error.kind !== "permission") {
        setError(t("list.unableToLoadDescription", { defaultValue: "Please check your connection and try again." }));
        return;
      }
      resolved = resolveCurrentPeriod([], today);
    }
    setPeriod(resolved);

    const collected: TimeEntryListItem[] = [];
    let page = 1;
    let hitCap = false;
    for (;;) {
      const result = await listTimeEntries(client, {
        apiKey: session.accessToken,
        page,
        limit: PAGE_LIMIT,
        user_id: session.user?.id,
        date_from: resolved.startDate,
        date_to: inclusiveEndDate(resolved.endDateExclusive),
        signal,
      });
      if (signal.aborted) return;
      if (!result.ok) {
        if (result.error.kind === "canceled") return;
        logger.warn("Time entries fetch failed", { error: result.error });
        if (result.error.kind === "permission") {
          setNoAccess(true);
          return;
        }
        setError(t("list.unableToLoadDescription", { defaultValue: "Please check your connection and try again." }));
        return;
      }
      collected.push(...result.data.data);
      if (!result.data.pagination.hasNext) break;
      page += 1;
      if (page > MAX_PAGES) {
        hitCap = true;
        break;
      }
    }

    setEntries(collected);
    setTruncated(hitCap);
  }, [client, session, t]);

  const { refreshing, refresh } = usePullToRefresh(load, { haptics: true });

  useAppResume(() => {
    void refresh();
  });

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      if (!client || !session) return;
      setInitialLoading(true);
      await load();
      if (!canceled) setInitialLoading(false);
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [client, load, session]);

  const sections = useMemo(
    () =>
      groupEntriesByDay(entries).map((group) => ({
        key: group.date ?? "unknown",
        date: group.date,
        totalMinutes: group.totalMinutes,
        data: group.entries,
      })),
    [entries],
  );

  const totalMinutes = useMemo(() => totalLoggedMinutes(entries), [entries]);

  const keyExtractor = useCallback((item: TimeEntryListItem) => item.entry_id, []);

  const renderItem = useCallback(
    ({ item }: { item: TimeEntryListItem }) => <TimeEntryRow item={item} />,
    [],
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
        title={t("list.noAccess", { defaultValue: "No access to time entries" })}
        description={t("list.noAccessDescription", {
          defaultValue: "Your account does not have permission to view time entries.",
        })}
      />
    );
  }

  if (initialLoading && entries.length === 0) {
    return <LoadingState message={t("list.loading", { defaultValue: "Loading time entries…" })} />;
  }

  if (error && entries.length === 0) {
    return (
      <ErrorState
        title={t("list.unableToLoad", { defaultValue: "Unable to load time entries" })}
        description={error}
        action={<PrimaryButton onPress={() => void refresh()}>{t("common:retry")}</PrimaryButton>}
      />
    );
  }

  const header = period ? (
    <View
      style={{
        padding: theme.spacing.md,
        borderRadius: theme.borderRadius.lg,
        backgroundColor: theme.colors.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
        marginBottom: theme.spacing.md,
      }}
    >
      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
        {t("header.currentPeriod", { defaultValue: "Current period" })}
      </Text>
      <Text style={{ ...theme.typography.title, color: theme.colors.text, marginTop: 2 }}>
        {formatPeriodRange(period.startDate, period.endDateExclusive, getDateTimeLocale())}
      </Text>
      <Text style={{ ...theme.typography.body, color: theme.colors.text, marginTop: theme.spacing.xs }}>
        {t("header.totalLogged", {
          defaultValue: "{{duration}} logged",
          duration: formatMinutesDuration(totalMinutes),
        })}
      </Text>
      {period.isFallback ? (
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.xs }}>
          {t("header.fallbackMonth", { defaultValue: "No time period is configured, showing the current month." })}
        </Text>
      ) : null}
      {truncated ? (
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.xs }}>
          {t("header.truncated", {
            defaultValue: "Showing the most recent {{count}} entries for this period.",
            count: entries.length,
          })}
        </Text>
      ) : null}
    </View>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <SectionList
        sections={sections}
        keyExtractor={keyExtractor}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={{ padding: theme.spacing.lg, flexGrow: 1 }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState
            title={t("list.noEntries", { defaultValue: "No time entries this period" })}
            description={t("list.noEntriesDescription", {
              defaultValue: "Time you log during this period will show up here.",
            })}
            action={<PrimaryButton onPress={() => void refresh()}>{t("common:refresh")}</PrimaryButton>}
          />
        }
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingVertical: theme.spacing.sm,
              backgroundColor: theme.colors.background,
            }}
          >
            <Text style={{ ...theme.typography.body, color: theme.colors.text, fontWeight: "600" }}>
              {section.date ? formatDateShort(section.date) : t("list.unknownDate", { defaultValue: "Unknown date" })}
            </Text>
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
              {formatMinutesDuration(section.totalMinutes)}
            </Text>
          </View>
        )}
        stickySectionHeadersEnabled={false}
        removeClippedSubviews
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        updateCellsBatchingPeriod={50}
        windowSize={7}
      />
    </View>
  );
}

const TimeEntryRow = memo(function TimeEntryRow({ item }: { item: TimeEntryListItem }) {
  const { t } = useTranslation("timeEntries");
  const theme = useTheme();

  const durationLabel = formatMinutesDuration(entryDurationMinutes(item));
  const timeLabel = formatTimeRange(item.start_time, item.end_time) ?? durationLabel;
  const typeLabel = workItemTypeLabel(item.work_item_type, t);
  const status = item.approval_status ?? "DRAFT";
  const billable = item.is_billable === true || (item.billable_duration ?? 0) > 0;

  return (
    <View
      accessibilityLabel={t("list.entryAccessibility", {
        defaultValue: "Time entry, {{duration}}",
        duration: durationLabel,
      })}
      style={{
        padding: theme.spacing.md,
        marginBottom: theme.spacing.sm,
        borderRadius: theme.borderRadius.lg,
        backgroundColor: theme.colors.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: theme.spacing.sm }}>
        <Text style={{ ...theme.typography.body, color: theme.colors.text, flex: 1 }} numberOfLines={1}>
          {timeLabel}
        </Text>
        <Text style={{ ...theme.typography.body, color: theme.colors.text, fontWeight: "600" }}>
          {durationLabel}
        </Text>
      </View>
      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }} numberOfLines={1}>
        {item.service_name ?? t("list.noService", { defaultValue: "No service" })}
        {typeLabel ? ` • ${typeLabel}` : ""}
      </Text>
      {item.notes ? (
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 4 }} numberOfLines={2}>
          {item.notes}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
        <Badge label={statusLabel(status, t)} tone={STATUS_TONE[status] ?? "neutral"} />
        {billable ? <Badge label={t("list.billable", { defaultValue: "Billable" })} tone="success" /> : null}
      </View>
    </View>
  );
});
