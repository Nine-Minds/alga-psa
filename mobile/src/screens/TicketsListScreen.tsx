import type { CompositeScreenProps } from "@react-navigation/native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Pressable, Text, View } from "react-native";
import type { RootStackParamList, TabsParamList, TicketsStackParamList } from "../navigation/types";

type Props = CompositeScreenProps<
  NativeStackScreenProps<TicketsStackParamList, "TicketsList">,
  CompositeScreenProps<
    BottomTabScreenProps<TabsParamList, "TicketsTab">,
    NativeStackScreenProps<RootStackParamList>
  >
>;

export function TicketsListScreen({ navigation }: Props) {
  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 16, marginBottom: 12 }}>
        Ticket list is not implemented yet.
      </Text>
      <Pressable
        onPress={() => navigation.navigate("TicketDetail", { ticketId: "12345" })}
        style={{
          paddingVertical: 12,
          paddingHorizontal: 14,
          backgroundColor: "#111827",
          borderRadius: 10,
          alignSelf: "flex-start",
        }}
        accessibilityRole="button"
      >
        <Text style={{ color: "#fff", fontWeight: "600" }}>Open sample ticket</Text>
      </Pressable>
    </View>
  );
}
