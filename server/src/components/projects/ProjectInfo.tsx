'use client';

import { useEffect, useState } from 'react';
import { ICompany, IProject, IUserWithRoles } from 'server/src/interfaces';
import HoursProgressBar from './HoursProgressBar';
import { calculateProjectCompletion } from 'server/src/lib/utils/projectUtils';
import { Edit2 } from 'lucide-react';
import BackNav from 'server/src/components/ui/BackNav';
import { Button } from 'server/src/components/ui/Button';
import { useDrawer } from "server/src/context/DrawerContext";
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
  const [projectMetrics, setProjectMetrics] = useState<{
    taskCompletionPercentage: number;
    hoursCompletionPercentage: number;
    budgetedHours: number;
    spentHours: number;
    remainingHours: number;
  } | null>(null);

  useEffect(() => {
    const fetchProjectMetrics = async () => {
      try {
        const metrics = await calculateProjectCompletion(project.project_id);
        setProjectMetrics({
          taskCompletionPercentage: metrics.taskCompletionPercentage,
          hoursCompletionPercentage: metrics.hoursCompletionPercentage,
          budgetedHours: metrics.budgetedHours,
          spentHours: metrics.spentHours,
          remainingHours: metrics.remainingHours
        });
      } catch (error) {
        console.error('Error fetching project metrics:', error);
      }
    };
    
    fetchProjectMetrics();
  }, [project.project_id]);

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
        <div className="flex items-center flex-1">
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
          {projectMetrics && (
            <div className="flex flex-col flex-1 ml-8 px-4 py-2">
              <div className="flex justify-between mb-1">
                <span className="text-sm font-medium">Project Budget:</span>
                <span className="text-sm text-gray-600">
                  {projectMetrics.spentHours.toFixed(1)} of {projectMetrics.budgetedHours.toFixed(1)} hours
                </span>
              </div>
              <HoursProgressBar 
                percentage={projectMetrics.hoursCompletionPercentage}
                width="100%"
                height={8}
                showTooltip={true}
                tooltipContent={
                  <div className="p-2">
                    <p className="font-medium">Hours Usage</p>
                    <p className="text-sm">{projectMetrics.spentHours.toFixed(1)} of {projectMetrics.budgetedHours.toFixed(1)} hours used</p>
                    <p className="text-sm">{projectMetrics.remainingHours.toFixed(1)} hours remaining</p>
                    <p className="text-sm text-gray-300 mt-1">Shows budget hours usage for the entire project</p>
                  </div>
                }
              />
            </div>
          )}
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
