import type { CompositeScreenProps } from "@react-navigation/native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RefreshControl, ScrollView } from "react-native";
import { EmptyState } from "../ui/states";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import type { RootStackParamList, TabsParamList, TicketsStackParamList } from "../navigation/types";
import { useAppResume } from "../hooks/useAppResume";
import { usePullToRefresh } from "../hooks/usePullToRefresh";

type Props = CompositeScreenProps<
  NativeStackScreenProps<TicketsStackParamList, "TicketsList">,
  CompositeScreenProps<
    BottomTabScreenProps<TabsParamList, "TicketsTab">,
    NativeStackScreenProps<RootStackParamList>
  >
>;

export function TicketsListScreen({ navigation }: Props) {
  const { refreshing, refresh } = usePullToRefresh(async () => {
    await Promise.resolve();
  });

  useAppResume(() => {
    void refresh();
  });

  return (
    <ScrollView
      contentContainerStyle={{ flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
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
    </ScrollView>
  );
}
