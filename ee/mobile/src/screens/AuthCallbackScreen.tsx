import React, { useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Application from "expo-application";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../navigation/types";
import { ErrorState, LoadingState } from "../ui/states";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { logger } from "../logging/logger";
import {
  clearPendingAppleLink,
  clearPendingMobileAuth,
  clearReceivedOtt,
  getPendingAppleLink,
  getPendingMobileAuth,
  storeReceivedOtt,
} from "../auth/mobileAuth";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import { exchangeOttWithRetry } from "../api/mobileAuth";
import { useAuth } from "../auth/AuthContext";
import { getStableDeviceId } from "../device/clientMetadata";
import { analytics } from "../analytics/analytics";
import { MobileAnalyticsEvents } from "../analytics/events";
import { getTicketStats } from "../api/tickets";
import { linkAppleId } from "../api/appleAuth";
import { decodeQaSession, parseTicketRichTextQaScenario } from "../qa/ticketRichTextQa";

type Props = NativeStackScreenProps<RootStackParamList, "AuthCallback">;

function mapAuthCallbackError(code: string, t: (key: string) => string): string {
  const normalized = code.trim().toLowerCase();
  switch (normalized) {
    case "invalid_redirect":
      return t("callback.errors.invalidRedirect");
    case "rate_limited":
      return t("callback.errors.rateLimited");
    case "client_not_allowed":
      return t("callback.errors.clientNotAllowed");
    case "host_not_allowlisted":
      return t("callback.errors.hostNotAllowlisted");
    default:
      return code;
  }
}

export function AuthCallbackScreen({ navigation, route }: Props) {
  const { t } = useTranslation("auth");
  const [error, setError] = useState<string | null>(null);
  const { setSession } = useAuth();
  const exchangeInFlight = useRef(false);

  useEffect(() => {
    let canceled = false;
    const abortController = new AbortController();

    const run = async () => {
      if (exchangeInFlight.current) return;
      exchangeInFlight.current = true;
      try {
        const qaOtt = __DEV__ && typeof route.params?.qaOtt === "string" ? route.params.qaOtt.trim() : "";
        const qaState = __DEV__ && typeof route.params?.qaState === "string" ? route.params.qaState.trim() : "";
        const ott = qaOtt || route.params?.ott;
        const state = qaState || route.params?.state;
        const callbackError = route.params?.error;
        const qaSession = decodeQaSession(route.params?.qaSession);
        const qaScenario = parseTicketRichTextQaScenario(route.params?.qaScenario);
        const qaTargetTicketId = route.params?.qaTargetTicketId;

        if (callbackError) {
          analytics.trackEvent(MobileAnalyticsEvents.authCallbackFailed, { reason: callbackError });
          setError(mapAuthCallbackError(callbackError, t));
          return;
        }

        if (qaSession) {
          await Promise.allSettled([clearPendingMobileAuth(), clearReceivedOtt()]);
          setSession(qaSession);
          void canceled;
          if (qaTargetTicketId && qaScenario) {
            setTimeout(() => {
              if (canceled) {
                return;
              }

              navigation.reset({
                index: 1,
                routes: [
                  { name: "Tabs" },
                  {
                    name: "TicketDetail",
                    params: {
                      ticketId: qaTargetTicketId,
                      qaScenario,
                    },
                  },
                ],
              });
            }, 0);
          }
          return;
        }

        if (!ott || !state) {
          analytics.trackEvent(MobileAnalyticsEvents.authCallbackFailed, { reason: "missing_params" });
          setError(t("callback.errors.missingParams"));
          return;
        }

        if (!qaOtt) {
          const pending = await getPendingMobileAuth();
          if (!pending || pending.state !== state) {
            analytics.trackEvent(MobileAnalyticsEvents.authCallbackFailed, { reason: "state_mismatch" });
            setError(t("callback.errors.stateMismatch"));
            return;
          }

          await storeReceivedOtt(ott, state);
        }

        const config = getAppConfig();
        if (!config.ok) {
          setError(config.error);
          return;
        }

        const client = createApiClient({
          baseUrl: config.baseUrl,
          getUserAgentTag: () => `mobile/${Platform.OS}`,
        });

        const deviceId = await getStableDeviceId();

        const device = {
          platform: Platform.OS,
          appVersion: Application.nativeApplicationVersion ?? undefined,
          buildVersion: Application.nativeBuildVersion ?? undefined,
          deviceId,
        };

        const exchanged = await exchangeOttWithRetry(
          client,
          { ott, state, device },
          { maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 2_000 },
          abortController.signal,
        );
        if (!exchanged.ok) {
          analytics.trackEvent(MobileAnalyticsEvents.authExchangeFailed, {
            errorKind: exchanged.error.kind,
            status: exchanged.status ?? null,
          });
          setError(exchanged.error.message);
          return;
        }

        analytics.trackEvent(MobileAnalyticsEvents.authExchangeSucceeded, {
          expiresInSec: exchanged.data.expiresInSec,
        });

        // Detect users who can authenticate but lack basic ticket permissions.
        const ticketCheckClient = createApiClient({
          baseUrl: config.baseUrl,
          getUserAgentTag: () => `mobile/${Platform.OS}`,
        });
        const ticketCheck = await getTicketStats(ticketCheckClient, { apiKey: exchanged.data.accessToken });
        if (!ticketCheck.ok && ticketCheck.error.kind === "permission") {
          analytics.trackEvent(MobileAnalyticsEvents.authExchangeFailed, {
            errorKind: "permission",
            status: ticketCheck.status ?? null,
          });
          await Promise.allSettled([clearPendingMobileAuth(), clearReceivedOtt()]);
          setError(t("callback.errors.noPermission"));
          return;
        }

        const pendingAppleLink = qaOtt ? null : await getPendingAppleLink();
        if (pendingAppleLink?.state === state) {
          try {
            const appleLinkClient = createApiClient({
              baseUrl: config.baseUrl,
              getAccessToken: () => exchanged.data.accessToken,
              getTenantId: () => exchanged.data.tenantId,
              getUserAgentTag: () => `mobile/${Platform.OS}/apple-link-after-signin`,
            });
            const appleLinkResult = await linkAppleId(appleLinkClient, {
              identityToken: pendingAppleLink.identityToken,
              authorizationCode: pendingAppleLink.authorizationCode,
            });
            if (!appleLinkResult.ok) {
              logger.warn("Post-sign-in Apple link failed", {
                status: appleLinkResult.status ?? null,
                errorKind: appleLinkResult.error.kind,
              });
            }
          } catch (e) {
            logger.warn("Post-sign-in Apple link threw", { error: e });
          } finally {
            await clearPendingAppleLink();
          }
        }

        const expiresAtMs = Date.now() + exchanged.data.expiresInSec * 1000;
        setSession({
          accessToken: exchanged.data.accessToken,
          refreshToken: exchanged.data.refreshToken,
          expiresAtMs,
          tenantId: exchanged.data.tenantId,
          user: exchanged.data.user,
        });
        await clearPendingMobileAuth();
        await clearReceivedOtt();
      } catch (e) {
        logger.error("Failed to handle auth callback", { error: e });
        if (!canceled) setError(t("callback.errors.failedComplete"));
      } finally {
        exchangeInFlight.current = false;
      }
    };

    void run();
    return () => {
      canceled = true;
      abortController.abort();
    };
  }, [
    navigation,
    route.params?.error,
    route.params?.ott,
    route.params?.qaOtt,
    route.params?.qaScenario,
    route.params?.qaSession,
    route.params?.qaState,
    route.params?.qaTargetTicketId,
    route.params?.state,
  ]);

  if (error) {
    return (
      <ErrorState
        title={t("callback.failed")}
        description={error}
        action={
          <PrimaryButton onPress={() => navigation.reset({ index: 0, routes: [{ name: "SignIn" }] })}>
            {t("callback.backToSignIn")}
          </PrimaryButton>
        }
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <LoadingState message={t("callback.completing")} />
    </View>
  );
}
