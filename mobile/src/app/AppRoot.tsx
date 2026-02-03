import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { getAppConfig } from "../config/appConfig";
import { linking } from "../navigation/linking";
import { RootNavigator } from "../navigation/RootNavigator";
import { ErrorState, LoadingState } from "../ui/states";
import { useNetworkStatus } from "../network/useNetworkStatus";
import { OfflineBanner } from "../ui/components/OfflineBanner";

type AuthState =
  | { status: "booting" }
  | { status: "signedOut" }
  | { status: "signedIn" };

export function AppRoot() {
  const config = useMemo(() => getAppConfig(), []);
  const [authState, setAuthState] = useState<AuthState>({ status: "booting" });
  const network = useNetworkStatus();

  useEffect(() => {
    let canceled = false;

    const run = async () => {
      if (!config.ok) {
        if (!canceled) setAuthState({ status: "signedOut" });
        return;
      }

      await Promise.resolve();
      if (!canceled) setAuthState({ status: "signedOut" });
    };

    void run();
    return () => {
      canceled = true;
    };
  }, [config]);

  if (!config.ok) {
    return (
      <ErrorState title="Configuration error" description={config.error} />
    );
  }

  if (authState.status === "booting") {
    return <LoadingState message="Loading…" />;
  }

  return (
    <View style={{ flex: 1 }}>
      {network.isConnected === false ? <OfflineBanner onRetry={() => {}} /> : null}
      <View style={{ flex: 1 }}>
        <NavigationContainer linking={linking}>
          <RootNavigator isSignedIn={authState.status === "signedIn"} />
        </NavigationContainer>
      </View>
    </View>
  );
}
