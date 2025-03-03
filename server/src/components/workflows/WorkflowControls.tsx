'use client';

import React, { useState } from 'react';
import { IWorkflowExecution } from '@/lib/workflow/persistence/workflowInterfaces';
import { Button } from '@/components/ui/Button';
import { useRouter } from 'next/navigation';
import { 
  pauseWorkflowExecutionAction, 
  resumeWorkflowExecutionAction,
  cancelWorkflowExecutionAction 
} from '@/lib/actions/workflow-actions';
import { 
  PauseCircle, 
  PlayCircle, 
  XCircle, 
  RefreshCw, 
  ArrowLeft 
} from 'lucide-react';

interface WorkflowControlsProps {
  execution: IWorkflowExecution;
}

export default function WorkflowControls({ execution }: WorkflowControlsProps) {
  const [isLoading, setIsLoading] = useState<Record<string, boolean>>({});
  const router = useRouter();

  const handleAction = async (
    action: 'pause' | 'resume' | 'cancel',
    actionFn: (executionId: string) => Promise<boolean>
  ) => {
    setIsLoading({ ...isLoading, [action]: true });
    try {
      await actionFn(execution.execution_id);
      // Refresh the page to show updated status
      router.refresh();
    } catch (error) {
      console.error(`Error ${action}ing workflow:`, error);
    } finally {
      setIsLoading({ ...isLoading, [action]: false });
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        id="back-to-workflows-button"
        variant="outline"
        size="sm"
        onClick={() => router.push('/msp/jobs')}
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back
      </Button>

      <Button
        id="refresh-workflow-button"
        variant="outline"
        size="sm"
        onClick={() => router.refresh()}
      >
        <RefreshCw className="h-4 w-4 mr-2" />
        Refresh
      </Button>

      {execution.status === 'active' && (
        <Button
          id="pause-workflow-button"
          variant="outline"
          size="sm"
          onClick={() => handleAction('pause', pauseWorkflowExecutionAction)}
          disabled={isLoading['pause']}
        >
          <PauseCircle className={`h-4 w-4 mr-2 ${isLoading['pause'] ? 'animate-pulse' : ''}`} />
          Pause
        </Button>
      )}

      {execution.status === 'paused' && (
        <Button
          id="resume-workflow-button"
          variant="outline"
          size="sm"
          onClick={() => handleAction('resume', resumeWorkflowExecutionAction)}
          disabled={isLoading['resume']}
        >
          <PlayCircle className={`h-4 w-4 mr-2 ${isLoading['resume'] ? 'animate-pulse' : ''}`} />
          Resume
        </Button>
      )}

      {(execution.status === 'active' || execution.status === 'paused') && (
        <Button
          id="cancel-workflow-button"
          variant="outline"
          size="sm"
          className="text-[rgb(var(--color-accent-600))] border-[rgb(var(--color-accent-200))] hover:bg-[rgb(var(--color-accent-50))]"
          onClick={() => handleAction('cancel', cancelWorkflowExecutionAction)}
          disabled={isLoading['cancel']}
        >
          <XCircle className={`h-4 w-4 mr-2 ${isLoading['cancel'] ? 'animate-pulse' : ''}`} />
          Cancel
        </Button>
      )}
    </div>
  );
}