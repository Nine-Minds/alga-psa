import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import type { TabsParamList } from "./types";
import { TicketsStackNavigator } from "./TicketsStackNavigator";
import { SettingsScreen } from "../screens/SettingsScreen";
import { t } from "../i18n/i18n";

const Tabs = createBottomTabNavigator<TabsParamList>();

export function TabsNavigator() {
  return (
    <Tabs.Navigator>
      <Tabs.Screen
        name="TicketsTab"
        component={TicketsStackNavigator}
        options={{ title: t("tickets.title"), headerShown: false }}
      />
      <Tabs.Screen
        name="SettingsTab"
        component={SettingsScreen}
        options={{ title: t("settings.title") }}
      />
    </Tabs.Navigator>
  );
}
