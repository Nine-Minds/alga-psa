'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type {
  IInteraction,
  IProjectTask,
  IProjectPhase,
  IUserWithRoles,
  IUser,
  IClient,
} from '@alga-psa/types';
import type { ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

// ── Render-prop interfaces ──────────────────────────────────────────────

/**
 * Props for rendering TicketDetails. The consolidated ticket data is fetched
 * externally and all the required fields are passed through.
 */
export interface SchedulingTicketDetailsRenderProps {
  isInDrawer: boolean;
  consolidatedData: any;  // ConsolidatedTicketData from optimizedTicketActions
  currentUser: IUser;
}

export interface SchedulingInteractionDetailsRenderProps {
  interaction: IInteraction;
  isInDrawer?: boolean;
}

export interface SchedulingTaskEditRenderProps {
  task: IProjectTask;
  phase: IProjectPhase;
  phases?: IProjectPhase[];
  users: IUser[];
  inDrawer?: boolean;
  onClose: () => void;
  onTaskUpdated: (updatedTask: unknown) => Promise<void>;
  projectTreeData?: any[];
}

// ── Project metadata shape ──────────────────────────────────────────────
export interface ProjectMetadata {
  project: any;
  phases: IProjectPhase[];
  statuses: any[];
  users: IUserWithRoles[];
  contact?: { full_name: string };
  assignedUser: IUserWithRoles | null;
  clients: IClient[];
}

// ── Callback interface ──────────────────────────────────────────────────

export interface SchedulingCrossFeatureCallbacks {
  // Render callbacks
  renderTicketDetails: (props: SchedulingTicketDetailsRenderProps) => ReactNode;
  renderInteractionDetails: (props: SchedulingInteractionDetailsRenderProps) => ReactNode;
  renderTaskEdit: (props: SchedulingTaskEditRenderProps) => ReactNode;

  // Data-fetching callbacks
  getConsolidatedTicketData: (ticketId: string) => Promise<any | null>;
  getInteractionById: (interactionId: string) => Promise<IInteraction>;
  getTaskById: (taskId: string) => Promise<IProjectTask | null>;
  getProjectPhase: (phaseId: string) => Promise<IProjectPhase | null>;
  getProjectMetadata: (projectId: string) => Promise<ActionPermissionError | ProjectMetadata>;
  getProjectTreeData: (projectId: string) => Promise<any>;
}

// ── Context ─────────────────────────────────────────────────────────────

const SchedulingCrossFeatureContext = createContext<SchedulingCrossFeatureCallbacks | null>(null);

export function useSchedulingCrossFeature(): SchedulingCrossFeatureCallbacks {
  const ctx = useContext(SchedulingCrossFeatureContext);
  if (!ctx) {
    throw new Error(
      'useSchedulingCrossFeature must be used within a SchedulingCrossFeatureProvider. ' +
      'Wrap your scheduling page in a provider from the composition layer.'
    );
  }
  return ctx;
}

export function SchedulingCrossFeatureProvider({
  value,
  children,
}: {
  value: SchedulingCrossFeatureCallbacks;
  children: ReactNode;
}) {
  return (
    <SchedulingCrossFeatureContext.Provider value={value}>
      {children}
    </SchedulingCrossFeatureContext.Provider>
  );
}
