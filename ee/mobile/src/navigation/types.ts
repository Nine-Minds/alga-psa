import type { TicketRichTextQaScenario } from "../qa/ticketRichTextQa";

export type RootStackParamList = {
  SignIn: undefined;
  AuthCallback:
    | {
        ott?: string;
        state?: string;
        error?: string;
        qaSession?: string;
        qaOtt?: string;
        qaState?: string;
        qaTargetTicketId?: string;
        qaScenario?: TicketRichTextQaScenario;
      }
    | undefined;
  Tabs: undefined;
  TicketDetail: {
    ticketId: string;
    qaScenario?: TicketRichTextQaScenario;
  };
  CreateTicket: undefined;
};

export type TicketsStackParamList = {
  TicketsList: undefined;
};

export type TabsParamList = {
  TicketsTab: undefined;
  SettingsTab: undefined;
};

