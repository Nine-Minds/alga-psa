import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { getAppConfig } from "../config/appConfig";

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
      <Centered>
        <Text style={{ fontSize: 16, color: "#B91C1C", textAlign: "center" }}>
          {config.error}
        </Text>
      </Centered>
    );
  }

  if (authState.status === "booting") {
    return (
      <Centered>
        <Text style={{ fontSize: 16 }}>Loading…</Text>
      </Centered>
    );
  }

  if (authState.status === "signedOut") {
    return (
      <Centered>
        <Text style={{ fontSize: 18, fontWeight: "600" }}>Sign in</Text>
        <Text style={{ marginTop: 8, textAlign: "center" }}>
          Mobile auth is not wired yet. Next: add browser-based SSO handoff.
        </Text>
      </Centered>
    );
  }

  return (
    <Centered>
      <Text style={{ fontSize: 18, fontWeight: "600" }}>Signed in</Text>
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      {children}
    </View>
  );
}
