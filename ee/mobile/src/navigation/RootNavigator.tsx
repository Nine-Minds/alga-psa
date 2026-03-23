import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { RootStackParamList } from "./types";
import { TabsNavigator } from "./TabsNavigator";
import { SignInScreen } from "../screens/SignInScreen";
import { TicketDetailScreen } from "../screens/TicketDetailScreen";
import { AuthCallbackScreen } from "../screens/AuthCallbackScreen";
import { useTranslation } from "react-i18next";
import { useTheme } from "../ui/ThemeContext";
import { useNotifications } from "../notifications/useNotifications";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator({ isSignedIn }: { isSignedIn: boolean }) {
  const theme = useTheme();
  const { t: tAuth } = useTranslation("auth");

  // Register push token and handle notification taps (no-op when feature flag is off)
  useNotifications();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.colors.card,
        },
        headerTintColor: theme.colors.text,
        headerTitleStyle: {
          color: theme.colors.text,
          fontWeight: "600" as const,
        },
        contentStyle: {
          backgroundColor: theme.colors.background,
        },
      }}
    >
      {isSignedIn ? (
        <>
          <Stack.Screen name="Tabs" component={TabsNavigator} options={{ headerShown: false }} />
          <Stack.Screen
            name="AuthCallback"
            component={AuthCallbackScreen}
            options={{ title: tAuth("callback.title", "Signing in") }}
          />
          <Stack.Screen
            name="TicketDetail"
            component={TicketDetailScreen}
            options={{ title: "Ticket" }}
          />
        </>
      ) : (
        <>
          <Stack.Screen
            name="SignIn"
            component={SignInScreen}
            options={{ title: tAuth("signIn.title", "Sign in") }}
          />
          <Stack.Screen
            name="AuthCallback"
            component={AuthCallbackScreen}
            options={{ title: tAuth("callback.title", "Signing in") }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}
