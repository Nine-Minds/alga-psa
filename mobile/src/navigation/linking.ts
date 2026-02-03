import * as Linking from "expo-linking";
import type { LinkingOptions } from "@react-navigation/native";
import type { RootStackParamList } from "./types";
import { logger } from "../logging/logger";

const EXPO_PREFIX = Linking.createURL("/");
const ALLOWED_PREFIXES = [EXPO_PREFIX, "alga://"] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isAllowedPath(path: string): boolean {
  if (path === "signin") return true;
  if (path === "auth/callback") return true;
  if (path === "tickets") return true;
  if (path === "settings") return true;
  const ticketMatch = /^ticket\/(.+)$/.exec(path);
  if (ticketMatch) return UUID_RE.test(ticketMatch[1] ?? "");
  return false;
}

function safeDeepLinkUrl(rawUrl: string): string | null {
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

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [EXPO_PREFIX, "alga://"],
  getInitialURL: async () => {
    const url = await Linking.getInitialURL();
    if (!url) return null;
    const safe = safeDeepLinkUrl(url);
    if (!safe) {
      const parsed = Linking.parse(url);
      logger.warn("Rejected initial deep link URL", {
        scheme: parsed.scheme,
        hostname: parsed.hostname,
        path: parsed.path,
      });
      return null;
    }
    return safe;
  },
  subscribe: (listener) => {
    const subscription = Linking.addEventListener("url", ({ url }) => {
      const safe = safeDeepLinkUrl(url);
      if (safe) listener(safe);
      else {
        const parsed = Linking.parse(url);
        logger.warn("Rejected deep link URL", {
          scheme: parsed.scheme,
          hostname: parsed.hostname,
          path: parsed.path,
        });
      }
    });
    return () => subscription.remove();
  },
  config: {
    screens: {
      SignIn: "signin",
      AuthCallback: "auth/callback",
      TicketDetail: "ticket/:ticketId",
      Tabs: {
        screens: {
          TicketsTab: {
            screens: {
              TicketsList: "tickets",
            },
          },
          SettingsTab: "settings",
        },
      },
    },
  },
};
