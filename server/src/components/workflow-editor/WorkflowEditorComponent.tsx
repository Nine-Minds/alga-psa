'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Switch } from 'server/src/components/ui/Switch';
import { ArrowLeft, Save, BookTemplate, AlertTriangle, Tag } from 'lucide-react';
import { Badge } from 'server/src/components/ui/Badge';
import { createWorkflow, updateWorkflow, getWorkflow, testWorkflow } from 'server/src/lib/actions/workflow-editor-actions';
import WorkflowEditor from 'server/src/components/workflow-editor/WorkflowEditor';
import WorkflowVersionsDialog from 'server/src/components/workflow-editor/WorkflowVersionsDialog';
import { toast } from 'react-hot-toast';

// Default workflow template for new workflows
const defaultWorkflowTemplate = `import { defineWorkflow } from '@shared/workflow/core/workflowDefinition';
import { WorkflowContext } from '@shared/workflow/core/workflowContext';

/**
 * New workflow definition
 */
export const newWorkflow = defineWorkflow(
  {
    name: 'NewWorkflow',
    description: 'Description of your workflow',
    version: '1.0.0',
    tags: ['custom']
  },
  async (context: WorkflowContext) => {
    const { actions, data, events, logger } = context;
    
    // Initial state
    context.setState('initial');
    logger.info('Workflow started');
    
    // Wait for an event
    const triggerEvent = await events.waitFor('TriggerEvent');
    logger.info('Received trigger event', triggerEvent.payload);
    
    // Update state
    context.setState('processing');
    
    // Execute an action
    try {
      const result = await actions.example_action({
        param1: triggerEvent.payload.value,
        param2: 'example value'
      });
      
      logger.info('Action completed successfully', result);
      
      // Store the result
      data.set('result', result);
      
      // Final state
      context.setState('completed');
    } catch (error) {
      logger.error('Action failed', error);
      context.setState('failed');
    }
  }
);`;

// WorkflowEditorComponent for editing or creating workflows
interface WorkflowEditorComponentProps {
  workflowId?: string | null;
  onBack: () => void;
}

export default function WorkflowEditorComponent({ workflowId, onBack }: WorkflowEditorComponentProps) {
  const router = useRouter();
  const isEditMode = !!workflowId;

  // Workflow metadata state
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [version, setVersion] = useState<string>("1.0.0");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState<string>("");
  const [isActive, setIsActive] = useState<boolean>(true);
  const [workflowCode, setWorkflowCode] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testWarnings, setTestWarnings] = useState<string[]>([]);

  // Load workflow data if in edit mode
  useEffect(() => {
    const loadWorkflow = async () => {
      if (isEditMode && workflowId) {
        try {
          const workflow = await getWorkflow(workflowId);
          
          setName(workflow.name);
          setDescription(workflow.description || "");
          setVersion(workflow.version);
          setTags(workflow.tags);
          setIsActive(workflow.isActive);
          setWorkflowCode(workflow.code);
        } catch (error) {
          console.error("Error loading workflow:", error);
          toast.error("Failed to load workflow");
        }
      }
    };

    loadWorkflow();
  }, [isEditMode, workflowId]);

  // Initialize with default template for new workflows
  useEffect(() => {
    if (!isEditMode && !workflowCode) {
      setWorkflowCode(defaultWorkflowTemplate);
    }
  }, [isEditMode, workflowCode]);

  // Handle tag input
  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      if (!tags.includes(tagInput.trim())) {
        setTags([...tags, tagInput.trim()]);
      }
      setTagInput("");
    }
  };

  // Remove tag
  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  // Handle save
  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Workflow name is required");
      return;
    }

    setIsSaving(true);
    try {
      if (isEditMode && workflowId) {
        // Update existing workflow
        await updateWorkflow(workflowId, {
          name,
          description,
          version,
          tags,
          isActive,
          code: workflowCode
        });
        toast.success("Workflow updated successfully");
      } else {
        // Create new workflow
        const newWorkflowId = await createWorkflow({
          name,
          description,
          version,
          tags,
          isActive,
          code: workflowCode
        });
        toast.success("Workflow created successfully");
        
        // Navigate to the workflows tab with the new workflow ID
        router.push(`/msp/automation-hub?tab=workflows&workflowId=${newWorkflowId}`);
      }
      onBack(); // Go back to workflow list
    } catch (error) {
      console.error("Error saving workflow:", error);
      toast.error("An error occurred while saving the workflow");
    } finally {
      setIsSaving(false);
    }
  };

  // Handle test
  const handleTest = async (code: string) => {
    setIsTesting(true);
    setTestWarnings([]);
    try {
      const result = await testWorkflow(code);
      
      // Set warnings if any
      if (result.warnings && result.warnings.length > 0) {
        setTestWarnings(result.warnings);
      }
      
      if (result.success) {
        toast.success(result.output);
      } else {
        toast.error(result.output);
      }
    } catch (error) {
      console.error("Error testing workflow:", error);
      toast.error(error instanceof Error ? error.message : "An error occurred while testing the workflow");
    } finally {
      setIsTesting(false);
    }
  };

  // Handle code change from editor
  const handleCodeChange = (code: string) => {
    setWorkflowCode(code);
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <Button
              id="back-to-workflows-button"
              variant="ghost"
              onClick={onBack}
              className="mr-2"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <h1 className="text-xl font-semibold">
              {isEditMode ? "Edit Workflow" : "Create Workflow"}
            </h1>
          </div>
          <div className="flex items-center space-x-2">
            {isEditMode && workflowId && (
              <WorkflowVersionsDialog
                workflowId={workflowId}
                currentVersion={version}
                onVersionChange={async () => {
                  try {
                    const workflow = await getWorkflow(workflowId);
                    
                    setName(workflow.name);
                    setDescription(workflow.description || "");
                    setVersion(workflow.version);
                    setTags(workflow.tags);
                    setIsActive(workflow.isActive);
                    setWorkflowCode(workflow.code);
                    
                    toast.success("Workflow version updated");
                  } catch (error) {
                    console.error("Error loading workflow after version change:", error);
                    toast.error("Failed to load updated workflow version");
                  }
                }}
              />
            )}
            {!isEditMode && (
              <Button
                id="browse-templates-button"
                variant="outline"
                onClick={() => router.push("/msp/automation-hub?tab=template-library")}
              >
                <BookTemplate className="h-4 w-4 mr-2" />
                Browse Templates
              </Button>
            )}
            <Button
              id="save-workflow-button"
              onClick={handleSave}
              disabled={isSaving}
            >
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? "Saving..." : "Save Workflow"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div className="md:col-span-2">
            <div className="space-y-4">
              <div>
                <Label htmlFor="workflow-name">Workflow Name</Label>
                <Input
                  id="workflow-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter workflow name"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="workflow-description">Description</Label>
                <TextArea
                  id="workflow-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter workflow description"
                  className="mt-1"
                  rows={3}
                />
              </div>
            </div>
          </div>
          <div>
            <div className="space-y-4">
              <div>
                <Label htmlFor="workflow-version">Version</Label>
                <Input
                  id="workflow-version"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="1.0.0"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="workflow-tags">Tags</Label>
                <div className="flex items-center mt-1">
                  <Tag className="h-4 w-4 text-gray-400 mr-2" />
                  <Input
                    id="workflow-tags"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    placeholder="Add tag and press Enter"
                    className="flex-1"
                  />
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {tags.map((tag) => (
                    <Badge
                      key={tag}
                      className="bg-primary-100 text-primary-800 cursor-pointer"
                      onClick={() => removeTag(tag)}
                    >
                      {tag} &times;
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="workflow-active">Active</Label>
                <Switch
                  id="workflow-active"
                  checked={isActive}
                  onCheckedChange={setIsActive}
                />
              </div>
            </div>
          </div>
        </div>

        {testWarnings.length > 0 && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
            <div className="flex items-center mb-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500 mr-2" />
              <h3 className="text-sm font-medium text-yellow-700">Security and Best Practice Warnings</h3>
            </div>
            <ul className="text-sm text-yellow-600 space-y-1 ml-7 list-disc">
              {testWarnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
        
        <WorkflowEditor
          initialValue={workflowCode}
          onSave={async (code) => handleCodeChange(code)}
          onTest={handleTest}
          height="60vh"
        />
      </Card>
    </div>
  );
}