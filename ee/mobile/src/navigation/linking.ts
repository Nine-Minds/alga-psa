import * as Linking from "expo-linking";
import type { LinkingOptions } from "@react-navigation/native";
import type { RootStackParamList } from "./types";
import { logger } from "../logging/logger";
import { matchRecordPath } from "../urls/recordLinks";

const EXPO_PREFIX = Linking.createURL("/");
const ALLOWED_PREFIXES = [EXPO_PREFIX, "alga://"] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Hosted web record URLs reach the app through iOS Universal Links / Android
// App Links (declared in app.json). They are folded into the alga:// shape so
// the rest of the config has a single route per record. The path grammar is
// the shared resolver's (matchRecordPath); only the trusted hosted origin and
// the UUID shape are checked here.
const HOSTED_ORIGIN_RE = /^https:\/\/algapsa\.com(?=[/?#]|$)/i;

export function normalizeHostedRecordUrl(rawUrl: string): string {
  const origin = HOSTED_ORIGIN_RE.exec(rawUrl);
  if (!origin) return rawUrl;
  const match = matchRecordPath(rawUrl.slice(origin[0].length));
  if (!match || !UUID_RE.test(match.id)) return rawUrl;
  const id = match.id.toLowerCase();
  switch (match.entityType) {
    case "ticket":
      return `alga://ticket/${id}`;
    case "asset":
      return `alga://asset/${id}`;
    case "stock_unit":
      return `alga://stock-unit/${id}`;
    case "project_task":
      return match.projectId && UUID_RE.test(match.projectId) ? `alga://project-task/${id}` : rawUrl;
    default:
      return rawUrl;
  }
}

function isAllowedPath(path: string): boolean {
  if (path === "signin") return true;
  if (path === "server") return true;
  if (path === "auth/callback") return true;
  if (path === "tickets") return true;
  if (path === "schedule") return true;
  if (path === "time-entries") return true;
  if (path === "clients") return true;
  if (path === "contacts") return true;
  if (path === "settings") return true;
  const ticketMatch = /^ticket\/(.+)$/.exec(path);
  if (ticketMatch) return UUID_RE.test(ticketMatch[1] ?? "");
  const taskMatch = /^project-task\/(.+)$/.exec(path);
  if (taskMatch) return UUID_RE.test(taskMatch[1] ?? "");
  const assetMatch = /^asset\/(.+)$/.exec(path);
  if (assetMatch) return UUID_RE.test(assetMatch[1] ?? "");
  const unitMatch = /^stock-unit\/(.+)$/.exec(path);
  if (unitMatch) return UUID_RE.test(unitMatch[1] ?? "");
  return false;
}

function safeDeepLinkUrl(url: string): string | null {
  const rawUrl = normalizeHostedRecordUrl(url);
  if (!ALLOWED_PREFIXES.some((prefix) => rawUrl.startsWith(prefix))) return null;

  try {
    const parsed = Linking.parse(rawUrl);
    const combined =
      parsed.scheme === "alga"
        ? [parsed.hostname, parsed.path].filter(Boolean).join("/")
        : (parsed.path ?? "");
    const normalized = combined.replace(/^--\//, "").replace(/^\/+/, "");
    return isAllowedPath(normalized) ? rawUrl : null;
  } catch {
    return null;
  }
}

// Ticket links need the signed-in navigator. One that arrives while signed
// out is held here and replayed when the container remounts after sign-in.
let signedIn = false;
let pendingUrl: string | null = null;
let consumedInitialUrl: string | null = null;

export function setDeepLinkSignedIn(next: boolean): void {
  signedIn = next;
}

/**
 * True when the next container mount will be driven by a deep link. React
 * Navigation never calls `getInitialURL` while an `initialState` is supplied,
 * so restored navigation state must be skipped in that case or the link is
 * silently lost and the app opens on the last-visited screen instead.
 */
export async function hasPendingDeepLink(): Promise<boolean> {
  if (pendingUrl) return true;
  const url = await Linking.getInitialURL();
  if (!url || url === consumedInitialUrl) return false;
  return safeDeepLinkUrl(url) !== null;
}

function requiresSession(url: string): boolean {
  return (
    url.startsWith("alga://ticket/") ||
    url.startsWith("alga://project-task/") ||
    url.startsWith("alga://asset/") ||
    url.startsWith("alga://stock-unit/")
  );
}

function rejectUrl(url: string, message: string): void {
  const parsed = Linking.parse(url);
  logger.warn(message, { scheme: parsed.scheme, hostname: parsed.hostname, path: parsed.path });
}

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [EXPO_PREFIX, "alga://"],
  getInitialURL: async () => {
    if (pendingUrl && signedIn) {
      const url = pendingUrl;
      pendingUrl = null;
      return url;
    }
    const url = await Linking.getInitialURL();
    // The container remounts on every sign-in/out; the OS keeps answering with
    // the cold-start URL, which must only ever be followed once.
    if (!url || url === consumedInitialUrl) return null;
    const safe = safeDeepLinkUrl(url);
    if (!safe) {
      rejectUrl(url, "Rejected initial deep link URL");
      return null;
    }
    consumedInitialUrl = url;
    if (requiresSession(safe) && !signedIn) {
      pendingUrl = safe;
      return null;
    }
    return safe;
  },
  subscribe: (listener) => {
    const subscription = Linking.addEventListener("url", ({ url }) => {
      const safe = safeDeepLinkUrl(url);
      if (!safe) {
        rejectUrl(url, "Rejected deep link URL");
        return;
      }
      if (requiresSession(safe) && !signedIn) {
        pendingUrl = safe;
        return;
      }
      listener(safe);
    });
    return () => subscription.remove();
  },
  config: {
    screens: {
      SignIn: "signin",
      ServerEntry: "server",
      AuthCallback: "auth/callback",
      TicketDetail: "ticket/:ticketId",
      ProjectTaskDetail: "project-task/:taskId",
      AssetDetail: "asset/:assetId",
      StockUnitDetail: "stock-unit/:unitId",
      Tabs: {
        screens: {
          TicketsTab: {
            screens: {
              TicketsList: "tickets",
            },
          },
          ScheduleTab: "schedule",
          TimeEntriesTab: "time-entries",
          ClientsTab: "clients",
          ContactsTab: "contacts",
          SettingsTab: "settings",
        },
      },
    },
  },
};
