import type { TicketRichTextQaScenario } from "../qa/ticketRichTextQa";
import type { ProjectTaskActivity } from "../api/activities";

export type RootStackParamList = {
  SignIn: undefined;
  ServerEntry: { url?: string } | undefined;
  CreateWorkspace: undefined;
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
  AccountDeletion: undefined;
  MutedUsers: undefined;
  ClientDetail: { clientId: string; clientName?: string };
  ContactDetail: { contactId: string; contactName?: string };
  ProjectTaskDetail: { activity: ProjectTaskActivity };
  WorkflowTaskDetail: { taskId: string };
};

export type TicketsStackParamList = {
  TicketsList: { clientId?: string; clientName?: string; contactId?: string; contactName?: string } | undefined;
};

export type DrawerParamList = {
  TicketsTab: undefined;
  UserActivitiesTab: undefined;
  ScheduleTab: undefined;
  TimeEntriesTab: undefined;
  ClientsTab: undefined;
  ContactsTab: undefined;
  SettingsTab: undefined;
};

