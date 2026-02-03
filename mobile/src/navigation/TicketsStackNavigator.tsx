import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { TicketsStackParamList } from "./types";
import { TicketsListScreen } from "../screens/TicketsListScreen";
import { t } from "../i18n/i18n";

const Stack = createNativeStackNavigator<TicketsStackParamList>();

export function TicketsStackNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="TicketsList"
        component={TicketsListScreen}
        options={{ title: t("tickets.title") }}
      />
    </Stack.Navigator>
  );
}
