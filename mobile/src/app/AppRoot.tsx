import { useEffect, useMemo, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { getAppConfig } from "../config/appConfig";
import { linking } from "../navigation/linking";
import { RootNavigator } from "../navigation/RootNavigator";
import { ErrorState, LoadingState } from "../ui/states";

type AuthState =
  | { status: "booting" }
  | { status: "signedOut" }
  | { status: "signedIn" };

export function AppRoot() {
  const config = useMemo(() => getAppConfig(), []);
  const [authState, setAuthState] = useState<AuthState>({ status: "booting" });

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
    <NavigationContainer linking={linking}>
      <RootNavigator isSignedIn={authState.status === "signedIn"} />
    </NavigationContainer>
  );
}
