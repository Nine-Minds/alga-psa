'use client'

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Input } from 'server/src/components/ui/Input';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import { IProject, IClient, IStatus } from 'server/src/interfaces';
import { IClientPortalConfig, DEFAULT_CLIENT_PORTAL_CONFIG } from 'server/src/interfaces/project.interfaces';
import { toast } from 'react-hot-toast';
import { createProject, getProjectStatuses } from 'server/src/lib/actions/project-actions/projectActions';
import { getTenantProjectStatuses } from 'server/src/lib/actions/project-actions/projectTaskStatusActions';
import { ClientPicker } from 'server/src/components/clients/ClientPicker';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import UserPicker from 'server/src/components/ui/UserPicker';
import { ContactPicker } from 'server/src/components/ui/ContactPicker';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { getContactsByClient, getAllContacts } from 'server/src/lib/actions/contact-actions/contactActions';
import { IContact } from 'server/src/interfaces';
import { getAllUsersBasic } from 'server/src/lib/actions/user-actions/userActions';
import { IUser } from '@shared/interfaces/user.interfaces';
import { ProjectTaskStatusSelector } from './ProjectTaskStatusSelector';
import { QuickAddTagPicker, PendingTag } from 'server/src/components/tags';
import { createTagsForEntity } from 'server/src/lib/actions/tagActions';
import ClientPortalConfigEditor from './ClientPortalConfigEditor';
import { ChevronDown, ChevronRight, Settings, Upload, FileSpreadsheet, X } from 'lucide-react';
import { parseCSV } from 'server/src/lib/utils/csvParser';
import {
  generatePhaseTaskCSVTemplate,
  validatePhaseTaskImportData,
  importPhasesAndTasks,
} from 'server/src/lib/actions/project-actions/phaseTaskImportActions';
import {
  ITaskImportRow,
  IGroupedPhaseData,
  TASK_IMPORT_FIELDS,
  MappableTaskField,
  groupRowsIntoPhases,
} from 'server/src/interfaces/phaseTaskImport.interfaces';

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

  // Phase/Task import state
  const [showImportSection, setShowImportSection] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importParsedRows, setImportParsedRows] = useState<ITaskImportRow[]>([]);
  const [importGroupedPhases, setImportGroupedPhases] = useState<IGroupedPhaseData[]>([]);
  const [importError, setImportError] = useState<string | null>(null);

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

  // Handle CSV file upload for phase/task import
  const handleImportFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0];
    if (!uploadedFile) return;

    setImportError(null);
    setImportFile(uploadedFile);

    try {
      const text = await uploadedFile.text();
      const rows = parseCSV(text) as string[][];

      if (rows.length < 2) {
        throw new Error('CSV file is empty or has no data rows');
      }

      const headers = rows[0];
      const dataRows = rows.slice(1);

      // Auto-map columns to fields
      const headerToFieldMap: Record<number, MappableTaskField> = {};
      headers.forEach((header, index) => {
        const headerLower = header.toLowerCase().replace(/[_\s-]/g, '');
        Object.entries(TASK_IMPORT_FIELDS).forEach(([field]) => {
          const fieldLower = field.toLowerCase().replace(/[_\s-]/g, '');
          if (headerLower === fieldLower || headerLower.includes(fieldLower)) {
            headerToFieldMap[index] = field as MappableTaskField;
          }
        });
      });

      // Map CSV data to ITaskImportRow objects
      const mappedRows: ITaskImportRow[] = dataRows.map((row) => {
        const mappedData: ITaskImportRow = {};
        Object.entries(headerToFieldMap).forEach(([indexStr, field]) => {
          const index = parseInt(indexStr, 10);
          (mappedData as Record<string, string>)[field] = row[index] || '';
        });
        return mappedData;
      }).filter(row => row.task_name?.trim()); // Filter out rows without task names

      if (mappedRows.length === 0) {
        throw new Error('No valid tasks found in CSV. Make sure "task_name" column is mapped.');
      }

      // Validate and group the data
      const validationResponse = await validatePhaseTaskImportData(mappedRows);
      const validRows = validationResponse.validationResults
        .filter(r => r.isValid)
        .map(r => r.data);

      const grouped = groupRowsIntoPhases(
        validRows,
        validationResponse.userLookup,
        validationResponse.priorityLookup,
        validationResponse.serviceLookup
      );

      setImportParsedRows(mappedRows);
      setImportGroupedPhases(grouped);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Error reading CSV file');
      setImportFile(null);
      setImportParsedRows([]);
      setImportGroupedPhases([]);
    }
  };

  const clearImportFile = () => {
    setImportFile(null);
    setImportParsedRows([]);
    setImportGroupedPhases([]);
    setImportError(null);
  };

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

      // Import phases/tasks if file was uploaded
      let importMessage = '';
      if (importGroupedPhases.length > 0) {
        try {
          const importResult = await importPhasesAndTasks(newProject.project_id, importGroupedPhases);
          if (importResult.success || importResult.tasksCreated > 0) {
            importMessage = ` with ${importResult.phasesCreated} phases and ${importResult.tasksCreated} tasks imported`;
          }
          if (importResult.errors.length > 0) {
            toast.error(`Some items could not be imported: ${importResult.errors[0]}`);
          }
        } catch (importError) {
          console.error("Error importing phases/tasks:", importError);
          toast.error('Project created, but phase/task import failed');
        }
      }

      // Pass project with tags to callback
      onProjectAdded({ ...newProject, tags: createdTags });

      onClose();

      // Show success toast *after* potential state updates in parent
      toast.success(`Project created successfully${importMessage}`);
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

              {/* Import Phases/Tasks - Expandable Section */}
              <div className="border-t pt-4 mt-2">
                <button
                  type="button"
                  onClick={() => setShowImportSection(!showImportSection)}
                  className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                >
                  {showImportSection ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <Upload className="h-4 w-4" />
                  <span>Import Phases/Tasks (Optional)</span>
                </button>
                {showImportSection && (
                  <div className="mt-3 space-y-3">
                    <p className="text-xs text-gray-500">
                      Upload a CSV file to pre-populate phases and tasks when creating this project.
                    </p>

                    {importError && (
                      <div className="p-2 text-sm text-red-600 bg-red-50 rounded border border-red-200">
                        {importError}
                      </div>
                    )}

                    {!importFile ? (
                      <div className="space-y-2">
                        <Input
                          id="import-csv-file"
                          type="file"
                          accept=".csv"
                          onChange={handleImportFileUpload}
                          disabled={isSubmitting}
                        />
                        <Button
                          id="download-import-template-btn"
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            const template = await generatePhaseTaskCSVTemplate();
                            const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
                            const link = document.createElement('a');
                            const url = URL.createObjectURL(blob);
                            link.setAttribute('href', url);
                            link.setAttribute('download', 'phase_task_import_template.csv');
                            link.style.visibility = 'hidden';
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                          }}
                          className="w-full"
                        >
                          Download CSV Template
                        </Button>
                      </div>
                    ) : (
                      <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <FileSpreadsheet className="h-5 w-5 text-green-600" />
                            <div>
                              <p className="text-sm font-medium text-green-800">{importFile.name}</p>
                              <p className="text-xs text-green-600">
                                {importGroupedPhases.length} phase{importGroupedPhases.length !== 1 ? 's' : ''},{' '}
                                {importGroupedPhases.reduce((sum, p) => sum + p.tasks.length, 0)} task{importGroupedPhases.reduce((sum, p) => sum + p.tasks.length, 0) !== 1 ? 's' : ''} ready to import
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={clearImportFile}
                            className="p-1 text-gray-400 hover:text-gray-600"
                            disabled={isSubmitting}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        {importGroupedPhases.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-green-200">
                            <p className="text-xs text-green-700 mb-1">Phases to create:</p>
                            <ul className="text-xs text-green-600 list-disc list-inside">
                              {importGroupedPhases.slice(0, 3).map((phase, index) => (
                                <li key={index}>
                                  {phase.phase_name} ({phase.tasks.length} task{phase.tasks.length !== 1 ? 's' : ''})
                                </li>
                              ))}
                              {importGroupedPhases.length > 3 && (
                                <li>...and {importGroupedPhases.length - 3} more phase{importGroupedPhases.length - 3 !== 1 ? 's' : ''}</li>
                              )}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
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
