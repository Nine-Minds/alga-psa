'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'server/src/components/ui/Tabs';
import { toast } from 'react-hot-toast';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { getEventCatalogEntries, getEventCatalogEntryByEventType } from 'server/src/lib/actions/event-catalog-actions';
import { IEventCatalogEntry } from '@alga-psa/shared/workflow';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import *  as workflowEditorActions from 'server/src/lib/actions/workflow-editor-actions';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';

// JSON Editor component
const JsonEditor = ({ value, onChange, error, height = '200px' }: {
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  height?: string;
}) => {
  return (
    <div className="space-y-2">
      <div className="border rounded-md overflow-hidden" style={{ height }}>
        <textarea
          className="w-full h-full p-2 font-mono text-sm resize-none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      </div>
      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}
    </div>
  );
};

// Helper function to extract event names from workflow code
function extractEventNamesFromCode(code: string): string[] {
  const eventNames: string[] = [];
  
  // Look for events.waitFor patterns
  const waitForRegex = /events\.waitFor\(['"]([^'"]+)['"]\)/g;
  let match;
  
  while ((match = waitForRegex.exec(code)) !== null) {
    eventNames.push(match[1]);
  }
  
  // Look for arrays of event names
  const arrayWaitForRegex = /events\.waitFor\(\s*\[\s*(['"][^'"]+['"](?:\s*,\s*['"][^'"]+['"])*)\s*\]\s*\)/g;
  while ((match = arrayWaitForRegex.exec(code)) !== null) {
    const eventArray = match[1];
    const eventMatches = eventArray.match(/['"]([^'"]+)['"]/g);
    if (eventMatches) {
      eventMatches.forEach(eventMatch => {
        const eventName = eventMatch.replace(/['"]/g, '');
        eventNames.push(eventName);
      });
    }
  }
  
  return [...new Set(eventNames)]; // Remove duplicates
}

// Generate example data based on event schema
function generateExampleFromSchema(schema: Record<string, any>): any {
  // Simple implementation - could be enhanced for more complex schemas
  if (!schema || !schema.properties) return {};
  
  const example: Record<string, any> = {};
  
  for (const [key, prop] of Object.entries<any>(schema.properties)) {
    if (prop.type === 'string') {
      example[key] = prop.format === 'uuid' ? '00000000-0000-0000-0000-000000000000' : 'example';
    } else if (prop.type === 'number') {
      example[key] = 0;
    } else if (prop.type === 'boolean') {
      example[key] = false;
    } else if (prop.type === 'object' && prop.properties) {
      example[key] = generateExampleFromSchema(prop);
    } else if (prop.type === 'array') {
      example[key] = [];
    }
  }
  
  return example;
}

// Main component
interface TestWorkflowModalProps {
  isOpen: boolean;
  onClose: () => void;
  workflowCode: string;
  workflowId: string; // Make workflowId required
}

export default function TestWorkflowModal({ isOpen, onClose, workflowCode, workflowId }: TestWorkflowModalProps) {
  const [eventName, setEventName] = useState<string>('');
  const [eventPayload, setEventPayload] = useState<string>('{}');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>('custom');
  const [jsonError, setJsonError] = useState<string | null>(null);
  
  // State for event catalog entries
  const [eventCatalogEntries, setEventCatalogEntries] = useState<IEventCatalogEntry[]>([]);
  const [selectedEventSchema, setSelectedEventSchema] = useState<Record<string, any> | null>(null);
  const [isLoadingSchema, setIsLoadingSchema] = useState<boolean>(false);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState<boolean>(false);
  
  // Extract event names from workflow code
  const eventNames = extractEventNamesFromCode(workflowCode);
  
  // Fetch event catalog entries when modal opens
  useEffect(() => {
    const fetchEventCatalog = async () => {
      try {
        setIsLoadingCatalog(true);
        const user = await getCurrentUser();
        if (!user) return;
        
        const entries = await getEventCatalogEntries({ tenant: user.tenant });
        setEventCatalogEntries(entries);
        
        // If we have entries and no event name is selected yet, select the first one
        if (entries.length > 0 && !eventName) {
          // Prioritize events from workflow code, then from catalog
          const eventNamesFromCode = extractEventNamesFromCode(workflowCode);
          if (eventNamesFromCode.length > 0) {
            handleEventTypeChange(eventNamesFromCode[0]);
          } else if (entries.length > 0) {
            handleEventTypeChange(entries[0].event_type);
          }
        }
      } catch (error) {
        console.error("Error fetching event catalog:", error);
        toast.error("Failed to load event catalog");
      } finally {
        setIsLoadingCatalog(false);
      }
    };
    
    if (isOpen) {
      fetchEventCatalog();
    }
  }, [isOpen, workflowCode]);
  
  // Set first event name as default when modal opens
  useEffect(() => {
    if (isOpen && eventNames.length > 0 && !eventName) {
      setEventName(eventNames[0]);
    }
  }, [isOpen, eventNames, eventName]);
  
  // Handle event type selection
  const handleEventTypeChange = async (selectedEventType: string) => {
    // Skip if it's a header
    if (selectedEventType === 'workflow-code-header' || selectedEventType === 'event-catalog-header') {
      return;
    }
    
    setEventName(selectedEventType);
    setIsLoadingSchema(true);
    
    try {
      const user = await getCurrentUser();
      if (!user) return;
      
      // Find the event catalog entry for this event type
      const entry = eventCatalogEntries.find(e => e.event_type === selectedEventType);
      
      if (entry && entry.payload_schema) {
        setSelectedEventSchema(entry.payload_schema);
        
        // Generate example data from schema
        const exampleData = generateExampleFromSchema(entry.payload_schema);
        setEventPayload(JSON.stringify(exampleData, null, 2));
        
        // Switch to the schema tab to show the schema information
        setActiveTab('examples');
      } else {
        // Try to fetch the schema directly if not found in the cached entries
        const fetchedEntry = await getEventCatalogEntryByEventType({
          eventType: selectedEventType,
          tenant: user.tenant
        });
        
        if (fetchedEntry && fetchedEntry.payload_schema) {
          setSelectedEventSchema(fetchedEntry.payload_schema);
          
          // Generate example data from schema
          const exampleData = generateExampleFromSchema(fetchedEntry.payload_schema);
          setEventPayload(JSON.stringify(exampleData, null, 2));
          
          // Switch to the schema tab to show the schema information
          setActiveTab('examples');
        } else {
          setSelectedEventSchema(null);
          // Set a simple default payload
          setEventPayload(JSON.stringify({ value: "example data" }, null, 2));
          
          // Switch to the custom tab since we don't have schema information
          setActiveTab('custom');
        }
      }
    } catch (error) {
      console.error("Error handling event type change:", error);
      setSelectedEventSchema(null);
      
      // Switch to the custom tab since we encountered an error
      setActiveTab('custom');
    } finally {
      setIsLoadingSchema(false);
    }
  };
  
  // Function to execute workflow test
  const handleTest = async () => {
    // Validate JSON
    try {
      const payload = JSON.parse(eventPayload);
      setJsonError(null);
      setIsSubmitting(true);
      
      try {        
        // Execute the workflow test with the event data
        const result = await workflowEditorActions.executeWorkflowTest(
          workflowCode,
          eventName,
          payload,
          workflowId // Pass the workflowId (now required)
        );
        
        if (result.success) {
          // If execution succeeds, show success message
          toast.success("Workflow test started successfully");
          
          if (result.executionId) {
            // Generate link to logs and history screen
            const logsUrl = `/msp/automation-hub?tab=logs&executionId=${result.executionId}`;
            
            // Show success notification with link
            toast.success(
              <div>
                Workflow test started successfully!
                <a href={logsUrl} className="block mt-2 text-blue-600 underline">
                  View execution details
                </a>
              </div>
            );
          }
          
          // Close the modal
          onClose();
        } else {
          toast.error(result.message);
        }
      } catch (error) {
        console.error('Error testing workflow:', error);
        toast.error(error instanceof Error ? error.message : 'An error occurred while testing the workflow');
      } finally {
        setIsSubmitting(false);
      }
    } catch (error) {
      setJsonError('Invalid JSON: ' + (error instanceof Error ? error.message : String(error)));
    }
  };
  
  return (
    <Dialog 
      isOpen={isOpen} 
      onClose={onClose} 
      id="test-workflow" title="Test Workflow"
    >
      <DialogContent className="sm:max-w-[600px]">
        
        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="event-name">Event Type</Label>
            {isLoadingCatalog ? (
              <LoadingIndicator text="Loading event types..." spinnerProps={{ size: "sm" }} />
            ) : (
              <CustomSelect
                id="event-name"
                value={eventName}
                onValueChange={handleEventTypeChange}
                placeholder="Select an event type"
                options={[
                  ...(eventNames.length > 0 ? [
                    { value: 'workflow-code-header', label: '--- From Workflow Code ---', className: 'bg-gray-100 font-semibold' }
                  ] : []),
                  ...eventNames.map(name => ({
                    value: name,
                    label: name
                  })),
                  ...(eventNames.length > 0 && eventCatalogEntries.length > 0 ? [
                    { value: 'event-catalog-header', label: '--- From Event Catalog ---', className: 'bg-gray-100 font-semibold' }
                  ] : []),
                  ...eventCatalogEntries.map(entry => ({
                    value: entry.event_type,
                    label: `${entry.name} (${entry.event_type})`
                  }))
                ].filter(option =>
                  // Filter out the headers if their section is empty
                  !(option.value === 'workflow-code-header' && eventNames.length === 0) &&
                  !(option.value === 'event-catalog-header' && eventCatalogEntries.length === 0)
                )}
              />
            )}
          </div>
          
          <div className="space-y-2">
            <Label>Event Payload</Label>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="custom">Custom</TabsTrigger>
                <TabsTrigger value="examples">Schema & Examples</TabsTrigger>
              </TabsList>
              <TabsContent value="custom">
                <JsonEditor
                  value={eventPayload}
                  onChange={setEventPayload}
                  error={jsonError}
                  height="200px"
                />
              </TabsContent>
              <TabsContent value="examples">
                <div className="space-y-4">
                  {isLoadingSchema ? (
                    <div className="bg-gray-50 p-3 rounded-md text-sm flex items-center space-x-2">
                      <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full"></div>
                      <span>Loading schema information...</span>
                    </div>
                  ) : selectedEventSchema ? (
                    <>
                      <div className="bg-gray-50 p-3 rounded-md text-sm">
                        <h4 className="font-medium mb-1">Schema Information for {eventName}:</h4>
                        {selectedEventSchema.description && (
                          <p className="text-gray-600 mb-2">{selectedEventSchema.description}</p>
                        )}
                        {selectedEventSchema.required && selectedEventSchema.required.length > 0 && (
                          <div className="mt-2">
                            <h5 className="font-medium">Required Fields:</h5>
                            <ul className="list-disc pl-5">
                              {selectedEventSchema.required.map((field: string) => (
                                <li key={field}>{field}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {selectedEventSchema.properties && Object.keys(selectedEventSchema.properties).length > 0 && (
                          <div className="mt-2">
                            <h5 className="font-medium">Available Properties:</h5>
                            <ul className="list-disc pl-5">
                              {Object.entries(selectedEventSchema.properties).map(([key, prop]: [string, any]) => (
                                <li key={key}>
                                  <span className="font-mono">{key}</span>
                                  <span className="text-gray-500"> ({prop.type})</span>
                                  {prop.description && <span className="text-xs block ml-2 text-gray-600">{prop.description}</span>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <Button
                          id="generate-example-button"
                          className="mt-3"
                          variant="outline"
                          onClick={() => {
                            const exampleData = generateExampleFromSchema(selectedEventSchema);
                            setEventPayload(JSON.stringify(exampleData, null, 2));
                            setActiveTab('custom');
                          }}
                        >
                          Generate Example from Schema
                        </Button>
                      </div>
                      <JsonEditor
                        value={eventPayload}
                        onChange={setEventPayload}
                        error={jsonError}
                        height="150px"
                      />
                    </>
                  ) : (
                    <div className="bg-gray-50 p-3 rounded-md text-sm">
                      <h4 className="font-medium mb-1">Example Templates:</h4>
                      <div className="space-y-2">
                        <Button
                          id="simple-example-button"
                          variant="outline"
                          onClick={() => {
                            setEventPayload(JSON.stringify({ value: "example data" }, null, 2));
                            setActiveTab('custom');
                          }}
                        >
                          Simple Example
                        </Button>
                        <Button
                          id="complex-example-button"
                          variant="outline"
                          onClick={() => {
                            setEventPayload(JSON.stringify({
                              id: "123456",
                              name: "Test Item",
                              status: "active",
                              metadata: {
                                createdBy: "user123",
                                timestamp: new Date().toISOString()
                              }
                            }, null, 2));
                            setActiveTab('custom');
                          }}
                        >
                          Complex Example
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
        
        <DialogFooter>
          <Button id="cancel-test-button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            id="run-test-button"
            onClick={handleTest}
            disabled={isSubmitting || !eventName || jsonError !== null || isLoadingCatalog || isLoadingSchema}
          >
            {isSubmitting ? 'Testing...' : 'Test Workflow'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}