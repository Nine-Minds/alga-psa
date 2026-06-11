import { createDrawerNavigator } from "@react-navigation/drawer";
import { Feather } from "@expo/vector-icons";
import type { DrawerParamList } from "./types";
import { TicketsStackNavigator } from "./TicketsStackNavigator";
import { ScheduleScreen } from "../screens/ScheduleScreen";
import { TimeEntriesScreen } from "../screens/TimeEntriesScreen";
import { ClientsListScreen } from "../screens/ClientsListScreen";
import { ContactsListScreen } from "../screens/ContactsListScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { useTranslation } from "react-i18next";
import { useTheme } from "../ui/ThemeContext";

const Drawer = createDrawerNavigator<DrawerParamList>();

export function DrawerNavigator() {
  const theme = useTheme();
  const { t: tTickets } = useTranslation("tickets");
  const { t: tSchedule } = useTranslation("schedule");
  const { t: tTimeEntries } = useTranslation("timeEntries");
  const { t: tClients } = useTranslation("clients");
  const { t: tContacts } = useTranslation("contacts");
  const { t: tSettings } = useTranslation("settings");
  return (
    <Drawer.Navigator
      screenOptions={{
        drawerActiveTintColor: theme.colors.primary,
        drawerInactiveTintColor: theme.colors.textSecondary,
        drawerStyle: {
          backgroundColor: theme.colors.card,
        },
        headerStyle: {
          backgroundColor: theme.colors.card,
        },
        headerTintColor: theme.colors.text,
        headerTitleStyle: {
          color: theme.colors.text,
          fontWeight: "600" as const,
        },
        sceneStyle: {
          backgroundColor: theme.colors.background,
        },
      }}
    >
      <Drawer.Screen
        name="TicketsTab"
        component={TicketsStackNavigator}
        options={{
          title: tTickets("list.title", "Tickets"),
          headerShown: false,
          drawerIcon: ({ color, size }) => (
            <Feather name="tag" size={size} color={color} />
          ),
        }}
      />
      <Drawer.Screen
        name="ScheduleTab"
        component={ScheduleScreen}
        options={{
          title: tSchedule("title", "Schedule"),
          drawerIcon: ({ color, size }) => (
            <Feather name="calendar" size={size} color={color} />
          ),
        }}
      />
      <Drawer.Screen
        name="TimeEntriesTab"
        component={TimeEntriesScreen}
        options={{
          title: tTimeEntries("title", "Time Entries"),
          drawerIcon: ({ color, size }) => (
            <Feather name="clock" size={size} color={color} />
          ),
        }}
      />
      <Drawer.Screen
        name="ClientsTab"
        component={ClientsListScreen}
        options={{
          title: tClients("title", "Clients"),
          drawerIcon: ({ color, size }) => (
            <Feather name="briefcase" size={size} color={color} />
          ),
        }}
      />
      <Drawer.Screen
        name="ContactsTab"
        component={ContactsListScreen}
        options={{
          title: tContacts("title", "Contacts"),
          drawerIcon: ({ color, size }) => (
            <Feather name="users" size={size} color={color} />
          ),
        }}
      />
      <Drawer.Screen
        name="SettingsTab"
        component={SettingsScreen}
        options={{
          title: tSettings("title", "Settings"),
          drawerIcon: ({ color, size }) => (
            <Feather name="settings" size={size} color={color} />
          ),
        }}
      />
    </Drawer.Navigator>
  );
}
