import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Pressable, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { TicketsStackParamList } from "./types";
import type { RootStackParamList } from "./types";
import { TicketsListScreen } from "../screens/TicketsListScreen";
import { useTranslation } from "react-i18next";
import { useTheme } from "../ui/ThemeContext";

const Stack = createNativeStackNavigator<TicketsStackParamList>();

function CreateTicketButton() {
  const theme = useTheme();
  const { t } = useTranslation("tickets");
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <Pressable
      onPress={() => navigation.navigate("CreateTicket")}
      accessibilityRole="button"
      accessibilityLabel={t("list.createTicket")}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: theme.colors.primary,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Feather name="plus" size={20} color={theme.colors.textInverse} />
    </Pressable>
  );
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
          headerRight: () => <View><CreateTicketButton /></View>,
        }}
      />
    </Stack.Navigator>
  );
}
