import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { createApiClient, type ApiClient } from "../../api";
import {
  getActiveTimeSession,
  startTimeTracking,
  stopTimeTracking,
  type ActiveTimeSession,
} from "../../api/timeTracking";
import type { ServiceOption, WorkItemType } from "../../api/timeEntries";
import { useAuth } from "../../auth/AuthContext";
import { getClientMetadataHeaders } from "../../device/clientMetadata";
import { useAppResume } from "../../hooks/useAppResume";
import { logger } from "../../logging/logger";
import { syncTimerNotifications } from "../../notifications/timerNotifications";
import { useToast } from "../../ui/toast/ToastProvider";
import { getApiErrorMessage } from "../ticketDetail/utils";
import { getLastUsedService, setLastUsedService } from "./lastUsedService";
import {
  computeServerClockOffsetMs,
  elapsedMsAt,
  formatMinutesDuration,
  type RunningTimerSnapshot,
} from "./timerLogic";
import { StopTimerModal, type TimerStopOverrides } from "./components/StopTimerModal";

export type TimerStartInput = {
  workItemId: string;
  workItemType: WorkItemType;
  service: ServiceOption;
};

export type TimerStatus = "loading" | "idle" | "running";

export type TimerContextValue = {
  status: TimerStatus;
  session: ActiveTimeSession | null;
  offsetMs: number;
  starting: boolean;
  defaultService: ServiceOption | null;
  lastStopped: { at: number; workItemId: string | null } | null;
  client: ApiClient | null;
  apiKey: string | null;
  refresh: () => Promise<void>;
  start: (input: TimerStartInput) => Promise<boolean>;
  openStopModal: (options?: { thenStart?: TimerStartInput }) => void;
};

const TimerContext = createContext<TimerContextValue | null>(null);

export function useTimer(): TimerContextValue {
  const value = useContext(TimerContext);
  if (!value) throw new Error("useTimer must be used within a TimerProvider");
  return value;
}

/** Ticks once a second while a session is running; null when idle. */
export function useTimerElapsedMs(): number | null {
  const { status, session, offsetMs } = useTimer();
  const running = status === "running" && session !== null;
  const sessionId = running ? session.session_id : null;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!sessionId) return;
    setNowMs(Date.now());
    const handle = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [sessionId]);

  if (!running) return null;
  return elapsedMsAt(nowMs, Date.parse(session.start_time), offsetMs);
}

function snapshotOf(session: ActiveTimeSession, offsetMs: number): RunningTimerSnapshot {
  return {
    sessionId: session.session_id,
    startTimeMs: Date.parse(session.start_time),
    offsetMs,
    workItemId: session.work_item_id,
    workItemType: session.work_item_type,
    workItemTitle: session.work_item_title ?? null,
  };
}

export function TimerProvider({ children }: { children: React.ReactNode }) {
  const { session: authSession, baseUrl, refreshSession } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation("timeEntries");

  const userId = authSession?.user?.id ?? null;
  const apiKey = authSession?.accessToken ?? null;

  const client = useMemo(() => {
    if (!baseUrl || !authSession) return null;
    return createApiClient({
      baseUrl,
      getTenantId: () => authSession.tenantId,
      getUserAgentTag: () => "mobile/timer",
      onAuthError: refreshSession,
    });
  }, [baseUrl, authSession, refreshSession]);

  const [active, setActive] = useState<ActiveTimeSession | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [loadedForUser, setLoadedForUser] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [defaultService, setDefaultService] = useState<ServiceOption | null>(null);
  const [lastStopped, setLastStopped] = useState<{ at: number; workItemId: string | null } | null>(null);
  const [stopModal, setStopModal] = useState<{ open: boolean; thenStart?: TimerStartInput }>({ open: false });
  const [stopSubmitting, setStopSubmitting] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const startingRef = useRef(false);

  const status: TimerStatus = !userId
    ? "idle"
    : loadedForUser !== userId
      ? "loading"
      : active
        ? "running"
        : "idle";

  const applySession = useCallback((session: ActiveTimeSession | null, nowMs: number) => {
    if (!session) {
      setActive(null);
      setOffsetMs(0);
      void syncTimerNotifications(null);
      return;
    }
    const offset = computeServerClockOffsetMs(session.start_time, session.elapsed_minutes ?? 0, nowMs);
    setActive(session);
    setOffsetMs(offset);
    void syncTimerNotifications(snapshotOf(session, offset));
  }, []);

  const refresh = useCallback(async () => {
    if (!client || !apiKey || !userId) return;
    const result = await getActiveTimeSession(client, { apiKey });
    if (!result.ok) {
      logger.warn("[Timer] Failed to load active session", { error: result.error.kind });
      // Show idle rather than an eternal spinner; a conflicting start will
      // surface the real state via its error path.
      setLoadedForUser(userId);
      return;
    }
    applySession(result.data.data, Date.now());
    setLoadedForUser(userId);
  }, [apiKey, applySession, client, userId]);

  useEffect(() => {
    if (!userId) {
      setActive(null);
      setOffsetMs(0);
      setLoadedForUser(null);
      setStopModal({ open: false });
      void syncTimerNotifications(null);
      return;
    }
    void refresh();
    void getLastUsedService(userId).then(setDefaultService);
    // Refetch only on user change, not on token refresh.
  }, [userId]);

  useAppResume(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const start = useCallback(
    async (input: TimerStartInput): Promise<boolean> => {
      if (!client || !apiKey || !userId || startingRef.current) return false;
      startingRef.current = true;
      setStarting(true);
      try {
        const auditHeaders = await getClientMetadataHeaders();
        const result = await startTimeTracking(client, {
          apiKey,
          work_item_type: input.workItemType,
          work_item_id: input.workItemId,
          service_id: input.service.service_id,
          auditHeaders,
        });
        if (!result.ok) {
          if (result.error.kind === "permission") {
            showToast({ message: t("timer.errors.permission"), tone: "error" });
          } else {
            showToast({ message: t("timer.errors.start"), tone: "error" });
          }
          // A conflicting session on another device is the most likely cause.
          await refresh();
          return false;
        }
        applySession(result.data.data, Date.now());
        setLoadedForUser(userId);
        setDefaultService(input.service);
        void setLastUsedService(userId, input.service);
        showToast({
          message: t("timer.startedToast", { service: input.service.service_name }),
          tone: "success",
        });
        return true;
      } finally {
        startingRef.current = false;
        setStarting(false);
      }
    },
    [apiKey, applySession, client, refresh, showToast, t, userId],
  );

  const submitStop = useCallback(
    async (overrides: TimerStopOverrides) => {
      if (!client || !apiKey || !active || stopSubmitting) return;
      setStopSubmitting(true);
      setStopError(null);
      try {
        const auditHeaders = await getClientMetadataHeaders();
        const result = await stopTimeTracking(client, {
          apiKey,
          sessionId: active.session_id,
          end_time: overrides.end_time,
          notes: overrides.notes,
          service_id: overrides.service_id,
          is_billable: overrides.is_billable,
          auditHeaders,
        });
        if (!result.ok) {
          if (result.error.kind === "validation") {
            setStopError(getApiErrorMessage(result.error.body) ?? t("timer.errors.stop"));
          } else if (result.error.kind === "permission") {
            setStopError(t("timer.errors.permission"));
          } else {
            setStopError(t("timer.errors.stop"));
            // Session may have been stopped from another device.
            void refresh();
          }
          return;
        }
        const entry = result.data.data;
        const durationMinutes =
          entry?.start_time && entry?.end_time
            ? Math.max(0, Math.round((Date.parse(entry.end_time) - Date.parse(entry.start_time)) / 60_000))
            : null;
        const stoppedWorkItemId = active.work_item_id;
        applySession(null, Date.now());
        setLastStopped({ at: Date.now(), workItemId: stoppedWorkItemId });
        const thenStart = stopModal.thenStart;
        setStopModal({ open: false });
        showToast({
          message:
            durationMinutes !== null
              ? t("timer.stoppedToast", { duration: formatMinutesDuration(durationMinutes) })
              : t("timer.stoppedToastNoDuration"),
          tone: "success",
        });
        if (thenStart) void start(thenStart);
      } finally {
        setStopSubmitting(false);
      }
    },
    [active, apiKey, applySession, client, refresh, showToast, start, stopModal.thenStart, stopSubmitting, t],
  );

  const openStopModal = useCallback((options?: { thenStart?: TimerStartInput }) => {
    setStopError(null);
    setStopModal({ open: true, thenStart: options?.thenStart });
  }, []);

  // The session can disappear underneath an open modal (stopped elsewhere).
  useEffect(() => {
    if (!active && stopModal.open) setStopModal({ open: false });
  }, [active, stopModal.open]);

  const value = useMemo<TimerContextValue>(
    () => ({
      status,
      session: active,
      offsetMs,
      starting,
      defaultService,
      lastStopped,
      client,
      apiKey,
      refresh,
      start,
      openStopModal,
    }),
    [status, active, offsetMs, starting, defaultService, lastStopped, client, apiKey, refresh, start, openStopModal],
  );

  return (
    <TimerContext.Provider value={value}>
      {children}
      <StopTimerModal
        visible={stopModal.open && active !== null}
        session={active}
        offsetMs={offsetMs}
        client={client}
        apiKey={apiKey}
        submitting={stopSubmitting}
        error={stopError}
        willStartNext={Boolean(stopModal.thenStart)}
        onClose={() => {
          if (!stopSubmitting) setStopModal({ open: false });
        }}
        onSubmit={(overrides) => void submitStop(overrides)}
      />
    </TimerContext.Provider>
  );
}
