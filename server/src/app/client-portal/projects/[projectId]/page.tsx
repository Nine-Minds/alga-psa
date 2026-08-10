import React from 'react';
import { cache } from 'react';
import { getClientProjectDetails } from '@alga-psa/client-portal/actions';
import { ProjectDetailsContainer } from '@alga-psa/client-portal/components';
import logger from '@alga-psa/core/logger';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import type { Metadata } from 'next';

const isReturnedActionError = (
  value: unknown
): value is { readonly actionError: string } | { readonly permissionError: string } =>
  isActionMessageError(value) || isActionPermissionError(value);

const getCachedProject = cache((id: string) => getClientProjectDetails(id));

interface ProjectPageProps {
  params: Promise<{
    projectId: string;
  }>;
}

export async function generateMetadata({ params }: ProjectPageProps): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');
  const fallbackTitle = t('clientPortal.projects.detail.fallbackTitle', {
    defaultValue: 'Project Details',
  });

  try {
    const { projectId } = await params;
    const project = await getCachedProject(projectId);
    if (isReturnedActionError(project)) {
      return { title: fallbackTitle };
    }
    if (project) {
      return { title: project.project_name };
    }
  } catch (error) {
    console.error('[generateMetadata] Failed to fetch project title:', error);
  }
  return { title: fallbackTitle };
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const resolvedParams = await params;
  const { projectId } = resolvedParams;
  const { t } = await getServerTranslation(undefined, 'features/projects');

  try {
    // Fetch project details server-side (uses React.cache — deduped with generateMetadata)
    const project = await getCachedProject(projectId);
    if (isReturnedActionError(project)) {
      return (
        <Alert id="project-error-message" variant="destructive">
          <AlertDescription>{getErrorMessage(project)}</AlertDescription>
        </Alert>
      );
    }

    if (!project) {
      return (
        <Alert id="project-not-found" variant="warning">
          <AlertDescription>
            {t('messages.notFoundOrNoAccess', {
              defaultValue: 'Project not found or you do not have access to this project.',
            })}
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
          {t('messages.errorWithMessage', {
            message: error instanceof Error
              ? error.message
              : t('messages.loadError', { defaultValue: 'Failed to load project details' }),
            defaultValue: 'Error: {{message}}',
          })}
        </AlertDescription>
      </Alert>
    );
  }
}

export const dynamic = "force-dynamic";
