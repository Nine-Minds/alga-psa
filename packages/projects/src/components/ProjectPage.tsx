'use client';

import { getProjectMetadata, updateProject } from '../actions/projectActions';
import ProjectInfo from './ProjectInfo';
import ProjectDetail from './ProjectDetail';
import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';
import type { IClient, IProject, IProjectPhase, IProjectTask, IProjectTicketLinkWithDetails, ITag, IUserWithRoles, ProjectStatus } from '@alga-psa/types';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

interface ProjectMetadata {
  project: IProject;
  phases: IProjectPhase[];
  statuses: ProjectStatus[];
  users: IUserWithRoles[];
  contact?: { full_name: string };
  assignedUser?: IUserWithRoles | null;
  clients: IClient[];
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const taskIdFromUrl = searchParams?.get('taskId') ?? null;
  const phaseIdFromUrl = searchParams?.get('phaseId') ?? null;
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
      if (isActionPermissionError(metadata)) {
        handleError(metadata.permissionError);
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
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }
      // Refresh project metadata after update
      const updatedMetadata = await getProjectMetadata(projectId);
      if (isActionPermissionError(updatedMetadata)) {
        handleError(updatedMetadata.permissionError);
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
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }
      // Refresh project metadata after update
      const updatedMetadata = await getProjectMetadata(projectId);
      if (isActionPermissionError(updatedMetadata)) {
        handleError(updatedMetadata.permissionError);
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
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }
      // Refresh project metadata after update
      const updatedMetadata = await getProjectMetadata(projectId);
      if (isActionPermissionError(updatedMetadata)) {
        handleError(updatedMetadata.permissionError);
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
    const newUrl = queryString ? `${pathname}?${queryString}` : pathname;
    window.history.replaceState(null, '', newUrl);
  }, [pathname]);

  if (!projectMetadata) {
    return <div>Loading...</div>;
  }

  return (
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
        onUrlUpdate={handleUrlUpdate}
      />
    </div>
  );
}
