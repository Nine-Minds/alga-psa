# Custom Fields, Ticket Templates & Visual Timeline - Branch Plan

**Branch:** `exploringandtestingcustomticketfieldsandUDFsforAccountsandContacts`
**Status:** In Progress
**Last Updated:** January 26, 2026

---

## Overview

Incremental UI enhancements to existing custom fields and ticket infrastructure, adding Halo-style templates and activity timeline. This is **NOT** a new system - it enhances existing infrastructure.

---

## What This Branch Contains

### 1. Enhanced Custom Fields UI
- **TabbedCustomFieldsCard** - Collapsible/tabbed group display
- **Conditional logic** - Show/hide fields based on other field values
- Supports: ticket, company, contact entity types
- Uses existing `custom_fields` table schema

### 2. Ticket Templates (Data Presets)
- **8 ITIL templates** pre-seeded:
  - New Hire Onboarding
  - Employee Offboarding
  - Change Request
  - Incident Report
  - Problem Investigation
  - Password Reset Request
  - Software Request
  - Hardware Request
- Templates store default values, NOT workflow enforcement
- No SLA rules, no approval gates, no auto-task creation

### 3. Visual Timeline
- Activity log for ticket history visualization
- **V1 Active types:** ticket_created, ticket_closed, status_change, assignment_change, field_change
- **Reserved for future:** 20+ additional types (documented in code)
- Non-blocking logging (doesn't slow down ticket operations)

---

## Database Migrations

| Migration | Description |
|-----------|-------------|
| `20260125100000_create_ticket_templates.cjs` | ticket_templates table (additive) |
| `20260128100000_create_ticket_activity_log.cjs` | ticket_activity_log table (additive) |

**Note:** All migrations are additive. No changes to existing tables.

---

## Files Created

### Actions (Server)
- `server/src/lib/actions/ticketTemplateActions.ts`
- `server/src/lib/actions/ticketActivityActions.ts`
- `packages/tickets/src/actions/ticketActivityActions.ts` (monorepo copy)

### Interfaces
- `server/src/interfaces/ticketTemplate.interfaces.ts`
- `server/src/interfaces/ticketActivity.interfaces.ts`

### Components - Templates
- `server/src/components/settings/tickets/TicketTemplatesManager.tsx`
- `server/src/components/settings/tickets/TemplateEditor.tsx`
- `server/src/components/settings/tickets/ITILTemplateLibrary.tsx`
- `packages/tickets/src/components/TemplatePicker.tsx`

### Components - Timeline
- `packages/tickets/src/components/ticket/TicketTimeline.tsx`
- `packages/tickets/src/components/ticket/TimelineItem.tsx`
- `packages/tickets/src/components/ticket/TimelineFilters.tsx`
- `packages/tickets/src/components/ticket/FieldChangeDiff.tsx`

### Components - UI
- `packages/ui/src/components/TabbedCustomFieldsCard.tsx`
- `packages/ui/src/components/ActivityIcon.tsx`
- `packages/ui/src/components/FieldTypeIcon.tsx`
- `packages/ui/src/components/CustomFieldInput.tsx`
- `packages/ui/src/components/CustomFieldsCard.tsx`

### Test Pages (Delete before merge)
- `server/src/app/(authenticated)/msp/test-templates/page.tsx`
- `server/src/app/(authenticated)/msp/test-timeline/page.tsx`
- `server/src/app/(authenticated)/msp/test-entity-fields/page.tsx`

---

## Files Modified (Integrations)

| File | Change |
|------|--------|
| `server/src/components/settings/general/TicketingSettings.tsx` | Added Templates tab |
| `packages/tickets/src/components/QuickAddTicket.tsx` | Added TemplatePicker |
| `packages/tickets/src/components/ticket/TicketDetails.tsx` | Added Timeline tab (Conversation/Timeline toggle) |
| `packages/tickets/src/actions/ticketActions.ts` | Added activity logging imports and calls |
| `packages/clients/src/components/clients/ClientDetails.tsx` | Enhanced CustomFieldsCard |

---

## Remaining Work

### High Priority
1. [ ] Verify all TypeScript imports compile (monorepo structure changes)
2. [ ] Run `npm install` to ensure dependencies are correct
3. [ ] Test template creation/editing workflow
4. [ ] Test timeline on a real ticket

### Before Merge
1. [ ] Delete test pages (`/msp/test-*`)
2. [ ] Run full test suite
3. [ ] Code review for import path consistency

### Future Enhancements (Not in this branch)
- Wire comment activity logging to commentActions
- Wire custom field change logging
- Add email/document activity logging
- Contact custom fields UI

---

## Testing Instructions

### Templates
1. Go to Settings > Ticketing > Templates
2. Create a new template or import from ITIL library
3. Create a ticket and select a template
4. Verify fields are pre-populated

### Timeline
1. Open any ticket
2. Click "Timeline" tab (next to "Conversation")
3. Make changes to the ticket (status, assignment, etc.)
4. Verify changes appear in timeline

### Custom Fields on Clients
1. Go to Clients > select a client
2. Scroll to Custom Fields section
3. Verify collapsible groups display correctly

---

## Notes

- **Backward compatible:** Existing tickets/fields unaffected
- **Non-breaking migrations:** Only new tables added
- **Halo-style simplicity:** Templates are presets, not workflow engines
- **Activity logging is non-blocking:** Uses `.catch()` to avoid slowing operations
