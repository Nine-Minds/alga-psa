export type RootStackParamList = {
  SignIn: undefined;
  AuthCallback: { ott?: string; state?: string; error?: string } | undefined;
  Tabs: undefined;
  TicketDetail: { ticketId: string };
};

export type TicketsStackParamList = {
  TicketsList: undefined;
};

export type TabsParamList = {
  TicketsTab: undefined;
  SettingsTab: undefined;
};
