import React from 'react';
import { getClientProjectDetails } from '@alga-psa/client-portal/actions';
import { ProjectDetailsContainer } from '@alga-psa/client-portal/components';
import logger from '@alga-psa/core/logger';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';

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
        <Alert id="project-not-found" variant="warning">
          <AlertDescription>
            Project not found or you do not have access to this project.
          </AlertDescription>
        </Alert>
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
      <Alert id="project-error-message" variant="destructive">
        <AlertDescription>
          Error: {error instanceof Error ? error.message : 'Failed to load project details'}
        </AlertDescription>
      </Alert>
    );
  }
}

export const dynamic = "force-dynamic";
