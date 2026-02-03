import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Application from "expo-application";
import type { RootStackParamList } from "../navigation/types";
import { ErrorState, LoadingState } from "../ui/states";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { logger } from "../logging/logger";
import { clearPendingMobileAuth, clearReceivedOtt, getPendingMobileAuth, storeReceivedOtt } from "../auth/mobileAuth";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import { exchangeOtt } from "../api/mobileAuth";
import { useAuth } from "../auth/AuthContext";

type Props = NativeStackScreenProps<RootStackParamList, "AuthCallback">;

export function AuthCallbackScreen({ navigation, route }: Props) {
  const [error, setError] = useState<string | null>(null);
  const { setSession } = useAuth();

  useEffect(() => {
    let canceled = false;

    const run = async () => {
      try {
        const ott = route.params?.ott;
        const state = route.params?.state;
        const callbackError = route.params?.error;

        if (callbackError) {
          setError(callbackError);
          return;
        }

        if (!ott || !state) {
          setError("Missing required sign-in parameters.");
          return;
        }

        const pending = await getPendingMobileAuth();
        if (!pending || pending.state !== state) {
          setError("This sign-in link is not valid for the current session. Please try again.");
          return;
        }

        await storeReceivedOtt(ott, state);

        const config = getAppConfig();
        if (!config.ok) {
          setError(config.error);
          return;
        }

        const client = createApiClient({
          baseUrl: config.baseUrl,
          getUserAgentTag: () => `mobile/${Platform.OS}`,
        });

        const device = {
          platform: Platform.OS,
          appVersion: Application.nativeApplicationVersion ?? undefined,
        };

        const exchanged = await exchangeOtt(client, { ott, state, device });
        if (!exchanged.ok) {
          const message =
            exchanged.error.kind === "http"
              ? `Sign-in failed (HTTP ${exchanged.status ?? "error"}).`
              : exchanged.error.message;
          setError(message);
          return;
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

        if (!canceled) navigation.reset({ index: 0, routes: [{ name: "Tabs" }] });
      } catch (e) {
        logger.error("Failed to handle auth callback", { error: e });
        if (!canceled) setError("Failed to complete sign-in. Please try again.");
      }
    };

    void run();
    return () => {
      canceled = true;
    };
  }, [navigation, route.params?.error, route.params?.ott, route.params?.state]);

  if (error) {
    return (
      <ErrorState
        title="Sign-in failed"
        description={error}
        action={
          <PrimaryButton onPress={() => navigation.reset({ index: 0, routes: [{ name: "SignIn" }] })}>
            Back to sign-in
          </PrimaryButton>
        }
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <LoadingState message="Completing sign-in…" />
    </View>
  );
}
