import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Platform, Pressable, Text } from "react-native";
import { Feather } from "@expo/vector-icons";
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
  const { t: tTickets } = useTranslation("tickets");

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
            options={({ navigation }) => ({
              title: tTickets("list.title", "Tickets"),
              headerBackTitle: tTickets("list.title", "Tickets"),
              ...(Platform.OS === "android" ? {
                headerTitleAlign: "left" as const,
                headerLeft: () => (
                  <Pressable
                    onPress={() => navigation.goBack()}
                    accessibilityRole="button"
                    accessibilityLabel={tTickets("list.title", "Tickets")}
                    style={{ flexDirection: "row", alignItems: "center", marginRight: 8 }}
                  >
                    <Feather name="chevron-left" size={24} color={theme.colors.text} />
                    <Text style={{ color: theme.colors.text, fontSize: 16, marginLeft: 2 }}>
                      {tTickets("list.title", "Tickets")}
                    </Text>
                  </Pressable>
                ),
              } : {}),
            })}
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
