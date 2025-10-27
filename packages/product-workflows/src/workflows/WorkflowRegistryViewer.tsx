'use client';

import React, { useState, useEffect } from 'react';
import { getRegisteredWorkflowsAction } from '@product/actions/workflow-actions';
import { Button } from '@server/components/ui/Button';
import { Card } from '@server/components/ui/Card';
import WorkflowVisualizer from './visualization/WorkflowVisualizer';

interface WorkflowDefinitionInfo {
  name: string;
  description?: string;
  version?: string;
  tags?: string[];
}

export default function WorkflowRegistryViewer() {
  const [workflows, setWorkflows] = useState<WorkflowDefinitionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'visualization' | 'debug'>('visualization');

  useEffect(() => {
    async function fetchWorkflows() {
      try {
        setLoading(true);
        const registeredWorkflows = await getRegisteredWorkflowsAction();
        setWorkflows(registeredWorkflows);
        
        // Select the first workflow by default if available
        if (registeredWorkflows.length > 0 && !selectedWorkflow) {
          setSelectedWorkflow(registeredWorkflows[0].name);
        }
        
        setError(null);
      } catch (err) {
        console.error('Error fetching registered workflows:', err);
        setError(err instanceof Error ? err : new Error('Failed to fetch workflows'));
      } finally {
        setLoading(false);
      }
    }

    fetchWorkflows();
  }, []);

  const handleSelectWorkflow = (workflowName: string) => {
    setSelectedWorkflow(workflowName);
  };

  if (loading) {
    return (
      <div className="p-4 text-center" id="workflow-registry-loading">
        <div className="animate-pulse">Loading workflow registry...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center text-red-500" id="workflow-registry-error">
        Error: {error.message}
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500" id="workflow-registry-empty">
        No registered workflows found.
      </div>
    );
  }

  return (
    <div className="workflow-registry" id="workflow-registry">
      <div className="flex flex-col md:flex-row gap-6">
        {/* Workflow List */}
        <div className="w-full md:w-1/3">
          <h3 className="text-xl font-semibold mb-4 text-[rgb(var(--color-text-900))]">
            Registered Workflows
          </h3>
          <div className="space-y-3">
            {workflows.map((workflow) => (
              <Card
                key={workflow.name}
                className={`p-4 cursor-pointer transition-colors ${
                  selectedWorkflow === workflow.name
                    ? 'border-[rgb(var(--color-primary-500))] bg-[rgb(var(--color-primary-50))]'
                    : 'hover:bg-[rgb(var(--color-background-100))]'
                }`}
                onClick={() => handleSelectWorkflow(workflow.name)}
                id={`workflow-card-${workflow.name}`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-medium text-[rgb(var(--color-text-900))]">
                      {workflow.name}
                    </h4>
                    {workflow.version && (
                      <div className="text-sm text-[rgb(var(--color-text-500))]">
                        v{workflow.version}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {workflow.tags?.map((tag) => (
                      <span 
                        key={tag} 
                        className="text-xs px-2 py-1 rounded-full bg-[rgb(var(--color-background-100))] text-[rgb(var(--color-text-700))]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                {workflow.description && (
                  <p className="mt-2 text-sm text-[rgb(var(--color-text-700))]">
                    {workflow.description}
                  </p>
                )}
              </Card>
            ))}
          </div>
        </div>

        {/* Workflow Visualization */}
        <div className="w-full md:w-2/3">
          {selectedWorkflow && (
            <div>
              <h3 className="text-xl font-semibold mb-4 text-[rgb(var(--color-text-900))]">
                Workflow Visualization
              </h3>
              
              {/* Custom Tabs */}
              <div className="border-b border-[rgb(var(--color-border-200))] mb-4">
                <div className="flex space-x-2">
                  <button
                    className={`px-4 py-2 text-sm font-medium ${
                      activeTab === 'visualization'
                        ? 'border-b-2 border-[rgb(var(--color-primary-500))] text-[rgb(var(--color-primary-600))]'
                        : 'text-[rgb(var(--color-text-500))] hover:text-[rgb(var(--color-text-700))]'
                    }`}
                    onClick={() => setActiveTab('visualization')}
                    id="visualization-tab"
                  >
                    Visualization
                  </button>
                  <button
                    className={`px-4 py-2 text-sm font-medium ${
                      activeTab === 'debug'
                        ? 'border-b-2 border-[rgb(var(--color-primary-500))] text-[rgb(var(--color-primary-600))]'
                        : 'text-[rgb(var(--color-text-500))] hover:text-[rgb(var(--color-text-700))]'
                    }`}
                    onClick={() => setActiveTab('debug')}
                    id="debug-tab"
                  >
                    Debug Tools
                  </button>
                </div>
              </div>
              
              {/* Tab Content */}
              {activeTab === 'visualization' && (
                <div className="h-[500px] border rounded-md overflow-hidden">
                  <WorkflowVisualizer
                    workflowDefinitionId={selectedWorkflow}
                    height="100%"
                    width="100%"
                    showControls={true}
                    showLegend={true}
                  />
                </div>
              )}
              
              {activeTab === 'debug' && (
                <Card className="p-4">
                  <h4 className="font-medium mb-2">Workflow Debugging Tools</h4>
                  <p className="text-sm text-[rgb(var(--color-text-700))] mb-4">
                    Use these tools to inspect and debug workflow execution.
                  </p>
                  <div className="space-y-3">
                    <div>
                      <h5 className="font-medium text-sm mb-1">Execution Status</h5>
                      <div className="flex gap-2">
                        <span className="px-2 py-1 text-xs rounded-full bg-[rgb(var(--color-info-50))] text-[rgb(var(--color-info-600))]">
                          Active: 0
                        </span>
                        <span className="px-2 py-1 text-xs rounded-full bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-600))]">
                          Completed: 0
                        </span>
                        <span className="px-2 py-1 text-xs rounded-full bg-[rgb(var(--color-accent-50))] text-[rgb(var(--color-accent-600))]">
                          Failed: 0
                        </span>
                      </div>
                    </div>
                    <div>
                      <h5 className="font-medium text-sm mb-1">Workflow Inspection</h5>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" id="inspect-workflow-button">
                          Inspect Structure
                        </Button>
                        <Button size="sm" variant="outline" id="view-executions-button">
                          View Executions
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
