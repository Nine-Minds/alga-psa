import * as Linking from "expo-linking";
import type { LinkingOptions } from "@react-navigation/native";
import type { RootStackParamList } from "./types";

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [Linking.createURL("/"), "alga://"],
  config: {
    screens: {
      SignIn: "signin",
      TicketDetail: "ticket/:ticketId",
      Tabs: {
        screens: {
          TicketsTab: {
            screens: {
              TicketsList: "tickets",
            },
          },
          SettingsTab: "settings",
        },
      },
    },
  },
};

