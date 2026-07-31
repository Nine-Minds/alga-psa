import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../api";
import { listScheduleEntries, type ScheduleEntry } from "../../api/schedule";
import {
  getCachedScheduleWeek,
  invalidateScheduleWeek,
  scheduleWeekCacheKey,
  setCachedScheduleWeek,
} from "../../cache/scheduleCache";
import { logger } from "../../logging/logger";
import { syncScheduleReminders } from "../../notifications/scheduleReminders";
import { dateFromKey, groupEntriesByDay, weekQueryRange } from "./scheduleUtils";

export function useScheduleWeek({
  client,
  apiKey,
  userId,
  weekStartKey,
}: {
  client: ApiClient | null;
  apiKey: string | null;
  userId: string | null;
  weekStartKey: string;
}) {
  const { t } = useTranslation("schedule");
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cacheKey = scheduleWeekCacheKey(userId ?? "anon", weekStartKey);

  const load = useCallback(
    async ({ force }: { force?: boolean } = {}) => {
      if (!client || !apiKey) return;
      const weekStart = dateFromKey(weekStartKey);
      if (!weekStart) return;

      const { startIso: windowStartIso, endIso: windowEndIso } = weekQueryRange(weekStart);

      if (!force) {
        const cached = getCachedScheduleWeek(cacheKey);
        if (cached) {
          setEntries(cached);
          setError(null);
          setNoAccess(false);
          void syncScheduleReminders(cached, { startIso: windowStartIso, endIso: windowEndIso });
          return;
        }
      }

      abortRef.current?.abort();
      const abortController = new AbortController();
      abortRef.current = abortController;

      const result = await listScheduleEntries(client, {
        apiKey,
        startDate: windowStartIso,
        endDate: windowEndIso,
        userId: userId ?? undefined,
        signal: abortController.signal,
      });

      if (abortRef.current === abortController) abortRef.current = null;
      if (abortController.signal.aborted) return;

      if (!result.ok) {
        if (result.error.kind === "canceled") return;
        logger.warn("Schedule list fetch failed", { error: result.error });
        if (result.error.kind === "permission") {
          setEntries([]);
          setNoAccess(true);
          setError(null);
          return;
        }
        setError(t("list.unableToLoadDescription", { defaultValue: "We couldn't load your schedule. Pull to refresh or try again." }));
        return;
      }

      const next = Array.isArray(result.data.data) ? result.data.data : [];
      setEntries(next);
      setError(null);
      setNoAccess(false);
      setCachedScheduleWeek(cacheKey, next);
      void syncScheduleReminders(next, { startIso: windowStartIso, endIso: windowEndIso });
    },
    [apiKey, cacheKey, client, t, userId, weekStartKey],
  );

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      setLoading(true);
      await load();
      if (!canceled) setLoading(false);
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [load]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const refresh = useCallback(async () => {
    invalidateScheduleWeek(cacheKey);
    await load({ force: true });
  }, [cacheKey, load]);

  const entriesByDay = useMemo(() => groupEntriesByDay(entries), [entries]);

  return { entries, entriesByDay, loading, error, noAccess, refresh };
}
