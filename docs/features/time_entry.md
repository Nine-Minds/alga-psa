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
4. [Stopwatch and Suggested Entries](#stopwatch-and-suggested-entries)
   - [Stopwatch](#stopwatch)
   - [Suggested Entries](#suggested-entries)
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

The Time Entry system enables users to log work time, submit entries for approval, and manage time periods according to configurable settings. The system supports both manual time entry, a server-side stopwatch and activity-based suggestions for ticket work. Approvers can review submissions, request changes, or approve time sheets, facilitating accurate time tracking and billing after approvals.

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

## Stopwatch and Suggested Entries

Time can be captured with a **server-side stopwatch** (web and mobile) and, for time that was not tracked live, **suggested entries** derived from ticket activity. Opening a ticket never starts a timer or records anything.

### Stopwatch

- A stopwatch session belongs to one user and one work item (a ticket or project task). A user can have one open (running or paused) session at a time; starting another asks whether to switch.
- Sessions and their running/paused segments are stored on the server (`time_tracking_sessions`, `time_tracking_session_segments`), so a session survives page reloads, app kills and device switches. The displayed time is always derived from segment timestamps, never from a local tick.
- API: `/api/v1/stopwatch` (start, active, pause, resume, log, discard). The older `/api/v1/time-tracking/start-tracking`, `active-session` and `stop-tracking` endpoints remain as adapters over sessions for installed mobile builds.
- Web: the ticket stopwatch tile and a header indicator offer Start, Pause, Resume, Stop and Discard. Stop opens the time entry drawer pre-filled from the session; saving logs the session. The board setting `enable_live_ticket_timer` means "show the stopwatch on tickets in this board".
- Time entries always have an `end_time`; there are no open time entry rows.

### Suggested Entries

The time sheet shows a Suggestions section built on read from the ticket audit log (comments, status changes and so on the user performed), grouped by ticket and local work date. A suggestion is hidden once the user has an entry for that ticket and date, while a stopwatch is running on the ticket, or after it is dismissed. Log time opens the time entry dialog with times estimated from the first and last activity.

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

### Frontend Components

**ApprovalActions.tsx**

Handles the user interface for approvers to interact with time sheets.

- **Uses:** `useState` hook for managing dialog states and input values.
- **Displays:** Buttons for approve, reject, and request changes.
- **Contains:** Dialog components for additional input when rejecting or requesting changes.

**SuggestedEntriesSection.tsx**

Lists activity-based suggestions on the time sheet:

- **Displays:** Ticket, client, work date, first/last activity and the kinds of action
- **Actions:** Log time (opens the time entry dialog with estimated times) and Dismiss
- **Visibility:** Only for the sheet owner or an allowed delegate

**TimeSheetHeader.tsx**

Enhanced to include suggestions toggle functionality:

- **Toggle:** Button to show/hide suggestions in the time sheet view
- **Indicator:** Shows count of available suggestions

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
- Automatic interval tracking for ticket-based work — browser-based (IndexedDB) in the web app and server-backed (REST API sessions) in the mobile app
- Intelligent interval management with merging and adjustment capabilities
- Configurable time period settings
- Automatic time period generation
- Approval workflows for time sheets
- Integration with billing processes

The combination of automatic interval tracking and configurable time periods creates a comprehensive system that balances accuracy with ease of use. Users benefit from automatic tracking that captures their actual work patterns, while still maintaining control over how that time is ultimately recorded and billed. This approach ensures both efficiency in time tracking and accuracy in billing, while providing the necessary oversight through the approval process.
