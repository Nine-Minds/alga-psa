import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import type { TabsParamList } from "./types";
import { TicketsStackNavigator } from "./TicketsStackNavigator";
import { SettingsScreen } from "../screens/SettingsScreen";
import { useTranslation } from "react-i18next";
import { useTheme } from "../ui/ThemeContext";

const Tabs = createBottomTabNavigator<TabsParamList>();

export function TabsNavigator() {
  const theme = useTheme();
  const { t: tTickets } = useTranslation("tickets");
  const { t: tSettings } = useTranslation("settings");
  return (
    <Tabs.Navigator
      screenOptions={{
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.colors.card,
          borderTopColor: theme.colors.border,
        },
        headerStyle: {
          backgroundColor: theme.colors.card,
        },
        headerTintColor: theme.colors.text,
        headerTitleStyle: {
          color: theme.colors.text,
          fontWeight: "600" as const,
        },
      }}
    >
      <Tabs.Screen
        name="TicketsTab"
        component={TicketsStackNavigator}
        options={{
          title: tTickets("list.title", "Tickets"),
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="ticket-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="SettingsTab"
        component={SettingsScreen}
        options={{
          title: tSettings("title", "Settings"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs.Navigator>
  );
}
