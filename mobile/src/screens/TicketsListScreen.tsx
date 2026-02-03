import type { CompositeScreenProps } from "@react-navigation/native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Pressable, Text, View } from "react-native";
import type { RootStackParamList, TabsParamList, TicketsStackParamList } from "../navigation/types";
import { colors, spacing, typography } from "../ui/theme";

type Props = CompositeScreenProps<
  NativeStackScreenProps<TicketsStackParamList, "TicketsList">,
  CompositeScreenProps<
    BottomTabScreenProps<TabsParamList, "TicketsTab">,
    NativeStackScreenProps<RootStackParamList>
  >
>;

export function TicketsListScreen({ navigation }: Props) {
  return (
    <View style={{ flex: 1, padding: spacing.lg, backgroundColor: colors.background }}>
      <Text style={{ ...typography.body, marginBottom: spacing.md, color: colors.mutedText }}>
        Ticket list is not implemented yet.
      </Text>
      <Pressable
        onPress={() => navigation.navigate("TicketDetail", { ticketId: "12345" })}
        style={{
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          backgroundColor: colors.primary,
          borderRadius: 10,
          alignSelf: "flex-start",
        }}
        accessibilityRole="button"
      >
        <Text style={{ ...typography.body, color: colors.primaryText, fontWeight: "600" }}>
          Open sample ticket
        </Text>
      </Pressable>
    </View>
  );
}
