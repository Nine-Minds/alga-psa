'use client';

import React, { createContext, useContext } from 'react';

/**
 * Cross-feature slot for a task's effort split (customer / MSP / combined).
 *
 * projects is a vertical feature package and must not import co-managed, so the effort block that appears
 * inside the task screens is injected from the composition layer. With no provider mounted (or a provider
 * whose value is null) the context is null and nothing renders: non-participating tenants see no change.
 *
 * LEVERAGE: pattern project-integration-slot — third copy of this context shape (billing, tickets, effort).
 */
export interface ProjectEffortIntegrationContextType {
  TaskEffort: React.ComponentType<{ taskId: string }>;
}

const ProjectEffortIntegrationContext = createContext<ProjectEffortIntegrationContextType | null>(null);

export const ProjectEffortIntegrationProvider = ProjectEffortIntegrationContext.Provider;

export function useProjectEffortIntegration(): ProjectEffortIntegrationContextType | null {
  return useContext(ProjectEffortIntegrationContext);
}
