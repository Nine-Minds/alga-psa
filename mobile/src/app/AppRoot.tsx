import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { getAppConfig } from "../config/appConfig";
import { linking } from "../navigation/linking";
import { RootNavigator } from "../navigation/RootNavigator";
import { ErrorState, LoadingState } from "../ui/states";
import { useNetworkStatus } from "../network/useNetworkStatus";
import { OfflineBanner } from "../ui/components/OfflineBanner";
import { AuthContext, type MobileSession } from "../auth/AuthContext";

export function AppRoot() {
  const config = useMemo(() => getAppConfig(), []);
  const [bootStatus, setBootStatus] = useState<"booting" | "ready">("booting");
  const [session, setSession] = useState<MobileSession | null>(null);
  const network = useNetworkStatus();

  useEffect(() => {
    let canceled = false;

    const run = async () => {
      if (!config.ok) {
        if (!canceled) setBootStatus("ready");
        return;
      }

      await Promise.resolve();
      if (!canceled) setBootStatus("ready");
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

  if (bootStatus === "booting") {
    return <LoadingState message="Loading…" />;
  }

  return (
    <AuthContext.Provider value={{ session, setSession }}>
      <View style={{ flex: 1 }}>
        {network.isConnected === false ? <OfflineBanner onRetry={() => {}} /> : null}
        <View style={{ flex: 1 }}>
          <NavigationContainer linking={linking}>
            <RootNavigator isSignedIn={session !== null} />
          </NavigationContainer>
        </View>
      </View>
    </AuthContext.Provider>
  );
}
