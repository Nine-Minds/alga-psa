import type { CompositeScreenProps } from "@react-navigation/native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { EmptyState } from "../ui/states";
import { PrimaryButton } from "../ui/components/PrimaryButton";
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
    <EmptyState
      title="Tickets"
      description="Ticket list is not implemented yet."
      action={
        <PrimaryButton
          onPress={() => navigation.navigate("TicketDetail", { ticketId: "12345" })}
          accessibilityLabel="Open sample ticket"
        >
          Open sample ticket
        </PrimaryButton>
      }
    />
  );
}
