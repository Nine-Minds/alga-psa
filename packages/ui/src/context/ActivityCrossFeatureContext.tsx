'use client';

import { createContext, useContext, type ReactNode } from 'react';

export interface ActivityTicketDetailsRenderProps {
  isInDrawer: boolean;
  consolidatedData: any;
  currentUser: any;
  onClose: () => void;
}

export interface ActivityTaskEditRenderProps {
  inDrawer: boolean;
  users: any[];
  phase: any;
  task: any;
  onClose: () => void;
  onTaskUpdated: () => Promise<void>;
}

export interface ActivityEntryPopupRenderProps {
  canAssignMultipleAgents: boolean;
  users: any[];
  currentUserId: string;
  event: any;
  onClose: () => void;
  onSave: () => Promise<void>;
  isInDrawer: boolean;
  canModifySchedule: boolean;
  focusedTechnicianId: string;
  canAssignOthers: boolean;
}

export interface ActivityTimeEntryDialogRenderProps {
  id: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedTimeEntry: any) => Promise<void>;
  workItem: any;
  date: Date;
  existingEntries: any[];
  timePeriod: any;
  isEditable: boolean;
  inDrawer: boolean;
  timeSheetId?: string;
}

export interface ActivityCrossFeatureCallbacks {
  // Render callbacks
  renderTicketDetails: (props: ActivityTicketDetailsRenderProps) => ReactNode;
  renderTaskEdit: (props: ActivityTaskEditRenderProps) => ReactNode;
  renderEntryPopup: (props: ActivityEntryPopupRenderProps) => ReactNode;
  renderTimeEntryDialog: (props: ActivityTimeEntryDialogRenderProps) => ReactNode;

  // Data-fetching callbacks
  getConsolidatedTicketData: (ticketId: string) => Promise<any>;
  getTaskWithDetails: (taskId: string) => Promise<any>;
  getScheduleEntries: (start: Date, end: Date) => Promise<any>;
  getTimeEntryById: (entryId: string) => Promise<any>;
  saveTimeEntry: (data: any) => Promise<any>;
  getBlockContent: (documentId: string) => Promise<any>;
  updateBlockContent: (documentId: string, data: any) => Promise<any>;
  getProjects: () => Promise<any>;
  getAllClients: (includeInactive?: boolean) => Promise<any>;
  getAllContacts: (status?: 'active' | 'inactive' | 'all', sortBy?: string, sortDirection?: 'asc' | 'desc') => Promise<any>;
}

const ActivityCrossFeatureContext = createContext<ActivityCrossFeatureCallbacks | null>(null);

export function useActivityCrossFeature(): ActivityCrossFeatureCallbacks {
  const ctx = useContext(ActivityCrossFeatureContext);
  if (!ctx) {
    throw new Error(
      'useActivityCrossFeature must be used within an ActivityCrossFeatureProvider. ' +
      'Wrap your page in a provider from the composition layer.'
    );
  }
  return ctx;
}

export function ActivityCrossFeatureProvider({
  value,
  children,
}: {
  value: ActivityCrossFeatureCallbacks;
  children: ReactNode;
}) {
  return (
    <ActivityCrossFeatureContext.Provider value={value}>
      {children}
    </ActivityCrossFeatureContext.Provider>
  );
}
