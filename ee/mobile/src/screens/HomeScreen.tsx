import type { CompositeScreenProps } from "@react-navigation/native";
import type { DrawerScreenProps } from "@react-navigation/drawer";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { DrawerParamList, RootStackParamList } from "../navigation/types";
import { useTheme } from "../ui/ThemeContext";
import { Badge } from "../ui/components/Badge";
import { Card } from "../ui/components/Card";
import { ErrorState } from "../ui/states";
import { formatDateShort } from "../ui/formatters/dateTime";
import { useAuth } from "../auth/AuthContext";
import { useCapabilities } from "../capabilities/CapabilitiesContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import { listActivities, type Activity } from "../api/activities";
import { listScheduleEntries, type ScheduleEntry } from "../api/schedule";
import { listTickets, type TicketListItem } from "../api/tickets";
import { getCachedHome, mergeCachedHome } from "../cache/homeCache";
import { useAppResume } from "../hooks/useAppResume";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { isOffline as isOfflineStatus } from "../network/isOffline";
import { useNetworkStatus } from "../network/useNetworkStatus";
import { ServicePickerModal } from "../features/timer/components/ServicePickerModal";
import { useTimer, useTimerElapsedMs } from "../features/timer/TimerContext";
import { formatElapsedClock } from "../features/timer/timerLogic";
import { LogInteractionEntry } from "../features/interactions/components/LogInteractionEntry";
import { logger } from "../logging/logger";

type Props = CompositeScreenProps<
  DrawerScreenProps<DrawerParamList, "HomeTab">,
  NativeStackScreenProps<RootStackParamList>
>;

const CARD_ROWS = 5;

/** Start and end of the device-local day, as the schedule API wants them. */
export function localDayWindow(now = new Date()): { startDate: string; endDate: string } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

function entryTimeRange(entry: ScheduleEntry): string {
  const format = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  };
  return [format(entry.scheduled_start), format(entry.scheduled_end)].filter(Boolean).join(" – ");
}

export function HomeScreen({ navigation }: Props) {
  const { t } = useTranslation("home");
  const theme = useTheme();
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession } = useAuth();
  const { features } = useCapabilities();
  const timer = useTimer();
  const elapsedMs = useTimerElapsedMs();
  const network = useNetworkStatus();
  const offline = isOfflineStatus(network);

  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/home",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);

  const apiKey = session?.accessToken;
  const userId = session?.user?.id;
  const cacheKey = `${session?.tenantId ?? "-"}|${userId ?? "-"}`;

  const [schedule, setSchedule] = useState<ScheduleEntry[] | null>(null);
  const [scheduleError, setScheduleError] = useState(false);
  const [tickets, setTickets] = useState<TicketListItem[] | null>(null);
  const [ticketTotal, setTicketTotal] = useState<number | null>(null);
  const [ticketsError, setTicketsError] = useState(false);
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [activitiesError, setActivitiesError] = useState(false);
  const [servicePickerOpen, setServicePickerOpen] = useState(false);
  const [interactionOpen, setInteractionOpen] = useState(false);

  // Offline: paint the last good answer and skip the requests entirely.
  useEffect(() => {
    if (!offline) return;
    const cached = getCachedHome(cacheKey);
    if (!cached) return;
    if (cached.schedule) setSchedule(cached.schedule);
    if (cached.tickets) {
      setTickets(cached.tickets.items);
      setTicketTotal(cached.tickets.total);
    }
    if (cached.activities) setActivities(cached.activities);
  }, [cacheKey, offline]);

  const loadSchedule = useCallback(async () => {
    if (!client || !apiKey || !userId || offline) return;
    setScheduleError(false);
    const { startDate, endDate } = localDayWindow();
    const result = await listScheduleEntries(client, { apiKey, startDate, endDate, userId });
    if (!result.ok) {
      if (result.error.kind === "canceled") return;
      logger.warn("Home schedule load failed", { error: result.error });
      setScheduleError(true);
      return;
    }
    const entries = [...(result.data.data ?? [])].sort((a, b) =>
      a.scheduled_start.localeCompare(b.scheduled_start),
    );
    setSchedule(entries);
    mergeCachedHome(cacheKey, { schedule: entries });
  }, [apiKey, cacheKey, client, offline, userId]);

  const loadTickets = useCallback(async () => {
    if (!client || !apiKey || !userId || offline) return;
    setTicketsError(false);
    const result = await listTickets(client, {
      apiKey,
      page: 1,
      limit: CARD_ROWS,
      sort: "updated_at",
      order: "desc",
      filters: { assigned_to: userId, is_open: true },
    });
    if (!result.ok) {
      if (result.error.kind === "canceled") return;
      logger.warn("Home tickets load failed", { error: result.error });
      setTicketsError(true);
      return;
    }
    setTickets(result.data.data);
    setTicketTotal(result.data.pagination.total);
    mergeCachedHome(cacheKey, {
      tickets: { items: result.data.data, total: result.data.pagination.total },
    });
  }, [apiKey, cacheKey, client, offline, userId]);

  const loadActivities = useCallback(async () => {
    if (!client || !apiKey || offline) return;
    setActivitiesError(false);
    const { endDate } = localDayWindow();
    const result = await listActivities(client, {
      apiKey,
      page: 1,
      pageSize: CARD_ROWS,
      status: "open",
      dueDateEnd: endDate,
      sortBy: "dueDate",
      sortDirection: "asc",
    });
    if (!result.ok) {
      if (result.error.kind === "canceled") return;
      logger.warn("Home activities load failed", { error: result.error });
      setActivitiesError(true);
      return;
    }
    setActivities(result.data.data);
    mergeCachedHome(cacheKey, { activities: result.data.data });
  }, [apiKey, cacheKey, client, offline]);

  const loadAll = useCallback(async () => {
    // Independent loaders: one failing endpoint must not blank the screen.
    await Promise.all([loadSchedule(), loadTickets(), loadActivities()]);
  }, [loadActivities, loadSchedule, loadTickets]);

  const { refreshing, refresh } = usePullToRefresh(loadAll, { haptics: true });
  useAppResume(() => void refresh());

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  if (!config.ok) {
    return <ErrorState title={t("unableToLoad", "Unable to load.")} description={config.error} />;
  }
  if (!session) {
    return <ErrorState title={t("unableToLoad", "Unable to load.")} />;
  }

  const timerRunning = (timer.status === "running" || timer.status === "paused") && timer.session !== null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {offline ? (
          <Text testID="home-offline" style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
            {t("offline", "Offline, showing cached data")}
          </Text>
        ) : null}

        {timerRunning && elapsedMs !== null ? (
          <HomeCard title={t("timer.title", "Running timer")} testID="home-timer">
            <View style={{ flexDirection: "row", alignItems: "center", padding: theme.spacing.md }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...theme.typography.body, color: theme.colors.text }} numberOfLines={1}>
                  {timer.session?.work_item_title ?? t("timer.untitled", "Timer")}
                </Text>
                <Text
                  testID="home-timer-elapsed"
                  style={{
                    ...theme.typography.caption,
                    color: theme.colors.textSecondary,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {formatElapsedClock(elapsedMs)}
                </Text>
              </View>
              <Pressable
                testID="home-timer-stop"
                onPress={() => timer.openStopModal()}
                accessibilityRole="button"
                accessibilityLabel={t("timer.stop", "Stop")}
                hitSlop={8}
              >
                <Text style={{ ...theme.typography.caption, color: theme.colors.primary, fontWeight: "700" }}>
                  {t("timer.stop", "Stop")}
                </Text>
              </Pressable>
            </View>
          </HomeCard>
        ) : null}

        {scheduleError || (schedule?.length ?? 0) > 0 ? (
          <HomeCard title={t("today.title", "Today")} testID="home-today">
            {scheduleError ? (
              <CardError onRetry={() => void loadSchedule()} testID="home-today-error" />
            ) : (
              (schedule ?? []).map((entry, index) => (
                <Pressable
                  key={entry.entry_id}
                  testID={`home-today-${entry.entry_id}`}
                  onPress={() => openScheduleEntry(entry, navigation)}
                  accessibilityRole="button"
                  accessibilityLabel={entry.title}
                  style={({ pressed }) => ({
                    padding: theme.spacing.md,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: theme.colors.borderLight,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Text style={{ ...theme.typography.body, color: theme.colors.text }} numberOfLines={1}>
                    {entry.title}
                  </Text>
                  <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
                    {entryTimeRange(entry)}
                  </Text>
                </Pressable>
              ))
            )}
          </HomeCard>
        ) : null}

        {ticketsError || (tickets?.length ?? 0) > 0 ? (
          <HomeCard
            title={t("tickets.title", "My tickets")}
            count={ticketTotal}
            testID="home-tickets"
            onViewAll={
              ticketsError
                ? undefined
                : () => navigation.navigate("TicketsTab", { screen: "TicketsList", params: { assignee: "me" } })
            }
            viewAllLabel={t("viewAll", "View all")}
          >
            {ticketsError ? (
              <CardError onRetry={() => void loadTickets()} testID="home-tickets-error" />
            ) : (
              (tickets ?? []).map((ticket, index) => (
                <Pressable
                  key={ticket.ticket_id}
                  testID={`home-ticket-${ticket.ticket_id}`}
                  onPress={() => navigation.navigate("TicketDetail", { ticketId: ticket.ticket_id })}
                  accessibilityRole="button"
                  accessibilityLabel={ticket.title}
                  style={({ pressed }) => ({
                    padding: theme.spacing.md,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: theme.colors.borderLight,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Text style={{ ...theme.typography.body, color: theme.colors.text }} numberOfLines={1}>
                    {ticket.title}
                  </Text>
                  <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }} numberOfLines={1}>
                    {[ticket.ticket_number, ticket.client_name, ticket.status_name].filter(Boolean).join(" • ")}
                  </Text>
                </Pressable>
              ))
            )}
          </HomeCard>
        ) : null}

        {activitiesError || (activities?.length ?? 0) > 0 ? (
          <HomeCard
            title={t("activities.title", "Activities")}
            testID="home-activities"
            onViewAll={activitiesError ? undefined : () => navigation.navigate("UserActivitiesTab")}
            viewAllLabel={t("viewAll", "View all")}
          >
            {activitiesError ? (
              <CardError onRetry={() => void loadActivities()} testID="home-activities-error" />
            ) : (
              (activities ?? []).map((activity, index) => (
                <Pressable
                  key={`${activity.type}-${activity.id}`}
                  testID={`home-activity-${activity.id}`}
                  onPress={() => openActivity(activity, navigation)}
                  accessibilityRole="button"
                  accessibilityLabel={activity.title}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: theme.spacing.sm,
                    padding: theme.spacing.md,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: theme.colors.borderLight,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...theme.typography.body, color: theme.colors.text }} numberOfLines={1}>
                      {activity.title}
                    </Text>
                    {activity.dueDate ? (
                      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
                        {formatDateShort(activity.dueDate)}
                      </Text>
                    ) : null}
                  </View>
                  {isOverdue(activity) ? (
                    <Badge label={t("activities.overdue", "Overdue")} tone="danger" />
                  ) : null}
                </Pressable>
              ))
            )}
          </HomeCard>
        ) : null}

        <HomeCard title={t("quickActions.title", "Quick actions")} testID="home-quick-actions">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm, padding: theme.spacing.md }}>
            <QuickAction
              testID="home-action-new-ticket"
              icon="ticket-outline"
              label={t("quickActions.newTicket", "New ticket")}
              onPress={() => navigation.navigate("CreateTicket")}
            />
            {features.inventory ? (
              <QuickAction
                testID="home-action-scan"
                icon="barcode-scan"
                label={t("quickActions.scan", "Scan")}
                onPress={() => navigation.navigate("InventoryTab", { segment: "scan" })}
              />
            ) : null}
            <QuickAction
              testID="home-action-log-interaction"
              icon="phone-message-outline"
              label={t("quickActions.logInteraction", "Log interaction")}
              onPress={() => setInteractionOpen(true)}
            />
            {timerRunning ? null : (
              <QuickAction
                testID="home-action-start-timer"
                icon="timer-outline"
                label={t("quickActions.startTimer", "Start timer")}
                onPress={() => setServicePickerOpen(true)}
              />
            )}
          </View>
        </HomeCard>
      </ScrollView>

      <ServicePickerModal
        visible={servicePickerOpen}
        client={timer.client}
        apiKey={timer.apiKey}
        onSelect={(service) => {
          setServicePickerOpen(false);
          // No work item: the same ad-hoc start the header chip offers.
          void timer.start({ workItemId: "", workItemType: "ad_hoc", service });
        }}
        onClose={() => setServicePickerOpen(false)}
      />
      <LogInteractionEntry
        visible={interactionOpen}
        client={client}
        apiKey={apiKey ?? null}
        userId={userId}
        onClose={() => setInteractionOpen(false)}
        onLogged={() => setInteractionOpen(false)}
      />
    </View>
  );
}

function isOverdue(activity: Activity): boolean {
  if (!activity.dueDate) return false;
  const due = new Date(activity.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due.getTime() < today.getTime();
}

/** Schedule rows open whatever they are attached to, as the Schedule tab does. */
function openScheduleEntry(entry: ScheduleEntry, navigation: Props["navigation"]): void {
  if (entry.work_item_type === "ticket" && entry.work_item_id) {
    navigation.navigate("TicketDetail", { ticketId: entry.work_item_id });
    return;
  }
  if (entry.work_item_type === "project_task" && entry.work_item_id) {
    navigation.navigate("ProjectTaskDetail", { taskId: entry.work_item_id });
    return;
  }
  navigation.navigate("ScheduleTab");
}

function openActivity(activity: Activity, navigation: Props["navigation"]): void {
  if (activity.type === "ticket") {
    navigation.navigate("TicketDetail", { ticketId: activity.id });
    return;
  }
  if (activity.type === "projectTask") {
    navigation.navigate("ProjectTaskDetail", { taskId: activity.id, activity });
    return;
  }
  if (activity.type === "workflowTask") {
    navigation.navigate("WorkflowTaskDetail", { taskId: activity.id });
    return;
  }
  navigation.navigate("UserActivitiesTab");
}

function HomeCard({
  title,
  count,
  children,
  onViewAll,
  viewAllLabel,
  testID,
}: {
  title: string;
  count?: number | null;
  children: React.ReactNode;
  onViewAll?: () => void;
  viewAllLabel?: string;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <View testID={testID}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: theme.spacing.sm }}>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, fontWeight: "700" }}>
          {title}
        </Text>
        {typeof count === "number" ? (
          <View style={{ marginLeft: theme.spacing.sm }}>
            <Badge label={String(count)} />
          </View>
        ) : null}
        {onViewAll && viewAllLabel ? (
          <Pressable
            testID={testID ? `${testID}-view-all` : undefined}
            onPress={onViewAll}
            accessibilityRole="button"
            accessibilityLabel={viewAllLabel}
            hitSlop={8}
            style={{ marginLeft: "auto" }}
          >
            <Text style={{ ...theme.typography.caption, color: theme.colors.primary, fontWeight: "700" }}>
              {viewAllLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Card style={{ padding: 0 }}>{children}</Card>
    </View>
  );
}

function CardError({ onRetry, testID }: { onRetry: () => void; testID?: string }) {
  const { t } = useTranslation("home");
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: theme.spacing.md,
      }}
    >
      <Text style={{ ...theme.typography.caption, color: theme.colors.danger }}>
        {t("unableToLoad", "Unable to load.")}
      </Text>
      <Pressable
        testID={testID ? `${testID}-retry` : undefined}
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={t("retry", "Retry")}
        hitSlop={8}
      >
        <Text style={{ ...theme.typography.caption, color: theme.colors.primary, fontWeight: "700" }}>
          {t("retry", "Retry")}
        </Text>
      </Pressable>
    </View>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing.xs,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        borderRadius: theme.borderRadius.full,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.card,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <MaterialCommunityIcons name={icon as never} size={16} color={theme.colors.primary} />
      <Text style={{ ...theme.typography.caption, color: theme.colors.text, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

export function HomeSearchButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation("home");
  const theme = useTheme();
  return (
    <Pressable
      testID="home-search"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("search", "Search")}
      hitSlop={8}
      style={({ pressed }) => ({ paddingHorizontal: theme.spacing.sm, opacity: pressed ? 0.7 : 1 })}
    >
      <Feather name="search" size={20} color={theme.colors.text} />
    </Pressable>
  );
}
