# Scheduling System

## Overview
The scheduling system provides a comprehensive solution for managing appointments, technician dispatch, and recurring events. It supports multiple agent assignments per schedule entry while maintaining efficient storage and performance characteristics.

## Key Components

### Database Structure
* **schedule_entries table:**
  - Core fields: entry_id, title, scheduled_start, scheduled_end, work_item_id, status
  - Recurrence support: recurrence_pattern (JSONB), original_entry_id, is_recurring
  - Multi-tenant: tenant field with RLS policies
  - Work item integration: work_item_type, work_item_id for linking to tickets/tasks

* **schedule_entry_assignees table:**
  - Many-to-many relationship for multiple agent assignments
  - Fields: tenant, entry_id, user_id
  - Cascading deletes for data consistency
  - Foreign key constraints to both users and schedule_entries

### Core Files
* Models:
  - `@`: Core scheduling logic
  - `server/src/interfaces/schedule.interfaces.ts`: TypeScript interfaces
  - `server/src/lib/schemas/scheduleSchemas.ts`: Zod validation schemas

* UI Components:
  - `server/src/components/time-management/ScheduleCalendar.tsx`: Main calendar view
  - `server/src/components/time-management/EntryPopup.tsx`: Entry creation/editing
  - `server/src/components/ui/MultiUserPicker.tsx`: Agent selection component

* Actions:
  - `server/src/lib/actions/scheduleActions.ts`: Server actions for CRUD operations

## Features

### Multiple Agent Assignment
* Support for assigning multiple technicians/agents to a single schedule entry
* Role-based access control for multi-agent assignment capability
* Backward compatibility with legacy single-user assignments
* Efficient querying through proper database indexing

### Recurrence Handling
* Efficient storage of recurring events:
  - Only master entries stored in database
  - Virtual instances generated on-demand
  - No duplicate storage for recurring instances
  - Supports infinite recurrence patterns

* Recurrence Patterns:
  - Frequencies: daily, weekly, monthly, yearly
  - Pattern options: interval, end date/count, exceptions
  - Support for complex patterns (e.g., every 2 weeks on Monday and Wednesday)

* Exception Handling:
  - Single instance modifications
  - Future occurrence updates
  - All occurrence updates
  - Pattern-based exceptions

### Calendar Interface
* Interactive calendar with drag-and-drop support
* Multiple view options (day, week, month)
* Visual distinction between different work item types
* Real-time updates and conflict detection
* Responsive design for various screen sizes

### Performance Optimizations
* Efficient database queries using proper indexes
* On-demand calculation of recurring instances
* Minimal storage overhead for recurring entries
* Optimized user assignment queries

## Usage Examples

### Creating a Schedule Entry
```typescript
const entry = await ScheduleEntry.create({
  title: "Site Visit",
  scheduled_start: new Date("2024-01-15T10:00:00"),
  scheduled_end: new Date("2024-01-15T12:00:00"),
  work_item_id: "ticket_123",
  work_item_type: "ticket",
  status: "scheduled"
}, {
  assignedUserIds: ["user1", "user2"]  // Multiple agents
});
```

### Creating a Recurring Entry
```typescript
const recurringEntry = await ScheduleEntry.create({
  // ... basic entry fields ...
  recurrence_pattern: {
    frequency: "weekly",
    interval: 2,
    daysOfWeek: [1, 3],  // Monday and Wednesday
    startDate: new Date("2024-01-15"),
    endDate: new Date("2024-06-15")
  }
});
```

### Updating Assignments
```typescript
await ScheduleEntry.update(entryId, {
  assigned_user_ids: ["user1", "user2", "user3"]
}, "future");  // Updates this and future occurrences
```

## Best Practices

1. **Recurrence Patterns:**
   - Use appropriate frequency for the use case
   - Consider time zone implications
   - Set reasonable end dates or occurrence counts
   - Handle exceptions appropriately

2. **Multiple Assignments:**
   - Verify agent availability before assignment
   - Consider workload distribution
   - Maintain clear assignment hierarchy
   - Handle conflicts gracefully

3. **Performance:**
   - Query within reasonable date ranges
   - Use appropriate indexes
   - Handle large result sets properly
   - Cache frequently accessed data

4. **UI Considerations:**
   - Provide clear visual feedback
   - Handle loading states gracefully
   - Implement proper error handling
   - Ensure responsive design

## Security Considerations

1. **Access Control:**
   - Role-based permissions for multi-agent assignment
   - Tenant isolation through RLS
   - Proper validation of user assignments
   - Audit logging of changes

2. **Data Integrity:**
   - Transaction handling for complex operations
   - Validation of recurrence patterns
   - Proper error handling and rollback
   - Consistent state management

## Future Enhancements

1. **Advanced Scheduling:**
   - Resource conflict detection
   - Automated scheduling optimization
   - Complex recurrence patterns
   - Calendar sync integration

2. **Integration:**
   - External calendar system sync
   - Mobile app support
   - Real-time updates
   - API expansion

3. **Analytics:**
   - Schedule optimization insights
   - Resource utilization tracking
   - Pattern analysis
   - Performance metrics

4. **UI/UX:**
   - Enhanced drag-and-drop
   - Better visualization options
   - Improved mobile experience
   - Accessibility enhancements
