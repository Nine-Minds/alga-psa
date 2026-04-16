# Release Notes

## 0.4.0

Feature release of the `Alga PSA` n8n community node.

### Added

- First-pass `Project Task` CRUD support: `Create`, `Get`, `List`, `Update`, and `Delete`
- Project Task create required fields: `task_name`, `projectTaskProjectId`, `projectTaskPhaseId`, and `projectTaskStatusMappingId`
- Project Task create/update optional fields: `description`, `assigned_to`, `estimated_hours`, `due_date`, `priority_id`, `task_type_key`, `wbs_code`, and comma-separated `tags` (update also accepts `task_name` and `project_status_mapping_id`)
- Project Task list pagination (`page`, `limit`) scoped to a selected project
- New lookup dropdowns backed by `searchProjects`, `searchProjectPhases`, and `searchProjectTaskStatusMappings` (phases and status mappings are scoped to the currently-selected project; empty selections fall back to manual UUID entry)

### Notes

- Checklist items, task dependencies, and ticket-task links are intentionally out of scope for the first pass and can be added in a follow-up
- Project Task responses follow the existing node normalization rules for `{ data: ... }`, list pagination, delete success payloads, and continue-on-fail item errors

## 0.3.0

Feature release of the `Alga PSA` n8n community node.

### Added

- First-pass `Contact` CRUD support: `Create`, `Get`, `List`, `Update`, and `Delete`
- Contact create/update field support for `full_name`, `email`, `client_id`, `role`, `notes`, `is_inactive`, and JSON-authored `phone_numbers`
- Contact list pagination/filter support for `page`, `limit`, `client_id`, `search_term`, and `is_inactive`
- Contact workflow example: `examples/create-update-contact.workflow.json`

### Notes

- Contact `client_id` reuses the existing lookup-plus-manual-UUID fallback used by ticket references
- Contact responses follow the existing node normalization rules for `{ data: ... }`, paginated lists, delete success payloads, and continue-on-fail item errors

## 0.2.0

Feature release of the `Alga PSA` n8n community node.

### Added

- `Ticket -> List Comments` for reading existing ticket comments with optional `limit`, `offset`, and `order`
- `Ticket -> Add Comment` for appending comments to existing tickets with supported `comment_text` and `is_internal` fields
- Comment workflow example: `examples/add-comment-then-list-comments.workflow.json`

### Notes

- `time_spent` is intentionally not exposed in the n8n node because the current Alga PSA ticket comment implementation does not persist or consume it

## 0.1.2

Patch release of the `Alga PSA` n8n community node.

### Fixes

- Node icon now uses `avatar-purple.png`
- Build output now includes the packaged node icon so the installed n8n node no longer shows a broken image

## 0.1.1

Patch release of the `Alga PSA` n8n community node.

### Fixes

- Status dropdowns used by ticket operations now request only ticket statuses from the API
- `Status -> List` now supports explicit status-type filtering for ticket, project, project task, and interaction statuses

## 0.1.0

Initial release of the `Alga PSA` n8n community node.

### Included resources and operations

- Ticket: Create, Get, List, Search, Update, Update Status, Update Assignment, Delete
- Client: List
- Board: List
- Status: List
- Priority: List

### Highlights

- Single credential (`baseUrl`, `apiKey`)
- Dynamic lookup dropdowns with manual UUID fallback for required ticket references
- Structured response normalization (`data` unwrapping + pagination preservation)
- Continue On Fail support with item-level error payloads

### Installation

Self-hosted n8n only:

- Community Node UI install: `n8n-nodes-alga-psa`
- Manual/CLI install: `npm install n8n-nodes-alga-psa`
