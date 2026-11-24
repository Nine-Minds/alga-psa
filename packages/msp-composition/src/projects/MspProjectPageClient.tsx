'use client';

import React, { useMemo } from 'react';
import { TicketIntegrationProvider } from '@alga-psa/projects/context/TicketIntegrationContext';
import { ProjectDataSourceProvider } from '@alga-psa/projects/context/ProjectDataSourceContext';
import { TaskCommentAudienceProvider, type TaskCommentAudienceSlot } from '@alga-psa/projects/context/TaskCommentAudienceContext';
import { nativeProjectDataSource } from '@alga-psa/projects/lib/nativeProjectDataSource';
import {
  OPEN_PROJECT_SURFACE,
  isProjectSurfaceOpen,
  projectDataSourceForSurface,
  type ProjectSurfaceAccess,
} from '@alga-psa/projects/lib/projectSurface';
import ProjectPage from '@alga-psa/projects/components/ProjectPage';
import { CommentAudienceSelect } from '@alga-psa/tickets/components/ticket/CommentAudienceControl';
import { useTicketIntegrationValue } from './useTicketIntegrationValue';

/**
 * A task comment by a viewer the server restricts (a seat technician) names who can read it, with the same audience
 * select the ticket composer uses. Shared IT is first: MSP staff and the client's own technicians.
 */
// LEVERAGE: friction audience-select-in-tickets-package — `CommentAudienceSelect` is generic but lives in packages/tickets, so projects needs a
// cross-feature slot (`TaskCommentAudienceContext`) to reuse it; hoisting the select (and its three labels) to packages/ui removes the slot.
const RESTRICTED_VIEWER_AUDIENCES: TaskCommentAudienceSlot = Object.freeze({
  audiences: Object.freeze(['shared_it', 'requester'] as const),
  renderSelect: (props) => <CommentAudienceSelect {...props} />,
});

/**
 * The MSP project screen. `surface` is what the server closes for the viewer (`getProjectSurfaceAccess`); it is
 * absent or empty for every MSP user, who then get the native data source object itself and no audience slot, so the
 * screen is exactly what it was. A restricted viewer gets the same native screen narrowed through the data source
 * seam (frozen and hidden fields, no management controls, no service catalog).
 */
export default function MspProjectPageClient(props: { params: Promise<{ id: string }>; surface?: ProjectSurfaceAccess }) {
  const contextValue = useTicketIntegrationValue();
  const surface = props.surface ?? OPEN_PROJECT_SURFACE;
  const dataSource = useMemo(() => projectDataSourceForSurface(nativeProjectDataSource, surface), [surface]);
  const restricted = !isProjectSurfaceOpen(surface);

  const page = (
    <TicketIntegrationProvider value={contextValue}>
      <ProjectPage params={props.params} />
    </TicketIntegrationProvider>
  );
  if (!restricted) return page;
  return (
    <ProjectDataSourceProvider dataSource={dataSource}>
      <TaskCommentAudienceProvider value={RESTRICTED_VIEWER_AUDIENCES}>{page}</TaskCommentAudienceProvider>
    </ProjectDataSourceProvider>
  );
}
