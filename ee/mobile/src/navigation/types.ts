import type { TicketRichTextQaScenario } from "../qa/ticketRichTextQa";
import type { ProjectTaskActivity } from "../api/activities";
import type { InventorySegment } from "../features/inventory/segments";

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
  /** Opened from an asset: that client and device start the form's selection. */
  CreateTicket:
    | { clientId?: string; clientName?: string; assets?: { asset_id: string; name: string }[] }
    | undefined;
  AccountDeletion: undefined;
  MutedUsers: undefined;
  ClientDetail: { clientId: string; clientName?: string };
  ContactDetail: { contactId: string; contactName?: string };
  /** Push and deep links only know the id; the activity row seeds the first paint when present. */
  ProjectTaskDetail: { taskId: string; activity?: ProjectTaskActivity };
  ProjectDetail: { projectId: string; projectName?: string };
  WorkflowTaskDetail: { taskId: string };
  StockProductDetail: { serviceId: string; serviceName?: string };
  StockUnitDetail: { unitId: string };
  InventoryReceive: { serviceId?: string; serviceName?: string; isSerialized?: boolean } | undefined;
  InventoryAdjust: { serviceId?: string; serviceName?: string } | undefined;
  CountSession: { sessionId: string; locationName?: string };
  PurchaseOrderDetail: { poId: string; poNumber?: string };
  AssetDetail: { assetId: string; assetName?: string };
  Search: undefined;
  AuditSetup: undefined;
  AuditSession: { auditId: string };
  AuditSummary: { auditId: string };
  OpportunityDetail: { opportunityId: string; title?: string };
};

export type TicketsStackParamList = {
  TicketsList:
    | {
        clientId?: string;
        clientName?: string;
        contactId?: string;
        contactName?: string;
        /** Preset for the assignee filter; Home's My tickets card sends "me". */
        assignee?: "any" | "me" | "unassigned";
      }
    | undefined;
};

export type DrawerParamList = {
  HomeTab: undefined;
  TicketsTab: { screen?: "TicketsList"; params?: TicketsStackParamList["TicketsList"] } | undefined;
  ProjectsTab: undefined;
  UserActivitiesTab: undefined;
  ScheduleTab: undefined;
  InteractionsTab: undefined;
  TimeEntriesTab: undefined;
  ClientsTab: undefined;
  ContactsTab: undefined;
  InventoryTab: { segment?: InventorySegment } | undefined;
  AssetsTab: undefined;
  OpportunitiesTab: undefined;
  SettingsTab: undefined;
};

