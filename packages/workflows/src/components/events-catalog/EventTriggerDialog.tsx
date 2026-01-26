"use client";

import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@alga-psa/ui/components/Dialog";
import { Button } from "@alga-psa/ui/components/Button";
import { Input } from "@alga-psa/ui/components/Input";
import { Label } from "@alga-psa/ui/components/Label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@alga-psa/ui/components/Tabs";
import { Card } from "@alga-psa/ui/components/Card";
import { Trash2, Plus, ArrowRight } from "lucide-react";
import { toast } from "react-hot-toast";
import { IEventCatalogEntry, ICreateWorkflowEventAttachment, ICreateWorkflowTrigger, ICreateWorkflowEventMapping } from "@alga-psa/shared/workflow";
import { createWorkflowTrigger, createWorkflowEventMappings } from "../../actions/workflow-trigger-actions";
import { createWorkflowEventAttachment } from "../../actions/workflow-event-attachment-actions";
import { getAllWorkflowRegistrations } from "../../actions/workflow-runtime-actions";
import { getCurrentTenant } from "@alga-psa/tenancy/actions";

interface EventTriggerDialogProps {
  isOpen: boolean;
  onClose: (refreshData?: boolean) => void;
  event: IEventCatalogEntry;
}

interface WorkflowOption {
  id: string;
  name: string;
  parameters?: Record<string, any>;
}

interface ParameterMapping {
  eventFieldPath: string;
  workflowParameter: string;
  transformFunction?: string;
}

export default function EventTriggerDialog({ isOpen, onClose, event }: EventTriggerDialogProps) {
  // State for workflows
  const [workflowOptions, setWorkflowOptions] = useState<WorkflowOption[]>([]);
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState<boolean>(true);

  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("");
  const [triggerName, setTriggerName] = useState<string>("");
  const [triggerDescription, setTriggerDescription] = useState<string>("");
  const [parameterMappings, setParameterMappings] = useState<ParameterMapping[]>([]);
  const [activeTab, setActiveTab] = useState<string>("basic");
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string>("");
  
  // Load workflows when dialog opens
  useEffect(() => {
    if (isOpen) {
      loadWorkflows();
    }
  }, [isOpen]);
  
  // Load workflows from the server
  const loadWorkflows = async () => {
    try {
      setIsLoadingWorkflows(true);
      
      // Fetch all workflow registrations
      const registrations = await getAllWorkflowRegistrations();
      
      // Convert to workflow options
      const options: WorkflowOption[] = registrations.map(reg => ({
        id: reg.registration_id,
        name: reg.name,
        parameters: reg.parameters || {}
      }));
      
      setWorkflowOptions(options);
    } catch (error) {
      console.error("Error loading workflows:", error);
      toast.error("Failed to load workflows");
    } finally {
      setIsLoadingWorkflows(false);
    }
  };
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setValidationError("");
    }
  };

  // Reset form when event changes
  useEffect(() => {
    if (event) {
      setTriggerName(`${event.name} Trigger`);
      setTriggerDescription(`Trigger for ${event.name} event`);
      setSelectedWorkflowId("");
      setParameterMappings([]);
      setActiveTab("basic");
      setHasAttemptedSubmit(false);
      setValidationError("");
    }
  }, [event]);

  // Add a new parameter mapping
  const addParameterMapping = () => {
    setParameterMappings([...parameterMappings, { eventFieldPath: "", workflowParameter: "" }]);
  };

  // Remove a parameter mapping
  const removeParameterMapping = (index: number) => {
    const newMappings = [...parameterMappings];
    newMappings.splice(index, 1);
    setParameterMappings(newMappings);
  };

  // Update a parameter mapping
  const updateParameterMapping = (index: number, field: keyof ParameterMapping, value: string) => {
    const newMappings = [...parameterMappings];
    newMappings[index] = { ...newMappings[index], [field]: value };
    setParameterMappings(newMappings);
  };

  // Get the selected workflow
  const selectedWorkflow = workflowOptions.find(w => w.id === selectedWorkflowId);

  // Handle form submission
  const handleSubmit = async () => {
    setHasAttemptedSubmit(true);
    
    const validationErrors: string[] = [];
    if (!selectedWorkflowId) validationErrors.push("Workflow");
    if (!triggerName.trim()) validationErrors.push("Trigger Name");
    
    if (validationErrors.length > 0) {
      setValidationError(`Please fill in the required fields: ${validationErrors.join(", ")}`);
      return;
    }

    try {
      setIsSubmitting(true);

      // Get current tenant ID using server action
      const tenant = await getCurrentTenant();
      
      // Create the workflow trigger
      const triggerData: ICreateWorkflowTrigger = {
        tenant: tenant || "", // Get tenant ID from server action
        name: triggerName,
        description: triggerDescription,
        event_type: event.event_type
      };

      const trigger = await createWorkflowTrigger(triggerData);

      // Create parameter mappings if any
      if (parameterMappings.length > 0) {
        const mappingData: ICreateWorkflowEventMapping[] = parameterMappings.map(mapping => ({
          trigger_id: trigger.trigger_id,
          event_field_path: mapping.eventFieldPath,
          workflow_parameter: mapping.workflowParameter,
          transform_function: mapping.transformFunction
        }));

        await createWorkflowEventMappings({ mappings: mappingData });
      }

      // Create the workflow event attachment
      const attachmentData: ICreateWorkflowEventAttachment = {
        workflow_id: selectedWorkflowId,
        event_type: event.event_type,
        tenant: tenant || "", // Get tenant ID from server action
        is_active: true
      };

      await createWorkflowEventAttachment(attachmentData);

      toast.success("Workflow attached successfully");
      onClose(true); // Close the dialog and refresh data
    } catch (error) {
      console.error("Error attaching workflow:", error);
      toast.error("Failed to attach workflow");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} id="event-trigger-dialog">
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Attach Workflow to Event: {event.name}</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="basic">Basic Configuration</TabsTrigger>
            <TabsTrigger value="parameters" disabled>Parameter Mapping</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-4 py-4">
            {hasAttemptedSubmit && validationError && (
              <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded mb-4">
                <p className="font-medium mb-2">Please fill in the required fields:</p>
                <ul className="list-disc list-inside space-y-1">
                  {validationError.split(": ")[1]?.split(", ").map((err, index) => (
                    <li key={index}>{err}</li>
                  )) || <li>{validationError}</li>}
                </ul>
              </div>
            )}
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <Label htmlFor="workflow-select">Select Workflow *</Label>
                  {isLoadingWorkflows ? (
                    <div className="w-full border border-gray-300 rounded-md p-2 mt-1 bg-gray-50">
                      <div className="animate-pulse flex space-x-4">
                        <div className="flex-1 space-y-2 py-1">
                          <div className="h-4 bg-gray-300 rounded w-3/4"></div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <select
                      id="workflow-select"
                      className={`w-full border rounded-md p-2 mt-1 ${
                        hasAttemptedSubmit && !selectedWorkflowId ? 'border-red-500' : 'border-gray-300'
                      }`}
                      value={selectedWorkflowId}
                      onChange={(e) => {
                        setSelectedWorkflowId(e.target.value);
                        clearErrorIfSubmitted();
                      }}
                      disabled={workflowOptions.length === 0}
                    >
                      <option value="">Select a workflow</option>
                      {workflowOptions.map((workflow) => (
                        <option key={workflow.id} value={workflow.id}>
                          {workflow.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {workflowOptions.length === 0 && !isLoadingWorkflows && (
                    <p className="text-sm text-red-500 mt-1">
                      No workflows available. Please create a workflow first.
                    </p>
                  )}
                </div>

                <div>
                  <Label htmlFor="trigger-name">Trigger Name *</Label>
                  <Input
                    id="trigger-name"
                    value={triggerName}
                    onChange={(e) => {
                      setTriggerName(e.target.value);
                      clearErrorIfSubmitted();
                    }}
                    placeholder="Enter trigger name *"
                    className={hasAttemptedSubmit && !triggerName.trim() ? 'border-red-500' : ''}
                  />
                </div>

                <div>
                  <Label htmlFor="trigger-description">Description (Optional)</Label>
                  <Input
                    id="trigger-description"
                    value={triggerDescription}
                    onChange={(e) => setTriggerDescription(e.target.value)}
                    placeholder="Enter trigger description"
                  />
                </div>
              </div>

              <div className="pt-4">
                <h3 className="text-sm font-medium mb-2">Event Details:</h3>
                <Card className="p-3 bg-gray-50">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="font-medium">Event Type:</span>
                      <div className="text-gray-700">{event.event_type}</div>
                    </div>
                    <div>
                      <span className="font-medium">Category:</span>
                      <div className="text-gray-700">{event.category || "Uncategorized"}</div>
                    </div>
                  </div>
                  {event.description && (
                    <div className="mt-2 text-sm">
                      <span className="font-medium">Description:</span>
                      <div className="text-gray-700">{event.description}</div>
                    </div>
                  )}
                </Card>
              </div>

              <div className="pt-2">
                <Button
                  id="continue-to-parameters-button"
                  type="button"
                  variant="outline"
                  onClick={() => setActiveTab("parameters")}
                  disabled={!selectedWorkflowId}
                  className="w-full"
                >
                  Continue to Parameter Mapping
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="parameters" className="space-y-4 py-4 relative">
            {/* Overlay */}
            <div className="absolute inset-0 bg-gray-200 opacity-75 flex items-center justify-center z-10">
              <p className="text-gray-800 text-lg font-semibold">Parameter mapping is coming soon.</p>
            </div>
            <div className="space-y-4 pointer-events-none">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-sm font-medium">Parameter Mappings</h3>
                  <Button
                    id="add-mapping-button"
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addParameterMapping}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Mapping
                  </Button>
                </div>

                {parameterMappings.length === 0 ? (
                  <div className="text-center py-6 bg-gray-50 rounded-md">
                    <p className="text-gray-500 text-sm">
                      No parameter mappings defined. Add mappings to pass event data to the workflow.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {parameterMappings.map((mapping, index) => (
                      <div key={index} className="flex items-center space-x-2 p-3 border rounded-md">
                        <div className="flex-1">
                          <Label htmlFor={`event-field-${index}`} className="text-xs">Event Field Path</Label>
                          <Input
                            id={`event-field-${index}`}
                            value={mapping.eventFieldPath}
                            onChange={(e) => updateParameterMapping(index, "eventFieldPath", e.target.value)}
                            placeholder="e.g., payload.ticketId"
                            className="text-sm"
                          />
                        </div>
                        <div className="flex-1">
                          <Label htmlFor={`workflow-param-${index}`} className="text-xs">Workflow Parameter</Label>
                          <Input
                            id={`workflow-param-${index}`}
                            value={mapping.workflowParameter}
                            onChange={(e) => updateParameterMapping(index, "workflowParameter", e.target.value)}
                            placeholder="e.g., ticketId"
                            className="text-sm"
                          />
                        </div>
                        <div className="flex-1">
                          <Label htmlFor={`transform-fn-${index}`} className="text-xs">Transform Function (Optional)</Label>
                          <Input
                            id={`transform-fn-${index}`}
                            value={mapping.transformFunction || ""}
                            onChange={(e) => updateParameterMapping(index, "transformFunction", e.target.value)}
                            placeholder="e.g., (val) => val.toString()"
                            className="text-sm"
                          />
                        </div>
                        <Button
                          id={`remove-mapping-${index}-button`}
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeParameterMapping(index)}
                          className="mt-5"
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {selectedWorkflow && selectedWorkflow.parameters && (
                <div className="pt-2">
                  <h3 className="text-sm font-medium mb-2">Available Workflow Parameters:</h3>
                  <Card className="p-3 bg-gray-50">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {Object.entries(selectedWorkflow.parameters).map(([key, type]) => (
                        <div key={key}>
                          <span className="font-medium">{key}:</span>
                          <span className="text-gray-700 ml-1">{type}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              )}

              <div className="pt-2">
                <h3 className="text-sm font-medium mb-2">Event Payload Schema:</h3>
                <Card className="p-3 bg-gray-50">
                  <pre className="text-xs overflow-auto max-h-40">
                    {JSON.stringify(event.payload_schema, null, 2)}
                  </pre>
                </Card>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button
            id="cancel-button"
            type="button"
            variant="outline"
            onClick={() => {
              setHasAttemptedSubmit(false);
              onClose();
            }}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            id="attach-workflow-button"
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className={!selectedWorkflowId || !triggerName ? 'opacity-50' : ''}
          >
            {isSubmitting ? "Attaching..." : "Attach Workflow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
