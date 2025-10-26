"use client";

import React, { useState, useEffect } from 'react';
import { Card } from '@server/components/ui/Card';
import { Input } from '@server/components/ui/Input';
import { Button } from '@server/components/ui/Button';
import CustomSelect from '@server/components/ui/CustomSelect';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@server/components/ui/DropdownMenu';
import { 
  Search, 
  Filter,
  Download,
  AlertCircle,
  Info,
  RefreshCw,
  CheckCircle, 
  XCircle,
  Clock
} from 'lucide-react';
import { IWorkflowEvent, IWorkflowActionResult } from '@alga-psa/shared/workflow/persistence';
import LoadingIndicator from '@server/components/ui/LoadingIndicator';

interface LogEntry {
  id: string;
  timestamp: string;
  type: 'event' | 'action';
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
  details: any;
  source: IWorkflowEvent | IWorkflowActionResult;
  // Add specific properties to help TypeScript with type narrowing
  isEvent?: boolean;
  isAction?: boolean;
}

interface WorkflowExecutionLogsProps {
  executionId: string;
  events: IWorkflowEvent[];
  actionResults: IWorkflowActionResult[];
  onRefresh?: () => Promise<void>;
}

export default function WorkflowExecutionLogs({
  executionId,
  events,
  actionResults,
  onRefresh
}: WorkflowExecutionLogsProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<LogEntry[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [logLevel, setLogLevel] = useState<string>('all');
  const [logType, setLogType] = useState<string>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

  // Convert events and action results to log entries
  useEffect(() => {
    const newLogs: LogEntry[] = [
      // Convert events to log entries
      ...events.map(event => {
        let level: 'info' | 'warning' | 'error' | 'success' = 'info';
        
        // Determine log level based on event name
        if (event.event_name.toLowerCase().includes('error') ||
            event.event_name.toLowerCase().includes('fail')) {
          level = 'error';
        } else if (event.event_name.toLowerCase().includes('complete') ||
                  event.event_name.toLowerCase().includes('success')) {
          level = 'success';
        } else if (event.event_name.toLowerCase().includes('warn')) {
          level = 'warning';
        }
        
        return {
          id: event.event_id,
          timestamp: event.created_at,
          type: 'event' as const,
          level,
          message: `${event.event_name}: ${event.from_state} → ${event.to_state}`,
          details: event.payload || {},
          source: event,
          isEvent: true
        };
      }),
      
      // Convert action results to log entries
      ...actionResults.map(action => {
        let level: 'info' | 'warning' | 'error' | 'success' = 'info';
        let message = `Action: ${action.action_name}`;
        
        if (!action.started_at) {
          level = 'info';
          message += ' (Pending)';
        } else if (action.error_message) {
          level = 'error';
          message += ` (Failed: ${action.error_message})`;
        } else if (action.success) {
          level = 'success';
          message += ' (Completed Successfully)';
        } else if (action.started_at && !action.completed_at) {
          level = 'warning';
          message += ' (In Progress)';
        }
        
        return {
          id: action.result_id,
          timestamp: action.created_at,
          type: 'action' as const,
          level,
          message,
          details: {
            parameters: action.parameters || {},
            result: action.result || {},
            error: action.error_message || null
          },
          source: action,
          isAction: true
        };
      })
    ];
    
    // Sort logs by timestamp (newest first)
    newLogs.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    
    setLogs(newLogs);
  }, [events, actionResults]);

  // Apply filters when logs, searchTerm, logLevel, or logType change
  useEffect(() => {
    let filtered = [...logs];
    
    // Apply search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(log => 
        log.message.toLowerCase().includes(term) || 
        JSON.stringify(log.details).toLowerCase().includes(term)
      );
    }
    
    // Apply log level filter
    if (logLevel !== 'all') {
      filtered = filtered.filter(log => log.level === logLevel);
    }
    
    // Apply log type filter
    if (logType !== 'all') {
      filtered = filtered.filter(log => log.type === logType);
    }
    
    setFilteredLogs(filtered);
  }, [logs, searchTerm, logLevel, logType]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    if (onRefresh) {
      await onRefresh();
    }
    setIsRefreshing(false);
  };

  const handleDownload = () => {
    // Create a JSON file with the logs
    const data = JSON.stringify(logs, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // Create a link and click it to download the file
    const a = document.createElement('a');
    a.href = url;
    a.download = `workflow-logs-${executionId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const toggleExpand = (logId: string) => {
    const newExpanded = new Set(expandedLogs);
    if (newExpanded.has(logId)) {
      newExpanded.delete(logId);
    } else {
      newExpanded.add(logId);
    }
    setExpandedLogs(newExpanded);
  };

  const getLogIcon = (level: string) => {
    switch (level) {
      case 'error':
        return <XCircle className="h-5 w-5 text-[rgb(var(--color-accent-500))] flex-shrink-0" />;
      case 'warning':
        return <AlertCircle className="h-5 w-5 text-[rgb(var(--color-warning-500))] flex-shrink-0" />;
      case 'success':
        return <CheckCircle className="h-5 w-5 text-[rgb(var(--color-primary-500))] flex-shrink-0" />;
      case 'info':
      default:
        return <Info className="h-5 w-5 text-[rgb(var(--color-info-500))] flex-shrink-0" />;
    }
  };

  return (
    <div className="workflow-logs-container">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
        <div className="flex items-center w-full md:w-auto">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-[rgb(var(--color-text-400))]" />
            <Input
              id="search-logs-input"
              placeholder="Search logs..."
              className="pl-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          <CustomSelect
            id="log-level-select"
            value={logLevel}
            onValueChange={setLogLevel}
            options={[
              { value: 'all', label: 'All Levels' },
              { value: 'info', label: 'Info' },
              { value: 'warning', label: 'Warning' },
              { value: 'error', label: 'Error' },
              { value: 'success', label: 'Success' }
            ]}
            placeholder="Log Level"
            className="w-[130px]"
          />
          
          <CustomSelect
            id="log-type-select"
            value={logType}
            onValueChange={setLogType}
            options={[
              { value: 'all', label: 'All Types' },
              { value: 'event', label: 'Events' },
              { value: 'action', label: 'Actions' }
            ]}
            placeholder="Log Type"
            className="w-[130px]"
          />
          
          <Button
            id="refresh-logs-button"
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <LoadingIndicator spinnerProps={{ size: 'sm' }} text="Refresh" />
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </>
            )}
          </Button>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button id="logs-actions-menu" variant="outline" size="sm">
                <Filter className="h-4 w-4 mr-2" />
                Actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem id="download-logs-menu-item" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                Download Logs
              </DropdownMenuItem>
              <DropdownMenuItem 
                id="expand-all-logs-menu-item" 
                onClick={() => {
                  if (expandedLogs.size === filteredLogs.length) {
                    setExpandedLogs(new Set());
                  } else {
                    setExpandedLogs(new Set(filteredLogs.map(log => log.id)));
                  }
                }}
              >
                {expandedLogs.size === filteredLogs.length ? 'Collapse All' : 'Expand All'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      
      <Card className="overflow-hidden">
        <div className="flow-root max-h-[600px] overflow-y-auto p-4">
          {filteredLogs.length > 0 ? (
            <ul className="divide-y divide-[rgb(var(--color-border-200))]">
              {filteredLogs.map((log) => (
                <li key={log.id} className="py-4">
                  <div className="flex items-start">
                    <div className="mt-1 mr-3">
                      {getLogIcon(log.level)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between">
                        <p className="font-medium text-[rgb(var(--color-text-900))]">
                          {log.message}
                        </p>
                        <p className="text-sm text-[rgb(var(--color-text-500))] whitespace-nowrap ml-4">
                          {new Date(log.timestamp).toLocaleString()}
                        </p>
                      </div>
                      <p className="text-sm text-[rgb(var(--color-text-500))] mt-1">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium mr-2 bg-[rgb(var(--color-background-200))] text-[rgb(var(--color-text-700))]">
                          {log.type === 'event' ? 'Event' : 'Action'}
                        </span>
                        {log.type === 'action' && log.isAction &&
                         'started_at' in log.source &&
                         'completed_at' in log.source &&
                         log.source.started_at &&
                         !log.source.completed_at && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[rgb(var(--color-info-50))] text-[rgb(var(--color-info-600))]">
                            <Clock className="h-3 w-3 mr-1" />
                            In Progress
                          </span>
                        )}
                      </p>
                      
                      <button
                        type="button"
                        className="mt-2 text-xs text-[rgb(var(--color-primary-600))] hover:text-[rgb(var(--color-primary-700))]"
                        onClick={() => toggleExpand(log.id)}
                      >
                        {expandedLogs.has(log.id) ? 'Hide details' : 'Show details'}
                      </button>
                      
                      {expandedLogs.has(log.id) && (
                        <div className="mt-2 space-y-2">
                          {log.type === 'event' && log.isEvent && (
                            <>
                              <div>
                                <div className="text-xs font-medium text-[rgb(var(--color-text-700))]">
                                  Event Type:
                                </div>
                                <div className="text-xs text-[rgb(var(--color-text-500))]">
                                  {(log.source as IWorkflowEvent).event_type}
                                </div>
                              </div>
                              <div>
                                <div className="text-xs font-medium text-[rgb(var(--color-text-700))]">
                                  State Transition:
                                </div>
                                <div className="text-xs text-[rgb(var(--color-text-500))]">
                                  {(log.source as IWorkflowEvent).from_state} → {(log.source as IWorkflowEvent).to_state}
                                </div>
                              </div>
                            </>
                          )}
                          
                          {log.type === 'action' && log.isAction && (
                            <>
                              {'started_at' in log.source && log.source.started_at && (
                                <div>
                                  <div className="text-xs font-medium text-[rgb(var(--color-text-700))]">
                                    Started At:
                                  </div>
                                  <div className="text-xs text-[rgb(var(--color-text-500))]">
                                    {new Date(log.source.started_at).toLocaleString()}
                                  </div>
                                </div>
                              )}
                              
                              {'completed_at' in log.source && log.source.completed_at && (
                                <div>
                                  <div className="text-xs font-medium text-[rgb(var(--color-text-700))]">
                                    Completed At:
                                  </div>
                                  <div className="text-xs text-[rgb(var(--color-text-500))]">
                                    {new Date(log.source.completed_at).toLocaleString()}
                                  </div>
                                </div>
                              )}
                              
                              {'error_message' in log.source && log.source.error_message && (
                                <div>
                                  <div className="text-xs font-medium text-[rgb(var(--color-accent-600))]">
                                    Error:
                                  </div>
                                  <div className="text-xs text-[rgb(var(--color-accent-500))]">
                                    {log.source.error_message}
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                          
                          {/* Show payload/parameters */}
                          {log.type === 'event' && log.isEvent && 'payload' in log.source && log.source.payload && Object.keys(log.source.payload).length > 0 && (
                            <div>
                              <div className="text-xs font-medium text-[rgb(var(--color-text-700))]">
                                Payload:
                              </div>
                              <pre className="mt-1 p-2 bg-[rgb(var(--color-background-200))] rounded text-xs text-[rgb(var(--color-text-700))] overflow-x-auto">
                                {JSON.stringify(log.source.payload, null, 2)}
                              </pre>
                            </div>
                          )}
                          {log.type === 'action' && log.isAction && 'parameters' in log.source && log.source.parameters && Object.keys(log.source.parameters).length > 0 && (
                            <div>
                              <div className="text-xs font-medium text-[rgb(var(--color-text-700))]">
                                Parameters:
                              </div>
                              <pre className="mt-1 p-2 bg-[rgb(var(--color-background-200))] rounded text-xs text-[rgb(var(--color-text-700))] overflow-x-auto">
                                {JSON.stringify(log.source.parameters, null, 2)}
                              </pre>
                            </div>
                          )}
                          
                          {log.type === 'action' && log.isAction && 'result' in log.source && log.source.result && Object.keys(log.source.result).length > 0 && (
                            <div>
                              <div className="text-xs font-medium text-[rgb(var(--color-text-700))]">
                                Result:
                              </div>
                              <pre className="mt-1 p-2 bg-[rgb(var(--color-background-200))] rounded text-xs text-[rgb(var(--color-text-700))] overflow-x-auto">
                                {JSON.stringify(log.source.result, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-center py-8 text-[rgb(var(--color-text-500))]">
              {searchTerm || logLevel !== 'all' || logType !== 'all' 
                ? 'No logs match the current filters'
                : 'No logs found for this workflow execution'}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}