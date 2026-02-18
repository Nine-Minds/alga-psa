import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { RootStackParamList } from "./types";
import { TabsNavigator } from "./TabsNavigator";
import { SignInScreen } from "../screens/SignInScreen";
import { TicketDetailScreen } from "../screens/TicketDetailScreen";
import { AuthCallbackScreen } from "../screens/AuthCallbackScreen";
import { t } from "../i18n/i18n";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <Stack.Navigator>
      {isSignedIn ? (
        <>
          <Stack.Screen name="Tabs" component={TabsNavigator} options={{ headerShown: false }} />
          <Stack.Screen
            name="AuthCallback"
            component={AuthCallbackScreen}
            options={{ title: t("auth.callback.title") }}
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
            options={{ title: t("auth.signIn.title") }}
          />
          <Stack.Screen
            name="AuthCallback"
            component={AuthCallbackScreen}
            options={{ title: t("auth.callback.title") }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}
