/**
 * Minimal UGC moderation hook (guideline 1.2).
 *
 * - Fetches the caller's mute list once per sign-in; subsequent mounts reuse
 *   the module-level cache so switching between ticket detail screens doesn't
 *   hit the server repeatedly.
 * - Exposes `mute`, `unmute`, and `report` actions that update the cache
 *   optimistically.
 *
 * Used by CommentsSection (and later, DescriptionSection) to filter muted
 * authors from view and expose the overflow-menu actions.
 */
import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";
import { createApiClient } from "../../api";
import { listMutedUsers, muteUser, reportContent, unmuteUser, type ReportContentRequest } from "../../api/moderation";
import { useAuth } from "../../auth/AuthContext";
import { getAppConfig } from "../../config/appConfig";
import { logger } from "../../logging/logger";

// Module-level cache: one entry per session-token prefix so that a new
// sign-in invalidates the cached list.
let cachedKey: string | null = null;
let cachedIds: Set<string> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch (e) {
      logger.warn("moderation listener threw", { error: e });
    }
  }
}

function setCache(key: string, ids: Set<string>) {
  cachedKey = key;
  cachedIds = ids;
  notify();
}

export function useModeration(): {
  mutedUserIds: Set<string>;
  isMuted: (userId: string | null | undefined) => boolean;
  mute: (userId: string) => Promise<boolean>;
  unmute: (userId: string) => Promise<boolean>;
  report: (body: ReportContentRequest) => Promise<boolean>;
} {
  const { session } = useAuth();
  const [ids, setIds] = useState<Set<string>>(() => cachedIds ?? new Set<string>());

  // Subscribe to module-level cache changes so sibling components re-render.
  useEffect(() => {
    const listener = () => setIds(new Set(cachedIds ?? []));
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const client = useCallback(() => {
    const config = getAppConfig();
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getAccessToken: () => session.accessToken,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => `mobile/${Platform.OS}/moderation`,
    });
  }, [session]);

  // Fetch once per session token change.
  useEffect(() => {
    if (!session) {
      cachedKey = null;
      cachedIds = null;
      setIds(new Set());
      return;
    }
    const key = session.accessToken.slice(0, 16);
    if (cachedKey === key && cachedIds) {
      setIds(new Set(cachedIds));
      return;
    }

    const api = client();
    if (!api) return;
    const controller = new AbortController();

    void (async () => {
      const res = await listMutedUsers(api, controller.signal);
      if (controller.signal.aborted) return;
      if (res.ok) {
        setCache(key, new Set(res.data.mutedUserIds));
      }
    })();

    return () => {
      controller.abort();
    };
  }, [session, client]);

  const mute = useCallback(
    async (userId: string): Promise<boolean> => {
      const api = client();
      if (!api) return false;
      const next = new Set(cachedIds ?? []);
      next.add(userId);
      setCache(cachedKey ?? session?.accessToken.slice(0, 16) ?? "", next);

      const res = await muteUser(api, { mutedUserId: userId });
      if (!res.ok) {
        // Roll back.
        next.delete(userId);
        setCache(cachedKey ?? "", next);
        return false;
      }
      return true;
    },
    [client, session],
  );

  const unmute = useCallback(
    async (userId: string): Promise<boolean> => {
      const api = client();
      if (!api) return false;
      const next = new Set(cachedIds ?? []);
      next.delete(userId);
      setCache(cachedKey ?? session?.accessToken.slice(0, 16) ?? "", next);

      const res = await unmuteUser(api, userId);
      if (!res.ok) {
        next.add(userId);
        setCache(cachedKey ?? "", next);
        return false;
      }
      return true;
    },
    [client, session],
  );

  const report = useCallback(
    async (body: ReportContentRequest): Promise<boolean> => {
      const api = client();
      if (!api) return false;
      const res = await reportContent(api, body);
      return res.ok;
    },
    [client],
  );

  const isMuted = useCallback((userId: string | null | undefined) => {
    if (!userId) return false;
    return ids.has(userId);
  }, [ids]);

  return { mutedUserIds: ids, isMuted, mute, unmute, report };
}
