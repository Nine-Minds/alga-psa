# Time Entry System Documentation 

---

## Table of Contents

1. [Overview](#overview)
2. [Time Entries](#time-entries)
   - [Data Structure](#time-entry-data-structure)
   - [Relationships](#time-entry-relationships)
3. [Time Periods](#time-periods)
   - [Time Period Settings](#time-period-settings)
     - [Purpose and Functionality](#purpose-and-functionality)
     - [Configuration Examples](#configuration-examples)
     - [Constraints and Validation](#constraints-and-validation)
   - [Generating Time Periods](#generating-time-periods)
   - [Time Sheets and Billing](#time-sheets-and-billing)
4. [Interval Tracking](#interval-tracking)
   - [Automatic Ticket Time Tracking](#automatic-ticket-time-tracking)
   - [Interval Management](#interval-management)
   - [Converting Intervals to Time Entries](#converting-intervals-to-time-entries)
   - [Integration Points](#integration-points)
5. [Approvals](#approvals)
   - [Time Sheets](#time-sheets)
   - [Approval Workflow](#approval-workflow)
   - [Approval Actions](#approval-actions)
6. [Components and Interfaces](#components-and-interfaces)
   - [Backend Actions](#backend-actions)
   - [Frontend Components](#frontend-components)
7. [Time Period Generation](#time-period-generation)
8. [Summary](#summary)


---

## Overview

The Time Entry system enables users to log work time, submit entries for approval, and manage time periods according to configurable settings. The system supports both manual time entry and automatic interval tracking for ticket work. Approvers can review submissions, request changes, or approve time sheets, facilitating accurate time tracking and billing after approvals.

---

## Time Entries

### Data Structure

A **Time Entry** represents a record of time spent by a user on a specific work item within a defined period.

**Primary Attributes:**

- `entry_id`: Unique identifier for the time entry.
- `work_item_id`: Associated work item's identifier.
- `work_item_type`: The type/category of the work item.
- `start_time` and `end_time`: Start and end timestamps of the work session.
- `billable_duration`: Calculated duration for billing.
- `notes`: User-provided additional information.
- `user_id`: Identifier of the user who made the entry.
- `time_sheet_id`: Associated time sheet's identifier.
- `approval_status`: Current status in the approval process.
- `service_id`, `tax_region`: Additional billing details if applicable.

**Interface Definition:**

```typescript
export interface ITimeEntry extends TenantEntity {
  entry_id?: string | null;
  work_item_id: string;
  work_item_type: WorkItemType;
  start_time: Date;
  end_time: Date;
  created_at: Date;
  updated_at: Date;
  billable_duration: number;
  notes: string;
  user_id: string;
  time_sheet_id?: string;
  approval_status: TimeSheetStatus;
  service_id?: string;
  tax_region?: string;
}
```

### Relationships

- **User Association**: Each time entry is linked to the user (`user_id`) who recorded it.
- **Work Item Association**: Time entries are connected to work items (`work_item_id`).
- **Time Sheet Association**: Entries are grouped into time sheets (`time_sheet_id`) for submission and approval.

---

## Time Periods

Time periods define the intervals (e.g., weekly, bi-weekly, custom ranges) for which users track and submit their time entries.

### Time Period Settings

#### Purpose and Functionality

**Time Period Settings** are configurations that determine how time periods are generated within the system. They define the start date and the pattern used to create time periods moving forward from that date.

**Key Purposes:**

- Automatically generate time periods based on specified rules.
- Allow for flexible and sophisticated time period configurations.
- Serve as templates or headers for time sheets where users enter time entries.
- Enable billing processes after time sheets are approved.

#### Configuration Examples

To create semi-monthly periods (from the 1st to the 15th and from the 16th to the end of the month), you can define two time period settings with `start_day` and `end_day`:

1. **First Semi-Monthly Period:**

   - `start_day`: 1
   - `end_day`: 15
   - `frequency_unit`: 'month'
   - Other fields as required.

2. **Second Semi-Monthly Period:**

   - `start_day`: 16
   - `end_day`: 0 // Use 0 or 31 to indicate the last day of the month
   - `frequency_unit`: 'month'
   - Other fields as required.

**Notes:**

- The `end_day` field specifies the day on which the period ends.
- If `end_day` is less than `start_day`, the period rolls over to the next month.
- Using `end_day` as 0 or 31 indicates the period ends on the last day of the month, accommodating months with different lengths.
- For **weekly** periods, the settings UI provides calendar-style dropdowns for selecting `start_day` and `end_day` (Monday through Sunday).

#### Constraints and Validation

- Overlapping **settings** are allowed if they result in non-overlapping **time periods**.
- The system validates that generated time periods do not overlap in dates.
- Ensure that the `start_day` and `end_day` values are valid and within the range of 1 to 31.
- **Active Settings:** Only settings marked as `is_active: true` are considered when generating time periods.

**Interface Definition:**

```typescript
export interface ITimePeriodSettings extends TenantEntity {
  time_period_settings_id: string;
  start_day: number;
  frequency: number;
  frequency_unit: 'day' | 'week' | 'month' | 'year';
  is_active: boolean;
  effective_from: Date;
  effective_to?: Date;
  created_at: Date;
  updated_at: Date;
  tenant_id: string;
}
```

### Generating Time Periods

Time periods are generated using the active `TimePeriodSettings`. The process involves:

1. **Retrieving Active Settings:** The system fetches all active time period settings ordered by the `effective_from` date.
2. **Applying Settings:** Each setting is applied starting from its `effective_from` date, creating time periods moving forward according to its `start_day`, `frequency`, and `frequency_unit`.
3. **Overlaying Settings:** If multiple settings are active, they are overlaid to produce the final set of time periods, provided they do not overlap.
4. **Creating Time Period Records:** The generated time periods are stored as `TimePeriod` records.

**Time Period Interface:**

```typescript
export interface ITimePeriod extends TenantEntity {
  period_id: string;
  start_date: Date;
  end_date: Date;
}
```

**Example Scenario:**

Suppose we have:

- **Setting A**: Effective from January 1, for a weekly period starting on Monday.
- **Setting B**: Effective from February 1, for a monthly period starting on the 15th.

From January 1 to January 31, only Setting A is active, so time periods are generated weekly starting every Monday. From February 1 onward, both settings are active, and the system generates both weekly and monthly periods, as long as they do not overlap. However, if overlapping occurs, the system must flag a conflict and prevent it.

### Time Sheets and Billing

The generated time periods serve as templates or headers for **Time Sheets**. Users enter their time entries within these periods. Once time sheets are approved, the recorded time may be billed accordingly.

---

## Interval Tracking

The system includes a lightweight ticket time-tracking feature that automatically captures when users view tickets, providing a foundation for accurate time entries with minimal manual effort.

### Automatic Ticket Time Tracking

When users interact with tickets in the system, their viewing sessions are automatically tracked:

- **Start Time**: Recorded when a user opens a ticket
- **End Time**: Captured when the user navigates away from the ticket
- **Storage**: Intervals are stored locally in the browser's IndexedDB
- **Privacy**: Intervals remain local until explicitly converted to time entries

**Interval Data Structure:**

```typescript
interface TicketInterval {
  id: string;                 // Unique identifier for the interval
  ticketId: string;           // ID of the ticket being viewed
  ticketNumber: string;       // Ticket number for display purposes
  ticketTitle: string;        // Title of the ticket for display
  startTime: string;          // ISO timestamp when viewing started
  endTime: string | null;     // ISO timestamp when viewing ended (null if still open)
  duration: number | null;    // Duration in seconds (null if still open)
  autoClosed: boolean;        // Flag indicating if interval was auto-closed
  userId: string;             // User who viewed the ticket
  selected: boolean;          // UI state for selection in the intervals list
}
```

**Auto-Close Mechanism:**

The system includes an intelligent auto-close feature for abandoned intervals:
- Intervals from previous days with no end time are automatically closed at 5:00 PM of their start date
- If the start time was after 5:00 PM, the interval is closed at the start time
- Auto-closed intervals are clearly marked for user review

### Interval Management

Users can review and manage their tracked intervals through dedicated interfaces:

**Key Management Features:**
- **View Intervals**: Chronological list of intervals per ticket
- **Select Intervals**: Choose one or more intervals for actions
- **Merge Intervals**: Combine multiple intervals into a single span
- **Adjust Timestamps**: Manually modify start and end times
- **Delete Intervals**: Remove unwanted or incorrect intervals

**Filtering and Organization:**
- Group intervals by ticket
- Filter by date range
- Sort by duration or timestamp
- Identify auto-closed intervals with visual indicators

### Converting Intervals to Time Entries

The primary purpose of interval tracking is to facilitate accurate time entry creation:

**Conversion Process:**
1. User selects one or more intervals
2. System calculates the total duration and date range
3. User can review and adjust details before creating the time entry
4. Upon confirmation, a time entry is created and the intervals are removed

**Conversion Rules:**
- When converting multiple intervals, the earliest start time and latest end time are used
- If any selected interval is still open (no end time), the current time is used as the end
- Intervals must belong to the same ticket when creating a time entry
- The system validates that the resulting time entry falls within a valid time period

### Integration Points

Interval tracking is integrated throughout the system:

**Ticket Details View:**
- Automatic tracking begins when viewing ticket details
- Intervals for the current ticket can be viewed and managed

**Time Sheet Interface:**
- Toggle to show/hide intervals within the time sheet view
- Filter intervals by time period
- Create time entries directly from intervals

**Ticketing Dashboard:**
- Access all intervals through a dedicated drawer
- View counts of tracked intervals
- Manage intervals across multiple tickets

**Continuous Tracking:**
- When reopening a ticket with an existing open interval, the system uses that interval
- When creating a new interval for a ticket viewed earlier in the day, the system uses the end time of the previous interval as the start time
- If no previous interval exists for the day, 8:00 AM is used as the default start time

---

## Approvals

### Time Sheets

A **Time Sheet** aggregates a user's time entries within a specific time period and is used in the approval process.

**Attributes:**

- `id`: Unique identifier for the time sheet.
- `period_id`: The associated time period's identifier.
- `user_id`: The user who submitted the time sheet.
- `approval_status`: Current status in the approval process.
- `submitted_at`, `approved_at`: Timestamps for submission and approval.
- `approved_by`: Identifier of the approver.
- `time_period`: The associated `TimePeriod` object.

**Interface Definition:**

```typescript
export interface ITimeSheet extends TenantEntity {
  id: string;
  period_id: string;
  user_id: string;
  approval_status: TimeSheetStatus;
  submitted_at?: Date;
  approved_at?: Date;
  approved_by?: string;
  time_period?: ITimePeriod;
}
```

### Approval Workflow

The approval process involves the following stages:

- `DRAFT`: The time sheet is being prepared by the user and not yet submitted.
- `SUBMITTED`: The time sheet has been submitted and awaits approval.
- `APPROVED`: The time sheet has been approved; time entries can proceed to billing.
- `CHANGES_REQUESTED`: The approver has requested modifications.

**Workflow Steps:**

1. **User Submits Time Sheet:** Upon completion of a time period, the user submits their time sheet for approval.
2. **Approver Reviews Time Sheet:** An authorized approver reviews the submitted entries.
3. **Approver Actions:** The approver can:
   - **Approve:** Confirm the entries are accurate.
   - **Request Changes:** Specify changes needed in certain entries.
   - **Reject:** Reject the time sheet entirely, often providing reasons.
4. **User Responds to Requests:** If changes are requested, the user modifies the entries and resubmits.
5. **Final Approval:** Once approved, time entries proceed to billing if applicable.

### Approval Actions

**Frontend Component:** `ApprovalActions.tsx`

This component provides the interface for approvers to perform actions on time sheets.

**Key Features:**

- **Approve Button:** Approves the time sheet.
- **Reject Button:** Opens a dialog to enter a rejection reason before rejecting.
- **Request Changes Button:** Opens a dialog to specify requested changes to entries.

**Code Snippet:**

```tsx
export function ApprovalActions({ timeSheet, onApprove, onReject, onRequestChanges }: ApprovalActionsProps) {
  // State management and handlers...

  return (
    <div className="mb-4 flex space-x-2">
      <Button onClick={handleApprove}>Approve</Button>
      <Button onClick={() => setIsRejectDialogOpen(true)}>Reject</Button>
      <Button onClick={() => setIsChangesDialogOpen(true)}>Request Changes</Button>

      {/* Dialogs for Reject and Request Changes */}
    </div>
  );
}
```

**Dialogs:**

- **Reject Dialog:** Captures the reason for rejection.
- **Request Changes Dialog:** Intended to specify which entries need changes and why.

---

## Components and Interfaces

### Backend Actions

**File:** `timePeriodSettingsActions.ts`

This file contains server-side actions related to managing time period settings.

**Functions:**

- `getActiveTimePeriodSettings()`: Retrieves all active time period settings.
- `updateTimePeriodSettings(settings)`: Updates existing time period settings, ensuring no overlaps.
- `createTimePeriodSettings(settings)`: Creates new time period settings, with validation to prevent conflicts.
- `deleteTimePeriodSettings(settingId)`: Deletes specified time period settings.

**Example Function:**

```typescript
export async function createTimePeriodSettings(settings: Partial<ITimePeriodSettings>): Promise<ITimePeriodSettings> {
  const { knex: db, tenant } = await createTenantKnex();

  // Validation to prevent overlaps should be added here

  const [newSetting] = await db('time_period_settings')
    .insert({
      ...settings,
      is_active: true,
      effective_from: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
      tenant_id: tenant,
    })
    .returning('*');

  return newSetting;
}
```

**Interval Tracking Service:**

The `IntervalTrackingService` class manages the storage and retrieval of ticket viewing intervals:

```typescript
// Key methods in IntervalTrackingService
class IntervalTrackingService {
  // Initialize IndexedDB
  async initDatabase(): Promise<IDBDatabase>;
  
  // Start tracking when a ticket is opened
  async startInterval(ticketId: string, ticketNumber: string, ticketTitle: string): Promise<string>;
  
  // End tracking when a ticket is closed
  async endInterval(intervalId: string): Promise<void>;
  
  // Get intervals for a specific ticket
  async getIntervalsByTicket(ticketId: string): Promise<TicketInterval[]>;
  
  // Get all intervals for the current user
  async getUserIntervals(): Promise<TicketInterval[]>;
  
  // Merge multiple intervals into one
  async mergeIntervals(intervalIds: string[]): Promise<TicketInterval>;
  
  // Delete intervals
  async deleteIntervals(intervalIds: string[]): Promise<void>;
}
```

### Frontend Components

**ApprovalActions.tsx**

Handles the user interface for approvers to interact with time sheets.

- **Uses:** `useState` hook for managing dialog states and input values.
- **Displays:** Buttons for approve, reject, and request changes.
- **Contains:** Dialog components for additional input when rejecting or requesting changes.

**IntervalManagement.tsx**

Provides an interface for managing ticket viewing intervals:

- **Displays:** List of intervals with start/end times and durations
- **Actions:** Select, merge, delete intervals and create time entries
- **Filtering:** Group by ticket, filter by date range
- **Integration:** Used in both ticket details and time sheet views

**IntervalItem.tsx**

Renders an individual interval with selection capability:

- **Shows:** Start time, end time, duration, and auto-close status
- **Interaction:** Selection checkbox for batch operations
- **Styling:** Visual indicators for different interval states

**TimeSheetHeader.tsx**

Enhanced to include interval toggle functionality:

- **Toggle:** Button to show/hide intervals in the time sheet view
- **Indicator:** Shows count of available intervals

---

## Time Period Generation

The Time Entry system includes functionality to automatically generate time periods based on configurable settings. This feature streamlines the process of creating time periods for time tracking and billing purposes.

### Key Components

1. **generateTimePeriods Function**
   - Located in: `server/src/lib/actions/timePeriodsActions.ts`
   - Purpose: Generates time periods based on provided settings and date range
   - Parameters:
     - `settings`: Array of `ITimePeriodSettings`
     - `startDate`: Start date for period generation
     - `endDate`: End date for period generation
   - Returns: Array of `ITimePeriod` objects

2. **generateAndSaveTimePeriods Function**
   - Located in: `server/src/lib/actions/timePeriodsActions.ts`
   - Purpose: Generates time periods and saves them to the database
   - Parameters:
     - `startDate`: Start date for period generation
     - `endDate`: End date for period generation
   - Returns: Promise resolving to an array of saved `ITimePeriod` objects

### Functionality

- The system retrieves active time period settings from the database.
- It generates time periods based on these settings for the specified date range.
- Each generated time period is saved to the database.
- The function handles various frequency units (day, week, month, year) and respects the `start_day` setting.
- It also manages settings with different effective dates and expiration dates.

### Usage

To generate and save time periods:

```typescript
import { generateAndSaveTimePeriods } from 'server/src/lib/actions/timePeriodsActions';

const startDate = new Date('2023-01-01');
const endDate = new Date('2023-12-31');

try {
  const generatedPeriods = await generateAndSaveTimePeriods(startDate, endDate);
  console.log(`Generated and saved ${generatedPeriods.length} time periods`);
} catch (error) {
  console.error('Failed to generate and save time periods:', error);
}
```

### Considerations

- Ensure that time period settings do not overlap to avoid conflicts in period generation.
- The system automatically adjusts for leap years when generating monthly or yearly periods.
- After generating new time periods, the '/msp/time-entry' path is revalidated to ensure the UI reflects the latest data.

### Testing

Comprehensive tests for the time period generation functionality are located in:
- `server/src/test/infrastructure/timePeriods.test.ts`
- `server/src/test/infrastructure/timePeriodsActions.test.ts`

These tests cover various scenarios including:
- Generation with single and multiple settings
- Handling of different frequency units
- Management of leap years
- Proper alignment with specified start days
- Error handling for overlapping settings

---

## Summary

The Time Entry system provides a robust solution for tracking work hours, managing approvals, and generating time periods. Key features include:

- Flexible time entry recording with both manual and automatic options
- Automatic interval tracking for ticket-based work
- Intelligent interval management with merging and adjustment capabilities
- Configurable time period settings
- Automatic time period generation
- Approval workflows for time sheets
- Integration with billing processes

The combination of automatic interval tracking and configurable time periods creates a comprehensive system that balances accuracy with ease of use. Users benefit from automatic tracking that captures their actual work patterns, while still maintaining control over how that time is ultimately recorded and billed. This approach ensures both efficiency in time tracking and accuracy in billing, while providing the necessary oversight through the approval process.
