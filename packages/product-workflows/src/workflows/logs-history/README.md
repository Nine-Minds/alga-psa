# Workflow Execution History and Logs View

This directory contains components for displaying detailed workflow execution history and logs in the Automation Hub project.

## Components

### 1. LogsHistoryWorkflowTable

A wrapper around the `WorkflowExecutionsTable` component that customizes the row click behavior to navigate within the Logs & History page.

### 2. WorkflowExecutionDetails

Displays detailed information about a workflow execution, including:
- Basic execution metadata (ID, status, timestamps)
- Visualization of the workflow using ReactFlow
- Timeline of workflow events
- List of workflow actions with their results
- Detailed logs view with filtering and search capabilities
- Context data viewer

### 3. WorkflowExecutionLogs

A comprehensive logs view that combines events and action results into a unified, filterable log stream. Features include:
- Search functionality for finding specific log entries
- Filtering by log level (info, warning, error, success)
- Filtering by log type (event, action)
- Expandable log entries with detailed information
- Download logs as JSON
- Visual indicators for log levels and statuses

## Usage

The logs and history view is accessible from the Automation Hub navigation under "Logs & History". The page displays a table of workflow executions by default. Clicking on a workflow execution row navigates to the detailed view for that execution.

### URL Structure

- List view: `/msp/automation-hub/logs-history`
- Detail view: `/msp/automation-hub/logs-history?executionId={execution_id}`

## Implementation Details

### Log Entry Structure

Each log entry combines data from either a workflow event or an action result, with a unified structure:

```typescript
interface LogEntry {
  id: string;
  timestamp: string;
  type: 'event' | 'action';
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
  details: any;
  source: IWorkflowEvent | IWorkflowActionResult;
  isEvent?: boolean;
  isAction?: boolean;
}
```

### Log Levels

Log levels are determined based on the content of events and actions:

- **Error**: Events with names containing "error" or "fail", or actions with error messages
- **Warning**: Events with names containing "warn", or actions that are started but not completed
- **Success**: Events with names containing "complete" or "success", or successful actions
- **Info**: All other events and actions

### Filtering

The logs view supports filtering by:
- Text search (searches in message and details)
- Log level (info, warning, error, success, or all)
- Log type (event, action, or all)

## Future Enhancements

Potential future enhancements for the logs and history view:

1. **Advanced filtering**: Add date range filters, user filters, and more complex search capabilities
2. **Real-time updates**: Implement WebSocket or polling for real-time log updates
3. **Log retention policies**: Add UI for configuring log retention periods
4. **Export formats**: Support exporting logs in different formats (CSV, PDF)
5. **Correlation**: Better visualization of related events and actions
6. **Metrics dashboard**: Add a dashboard with workflow execution metrics and trends