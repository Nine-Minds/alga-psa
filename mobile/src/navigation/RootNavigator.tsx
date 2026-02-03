import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { RootStackParamList } from "./types";
import { TabsNavigator } from "./TabsNavigator";
import { SignInScreen } from "../screens/SignInScreen";
import { TicketDetailScreen } from "../screens/TicketDetailScreen";
import { t } from "../i18n/i18n";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <Stack.Navigator>
      {isSignedIn ? (
        <>
          <Stack.Screen name="Tabs" component={TabsNavigator} options={{ headerShown: false }} />
          <Stack.Screen
            name="TicketDetail"
            component={TicketDetailScreen}
            options={{ title: "Ticket" }}
          />
        </>
      ) : (
        <Stack.Screen
          name="SignIn"
          component={SignInScreen}
          options={{ title: t("auth.signIn.title") }}
        />
      )}
    </Stack.Navigator>
  );
}
