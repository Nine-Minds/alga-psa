'use client';

import { createContext, useContext, type ComponentType } from 'react';

/** Composition supplies an organization effort view without coupling the
 * native project form to another product's actions or session context. */
export interface ProjectEffortIntegration {
  TaskEffort: ComponentType<{ taskId: string }>;
}

const ProjectEffortIntegrationContext = createContext<ProjectEffortIntegration | null>(null);
export const ProjectEffortIntegrationProvider = ProjectEffortIntegrationContext.Provider;
export const useProjectEffortIntegration = () => useContext(ProjectEffortIntegrationContext);
