'use client';

import React, { createContext, useContext } from 'react';
import { nativeProjectDataSource } from '../lib/nativeProjectDataSource';
import type { ProjectDataSource, ProjectScreenBehavior } from '../lib/projectDataSource';

/**
 * Disabled-default context (same shape as TicketDataSourceContext): with no provider mounted the
 * project screen runs against the native actions. The default is the module-level singleton, never a
 * per-render object, so effect/callback dependency lists do not churn.
 */
const ProjectDataSourceContext = createContext<ProjectDataSource>(nativeProjectDataSource);

export function ProjectDataSourceProvider({ dataSource, children }: { dataSource: ProjectDataSource; children: React.ReactNode }) {
  return <ProjectDataSourceContext.Provider value={dataSource}>{children}</ProjectDataSourceContext.Provider>;
}

export function useProjectDataSource(): ProjectDataSource {
  return useContext(ProjectDataSourceContext);
}

export function useProjectScreen(): ProjectScreenBehavior {
  return useContext(ProjectDataSourceContext).screen;
}

/** The screen may be read but not written. */
export function useProjectScreenReadOnly(): boolean {
  return useContext(ProjectDataSourceContext).screen.readOnly === true;
}

/** Runs the screen's refresh behaviour; native has none and keeps today's explicit reloads. */
export async function runProjectRefresh(dataSource: Pick<ProjectDataSource, 'kind'>): Promise<void> {
  if (dataSource.kind !== 'native' && typeof window !== 'undefined') window.location.reload();
}
