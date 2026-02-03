import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Text, View } from "react-native";
import type { RootStackParamList } from "../navigation/types";
import { colors, spacing, typography } from "../ui/theme";

type Props = NativeStackScreenProps<RootStackParamList, "TicketDetail">;

export function TicketDetailScreen({ route }: Props) {
  return (
    <View style={{ flex: 1, padding: spacing.lg, backgroundColor: colors.background }}>
      <Text style={{ ...typography.title, marginBottom: spacing.sm, color: colors.text }}>
        Ticket detail (placeholder)
      </Text>
      <Text style={{ ...typography.body, color: colors.mutedText }}>
        Ticket ID: {route.params.ticketId}
      </Text>
    </View>
  );
}
