'use client';

import { getProjectMetadata, updateProject } from '../actions/projectActions';
import ProjectInfo from './ProjectInfo';
import ProjectDetail from './ProjectDetail';
import { TaskShareActionsProvider } from './TaskShareActionsContext';
import { TaskSelectionProvider } from './TaskSelectionContext';
import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';
import type { IClient, IProject, IProjectPhase, IProjectTask, IProjectTicketLinkWithDetails, ITag, IUserWithRoles, ProjectStatus } from '@alga-psa/types';
import {
  getErrorMessage,
  handleError,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from 'react-i18next';

interface ProjectMetadata {
  project: IProject;
  phases: IProjectPhase[];
  statuses: ProjectStatus[];
  users: IUserWithRoles[];
  contact?: { full_name: string };
  assignedUser?: IUserWithRoles | null;
  clients: IClient[];
}

function isReturnedActionError(value: unknown): value is { actionError: string } | { permissionError: string } {
  return isActionMessageError(value) || isActionPermissionError(value);
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = useTranslation('features/projects');
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const taskIdFromUrl = searchParams?.get('taskId') ?? null;
  const phaseIdFromUrl = searchParams?.get('phaseId') ?? null;
  const viewFromUrlRaw = searchParams?.get('view') ?? null;
  const viewFromUrl = viewFromUrlRaw === 'kanban' || viewFromUrlRaw === 'list' || viewFromUrlRaw === 'billing'
    ? viewFromUrlRaw
    : null;
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectMetadata, setProjectMetadata] = useState<ProjectMetadata | null>(null);
  const [projectTags, setProjectTags] = useState<ITag[]>([]);
  const [allTagTexts, setAllTagTexts] = useState<string[]>([]);

  useEffect(() => {
    const initializeParams = async () => {
      const resolvedParams = await params;
      setProjectId(resolvedParams.id);
    };
    initializeParams();
  }, [params]);

  useEffect(() => {
    if (!projectId) return;

    const fetchProjectMetadata = async () => {
      const metadata = await getProjectMetadata(projectId);
      if (isReturnedActionError(metadata)) {
        handleError(getErrorMessage(metadata));
        return;
      }
      setProjectMetadata(metadata);
    };
    fetchProjectMetadata();
  }, [projectId]);

  const handleAssignedUserChange = async (userId: string | null) => {
    if (!projectId) return;

    try {
      const result = await updateProject(projectId, {
        assigned_to: userId
      });
      if (isReturnedActionError(result)) {
        handleError(getErrorMessage(result));
        return;
      }
      // Refresh project metadata after update
      const updatedMetadata = await getProjectMetadata(projectId);
      if (isReturnedActionError(updatedMetadata)) {
        handleError(getErrorMessage(updatedMetadata));
        return;
      }
      setProjectMetadata(updatedMetadata);
    } catch (error) {
      console.error('Error updating assigned user:', error);
    }
  };

  const handleContactChange = async (contactId: string | null) => {
    if (!projectId) return;

    try {
      const result = await updateProject(projectId, {
        contact_name_id: contactId
      });
      if (isReturnedActionError(result)) {
        handleError(getErrorMessage(result));
        return;
      }
      // Refresh project metadata after update
      const updatedMetadata = await getProjectMetadata(projectId);
      if (isReturnedActionError(updatedMetadata)) {
        handleError(getErrorMessage(updatedMetadata));
        return;
      }
      setProjectMetadata(updatedMetadata);
    } catch (error) {
      console.error('Error updating contact:', error);
    }
  };

  const handleProjectUpdate = async (updatedProject: IProject) => {
    if (!projectId) return;

    try {
      const result = await updateProject(projectId, updatedProject);
      if (isReturnedActionError(result)) {
        handleError(getErrorMessage(result));
        return;
      }
      // Refresh project metadata after update
      const updatedMetadata = await getProjectMetadata(projectId);
      if (isReturnedActionError(updatedMetadata)) {
        handleError(getErrorMessage(updatedMetadata));
        return;
      }
      setProjectMetadata(updatedMetadata);
    } catch (error) {
      console.error('Error updating project:', error);
    }
  };
  
  const handleTagsUpdate = (tags: ITag[], allTags: string[]) => {
    setProjectTags(tags);
    setAllTagTexts(allTags);
  };

  // Update URL when phase or task selection changes
  // Uses history.replaceState to avoid triggering a Next.js soft navigation
  // (which would re-fetch the RSC payload and potentially block state updates)
  const handleUrlUpdate = useCallback((phaseId: string | null, taskId: string | null) => {
    const params = new URLSearchParams();
    if (phaseId) {
      params.set('phaseId', phaseId);
    }
    if (taskId) {
      params.set('taskId', taskId);
    }
    const queryString = params.toString();
    const shouldPreserveCommentHash =
      taskId &&
      taskId === taskIdFromUrl &&
      typeof window !== 'undefined' &&
      window.location.hash.startsWith('#comment-');
    const hash = shouldPreserveCommentHash ? window.location.hash : '';
    const newUrl = `${queryString ? `${pathname}?${queryString}` : pathname}${hash}`;
    window.history.replaceState(null, '', newUrl);
  }, [pathname, taskIdFromUrl]);

  if (!projectMetadata) {
    return <div>{t('projectDetail.loading')}</div>;
  }

  return (
    <TaskShareActionsProvider>
    <TaskSelectionProvider>
    <div>
      <ProjectInfo
        project={projectMetadata.project}
        phases={projectMetadata.phases}
        contact={projectMetadata.contact}
        assignedUser={projectMetadata.assignedUser || undefined}
        users={projectMetadata.users}
        clients={projectMetadata.clients}
        onAssignedUserChange={handleAssignedUserChange}
        onContactChange={handleContactChange}
        onProjectUpdate={handleProjectUpdate}
        projectTags={projectTags}
        allTagTexts={allTagTexts}
        onTagsChange={setProjectTags}
      />
      <ProjectDetail
        project={projectMetadata.project}
        phases={projectMetadata.phases}
        statuses={projectMetadata.statuses}
        users={projectMetadata.users}
        clients={projectMetadata.clients}
        onTagsUpdate={handleTagsUpdate}
        initialTaskId={taskIdFromUrl}
        initialPhaseId={phaseIdFromUrl}
        initialViewMode={viewFromUrl}
        onUrlUpdate={handleUrlUpdate}
      />
    </div>
    </TaskSelectionProvider>
    </TaskShareActionsProvider>
  );
}
