import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

export const reactNavigationIntegration = Sentry.reactNavigationIntegration();

let initialized = false;

export function initSentry() {
  if (initialized || !DSN) return;
  initialized = true;

  Sentry.init({
    dsn: DSN,
    environment: process.env.EXPO_PUBLIC_ALGA_ENV ?? "dev",
    release: `${Constants.expoConfig?.version ?? "0.0.0"}+${
      Constants.expoConfig?.ios?.buildNumber ??
      Constants.expoConfig?.android?.versionCode ??
      "0"
    }`,
    enabled: !__DEV__,
    tracesSampleRate: 0.2,
    sendDefaultPii: false,
    integrations: [reactNavigationIntegration],
  });
}

export function captureException(error: unknown, context?: Record<string, unknown>) {
  if (!initialized) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

export function setUser(user: { id: string; email?: string; tenantId?: string } | null) {
  if (!initialized) return;
  if (user) {
    Sentry.setUser({ id: user.id, email: user.email });
    if (user.tenantId) Sentry.setTag("tenant", user.tenantId);
  } else {
    Sentry.setUser(null);
  }
}
