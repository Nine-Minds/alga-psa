'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Code2, Plus, Search, MoreVertical, BookTemplate, History, Check, ArrowLeft, Save, Play, Tag, AlertTriangle, PlayCircle } from 'lucide-react';
import { Input } from 'server/src/components/ui/Input'; // Assuming WorkflowDataWithSystemFlag is exported from here
import { Label } from 'server/src/components/ui/Label';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Switch } from 'server/src/components/ui/Switch';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem
} from 'server/src/components/ui/DropdownMenu';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { Badge } from 'server/src/components/ui/Badge';
import {
  getAllWorkflows,
  setActiveWorkflowVersion,
  getWorkflowVersions,
  getWorkflow,
  updateWorkflowStatus,
  WorkflowDataWithSystemFlag // Import the type
} from 'server/src/lib/actions/workflow-editor-actions';
import { toast } from 'react-hot-toast';
import WorkflowEditorComponent from 'server/src/components/workflow-editor/WorkflowEditorComponent';
import TestWorkflowModal from 'server/src/components/workflow-editor/TestWorkflowModal';
import WorkflowVersionsDialog from 'server/src/components/workflow-editor/WorkflowVersionsDialog';


// Type for workflow data with events
interface WorkflowWithEvents extends WorkflowDataWithSystemFlag { // Extend the imported type
  id: string; // Ensure id is always present
  name: string;
  description?: string;
  version: string;
  tags: string[];
  isActive: boolean;
  code: string;
  events: string[];
  lastUpdated?: string;
  isSystemManaged: boolean; // Ensure this is part of the interface
}

interface WorkflowsProps {
  workflowId?: string | null;
}

export default function Workflows({ workflowId }: WorkflowsProps) {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowWithEvents[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState<boolean>(false);
  
  // Effect to reload workflows when showInactive changes
  useEffect(() => {
    console.log(`showInactive changed to: ${showInactive}`);
    if (workflowId) return; // Don't reload if we're in editor mode
    loadWorkflows();
  }, [showInactive, workflowId]);
  const [activatingVersion, setActivatingVersion] = useState<{workflowId: string, versionId: string} | null>(null);
  const [showEditor, setShowEditor] = useState<boolean>(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [isTestModalOpen, setIsTestModalOpen] = useState<boolean>(false);
  const [workflowToTest, setWorkflowToTest] = useState<WorkflowWithEvents | null>(null);
  const [selectedWorkflowForVersions, setSelectedWorkflowForVersions] = useState<WorkflowWithEvents | null>(null);

  // Handle workflowId if provided
  useEffect(() => {
    if (workflowId) {
      setSelectedWorkflowId(workflowId);
      setShowEditor(true);
    } else {
      loadWorkflows();
    }
  }, [workflowId]);
  
  // Load workflows from server
  const loadWorkflows = async () => {
    setLoading(true);
    console.log(`Loading workflows with includeInactive=${showInactive}`);
    try {
      const workflowsData = await getAllWorkflows(showInactive);
      console.log(`Loaded ${workflowsData.length} workflows`);
      
      // TODO: Replace with actual event data when available
      // For now, we'll use placeholder event data
      const workflowsWithEvents: WorkflowWithEvents[] = workflowsData.map((workflow: WorkflowDataWithSystemFlag) => ({
        ...workflow,
        id: workflow.id || workflow.registration_id || '', // Ensure ID is set
        events: [],
        lastUpdated: workflow.updated_at || new Date().toISOString(), // Use updated_at if available
        isSystemManaged: workflow.isSystemManaged // Map the flag
      }));
      
      setWorkflows(workflowsWithEvents);
    } catch (error) {
      console.error('Error loading workflows:', error);
      toast.error('Failed to load workflows');
    } finally {
      setLoading(false);
    }
  };

  // Filter by status/search - let DataTable handle sorting
  const filteredWorkflows = useMemo(() => {
    return workflows
      .filter(workflow => showInactive || workflow.isActive) // Filter by active status first
      .filter(workflow => // Then filter by search term
        workflow.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        workflow.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        workflow.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()))
      );
  }, [workflows, showInactive, searchTerm]);

  // Define columns for DataTable
  const columns: ColumnDefinition<WorkflowWithEvents>[] = useMemo(() => [
    {
      title: 'Name',
      dataIndex: 'name',
      sortable: true,
      width: '30%',
      render: (value, workflow) => (
        <div className="flex items-center">
          <div>
            <div className="text-sm font-medium text-gray-900">
              {workflow.name} {workflow.isSystemManaged && (
                <Badge variant="secondary" className="ml-2">
                  System
                </Badge>
              )}
            </div>
            <div className="text-sm text-gray-500">{workflow.description}</div>
          </div>
        </div>
      ),
    },
    {
      title: 'Test',
      dataIndex: 'id',
      width: '8%',
      render: (value, workflow) => (
        <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
          <Button
            id={`test-workflow-button-${workflow.id}`}
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={(e) => {
              e.stopPropagation();
              handleTestWorkflow(workflow.id);
            }}
            title="Test Workflow"
          >
            <span className="sr-only">Test workflow</span>
            <PlayCircle className="h-5 w-5 text-primary" />
          </Button>
        </div>
      ),
    },
    {
      title: 'Version',
      dataIndex: 'version',
      sortable: true,
      width: '10%',
      render: (value, workflow) => (
        <div className="flex items-center">
          <Badge className="bg-primary-100 text-primary-800">
            v{workflow.version}
          </Badge>
        </div>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      sortable: true,
      width: '10%',
      render: (value, workflow) => (
        <Badge
          className={`${
            workflow.isActive
              ? 'bg-success-100 text-success-800'
              : 'bg-secondary-100 text-secondary-800'
          }`}
        >
          {workflow.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      title: 'Events',
      dataIndex: 'events',
      sortable: true,
      width: '22%',
      render: (value, workflow) => (
        <div className="flex flex-wrap gap-1">
          {workflow.events.length > 0 ? (
            workflow.events.map((event) => (
              <Badge key={event} className="bg-blue-100 text-blue-800">
                {event}
              </Badge>
            ))
          ) : (
            <span className="text-sm text-gray-500">No events</span>
          )}
        </div>
      ),
    },
    {
      title: 'Last Updated',
      dataIndex: 'lastUpdated',
      sortable: true,
      width: '12%',
      render: (value, workflow) => (
        <span className="text-sm text-gray-500">
          {workflow.lastUpdated ? new Date(workflow.lastUpdated).toLocaleDateString() : '-'}
        </span>
      ),
    },
    {
      title: 'Actions',
      dataIndex: 'actions',
      width: '8%',
      render: (value, workflow) => (
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                id={`${workflow.id}-actions-menu`}
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="sr-only">Open menu</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                id={`edit-${workflow.id}-menu-item`}
                onClick={() => handleEditWorkflow(workflow.id)}
                disabled={workflow.isSystemManaged}
              >
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                id={`versions-${workflow.id}-menu-item`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleManageVersions(workflow);
                }}
                disabled={workflow.isSystemManaged}
              >
                <History className="h-4 w-4 mr-2" />
                Manage Versions
              </DropdownMenuItem>
              <DropdownMenuItem
                id={`test-${workflow.id}-menu-item`}
                onClick={() => handleTestWorkflow(workflow.id)}
              >
                <PlayCircle className="h-4 w-4 mr-2" />
                Test Workflow
              </DropdownMenuItem>
              <DropdownMenuItem
                id={`duplicate-${workflow.id}-menu-item`}
                disabled={workflow.isSystemManaged}
              >
                Duplicate
              </DropdownMenuItem>
              {workflow.isActive ? (
                <DropdownMenuItem
                  id={`deactivate-${workflow.id}-menu-item`}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    console.log(`Deactivate clicked for workflow ${workflow.id}, currently active: ${workflow.isActive}`);
                    handleToggleWorkflowStatus(workflow.id, workflow.isActive);
                  }}
                  disabled={workflow.isSystemManaged}
                >
                  Deactivate
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  id={`activate-${workflow.id}-menu-item`}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    console.log(`Activate clicked for workflow ${workflow.id}, currently active: ${workflow.isActive}`);
                    handleToggleWorkflowStatus(workflow.id, workflow.isActive);
                  }}
                  disabled={workflow.isSystemManaged}
                >
                  Activate
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                id={`delete-${workflow.id}-menu-item`}
                className="text-red-600 focus:text-red-600"
                onClick={async () => {
                  if (workflow.isSystemManaged) return;
                  if (confirm('Are you sure you want to delete this workflow? This action cannot be undone.')) {
                    toast.success('Workflow deleted');
                    await loadWorkflows();
                  }
                }}
                disabled={workflow.isSystemManaged}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ], [handleTestWorkflow, handleEditWorkflow, handleManageVersions, handleToggleWorkflowStatus, loadWorkflows]);

  // Handle creating a new workflow
  const handleCreateWorkflow = () => {
    setSelectedWorkflowId(null);
    setShowEditor(true);
  };

  // Handle editing a workflow
  const handleEditWorkflow = (id: string) => {
    const workflow = workflows.find(w => w.id === id);
    if (workflow?.isSystemManaged) return; // Don't allow editing system workflows

    setSelectedWorkflowId(id);
    setShowEditor(true);
  };

  // Handle managing workflow versions
  const handleManageVersions = (workflow: WorkflowWithEvents) => {
    if (workflow.isSystemManaged) return; // Don't allow managing versions for system workflows
    setSelectedWorkflowForVersions(workflow);
  };

  // Handle going back to the workflow list
  const handleBackToList = () => {
    setShowEditor(false);
    setSelectedWorkflowId(null);
    loadWorkflows(); // Refresh the list
  };

  // Handle testing a workflow
  const handleTestWorkflow = async (id: string) => {
    try {
      // Find the workflow in the current list
      const workflow = workflows.find(w => w.id === id);
      
      if (workflow) {
        setWorkflowToTest(workflow);
        setIsTestModalOpen(true);
      } else {
        // If not found in the current list, fetch it from the server
        const workflowData = await getWorkflow(id);
        if (workflowData) {
          const workflowWithEvents: WorkflowWithEvents = {
            ...workflowData,
            id: workflowData.id || '',
            events: [],
            lastUpdated: new Date().toISOString(),
            isSystemManaged: workflowData.isSystemManaged // Add the missing flag
          };
          setWorkflowToTest(workflowWithEvents);
          setIsTestModalOpen(true);
        } else {
          toast.error('Workflow not found');
        }
      }
    } catch (error) {
      console.error('Error loading workflow for testing:', error);
      toast.error('Failed to load workflow for testing');
    }
  };
  
  // Handle activating/deactivating a workflow
  const handleToggleWorkflowStatus = async (id: string, currentlyActive: boolean) => {
    const workflow = workflows.find(w => w.id === id);
    if (workflow?.isSystemManaged) return; // Don't allow status change for system workflows

    try {
      console.log(`Toggle workflow status: id=${id}, currentlyActive=${currentlyActive}`);
      
      // We want to set it to the opposite of the current status
      const newStatus = !currentlyActive;
      console.log(`Setting to: ${newStatus ? 'active' : 'inactive'}`);
      
      const success = await updateWorkflowStatus(id, newStatus);
      
      if (success) {
        toast.success(`Workflow ${newStatus ? 'activated' : 'deactivated'} successfully`);
        
        // Force a reload of the workflows list
        setTimeout(() => {
          console.log("Reloading workflows after status change");
          loadWorkflows();
        }, 100);
      } else {
        toast.error(`Failed to ${newStatus ? 'activate' : 'deactivate'} workflow`);
      }
    } catch (error) {
      console.error(`Error ${currentlyActive ? 'deactivating' : 'activating'} workflow:`, error);
      toast.error(`An error occurred while ${currentlyActive ? 'deactivating' : 'activating'} the workflow`);
    }
  };

  return (
    <div className="space-y-6">
      {showEditor ? (
        <WorkflowEditorComponent
          workflowId={selectedWorkflowId}
          onBack={handleBackToList}
        />
      ) : (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center">
              <Code2 className="h-6 w-6 text-primary-500 mr-2" />
              <h1 className="text-xl font-semibold">Workflows</h1>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <SwitchWithLabel
                  checked={showInactive}
                  onCheckedChange={(newValue) => {
                    // Update state first
                    setShowInactive(newValue);
                    console.log(`Show inactive set to: ${newValue}`);
                  }}
                  label="Show inactive workflows"
                />
              </div>
              <div className="relative w-64">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  id="search-workflows-input"
                  placeholder="Search workflows..."
                  className="pl-8"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <div className="flex space-x-2">
                <Button
                  id="browse-templates-button"
                  variant="outline"
                  onClick={() => router.push('/msp/automation-hub?tab=template-library')}
                >
                  <BookTemplate className="h-4 w-4 mr-2" />
                  Browse Templates
                </Button>
                <Button
                  id="create-workflow-button"
                  onClick={handleCreateWorkflow}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create Workflow
                </Button>
              </div>
            </div>
          </div>
          
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
            </div>
          ) : workflows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Code2 className="h-12 w-12 text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900">No workflows found</h3>
              <p className="mt-1 text-sm text-gray-500">Get started by creating a new workflow or using a template.</p>
              <div className="mt-6 flex space-x-4">
                <Button
                  id="browse-templates-empty-button"
                  onClick={() => router.push('/msp/automation-hub?tab=template-library')}
                  variant="outline"
                >
                  <BookTemplate className="h-4 w-4 mr-2" />
                  Browse Templates
                </Button>
                <Button
                  id="create-workflow-empty-button"
                  onClick={handleCreateWorkflow}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create Workflow
                </Button>
              </div>
            </div>
          ) : (
            <DataTable
              id="workflows-table"
              data={filteredWorkflows}
              columns={columns}
              pagination={false}
              onRowClick={(workflow) => !workflow.isSystemManaged && handleEditWorkflow(workflow.id)}
              initialSorting={[{ id: 'name', desc: false }]}
            />
          )}
        </Card>
      )}

      {/* Test Workflow Modal */}
      {workflowToTest && (
        <TestWorkflowModal
          isOpen={isTestModalOpen}
          onClose={() => setIsTestModalOpen(false)}
          workflowCode={workflowToTest.code}
          workflowId={workflowToTest.id}
        />
      )}
      {selectedWorkflowForVersions && (
        <WorkflowVersionsDialog
          isOpen={selectedWorkflowForVersions !== null}
          workflowId={selectedWorkflowForVersions.id}
          currentVersion={selectedWorkflowForVersions.version}
          onClose={() => setSelectedWorkflowForVersions(null)}
          onVersionChange={loadWorkflows}
        />
      )}
    </div>
  );
}