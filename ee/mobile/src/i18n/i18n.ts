import * as Localization from "expo-localization";

type Locale = "en-US";

const messages: Record<Locale, Record<string, string>> = {
  "en-US": {
    "app.title": "Alga PSA Mobile",
    "auth.signIn.title": "Sign in",
    "auth.signIn.cta": "Continue in browser",
    "auth.signIn.opening": "Opening…",
    "auth.callback.title": "Signing in",
    "tickets.title": "Tickets",
    "settings.title": "Settings",
  },
};

function resolveLocale(): Locale {
  const tag = Localization.getLocales()[0]?.languageTag;
  return tag === "en-US" ? "en-US" : "en-US";
}

const locale = resolveLocale();

export function t(key: string): string {
  return messages[locale][key] ?? messages["en-US"][key] ?? key;
}
