"use client";

import { useState, useEffect } from 'react';
import WorkflowVisualizer from './visualization/WorkflowVisualizer';
import { getWorkflowDefinition, getWorkflowExecutionStatus, getWorkflowDSLContent } from '@product/actions/workflow-visualization-actions';

interface ClientWorkflowVisualizationProps {
  workflowDefinitionId: string;
  executionId: string;
  height?: number | string;
  width?: string | number;
  showControls?: boolean;
  showLegend?: boolean;
  pollInterval?: number;
}

export default function ClientWorkflowVisualization({
  workflowDefinitionId,
  executionId,
  height = 450,
  width = '100%',
  showControls = true,
  showLegend = true,
  pollInterval = 5000
}: ClientWorkflowVisualizationProps) {
  const [definition, setDefinition] = useState<any | null>(null);
  const [dslContent, setDslContent] = useState<string | null>(null);
  const [executionStatus, setExecutionStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Fetch workflow definition and DSL content
  useEffect(() => {
    async function fetchDefinitionAndDSL() {
      try {
        // Fetch both the parsed definition and raw DSL content in parallel
        const [def, dsl] = await Promise.all([
          getWorkflowDefinition(workflowDefinitionId),
          getWorkflowDSLContent(workflowDefinitionId).catch(err => {
            console.warn(`Could not load DSL content for ${workflowDefinitionId}:`, err);
            return null; // This is not a critical error, we can still use the parsed definition
          })
        ]);
        
        setDefinition(def);
        if (dsl) {
          setDslContent(dsl);
          console.log(`Successfully loaded DSL content for ${workflowDefinitionId}, length: ${dsl.length}`);
        }
      } catch (err) {
        console.error('Error fetching workflow definition:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    }

    fetchDefinitionAndDSL();
  }, [workflowDefinitionId]);

  // Fetch execution status with polling
  useEffect(() => {
    let isMounted = true;
    let timeoutId: NodeJS.Timeout;

    async function fetchStatus() {
      try {
        const status = await getWorkflowExecutionStatus(executionId);
        if (isMounted) {
          setExecutionStatus(status);
          setLoading(false);
        }
      } catch (err) {
        console.error('Error fetching workflow execution status:', err);
        if (isMounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      }

      // Schedule next poll if component is still mounted
      if (isMounted) {
        timeoutId = setTimeout(fetchStatus, pollInterval);
      }
    }

    fetchStatus();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [executionId, pollInterval]);

  if (loading && !definition) {
    return <div>Loading workflow visualization...</div>;
  }

  if (error) {
    return <div>Error: {error.message}</div>;
  }

  if (!definition) {
    return <div>Workflow definition not found</div>;
  }

  return (
    <WorkflowVisualizer
      workflowDefinitionId={workflowDefinitionId}
      executionId={executionId}
      height={height}
      width={width}
      showControls={showControls}
      showLegend={showLegend}
      pollInterval={pollInterval}
      initialDefinition={definition}
      initialExecutionStatus={executionStatus}
      workflowDSL={dslContent || undefined}
    />
  );
}
