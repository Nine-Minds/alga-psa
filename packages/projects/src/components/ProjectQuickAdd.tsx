'use client'

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Input } from '@alga-psa/ui/components/Input';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { IProject, IClient, IStatus } from 'server/src/interfaces';
import { IClientPortalConfig, DEFAULT_CLIENT_PORTAL_CONFIG } from 'server/src/interfaces/project.interfaces';
import { toast } from 'react-hot-toast';
import { createProject, getProjectStatuses } from '../actions/projectActions';
import { getTenantProjectStatuses } from '../actions/projectTaskStatusActions';
import { ClientPicker } from '@alga-psa/clients/components/clients/ClientPicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { getContactsByClient, getAllContacts } from 'server/src/lib/actions/contact-actions/contactActions';
import { IContact } from 'server/src/interfaces';
import { getAllUsersBasic } from 'server/src/lib/actions/user-actions/userActions';
import { IUser } from '@shared/interfaces/user.interfaces';
import { ProjectTaskStatusSelector } from './ProjectTaskStatusSelector';
import { QuickAddTagPicker, type PendingTag } from '@alga-psa/ui/components';
import { createTagsForEntity } from 'server/src/lib/actions/tagActions';
import ClientPortalConfigEditor from './ClientPortalConfigEditor';
import { ChevronDown, ChevronRight, Settings } from 'lucide-react';

interface ProjectQuickAddProps {
  onClose: () => void;
  onProjectAdded: (newProject: IProject) => void;
  clients: IClient[];
}

const ProjectQuickAdd: React.FC<ProjectQuickAddProps> = ({ onClose, onProjectAdded, clients }) => {
  const [projectName, setProjectName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [users, setUsers] = useState<IUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [statuses, setStatuses] = useState<IStatus[]>([]);
  const [selectedStatusId, setSelectedStatusId] = useState<string | null>(null);
  const [taskStatuses, setTaskStatuses] = useState<IStatus[]>([]);
  const [selectedTaskStatuses, setSelectedTaskStatuses] = useState<Array<{ status_id: string; display_order: number }>>([]);
  const [budgetedHours, setBudgetedHours] = useState<string>('');
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [pendingTags, setPendingTags] = useState<PendingTag[]>([]);
  const [clientPortalConfig, setClientPortalConfig] = useState<IClientPortalConfig>(DEFAULT_CLIENT_PORTAL_CONFIG);
  const [showClientPortalConfig, setShowClientPortalConfig] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [allUsers, projectStatuses, projectTaskStatuses] = await Promise.all([
          getAllUsersBasic(),
          getProjectStatuses(),
          getTenantProjectStatuses()
        ]);
        setUsers(allUsers);
        setStatuses(projectStatuses);
        setTaskStatuses(projectTaskStatuses);
        // Default selection is now handled by ProjectTaskStatusSelector component
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    const fetchContacts = async () => {
      try {
        const contactsData = selectedClientId
          ? await getContactsByClient(selectedClientId, 'all')
          : await getAllContacts('all');
        setContacts(contactsData);
      } catch (error) {
        console.error('Error fetching contacts:', error);
        setContacts([]);
      }
    };
    fetchContacts();
  }, [selectedClientId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);

    const errors: string[] = [];
    if (projectName.trim() === '') {
      errors.push('Project name is required');
    }
    if (!selectedClientId) {
      errors.push('Client is required');
    }
    if (!selectedStatusId) {
      errors.push('Project status is required');
    }
    if (selectedTaskStatuses.length === 0) {
      errors.push('At least one task status must be selected');
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors([]);

    setIsSubmitting(true);

    try {
      // These checks are redundant since we validate above, but TypeScript needs them
      if (!selectedClientId || !selectedStatusId) {
        return;
      }

      const projectData: Omit<IProject, 'project_id' | 'created_at' | 'updated_at' | 'tenant' | 'wbs_code' | 'project_number'> = {
        project_name: projectName,
        description: description || null,
        client_id: selectedClientId,
        start_date: startDate || null,
        end_date: endDate || null,
        is_inactive: false,
        status: selectedStatusId,
        assigned_to: selectedUserId || null,
        contact_name_id: selectedContactId || null,
        budgeted_hours: budgetedHours ? Math.round(Number(budgetedHours) * 60) : null,
        client_portal_config: clientPortalConfig
      };

      // Create the project with selected task statuses in specified order
      const statusIds = selectedTaskStatuses
        .sort((a, b) => a.display_order - b.display_order)
        .map(s => s.status_id);

      const newProject = await createProject(projectData, statusIds);

      // Create tags for the new project
      let createdTags: typeof newProject.tags = [];
      if (pendingTags.length > 0) {
        try {
          createdTags = await createTagsForEntity(newProject.project_id, 'project', pendingTags);
          if (createdTags.length < pendingTags.length) {
            toast.error(`${pendingTags.length - createdTags.length} tag(s) could not be created`);
          }
        } catch (tagError) {
          console.error("Error creating project tags:", tagError);
        }
      }

      // Pass project with tags to callback
      onProjectAdded({ ...newProject, tags: createdTags });

      onClose();

      // Show success toast *after* potential state updates in parent
      toast.success('Project created successfully');
    } catch (error) {
      console.error('Error creating project:', error);
      // Show an error toast to the user
      toast.error('Failed to create project. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={true}
      onClose={() => {
        setHasAttemptedSubmit(false);
        setValidationErrors([]);
        onClose();
      }}
      title="Add New Project"
      className="max-w-[600px]"
      disableFocusTrap
    >
      <DialogContent>
          {hasAttemptedSubmit && validationErrors.length > 0 && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>
                Please fix the following errors:
                <ul className="list-disc pl-5 mt-1 text-sm">
                  {validationErrors.map((err, index) => (
                    <li key={index}>{err}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <form onSubmit={handleSubmit} className="flex flex-col">
            <div className="space-y-4">
              <TextArea
                value={projectName}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setProjectName(e.target.value)}
                placeholder="Project Name *"
                className={`w-full text-lg font-semibold p-2 border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 ${hasAttemptedSubmit && projectName.trim() === '' ? 'border-red-500' : 'border-gray-300'}`}
                rows={1}
                autoFocus
              />
              <TextArea
                value={description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                placeholder="Description"
                className="w-full p-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                rows={3}
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status *</label>
                <CustomSelect
                  value={selectedStatusId || ''}
                  onValueChange={setSelectedStatusId}
                  options={statuses.map((status): { value: string; label: string } => ({
                    value: status.status_id,
                    label: status.name
                  }))}
                  placeholder="Select Status"
                  className={hasAttemptedSubmit && !selectedStatusId ? 'ring-1 ring-red-500' : ''}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Client *</label>
                <ClientPicker
                  id='client-picker'
                  clients={clients}
                  onSelect={setSelectedClientId}
                  selectedClientId={selectedClientId}
                  filterState={filterState}
                  onFilterStateChange={setFilterState}
                  clientTypeFilter={clientTypeFilter}
                  onClientTypeFilterChange={setClientTypeFilter}
                  className={hasAttemptedSubmit && !selectedClientId ? 'ring-1 ring-red-500' : ''}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact</label>
                <ContactPicker
                  id='contact-picker'
                  contacts={contacts}
                  value={selectedContactId || ''}
                  onValueChange={setSelectedContactId}
                  clientId={selectedClientId || undefined}
                  placeholder="Select Contact"
                  buttonWidth="full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Project Manager</label>
                <UserPicker
                  value={selectedUserId || ''}
                  onValueChange={setSelectedUserId}
                  users={users}
                  labelStyle="none"
                  buttonWidth="full"
                  size="sm"
                  placeholder="Select Assignee"
                />
              </div>
              <div>
                <label htmlFor="budgeted_hours" className="block text-sm font-medium text-gray-700 mb-1">
                  Budgeted Hours
                </label>
                <Input
                  id="budgeted_hours"
                  name="budgeted_hours"
                  type="number"
                  value={budgetedHours}
                  onChange={(e) => {
                    // Prevent 'e' character and only allow numbers and decimal point
                    const value = e.target.value;
                    if (value === '' || (/^\d*\.?\d*$/.test(value) && !value.includes('e'))) {
                      setBudgetedHours(value);
                    }
                  }}
                  onKeyDown={(e) => {
                    // Prevent 'e' character from being entered
                    if (e.key === 'e' || e.key === 'E') {
                      e.preventDefault();
                    }
                  }}
                  min="0"
                  step="1"
                  placeholder="Enter budgeted hours"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <DatePicker
                    value={startDate}
                    onChange={setStartDate}
                    placeholder="Select start date"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                  <DatePicker
                    value={endDate}
                    onChange={setEndDate}
                    placeholder="Select end date"
                  />
                </div>
              </div>
              <ProjectTaskStatusSelector
                availableStatuses={taskStatuses}
                selectedStatuses={selectedTaskStatuses}
                onChange={setSelectedTaskStatuses}
                onStatusCreated={(newStatus) => {
                  // Add new status to the available list
                  setTaskStatuses(prev => [...prev, newStatus]);
                }}
                error={hasAttemptedSubmit && selectedTaskStatuses.length === 0 ? 'At least one task status must be selected' : undefined}
              />
              <QuickAddTagPicker
                id="quick-add-project-tags"
                entityType="project"
                pendingTags={pendingTags}
                onPendingTagsChange={setPendingTags}
                disabled={isSubmitting}
              />
              {/* Client Portal Visibility - Expandable Section */}
              <div className="border-t pt-4 mt-2">
                <button
                  type="button"
                  onClick={() => setShowClientPortalConfig(!showClientPortalConfig)}
                  className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                >
                  {showClientPortalConfig ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <Settings className="h-4 w-4" />
                  <span>Client Portal Visibility</span>
                </button>
                {showClientPortalConfig && (
                  <div className="mt-3">
                    <ClientPortalConfigEditor
                      config={clientPortalConfig}
                      onChange={setClientPortalConfig}
                      disabled={isSubmitting}
                    />
                  </div>
                )}
              </div>
              <div className="flex justify-between mt-6">
                <Button id='cancel-button' variant="ghost" onClick={() => {
                  setHasAttemptedSubmit(false);
                  setValidationErrors([]);
                  onClose();
                }} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button id='create-button' type="submit" disabled={isSubmitting} className={!projectName.trim() || !selectedClientId || !selectedStatusId ? 'opacity-50' : ''}>
                  {isSubmitting ? 'Creating...' : 'Create Project'}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
    </Dialog>
  );
};

export default ProjectQuickAdd;
