'use client';

import { useEffect, useState } from 'react';
import { IClient, IProject, IUserWithRoles } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import HoursProgressBar from './HoursProgressBar';
import { calculateProjectCompletion } from '@alga-psa/projects/lib/projectUtils';
import { Edit2, Save } from 'lucide-react';
import BackNav from '@alga-psa/ui/components/BackNav';
import { Button } from '@alga-psa/ui/components/Button';
import { useDrawer } from "@alga-psa/ui";
import ProjectDetailsEdit from './ProjectDetailsEdit';
import { TagManager } from '@alga-psa/tags/components';
import { toast } from 'react-hot-toast';
import CreateTemplateDialog from './project-templates/CreateTemplateDialog';
import ProjectMaterialsDrawer from './ProjectMaterialsDrawer';

interface ProjectInfoProps {
  project: IProject;
  contact?: {
    full_name: string;
  };
  assignedUser?: IUserWithRoles;
  users: IUserWithRoles[];
  clients: IClient[];
  onContactChange?: (contactId: string | null) => void;
  onAssignedUserChange?: (userId: string | null) => void;
  onProjectUpdate?: (project: IProject) => void;
  projectTags?: ITag[];
  allTagTexts?: string[];
  onTagsChange?: (tags: ITag[]) => void;
}

export default function ProjectInfo({
  project,
  contact,
  assignedUser,
  users,
  clients,
  onContactChange,
  onAssignedUserChange,
  onProjectUpdate,
  projectTags = [],
  allTagTexts = [],
  onTagsChange
}: ProjectInfoProps) {
  const { openDrawer, closeDrawer } = useDrawer();

  const [currentProject, setCurrentProject] = useState(project);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
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
        // Store metrics returned by calculateProjectCompletion (already in hours)
        setProjectMetrics({
          taskCompletionPercentage: metrics.taskCompletionPercentage,
          hoursCompletionPercentage: metrics.hoursCompletionPercentage,
          budgetedHours: metrics.budgetedHours || 0,
          spentHours: metrics.spentHours || 0,
          remainingHours: metrics.remainingHours || 0 
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
        clients={clients}
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

  const handleMaterialsClick = () => {
    const clientId = currentProject.client_id;
    if (!clientId) {
      toast.error('Project has no client assigned');
      return;
    }
    openDrawer(
      <ProjectMaterialsDrawer
        projectId={currentProject.project_id}
        clientId={clientId}
      />
    );
  };

  return (
    <div className="space-y-2 mb-4">
      {/* First line: Back nav, project number, title, tags, and edit button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-5">
          <BackNav href="/msp/projects">← Back to Projects</BackNav>

          {/* Project number */}
          <span className="text-sm font-medium text-gray-600">
            {currentProject.project_number}
          </span>

          <h1 className="text-xl font-bold">{currentProject.project_name}</h1>
          {/* Tags using TagManager for inline editing */}
          {onTagsChange && (
            <TagManager
              entityId={project.project_id}
              entityType="project"
              initialTags={projectTags}
              onTagsChange={onTagsChange}
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            id="save-as-template-button"
            variant="outline"
            size="sm"
            onClick={() => setShowTemplateDialog(true)}
          >
            <Save className="h-4 w-4 mr-2" />
            Save as Template
          </Button>
          <Button
            id="project-materials-button"
            variant="outline"
            size="sm"
            onClick={handleMaterialsClick}
          >
            Materials
          </Button>
          <Button
            id="edit-project-button"
            variant="outline"
            size="sm"
            onClick={handleEditClick}
          >
            <Edit2 className="h-4 w-4 mr-2" />
            Edit
          </Button>
        </div>
      </div>
      
      {/* Project description */}
      {currentProject.description && (
        <p className="text-sm text-gray-600">{currentProject.description}</p>
      )}

      {/* Second line: Project metadata */}
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
        
        {/* Project Budget Section - takes remaining space */}
        {projectMetrics && (
          <div className="flex items-center space-x-2 flex-1">
            <h5 className="font-bold text-gray-800">Budget:</h5>
            <div className="flex items-center space-x-3 flex-1">
              <span className="text-base text-gray-800 whitespace-nowrap">
                {projectMetrics.spentHours.toFixed(1)} of {projectMetrics.budgetedHours.toFixed(1)} hours
              </span>
              <div className="flex-1">
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
            </div>
          </div>
        )}
      </div>

      {/* Template Dialog */}
      {showTemplateDialog && (
        <CreateTemplateDialog
          onClose={() => setShowTemplateDialog(false)}
          initialProjectId={currentProject.project_id}
          onTemplateCreated={(templateId) => {
            setShowTemplateDialog(false);
            toast.success('Template created successfully');
          }}
        />
      )}
    </div>
  );
}
