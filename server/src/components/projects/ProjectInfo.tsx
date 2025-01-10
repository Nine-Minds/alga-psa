'use client';

import { useEffect, useState } from 'react';
import { ICompany, IProject, IUserWithRoles } from '@/interfaces';
import { Edit2 } from 'lucide-react';
import BackNav from '@/components/ui/BackNav';
import { Button } from '@/components/ui/Button';
import { useDrawer } from '@/context/DrawerContext';
import ProjectDetailsEdit from './ProjectDetailsEdit';

interface ProjectInfoProps {
  project: IProject;
  contact?: {
    full_name: string;
  };
  assignedUser?: IUserWithRoles;
  users: IUserWithRoles[];
  companies: ICompany[];
  onContactChange?: (contactId: string | null) => void;
  onAssignedUserChange?: (userId: string | null) => void;
  onProjectUpdate?: (project: IProject) => void;
}

export default function ProjectInfo({
  project,
  contact,
  assignedUser,
  users,
  companies,
  onContactChange,
  onAssignedUserChange,
  onProjectUpdate
}: ProjectInfoProps) {
  const { openDrawer, closeDrawer } = useDrawer();

  const [currentProject, setCurrentProject] = useState(project);

  useEffect(() => {
    setCurrentProject(project);
  }, [project]);

  const handleEditClick = () => {
    openDrawer(
      <ProjectDetailsEdit
        initialProject={currentProject}
        companies={companies}
        onSave={(updatedProject) => {
          setCurrentProject(updatedProject);
          if (onProjectUpdate) {
            onProjectUpdate(updatedProject);
          }
          closeDrawer();
        }}
        onCancel={() => {
          closeDrawer();
        }}
      />
    );
  };

  return (
    <div className="space-y-4 mb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-5">
          <BackNav href="/msp/projects">Back to Projects</BackNav>
          <h1 className="text-xl font-bold">{currentProject.project_name}</h1>
          <div className="flex items-center space-x-8">
            {/* Client Section */}
            <div className="flex items-center space-x-2">
              <h5 className="font-bold text-gray-800">Client:</h5>
              <p className="text-base text-gray-800">
                {currentProject.client_name || 'N/A'}
              </p>
            </div>

            {/* Contact Section */}
            <div className="flex items-center space-x-2">
              <h5 className="font-bold text-gray-800">Contact:</h5>
              <p className="text-base text-gray-800">
                {contact?.full_name || 'N/A'}
              </p>
            </div>
          </div>
        </div>
        <Button
          id="edit-project-button"
          variant="outline"
          size="sm"
          onClick={handleEditClick}
          className="ml-4"
        >
          <Edit2 className="h-4 w-4 mr-2" />
          Edit
        </Button>
      </div>
    </div>
  );
}
