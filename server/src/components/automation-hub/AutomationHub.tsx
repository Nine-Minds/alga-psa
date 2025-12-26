'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { DnDFlow as WorkflowDesigner } from '@product/workflows/entry';
import { Tabs, TabsList, TabsTrigger, TabsContent } from 'server/src/components/ui/Tabs';
import WorkflowList from './WorkflowList';
import CreateWorkflowDialog, { WorkflowTriggerType } from './CreateWorkflowDialog';
import { List, PenTool, Play, Zap } from 'lucide-react';

type TabValue = 'workflows' | 'designer' | 'runs' | 'events';

export default function AutomationHub() {
  const [activeTab, setActiveTab] = useState<TabValue>('workflows');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newWorkflowConfig, setNewWorkflowConfig] = useState<{
    name: string;
    triggerType: WorkflowTriggerType;
  } | null>(null);
  const searchParams = useSearchParams();
  const eventTypeFromQuery = searchParams.get('eventType');

  useEffect(() => {
    const tab = searchParams.get('tab') as TabValue | null;
    if (tab && ['workflows', 'designer', 'runs', 'events'].includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const handleSelectWorkflow = useCallback((workflowId: string) => {
    setSelectedWorkflowId(workflowId);
    setActiveTab('designer');
  }, []);

  const handleCreateNew = useCallback(() => {
    setIsCreateDialogOpen(true);
  }, []);

  const handleCreateWorkflow = useCallback((name: string, triggerType: WorkflowTriggerType) => {
    setNewWorkflowConfig({ name, triggerType });
    setSelectedWorkflowId(null);
    setActiveTab('designer');
    setIsCreateDialogOpen(false);
  }, []);

  return (
    <ReflectionContainer id="automation-hub-container" label="Automation Hub">
      <div className="flex flex-col h-full">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
          <div className="border-b border-[rgb(var(--color-border-200))] bg-white px-6">
            <TabsList className="gap-1 -mb-px">
              <TabsTrigger value="workflows" className="flex items-center gap-2">
                <List className="w-4 h-4" />
                Workflows
              </TabsTrigger>
              <TabsTrigger value="designer" className="flex items-center gap-2">
                <PenTool className="w-4 h-4" />
                Designer
              </TabsTrigger>
              <TabsTrigger value="runs" className="flex items-center gap-2">
                <Play className="w-4 h-4" />
                Runs
              </TabsTrigger>
              <TabsTrigger value="events" className="flex items-center gap-2">
                <Zap className="w-4 h-4" />
                Events
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="workflows" className="flex-1 p-6 overflow-auto bg-[rgb(var(--color-border-50))]">
            <WorkflowList
              onSelectWorkflow={handleSelectWorkflow}
              onCreateNew={handleCreateNew}
            />
          </TabsContent>

          <TabsContent value="designer" className="flex-1 overflow-hidden">
            <WorkflowDesigner />
          </TabsContent>

          <TabsContent value="runs" className="flex-1 p-6 overflow-auto bg-[rgb(var(--color-border-50))]">
            <div className="flex flex-col items-center justify-center py-16 px-4">
              <div className="w-16 h-16 rounded-full bg-[rgb(var(--color-border-100))] flex items-center justify-center mb-4">
                <Play className="w-8 h-8 text-[rgb(var(--color-text-400))]" />
              </div>
              <h3 className="text-lg font-semibold text-[rgb(var(--color-text-900))] mb-2">
                Workflow Runs
              </h3>
              <p className="text-sm text-[rgb(var(--color-text-500))] text-center max-w-md">
                View and manage workflow execution history. This feature is coming soon.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="events" className="flex-1 p-6 overflow-auto bg-[rgb(var(--color-border-50))]">
            <div className="flex flex-col items-center justify-center py-16 px-4">
              <div className="w-16 h-16 rounded-full bg-[rgb(var(--color-border-100))] flex items-center justify-center mb-4">
                <Zap className="w-8 h-8 text-[rgb(var(--color-text-400))]" />
              </div>
              <h3 className="text-lg font-semibold text-[rgb(var(--color-text-900))] mb-2">
                Workflow Events
              </h3>
              <p className="text-sm text-[rgb(var(--color-text-500))] text-center max-w-md">
                Monitor events that trigger workflows. This feature is coming soon.
              </p>
              {eventTypeFromQuery && (
                <div className="mt-3 text-xs text-[rgb(var(--color-text-500))]">
                  Selected event: <span className="font-semibold text-[rgb(var(--color-text-700))]">{eventTypeFromQuery}</span>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Create Workflow Dialog */}
        <CreateWorkflowDialog
          isOpen={isCreateDialogOpen}
          onClose={() => setIsCreateDialogOpen(false)}
          onCreate={handleCreateWorkflow}
        />
      </div>
    </ReflectionContainer>
  );
}
