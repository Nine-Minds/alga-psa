import React from 'react';
import { getClientProjectDetails } from 'server/src/lib/actions/client-portal-actions/client-projects';
import ProjectDetailsContainer from './ProjectDetailsContainer';
import logger from '@alga-psa/core/logger';

interface ProjectPageProps {
  params: Promise<{
    projectId: string;
  }>;
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const resolvedParams = await params;
  const { projectId } = resolvedParams;

  try {
    // Fetch project details server-side
    const project = await getClientProjectDetails(projectId);

    if (!project) {
      return (
        <div id="project-not-found" className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-yellow-700">
            Project not found or you do not have access to this project.
          </p>
        </div>
      );
    }

    return (
      <div className="w-full">
        <ProjectDetailsContainer project={project} />
      </div>
    );
  } catch (error) {
    logger.error('[ClientPortal] Failed to fetch project details', {
      projectId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    return (
      <div id="project-error-message" className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-700">
          Error: {error instanceof Error ? error.message : 'Failed to load project details'}
        </p>
      </div>
    );
  }
}

export const dynamic = "force-dynamic";
