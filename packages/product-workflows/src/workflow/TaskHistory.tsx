import { useState, useEffect } from 'react';
import { Card } from '@server/components/ui/Card';
import { Badge } from '@server/components/ui/Badge';
import { WorkflowTaskStatus } from '@alga-psa/shared/workflow/persistence/workflowTaskModel';
import { TaskHistoryEntry } from '@alga-psa/shared/workflow/persistence/taskInboxInterfaces';

// Simple Spinner component
function Spinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-8 w-8" : "h-6 w-6";
  return (
    <div className={`animate-spin rounded-full border-2 border-gray-300 border-t-blue-600 ${sizeClass}`}></div>
  );
}

interface TaskHistoryProps {
  taskId: string;
  className?: string;
}

/**
 * Task History component for displaying workflow task history
 * 
 * This component displays the history of a task, including status changes,
 * assignments, and other actions.
 */
export function TaskHistory({
  taskId,
  className = ''
}: TaskHistoryProps) {
  const [history, setHistory] = useState<TaskHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch task history when taskId changes
  useEffect(() => {
    fetchTaskHistory();
  }, [taskId]);

  // Fetch task history from the server
  const fetchTaskHistory = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // This would be a real API call in a production app
      // For now, we'll simulate it with a timeout and mock data
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Mock history data
      const mockHistory: TaskHistoryEntry[] = [
        {
          historyId: 'hist-1',
          taskId,
          action: 'create',
          toStatus: WorkflowTaskStatus.PENDING,
          userId: 'system',
          timestamp: new Date(Date.now() - 3600000).toISOString(),
          details: { source: 'workflow-engine' }
        },
        {
          historyId: 'hist-2',
          taskId,
          action: 'claim',
          fromStatus: WorkflowTaskStatus.PENDING,
          toStatus: WorkflowTaskStatus.CLAIMED,
          userId: 'user-123',
          timestamp: new Date(Date.now() - 1800000).toISOString()
        },
        {
          historyId: 'hist-3',
          taskId,
          action: 'unclaim',
          fromStatus: WorkflowTaskStatus.CLAIMED,
          toStatus: WorkflowTaskStatus.PENDING,
          userId: 'user-123',
          timestamp: new Date(Date.now() - 900000).toISOString()
        },
        {
          historyId: 'hist-4',
          taskId,
          action: 'claim',
          fromStatus: WorkflowTaskStatus.PENDING,
          toStatus: WorkflowTaskStatus.CLAIMED,
          userId: 'user-456',
          timestamp: new Date(Date.now() - 600000).toISOString()
        }
      ];
      
      setHistory(mockHistory);
    } catch (err) {
      setError('Failed to load task history. Please try again.');
      console.error('Error fetching task history:', err);
    } finally {
      setLoading(false);
    }
  };

  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric'
    });
  };

  // Get action label
  const getActionLabel = (action: string) => {
    switch (action) {
      case 'create':
        return 'Created';
      case 'claim':
        return 'Claimed';
      case 'unclaim':
        return 'Unclaimed';
      case 'complete':
        return 'Completed';
      case 'cancel':
        return 'Canceled';
      case 'expire':
        return 'Expired';
      default:
        return action.charAt(0).toUpperCase() + action.slice(1);
    }
  };

  // Get status badge
  const getStatusBadge = (status?: string) => {
    if (!status) return null;
    
    let variant: 'default' | 'primary' | 'success' | 'warning' | 'error' = 'default';
    
    switch (status) {
      case WorkflowTaskStatus.PENDING:
        variant = 'primary';
        break;
      case WorkflowTaskStatus.CLAIMED:
        variant = 'default';
        break;
      case WorkflowTaskStatus.COMPLETED:
        variant = 'success';
        break;
      case WorkflowTaskStatus.CANCELED:
        variant = 'error';
        break;
      case WorkflowTaskStatus.EXPIRED:
        variant = 'warning';
        break;
    }
    
    return (
      <Badge variant={variant} className="ml-2">
        {status}
      </Badge>
    );
  };

  // Render loading state
  if (loading) {
    return (
      <div className={`flex justify-center items-center p-4 ${className}`}>
        <Spinner size="md" />
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div className={`bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded ${className}`}>
        <p>{error}</p>
      </div>
    );
  }

  // Render empty state
  if (history.length === 0) {
    return (
      <div className={`p-4 text-center ${className}`}>
        <p className="text-gray-500">No history available for this task.</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="space-y-4">
        {history.map((entry) => (
          <Card key={entry.historyId} className="p-4">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center">
                  <span className="font-medium">{getActionLabel(entry.action)}</span>
                  {entry.toStatus && getStatusBadge(entry.toStatus)}
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  By: {entry.userId === 'system' ? 'System' : entry.userId}
                </p>
                {entry.details && Object.keys(entry.details).length > 0 && (
                  <div className="mt-2 text-sm">
                    <details>
                      <summary className="cursor-pointer text-blue-600">Details</summary>
                      <pre className="mt-2 bg-gray-50 p-2 rounded text-xs overflow-auto">
                        {JSON.stringify(entry.details, null, 2)}
                      </pre>
                    </details>
                  </div>
                )}
              </div>
              <div className="text-sm text-gray-500">
                {formatDate(entry.timestamp)}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}