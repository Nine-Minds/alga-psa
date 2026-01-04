# Client Portal Projects

## Overview

The client portal provides clients with visibility into their projects, phases, and tasks. MSPs have granular control over what information is visible to clients through the **Client Portal Visibility** configuration.

## Client Portal Views

### Project List (`/client-portal/projects`)

- Shows all projects associated with the client's company
- Filter by status: Active, Completed, On Hold
- Displays project name, status, dates, and progress
- Click to access project details

### Project Detail View

The project detail page shows:
- Project overview (name, dates, description)
- Progress metrics
- Phases section (if enabled)
- Tasks section with kanban or list view toggle (if enabled)

### Task Views

When tasks are visible, clients can switch between two views:
- **Kanban View**: Tasks organized by status columns within phases
- **List View**: Hierarchical table showing phases → statuses → tasks

## Visibility Configuration

### Configuration Locations

| Location | Description |
|----------|-------------|
| Project Details → Client Portal Visibility | Per-project settings |
| Project Templates → Basics step | Template-level defaults |

When a project is created from a template, it inherits the template's visibility configuration.

### Phase Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Show Phases | Display project phases to clients | Off |
| Show Phase Completion | Show completion percentage per phase | Off |

### Task Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Show Tasks | Display tasks within phases | Off |
| Visible Task Fields | Select which task fields clients can see | Name, Due Date, Status |

### Available Task Fields

| Field | Key | Description |
|-------|-----|-------------|
| Task Name | `task_name` | Name of the task |
| Due Date | `due_date` | Task due date |
| Status | `status` | Current task status |
| Assignee | `assigned_to` | Who the task is assigned to |
| Estimated Hours | `estimated_hours` | Estimated hours for the task |
| Hours Logged | `actual_hours` | Actual hours logged |
| Checklist | `checklist_progress` | Checklist completion progress |
| Dependencies | `dependencies` | Task dependency indicators |
| Document Uploads | `document_uploads` | Allow clients to upload documents |

## Document Uploads

When `document_uploads` is enabled in visible task fields:
- Clients can upload files to individual tasks
- Files are associated with the task and stored securely
- MSP users can view uploaded documents in the task details
- Drag-and-drop or click-to-upload interface

## Data Model

Configuration is stored in `client_portal_config` JSONB column:

```typescript
interface IClientPortalConfig {
  show_phases?: boolean;           // Default: false
  show_phase_completion?: boolean; // Default: false
  show_tasks?: boolean;            // Default: false
  visible_task_fields?: string[];  // Default: ['task_name', 'due_date', 'status']
}
```

**Tables with this column:**
- `projects` - Per-project configuration
- `project_templates` - Template defaults

## Components

### MSP-Side

| Component | Description |
|-----------|-------------|
| `ClientPortalConfigEditor` | Visibility settings UI with summary preview |

### Client Portal

| Component | Description |
|-----------|-------------|
| `ProjectDetailView` | Main project detail page |
| `ClientKanbanBoard` | Kanban-style task view |
| `ClientTaskListView` | Hierarchical list view |
| `TaskDocumentUpload` | Document upload widget |

### Server Actions

| Action | Description |
|--------|-------------|
| `getClientProjectPhases()` | Fetch phases with completion stats |
| `getClientProjectTasks()` | Fetch filtered task data |
| `uploadClientTaskDocument()` | Handle document uploads |

All actions are in `server/src/lib/actions/client-portal-actions/client-project-details.ts`.

## Security

- **Ownership Verification**: All actions verify client ownership through `contact_id` → `client_id` relationship
- **Server-Side Filtering**: Task fields are filtered based on `visible_task_fields` configuration
- **Upload Authorization**: Document uploads only allowed when explicitly enabled
- **Multi-Tenant Isolation**: All queries include tenant filtering
