import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import type { TabsParamList } from "./types";
import { TicketsStackNavigator } from "./TicketsStackNavigator";
import { SettingsScreen } from "../screens/SettingsScreen";

const Tabs = createBottomTabNavigator<TabsParamList>();

export function TabsNavigator() {
  return (
    <Tabs.Navigator>
      <Tabs.Screen
        name="TicketsTab"
        component={TicketsStackNavigator}
        options={{ title: "Tickets", headerShown: false }}
      />
      <Tabs.Screen name="SettingsTab" component={SettingsScreen} options={{ title: "Settings" }} />
    </Tabs.Navigator>
  );
}

