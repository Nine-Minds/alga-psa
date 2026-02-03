import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Text, View } from "react-native";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "TicketDetail">;

export function TicketDetailScreen({ route }: Props) {
  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 16, marginBottom: 8 }}>Ticket detail (placeholder)</Text>
      <Text style={{ fontSize: 14 }}>Ticket ID: {route.params.ticketId}</Text>
    </View>
  );
}

