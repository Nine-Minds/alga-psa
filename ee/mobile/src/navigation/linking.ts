import * as Linking from "expo-linking";
import type { LinkingOptions } from "@react-navigation/native";
import type { RootStackParamList } from "./types";
import { logger } from "../logging/logger";

const EXPO_PREFIX = Linking.createURL("/");
const ALLOWED_PREFIXES = [EXPO_PREFIX, "alga://"] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Hosted web ticket URLs reach the app through iOS Universal Links / Android
// App Links (declared in app.json). They are folded into the alga:// shape so
// the rest of the config has a single ticket route.
const HOSTED_TICKET_URL_RE =
  /^https:\/\/algapsa\.com\/msp\/tickets\/([0-9a-f-]{36})(?:[/?#].*)?$/i;

export function normalizeHostedTicketUrl(rawUrl: string): string {
  const match = HOSTED_TICKET_URL_RE.exec(rawUrl);
  return match ? `alga://ticket/${match[1].toLowerCase()}` : rawUrl;
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
  return false;
}

function safeDeepLinkUrl(url: string): string | null {
  const rawUrl = normalizeHostedTicketUrl(url);
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

function requiresSession(url: string): boolean {
  return url.startsWith("alga://ticket/");
}

function rejectUrl(url: string, message: string): void {
  const parsed = Linking.parse(url);
  logger.warn(message, { scheme: parsed.scheme, hostname: parsed.hostname, path: parsed.path });
}

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [EXPO_PREFIX, "alga://", "https://algapsa.com"],
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
