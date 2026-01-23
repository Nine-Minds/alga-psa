'use client';

import { getProjectMetadata, updateProject } from '../actions/projectActions';
import ProjectInfo from './ProjectInfo';
import ProjectDetail from './ProjectDetail';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { IClient, IProject, IProjectPhase, IProjectTask, IProjectTicketLinkWithDetails, ITag, IUserWithRoles, ProjectStatus } from '@alga-psa/types';

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
  const taskIdFromUrl = searchParams?.get('taskId') ?? null;
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
      setProjectMetadata(metadata);
    };
    fetchProjectMetadata();
  }, [projectId]);

  const handleAssignedUserChange = async (userId: string | null) => {
    if (!projectId) return;
    
    try {
      await updateProject(projectId, {
        assigned_to: userId
      });
      // Refresh project metadata after update
      const updatedMetadata = await getProjectMetadata(projectId);
      setProjectMetadata(updatedMetadata);
    } catch (error) {
      console.error('Error updating assigned user:', error);
    }
  };

  const handleContactChange = async (contactId: string | null) => {
    if (!projectId) return;
    
    try {
      await updateProject(projectId, {
        contact_name_id: contactId
      });
      // Refresh project metadata after update
      const updatedMetadata = await getProjectMetadata(projectId);
      setProjectMetadata(updatedMetadata);
    } catch (error) {
      console.error('Error updating contact:', error);
    }
  };

  const handleProjectUpdate = async (updatedProject: IProject) => {
    if (!projectId) return;
    
    try {
      await updateProject(projectId, updatedProject);
      // Refresh project metadata after update
      const updatedMetadata = await getProjectMetadata(projectId);
      setProjectMetadata(updatedMetadata);
    } catch (error) {
      console.error('Error updating project:', error);
    }
  };
  
  const handleTagsUpdate = (tags: ITag[], allTags: string[]) => {
    setProjectTags(tags);
    setAllTagTexts(allTags);
  };

  if (!projectMetadata) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <ProjectInfo
        project={projectMetadata.project}
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
      />
    </div>
  );
}
