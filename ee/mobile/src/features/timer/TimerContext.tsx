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
  discardStopwatch,
  getActiveStopwatch,
  getOpenSessionFromConflict,
  logStopwatch,
  pauseStopwatch,
  resumeStopwatch,
  startStopwatch,
  type StopwatchSession,
} from "../../api/stopwatch";
import type { ServiceOption, WorkItemType } from "../../api/timeEntries";
import { useAuth } from "../../auth/AuthContext";
import { getClientMetadataHeaders } from "../../device/clientMetadata";
import { useAppResume } from "../../hooks/useAppResume";
import { logger } from "../../logging/logger";
import { syncTimerNotifications } from "../../notifications/timerNotifications";
import { useToast } from "../../ui/toast/ToastProvider";
import { getApiErrorMessage } from "../ticketDetail/utils";
import { getLastUsedService, setLastUsedService } from "./lastUsedService";
import { activeMs, clockOffset, firstStart } from "./stopwatchMath";
import { formatMinutesDuration, type RunningTimerSnapshot } from "./timerLogic";
import { StopTimerModal, type TimerStopOverrides } from "./components/StopTimerModal";

export type TimerStartInput = {
  workItemId: string;
  workItemType: WorkItemType;
  service: ServiceOption;
};

export type TimerStatus = "loading" | "idle" | "running" | "paused";

export type TimerContextValue = {
  status: TimerStatus;
  session: StopwatchSession | null;
  /** Milliseconds to add to the device clock to get server time. */
  offsetMs: number;
  starting: boolean;
  /** A pause, resume or discard request is in flight. */
  mutating: boolean;
  defaultService: ServiceOption | null;
  lastStopped: { at: number; workItemId: string | null } | null;
  client: ApiClient | null;
  apiKey: string | null;
  refresh: () => Promise<void>;
  start: (input: TimerStartInput) => Promise<boolean>;
  pause: () => Promise<boolean>;
  resume: () => Promise<boolean>;
  discard: () => Promise<boolean>;
  openStopModal: (options?: { thenStart?: TimerStartInput }) => void;
};

const TimerContext = createContext<TimerContextValue | null>(null);

export function useTimer(): TimerContextValue {
  const value = useContext(TimerContext);
  if (!value) throw new Error("useTimer must be used within a TimerProvider");
  return value;
}

/**
 * Elapsed active time for the open session (running or paused); null when idle.
 * Always derived from the segments and the server clock offset, never counted.
 * The interval only forces a re-render while running.
 */
export function useTimerElapsedMs(): number | null {
  const { session, offsetMs } = useTimer();
  const running = session?.status === "running";
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!running) return;
    const handle = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(handle);
  }, [running, session?.session_id]);

  if (!session || (session.status !== "running" && session.status !== "paused")) return null;
  return activeMs(session.segments, Date.now() + offsetMs);
}

function snapshotOf(session: StopwatchSession, offsetMs: number): RunningTimerSnapshot {
  const serverNowMs = Date.parse(session.server_now);
  return {
    sessionId: session.session_id,
    startTimeMs: serverNowMs - session.active_ms,
    firstStartMs: firstStart(session.segments)?.getTime(),
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

  const [active, setActive] = useState<StopwatchSession | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [loadedForUser, setLoadedForUser] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [defaultService, setDefaultService] = useState<ServiceOption | null>(null);
  const [lastStopped, setLastStopped] = useState<{ at: number; workItemId: string | null } | null>(null);
  const [stopModal, setStopModal] = useState<{ open: boolean; thenStart?: TimerStartInput }>({ open: false });
  const [stopSubmitting, setStopSubmitting] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const startingRef = useRef(false);
  const mutatingRef = useRef(false);

  const status: TimerStatus = !userId
    ? "idle"
    : loadedForUser !== userId
      ? "loading"
      : active
        ? active.status === "paused"
          ? "paused"
          : "running"
        : "idle";

  const applySession = useCallback((session: StopwatchSession | null, receivedAtMs: number) => {
    if (!session || (session.status !== "running" && session.status !== "paused")) {
      setActive(null);
      setOffsetMs(0);
      void syncTimerNotifications(null);
      return;
    }
    const offset = clockOffset(session.server_now, receivedAtMs);
    setActive(session);
    setOffsetMs(offset);
    // Reminders measure active time: only a running session has them.
    void syncTimerNotifications(session.status === "running" ? snapshotOf(session, offset) : null);
  }, []);

  const refresh = useCallback(async () => {
    if (!client || !apiKey || !userId) return;
    const result = await getActiveStopwatch(client, { apiKey });
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
        const result = await startStopwatch(client, {
          apiKey,
          work_item_type: input.workItemType,
          work_item_id: input.workItemId,
          service_id: input.service.service_id,
          auditHeaders,
        });
        if (!result.ok) {
          if (result.error.kind === "permission") {
            showToast({ message: t("timer.errors.permission"), tone: "error" });
          } else if (result.error.kind === "http" && result.error.status === 409) {
            // One open session per user: show the one that is blocking the start.
            const open = getOpenSessionFromConflict(result.error.body);
            if (open) {
              applySession(open, Date.now());
              setLoadedForUser(userId);
            } else {
              await refresh();
            }
            showToast({ message: t("timer.errors.alreadyOpen"), tone: "error" });
          } else {
            showToast({ message: t("timer.errors.start"), tone: "error" });
            await refresh();
          }
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

  const mutate = useCallback(
    async (
      call: (client: ApiClient, params: { apiKey: string; sessionId: string }) => Promise<
        { ok: true; data: unknown } | { ok: false; error: { kind: string; status?: number } }
      >,
      errorKey: string,
      applyResult: (data: unknown) => void,
    ): Promise<boolean> => {
      if (!client || !apiKey || !active || mutatingRef.current) return false;
      mutatingRef.current = true;
      setMutating(true);
      try {
        const result = await call(client, { apiKey, sessionId: active.session_id });
        if (!result.ok) {
          showToast({
            message: t(result.error.kind === "permission" ? "timer.errors.permission" : errorKey),
            tone: "error",
          });
          // The session may have changed on another device.
          await refresh();
          return false;
        }
        applyResult(result.data);
        return true;
      } finally {
        mutatingRef.current = false;
        setMutating(false);
      }
    },
    [active, apiKey, client, refresh, showToast, t],
  );

  const pause = useCallback(
    () =>
      mutate(
        async (c, p) => pauseStopwatch(c, { ...p, auditHeaders: await getClientMetadataHeaders() }),
        "timer.errors.pause",
        (data) => applySession((data as { data: StopwatchSession }).data, Date.now()),
      ),
    [applySession, mutate],
  );

  const resume = useCallback(
    () =>
      mutate(
        async (c, p) => resumeStopwatch(c, { ...p, auditHeaders: await getClientMetadataHeaders() }),
        "timer.errors.resume",
        (data) => applySession((data as { data: StopwatchSession }).data, Date.now()),
      ),
    [applySession, mutate],
  );

  const discard = useCallback(
    () =>
      mutate(
        async (c, p) => discardStopwatch(c, { ...p, auditHeaders: await getClientMetadataHeaders() }),
        "timer.errors.discard",
        () => {
          applySession(null, Date.now());
          setStopModal({ open: false });
          showToast({ message: t("timer.discardedToast"), tone: "success" });
        },
      ),
    [applySession, mutate, showToast, t],
  );

  const submitStop = useCallback(
    async (overrides: TimerStopOverrides) => {
      if (!client || !apiKey || !active || stopSubmitting) return;
      setStopSubmitting(true);
      setStopError(null);
      try {
        const auditHeaders = await getClientMetadataHeaders();
        // Pause first so the clock stops now. If logging then fails (locked sheet,
        // validation) the time stays intact on a paused session.
        if (active.status === "running") {
          const paused = await pauseStopwatch(client, { apiKey, sessionId: active.session_id, auditHeaders });
          if (!paused.ok) {
            setStopError(paused.error.kind === "permission" ? t("timer.errors.permission") : t("timer.errors.stop"));
            void refresh();
            return;
          }
          applySession(paused.data.data, Date.now());
        }
        const result = await logStopwatch(client, {
          apiKey,
          sessionId: active.session_id,
          start_time: overrides.start_time,
          end_time: overrides.end_time,
          notes: overrides.notes,
          service_id: overrides.service_id,
          is_billable: overrides.is_billable,
          auditHeaders,
        });
        if (!result.ok) {
          if (result.error.kind === "http" && result.error.status === 409) {
            // Locked time sheet: nothing was written, the session stays paused.
            setStopError(t("timer.errors.sheetLocked"));
          } else if (result.error.kind === "validation") {
            setStopError(getApiErrorMessage(result.error.body) ?? t("timer.errors.stop"));
          } else if (result.error.kind === "permission") {
            setStopError(t("timer.errors.permission"));
          } else {
            setStopError(t("timer.errors.stop"));
            // Session may have been logged or discarded from another device.
            void refresh();
          }
          return;
        }
        const entry = result.data.data?.time_entry;
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
      mutating,
      defaultService,
      lastStopped,
      client,
      apiKey,
      refresh,
      start,
      pause,
      resume,
      discard,
      openStopModal,
    }),
    [
      status, active, offsetMs, starting, mutating, defaultService, lastStopped, client, apiKey,
      refresh, start, pause, resume, discard, openStopModal,
    ],
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
        submitting={stopSubmitting || mutating}
        error={stopError}
        willStartNext={Boolean(stopModal.thenStart)}
        onClose={() => {
          if (!stopSubmitting) setStopModal({ open: false });
        }}
        onSubmit={(overrides) => void submitStop(overrides)}
        onDiscard={() => void discard()}
      />
    </TimerContext.Provider>
  );
}
