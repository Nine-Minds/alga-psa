'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { DnDFlow as WorkflowDesigner } from '@product/workflows/entry';
import { Tabs, TabsList, TabsTrigger, TabsContent } from 'server/src/components/ui/Tabs';
import WorkflowList from './WorkflowList';
import CreateWorkflowDialog, { WorkflowTriggerType } from './CreateWorkflowDialog';
import { List, PenTool, Play, Zap } from 'lucide-react';
import EventsCatalogV2 from './EventsCatalogV2';

type TabValue = 'workflows' | 'designer' | 'runs' | 'events-catalog';

export default function AutomationHub() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const activeTab: TabValue = useMemo(() => {
    const tabRaw = searchParams.get('tab');
    const tab = tabRaw === 'events' ? 'events-catalog' : tabRaw;
    if (tab && ['workflows', 'designer', 'runs', 'events-catalog'].includes(tab)) {
      return tab as TabValue;
    }
    return 'workflows';
  }, [searchParams]);

  const handleTabChange = useCallback((next: TabValue) => {
    if (next === activeTab) return;
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.set('tab', next);

    if (next === 'workflows') {
      newParams.delete('workflowId');
      newParams.delete('new');
    }

    if (next === 'designer') {
      // Manually selecting the Designer tab always opens "New Workflow" mode.
      // Selecting a workflow from the list is the only path that sets workflowId.
      newParams.delete('workflowId');
      newParams.set('new', '1');
    } else if (next === 'runs') {
      newParams.delete('new');
      // Keep workflowId for runs filtering if present.
    } else {
      newParams.delete('workflowId');
      newParams.delete('new');
    }

    router.replace(`?${newParams.toString()}`, { scroll: false });
  }, [activeTab, router, searchParams]);

  const handleSelectWorkflow = useCallback((workflowId: string) => {
    // Update URL with workflowId so WorkflowDesigner can read it
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.set('tab', 'designer');
    newParams.set('workflowId', workflowId);
    newParams.delete('new');
    router.replace(`?${newParams.toString()}`, { scroll: false });
  }, [searchParams, router]);

  const handleCreateNew = useCallback(() => {
    setIsCreateDialogOpen(true);
  }, []);

  const handleCreateWorkflow = useCallback((name: string, triggerType: WorkflowTriggerType) => {
    void name;
    void triggerType;
    // Clear workflowId from URL when creating new workflow
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.set('tab', 'designer');
    newParams.delete('workflowId');
    newParams.set('new', '1');
    router.replace(`?${newParams.toString()}`, { scroll: false });
    setIsCreateDialogOpen(false);
  }, [searchParams, router]);

  return (
    <ReflectionContainer id="automation-hub-container" label="Automation Hub" className="h-full min-h-0">
      <div className="flex flex-col h-full">
        <Tabs value={activeTab} onValueChange={(v) => handleTabChange(v as TabValue)} className="flex flex-col h-full min-h-0">
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
              <TabsTrigger value="events-catalog" className="flex items-center gap-2">
                <Zap className="w-4 h-4" />
                Events Catalog
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="workflows" className="flex-1 min-h-0 p-6 overflow-auto bg-[rgb(var(--color-border-50))]">
            <WorkflowList
              onSelectWorkflow={handleSelectWorkflow}
              onCreateNew={handleCreateNew}
            />
          </TabsContent>

          <TabsContent value="designer" className="flex-1 min-h-0 overflow-hidden">
            <WorkflowDesigner />
          </TabsContent>

          <TabsContent value="runs" className="flex-1 min-h-0 p-6 overflow-auto bg-[rgb(var(--color-border-50))]">
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

          <TabsContent value="events-catalog" className="flex-1 min-h-0 p-6 overflow-auto bg-[rgb(var(--color-border-50))]">
            <EventsCatalogV2 />
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
