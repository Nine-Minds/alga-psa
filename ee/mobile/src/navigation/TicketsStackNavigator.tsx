import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { TicketsStackParamList } from "./types";
import { TicketsListScreen } from "../screens/TicketsListScreen";
import { useTranslation } from "react-i18next";
import { useTheme } from "../ui/ThemeContext";

const Stack = createNativeStackNavigator<TicketsStackParamList>();

export function TicketsStackNavigator() {
  const theme = useTheme();
  const { t: tTickets } = useTranslation("tickets");
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
      <Stack.Screen
        name="TicketsList"
        component={TicketsListScreen}
        options={{ title: tTickets("list.title", "Tickets") }}
      />
    </Stack.Navigator>
  );
}
