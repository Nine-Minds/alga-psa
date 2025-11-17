'use client';

import React, { useState, useEffect } from 'react';
import { IProject } from 'server/src/interfaces/project.interfaces';
import { IStatus } from 'server/src/interfaces';
import { IClient } from 'server/src/interfaces/client.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { Button } from 'server/src/components/ui/Button';
import { Switch } from 'server/src/components/ui/Switch';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Input } from 'server/src/components/ui/Input';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import { ClientPicker } from 'server/src/components/clients/ClientPicker';
import UserPicker from 'server/src/components/ui/UserPicker';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { TagManager } from 'server/src/components/tags';
import { updateProject, getProjectStatuses } from 'server/src/lib/actions/project-actions/projectActions';
import { getContactsByClient, getAllContacts } from 'server/src/lib/actions/contact-actions/contactActions';
import { getAllUsers } from 'server/src/lib/actions/user-actions/userActions';
import { findTagsByEntityId } from 'server/src/lib/actions/tagActions';
import { useTagPermissions } from 'server/src/hooks/useTagPermissions';
import { toast } from 'react-hot-toast';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { ProjectTaskStatusEditor } from './ProjectTaskStatusEditor';

interface ProjectDetailsEditProps {
  initialProject: IProject;
  clients: IClient[];
  onSave: (updatedProject: IProject) => void;
  onCancel: () => void;
  onChange?: () => void;
}

const ProjectDetailsEdit: React.FC<ProjectDetailsEditProps> = ({
  initialProject,
  clients,
  onSave,
  onCancel,
}) => {
  // Initialize tag permissions for project tags
  useTagPermissions(['project']);
  
  // Debug logs
  useEffect(() => {
    console.log('ProjectDetailsEdit:', {
      initialProject,
      clientsLength: clients?.length,
      clients
    });
  }, [initialProject, clients]);

  const [project, setProject] = useState<IProject>(initialProject);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [contacts, setContacts] = useState<{ value: string; label: string }[]>([]);
  const [users, setUsers] = useState<IUserWithRoles[]>([]);
  const [statuses, setStatuses] = useState<IStatus[]>([]);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [projectTags, setProjectTags] = useState<ITag[]>([]);
  
  // TagContext is available if needed for tag-related features in the future
  // const { tags } = useTags();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [allUsers, projectStatuses, projectTagsData] = await Promise.all([
          getAllUsers(),
          getProjectStatuses(),
          initialProject.project_id ? findTagsByEntityId(initialProject.project_id, 'project') : Promise.resolve([])
        ]);
        setUsers(allUsers);
        setStatuses(projectStatuses);
        setProjectTags(projectTagsData);
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };
    fetchData();
  }, [initialProject.project_id]);

  useEffect(() => {
    const fetchContacts = async () => {
      try {
        const contactsData = project.client_id 
          ? await getContactsByClient(project.client_id)
          : await getAllContacts();
          setContacts(contactsData.map((contact): { value: string; label: string } => ({
            value: contact.contact_name_id,
            label: contact.full_name
        })));
      } catch (error) {
        console.error('Error fetching contacts:', error);
        setContacts([]);
      }
    };
    fetchContacts();
  }, [project.client_id]);

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setValidationErrors([]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);

    // Validate required fields
    const errors: string[] = [];
    if (!project.project_name?.trim()) {
      errors.push('Project name');
    }
    if (!project.status) {
      errors.push('Status');
    }
    if (!project.client_id) {
      errors.push('Client');
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors([]);
    setIsSubmitting(true);

    try {
      // Convert budgeted_hours to a number or null
      const budgetedHours = project.budgeted_hours ? Number(project.budgeted_hours) : null;
      
      const updatedProject = await updateProject(project.project_id, {
        project_name: project.project_name,
        description: project.description,
        client_id: project.client_id,
        start_date: project.start_date,
        end_date: project.end_date,
        assigned_to: project.assigned_to,
        contact_name_id: project.contact_name_id,
        is_inactive: project.is_inactive,
        status: project.status,
        budgeted_hours: budgetedHours,
      });
      
      // Log for debugging
      console.log('Updated project with budgeted hours:', budgetedHours);

      toast.success('Project updated successfully');
      onSave(updatedProject);
    } catch (error) {
      console.error('Error updating project:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to update project';
      setValidationErrors([errorMessage]);
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setProject(prev => ({
      ...prev,
      [name]: value,
    }));
    setHasChanges(true);
    clearErrorIfSubmitted();
  };

  const handleClientSelect = (clientId: string | null) => {
    setProject(prev => ({
      ...prev,
      client_id: clientId || '',
      // Reset contact when client changes
      contact_name_id: null,
      contact_name: null,
    }));
    setHasChanges(true);
    clearErrorIfSubmitted();
  };

  return (
    <div className="p-4 w-full max-w-[480px] mx-auto">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {hasAttemptedSubmit && validationErrors.length > 0 && (
          <Alert variant="destructive">
            <AlertDescription>
              <p className="font-medium mb-2">Please fill in the required fields:</p>
              <ul className="list-disc list-inside space-y-1">
                {validationErrors.map((err, index) => (
                  <li key={index}>{err}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        <div className="space-y-3">
          <div>
            <label htmlFor="project_name" className="block text-sm font-medium text-gray-700 mb-1">
              Project Name *
            </label>
            <TextArea
              id="project_name"
              name="project_name"
              value={project.project_name}
              onChange={handleInputChange}
              placeholder="Enter project name..."
              className={`w-full text-base font-medium p-2 border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 ${
                hasAttemptedSubmit && !project.project_name?.trim() ? 'border-red-500' : 'border-gray-300'
              }`}
              rows={1}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status *</label>
            <CustomSelect
              value={project.status}
              onValueChange={(value) => {
                setProject(prev => ({ ...prev, status: value }));
                setHasChanges(true);
                clearErrorIfSubmitted();
              }}
              options={statuses.map((status): SelectOption => ({
                value: status.status_id,
                label: status.name
              }))}
              placeholder="Select Status"
              className={hasAttemptedSubmit && !project.status ? 'ring-1 ring-red-500' : ''}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Client *
            </label>
            <ClientPicker
              id='client-picker'
              clients={clients}
              selectedClientId={project.client_id}
              onSelect={handleClientSelect}
              filterState="all"
              onFilterStateChange={() => {}}
              clientTypeFilter="all"
              onClientTypeFilterChange={() => {}}
              className={hasAttemptedSubmit && !project.client_id ? 'ring-1 ring-red-500 rounded-md' : ''}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contact</label>
            <CustomSelect
              value={project.contact_name_id || ''}
              onValueChange={(value) => {
                setProject(prev => ({ ...prev, contact_name_id: value }));
                setHasChanges(true);
                clearErrorIfSubmitted();
              }}
              options={contacts}
              placeholder="Select Contact"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Project Manager
            </label>
            <UserPicker
              value={project.assigned_to || ''}
              onValueChange={(value) => {
                setProject(prev => ({ ...prev, assigned_to: value || null }));
                setHasChanges(true);
                clearErrorIfSubmitted();
              }}
              users={users}
              size="sm"
              labelStyle="none"
              buttonWidth="full"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="start_date" className="block text-sm font-medium text-gray-700 mb-1">
                Start Date
              </label>
              <DatePicker
                id="start_date"
                value={project.start_date ? new Date(project.start_date) : undefined}
                onChange={(date) => {
                  setProject(prev => ({
                    ...prev,
                    start_date: date || null,
                  }));
                  setHasChanges(true);
                  clearErrorIfSubmitted();
                }}
                placeholder="Select start date"
              />
            </div>

            <div>
              <label htmlFor="end_date" className="block text-sm font-medium text-gray-700 mb-1">
                End Date
              </label>
              <DatePicker
                id="end_date"
                value={project.end_date ? new Date(project.end_date) : undefined}
                onChange={(date) => {
                  setProject(prev => ({
                    ...prev,
                    end_date: date || null,
                  }));
                  setHasChanges(true);
                  clearErrorIfSubmitted();
                }}
                placeholder="Select end date"
              />
            </div>
          </div>

          <div>
            <label htmlFor="budgeted_hours" className="block text-sm font-medium text-gray-700 mb-1">
              Budgeted Hours
            </label>
            <Input
              id="budgeted_hours"
              name="budgeted_hours"
              type="number"
              // Convert from minutes to hours for display
              value={project.budgeted_hours ? (project.budgeted_hours / 60).toString() : ''}
              onChange={(e) => {
                const { name, value } = e.target;
                // Only allow numbers and decimal point, prevent 'e'
                if (value === '' || (/^\d*\.?\d*$/.test(value) && !value.includes('e'))) {
                  const hoursValue = parseFloat(value);
                  const minutesValue = value ? Math.round(hoursValue * 60) : null; // Store null if empty
                  setProject(prev => ({
                    ...prev,
                    // Convert from hours to minutes for storage
                    [name]: minutesValue,
                  }));
                  setHasChanges(true);
                  clearErrorIfSubmitted();
                }
              }}
              onKeyDown={(e) => {
                // Prevent 'e' character from being entered
                if (e.key === 'e' || e.key === 'E') {
                  e.preventDefault();
                }
              }}
              min="0"
              step="0.25" // Allow quarter-hour increments
              placeholder="Enter budgeted hours"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
            <TagManager
              id="project-tags-edit"
              entityId={project.project_id}
              entityType="project"
              initialTags={projectTags}
              onTagsChange={(tags) => {
                console.log('Tags changed in ProjectDetailsEdit:', tags);
                setProjectTags(tags);
                setHasChanges(true);
              }}
              useInlineInput={true}
            />
          </div>

          <div>
            <ProjectTaskStatusEditor
              projectId={project.project_id}
              onChange={() => setHasChanges(true)}
            />
          </div>

          <div className="flex items-center space-x-2">
            <span className={`px-2 py-1 rounded text-sm ${project.is_inactive ? 'text-gray-800' : 'text-gray-800'}`}>
              {project.is_inactive ? 'Inactive' : 'Active'}
            </span>
            <Switch
              id="is_inactive"
              checked={!project.is_inactive}
              onCheckedChange={(checked) => {
                setProject(prev => ({ ...prev, is_inactive: !checked }));
                setHasChanges(true);
                clearErrorIfSubmitted();
              }}
            />
          </div>
        </div>

        <div className="flex justify-end space-x-3 mt-4">
          {showCancelConfirm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
              <div className="bg-white p-6 rounded-lg">
                <h3 className="text-lg font-bold mb-4">Unsaved Changes</h3>
                <p className="mb-4">You have unsaved changes. Are you sure you want to cancel?</p>
                <div className="flex justify-end space-x-3">
                  <Button
                    id='cancel-button'
                    type="button"
                    variant="outline"
                    onClick={() => setShowCancelConfirm(false)}
                  >
                    Continue Editing
                  </Button>
                  <Button
                    id='discard-button'
                    type="button"
                    onClick={() => {
                      setShowCancelConfirm(false);
                      onCancel();
                    }}
                  >
                    Discard Changes
                  </Button>
                </div>
              </div>
            </div>
          )}

          {showSaveConfirm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
              <div className="bg-white p-6 rounded-lg">
                <h3 className="text-lg font-bold mb-4">Save Changes</h3>
                <p className="mb-4">Are you sure you want to save your changes and close the drawer?</p>
                <div className="flex justify-end space-x-3">
                  <Button
                    id='continue-button'
                    type="button"
                    variant="outline"
                    onClick={() => setShowSaveConfirm(false)}
                  >
                    Continue Editing
                  </Button>
                  <Button
                    id='save-and-close-button'
                    type="button"
                    onClick={(e) => {
                      setShowSaveConfirm(false);
                      handleSubmit(e);
                    }}
                  >
                    Save and Close
                  </Button>
                </div>
              </div>
            </div>
          )}

          <Button
            id='cancel-button'
            type="button"
            variant="outline"
            onClick={() => {
              if (hasChanges) {
                setShowCancelConfirm(true);
              } else {
                onCancel();
              }
            }}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            id='save-button'
            type="button"
            onClick={() => setShowSaveConfirm(true)}
            disabled={isSubmitting}
            className={!project.project_name?.trim() || !project.status || !project.client_id ? 'opacity-50' : ''}
          >
            {isSubmitting ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default ProjectDetailsEdit;
