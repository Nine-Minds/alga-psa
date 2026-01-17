'use client';

import React, { useState } from 'react';
import { IWorkflowActionResult } from '@alga-psa/shared/workflow/persistence';
import { Button } from '@alga-psa/ui/components/Button';
import { retryWorkflowActionAction } from '../actions/workflow-actions';
import { CheckCircle, XCircle, Clock, AlertTriangle, RefreshCw } from 'lucide-react';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';

interface WorkflowActionsListProps {
  actionResults: IWorkflowActionResult[];
  executionId: string;
}

export default function WorkflowActionsList({ actionResults, executionId }: WorkflowActionsListProps) {
  const [expandedActions, setExpandedActions] = useState<Set<string>>(new Set());
  const [isRetrying, setIsRetrying] = useState<Record<string, boolean>>({});

  // Sort actions by created_at
  const sortedActions = [...actionResults].sort((a, b) => 
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const toggleExpand = (actionId: string) => {
    const newExpanded = new Set(expandedActions);
    if (newExpanded.has(actionId)) {
      newExpanded.delete(actionId);
    } else {
      newExpanded.add(actionId);
    }
    setExpandedActions(newExpanded);
  };

  const handleRetry = async (actionId: string) => {
    setIsRetrying({ ...isRetrying, [actionId]: true });
    try {
      await retryWorkflowActionAction(executionId, actionId);
    } catch (error) {
      console.error('Error retrying action:', error);
    } finally {
      setIsRetrying({ ...isRetrying, [actionId]: false });
    }
  };

  if (actionResults.length === 0) {
    return (
      <div className="text-center py-8 text-[rgb(var(--color-text-500))]">
        No actions found for this workflow execution
      </div>
    );
  }

  return (
    <div className="flow-root max-h-[400px] overflow-y-auto pr-2">
      <ul className="divide-y divide-[rgb(var(--color-border-200))]">
        {sortedActions.map((action) => (
          <li key={action.result_id} className="py-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-3">
                {action.success ? (
                  <CheckCircle className="h-5 w-5 text-[rgb(var(--color-primary-500))] flex-shrink-0 mt-0.5" />
                ) : action.error_message ? (
                  <XCircle className="h-5 w-5 text-[rgb(var(--color-accent-500))] flex-shrink-0 mt-0.5" />
                ) : action.started_at && !action.completed_at ? (
                  <Clock className="h-5 w-5 text-[rgb(var(--color-info-500))] flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-[rgb(var(--color-warning-500))] flex-shrink-0 mt-0.5" />
                )}
                
                <div>
                  <div className="font-medium text-[rgb(var(--color-text-900))]">
                    {action.action_name}
                  </div>
                  
                  <div className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
                    {action.started_at ? (
                      <span>
                        Started: {new Date(action.started_at).toLocaleString()}
                      </span>
                    ) : (
                      <span>Not started yet</span>
                    )}
                    
                    {action.completed_at && (
                      <span className="ml-4">
                        Completed: {new Date(action.completed_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                  
                  {action.error_message && (
                    <div className="mt-1 text-sm text-[rgb(var(--color-accent-600))]">
                      Error: {action.error_message}
                    </div>
                  )}
                  
                  <button
                    type="button"
                    className="mt-2 text-xs text-[rgb(var(--color-primary-600))] hover:text-[rgb(var(--color-primary-700))]"
                    onClick={() => toggleExpand(action.result_id)}
                  >
                    {expandedActions.has(action.result_id) ? 'Hide details' : 'Show details'}
                  </button>
                  
                  {expandedActions.has(action.result_id) && (
                    <div className="mt-2 space-y-2">
                      {action.parameters && Object.keys(action.parameters).length > 0 && (
                        <div>
                          <div className="text-xs font-medium text-[rgb(var(--color-text-700))]">
                            Parameters:
                          </div>
                          <pre className="mt-1 p-2 bg-[rgb(var(--color-background-200))] rounded text-xs text-[rgb(var(--color-text-700))] overflow-x-auto">
                            {JSON.stringify(action.parameters, null, 2)}
                          </pre>
                        </div>
                      )}
                      
                      {action.result && Object.keys(action.result).length > 0 && (
                        <div>
                          <div className="text-xs font-medium text-[rgb(var(--color-text-700))]">
                            Result:
                          </div>
                          <pre className="mt-1 p-2 bg-[rgb(var(--color-background-200))] rounded text-xs text-[rgb(var(--color-text-700))] overflow-x-auto">
                            {JSON.stringify(action.result, null, 2)}
                          </pre>
                        </div>
                      )}
                      
                      <div>
                        <div className="text-xs font-medium text-[rgb(var(--color-text-700))]">
                          Idempotency Key:
                        </div>
                        <div className="mt-1 text-xs text-[rgb(var(--color-text-500))]">
                          {action.idempotency_key}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              {!action.success && (
                <Button
                  id={`retry-action-${action.result_id}`}
                  variant="outline"
                  size="sm"
                  onClick={() => handleRetry(action.result_id)}
                  disabled={isRetrying[action.result_id]}
                >
                  {isRetrying[action.result_id] ? (
                    <LoadingIndicator spinnerProps={{ size: 'sm' }} text="Retry" />
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Retry
                    </>
                  )}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
