# Release Notes

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
