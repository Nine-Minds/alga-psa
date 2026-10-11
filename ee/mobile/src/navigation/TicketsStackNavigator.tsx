import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Pressable, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { DrawerActions, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { TicketsStackParamList } from "./types";
import type { RootStackParamList } from "./types";
import { TicketsListScreen } from "../screens/TicketsListScreen";
import { useTranslation } from "react-i18next";
import { useTheme } from "../ui/ThemeContext";
import { HeaderTimerChip } from "../features/timer/components/HeaderTimerChip";
import { HeaderAddButton } from "../ui/components/HeaderAddButton";

const Stack = createNativeStackNavigator<TicketsStackParamList>();

function DrawerToggleButton() {
  const theme = useTheme();
  const { t } = useTranslation("common");
  const navigation = useNavigation();
  return (
    <Pressable
      onPress={() => navigation.dispatch(DrawerActions.toggleDrawer())}
      accessibilityRole="button"
      accessibilityLabel={t("menu", { defaultValue: "Menu" })}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Feather name="menu" size={22} color={theme.colors.text} />
    </Pressable>
  );
}

function CreateTicketButton() {
  const { t } = useTranslation("tickets");
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return <HeaderAddButton onPress={() => navigation.navigate("CreateTicket")} accessibilityLabel={t("list.createTicket")} />;
}

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
        options={{
          title: tTickets("list.title", "Tickets"),
          headerLeft: () => <DrawerToggleButton />,
          headerRight: () => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
              <HeaderTimerChip />
              <CreateTicketButton />
            </View>
          ),
        }}
      />
    </Stack.Navigator>
  );
}
