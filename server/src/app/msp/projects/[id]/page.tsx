'use client';

import { getProjectDetails, updateProject } from 'server/src/lib/actions/project-actions/projectActions';
import ProjectInfo from 'server/src/components/projects/ProjectInfo';
import ProjectDetail from 'server/src/components/projects/ProjectDetail';
import { useEffect, useState } from 'react';
import { IProject, IProjectPhase, IProjectTask, IProjectTicketLinkWithDetails, ProjectStatus } from 'server/src/interfaces/project.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';

interface ProjectDetails {
  project: IProject;
  phases: IProjectPhase[];
  tasks: IProjectTask[];
  ticketLinks: IProjectTicketLinkWithDetails[];
  statuses: ProjectStatus[];
  users: IUserWithRoles[];
  contact?: { full_name: string };
  assignedUser?: IUserWithRoles | null;
  companies: ICompany[];
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectDetails, setProjectDetails] = useState<ProjectDetails | null>(null);
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

    const fetchProjectDetails = async () => {
      const details = await getProjectDetails(projectId);
      setProjectDetails(details);
    };
    fetchProjectDetails();
  }, [projectId]);

  const handleAssignedUserChange = async (userId: string | null) => {
    if (!projectId) return;
    
    try {
      await updateProject(projectId, {
        assigned_to: userId
      });
      // Refresh project details after update
      const updatedDetails = await getProjectDetails(projectId);
      setProjectDetails(updatedDetails);
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
      // Refresh project details after update
      const updatedDetails = await getProjectDetails(projectId);
      setProjectDetails(updatedDetails);
    } catch (error) {
      console.error('Error updating contact:', error);
    }
  };

  const handleProjectUpdate = async (updatedProject: IProject) => {
    if (!projectId) return;
    
    try {
      await updateProject(projectId, updatedProject);
      // Refresh project details after update
      const updatedDetails = await getProjectDetails(projectId);
      setProjectDetails(updatedDetails);
    } catch (error) {
      console.error('Error updating project:', error);
    }
  };
  
  const handleTagsUpdate = (tags: ITag[], allTags: string[]) => {
    setProjectTags(tags);
    setAllTagTexts(allTags);
  };

  if (!projectDetails) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <ProjectInfo
        project={projectDetails.project}
        contact={projectDetails.contact}
        assignedUser={projectDetails.assignedUser || undefined}
        users={projectDetails.users}
        companies={projectDetails.companies}
        onAssignedUserChange={handleAssignedUserChange}
        onContactChange={handleContactChange}
        onProjectUpdate={handleProjectUpdate}
        projectTags={projectTags}
        allTagTexts={allTagTexts}
        onTagsChange={setProjectTags}
      />
      <ProjectDetail
        project={projectDetails.project}
        phases={projectDetails.phases}
        tasks={projectDetails.tasks}
        ticketLinks={projectDetails.ticketLinks}
        statuses={projectDetails.statuses}
        users={projectDetails.users}
        companies={projectDetails.companies}
        onTagsUpdate={handleTagsUpdate}
      />
    </div>
  );
}
