# Ticket Location Feature Planning Document

## Executive Summary
This document outlines the plan to add company location support to the ticket detail screen in Alga PSA. Currently, tickets can be associated with companies but not with specific company locations. This feature will allow users to specify which location a ticket is associated with, supporting scenarios where companies have multiple locations.

## Background
- Companies in Alga PSA can have multiple locations (branches, offices, sites)
- Tickets are currently linked only to companies, not specific locations
- The company locations feature is already implemented with full CRUD operations
- Users may not always select a company for tickets
- When a company is selected, users should be able to optionally specify the location

## Technical Overview

### Current State
1. **Database Structure**:
   - `tickets` table has `company_id` foreign key
   - `company_locations` table exists with comprehensive location data
   - No direct relationship between tickets and locations

2. **UI Components**:
   - `TicketDetails` and `TicketProperties` components handle ticket display
   - `CompanyLocations` component provides location management
   - Location picker functionality already exists

3. **Data Flow**:
   - Tickets are linked to companies via `company_id`
   - Company locations are managed separately
   - No location context in ticket workflows

### Proposed Changes

#### 1. Database Schema Updates
**Migration**: `add_location_to_tickets.cjs`
```sql
ALTER TABLE tickets ADD COLUMN location_id UUID;
ALTER TABLE tickets ADD CONSTRAINT tickets_location_fk 
  FOREIGN KEY (location_id) REFERENCES company_locations(location_id);
CREATE INDEX idx_tickets_location ON tickets(location_id);
```

#### 2. Interface Updates
**File**: `/server/src/interfaces/ticket.interfaces.tsx`
- Add `location_id?: string` to `ITicket` interface
- Add `location?: ICompanyLocation` for populated location data
- Update related type definitions

#### 3. API/Action Updates
**Files to modify**:
- `/server/src/lib/actions/ticket-actions/ticketActions.ts`
  - Update `createTicket` to accept `location_id`
  - Update `updateTicket` to handle location changes
  - Add location data to ticket queries
  
- `/server/src/lib/actions/ticket-actions/getTickets.ts`
  - Include location joins in ticket queries
  - Add location data to response

#### 4. UI Component Updates

##### A. TicketProperties Component Enhancement
**File**: `/server/src/components/tickets/ticket/TicketProperties.tsx`

Add location display and selection in the Contact Info section:
- Display current location if set
- Show location picker when company is selected
- Handle "No specific location" option
- Update location when company changes

##### B. Location Picker Integration
**Reuse existing components**:
- Leverage `CompanyLocations` component patterns
- Use existing location formatting utilities
- Implement dropdown/select for location choice

##### C. Quick Add Ticket Dialog
**File**: `/server/src/components/tickets/QuickAddTicket.tsx`
- Add location field after company selection
- Make location field dependent on company selection
- Default to company's default location if available

## User Experience Design

### Ticket Detail View - Contact Info Section
```
Contact Info
├── Contact: [Contact Dropdown]
├── Company: [Company Dropdown]
├── Location: [Location Dropdown] (Only visible when company selected)
├── Phone: [Phone Input]
└── Email: [Email Input]
```

### Location Selection Behavior
1. **No Company Selected**: Location field hidden
2. **Company Selected, No Locations**: Show "No locations available"
3. **Company Selected, Has Locations**: 
   - Show dropdown with all active locations
   - Include "No specific location" option
   - Pre-select default location if exists
4. **Company Changed**: Reset location selection

### Location Display Format
```
Main Office - 123 Main St, City, ST 12345
Branch Office - 456 Oak Ave, Town, ST 67890
```

## Implementation Plan

### Phase 1: Backend Foundation (Week 1)
- [ ] Create database migration
- [ ] Update ticket interfaces
- [ ] Modify ticket actions to support location
- [ ] Add location data to ticket queries
- [ ] Create unit tests for backend changes

### Phase 2: UI Integration (Week 2)
- [ ] Add location field to TicketProperties
- [ ] Implement location picker component
- [ ] Update Quick Add Ticket dialog
- [ ] Add location display formatting
- [ ] Handle edge cases (no company, no locations)

## Technical Considerations

### 1. Data Integrity
- Location must belong to the selected company
- Handle location deletion (set to null)
- Validate location-company relationship

### 2. Performance
- Optimize queries to avoid N+1 problems
- Consider caching location data
- Lazy load locations only when needed

### 3. Multi-tenancy
- Ensure proper tenant isolation
- Include tenant in all location queries
- Maintain CitusDB compatibility

### 4. Backwards Compatibility
- Existing tickets without locations should work
- API should handle missing location gracefully
- UI should degrade gracefully

## Security Considerations
- Validate user has access to selected location
- Ensure location belongs to selected company
- Maintain existing RBAC/ABAC rules
- Prevent cross-tenant location access


## Migration Strategy
1. Deploy database changes
2. Deploy backend changes
3. Deploy frontend changes

## Future Enhancements
1. **Location-based Filtering**: Filter tickets by location
2. **Location Analytics**: Reports by location
3. **Location Templates**: Default settings per location
4. **Location-based SLAs**: Different SLAs per location
5. **Location-based Routing**: Auto-assign based on location

## Success Metrics
- Adoption rate of location field
- Reduction in location-related support requests
- Improved ticket routing accuracy
- User satisfaction scores

## Risks and Mitigation
| Risk | Impact | Mitigation |
|------|--------|------------|
| Performance degradation | High | Optimize queries, add indexes |
| Data integrity issues | High | Strong validation, constraints |
| User confusion | Medium | Clear UI, good defaults |
| Migration complexity | Medium | Phased rollout, optional field |

## Dependencies
- Existing company locations feature
- Current ticket management system
- RBAC/ABAC authorization system
