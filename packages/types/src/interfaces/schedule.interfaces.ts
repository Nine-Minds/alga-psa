import { TenantEntity } from ".";
import { IUser } from './auth.interfaces';
import { WorkItemType } from './workItem.interfaces';

export interface IRecurrencePattern {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  daysOfWeek?: number[];
  dayOfMonth?: number;
  monthOfYear?: number;
  startDate: Date;
  endDate?: Date;
  exceptions?: Date[];
  count?: number;
  workdaysOnly?: boolean;
}

export interface HighlightedSlot {
  techId: string;
  timeSlot: string;
}

export interface IScheduleEntry extends TenantEntity {
  entry_id: string;
  work_item_id: string | null;
  /** Array of user IDs assigned to this schedule entry. Populated from schedule_entry_assignees table. */
  assigned_user_ids: string[];  // Required since it's the only way to track assignments
  scheduled_start: Date;
  scheduled_end: Date;
  status: string;
  notes?: string;
  title: string;
  recurrence_pattern?: IRecurrencePattern | null;
  work_item_type: WorkItemType;
  created_at: Date;
  updated_at: Date;
  is_recurring?: boolean;
  original_entry_id?: string;
  updateType?: IEditScope;
  is_private?: boolean;
  /** Explicit date-only semantics; absent values are timed, never inferred. */
  is_all_day?: boolean;
  /** Group calendar this entry is placed on; null/absent for personal entries. */
  calendar_id?: string | null;
  /**
   * Server-computed visibility for the requesting viewer. `busy` entries are
   * masked (no title, notes, work item or assignees beyond the calendar owner).
   */
  access?: 'full' | 'busy';
  /** Server-computed: whether the requesting viewer may move/edit/delete this entry. */
  can_edit?: boolean;
}

export type CalendarType = 'personal' | 'group';

/** Ordered lowest → highest. `manage` is valid on group calendars only. */
export type CalendarAccessLevel = 'free_busy' | 'read' | 'edit' | 'manage';

export type CalendarGranteeType = 'user' | 'team';

export interface ICalendar extends TenantEntity {
  calendar_id: string;
  calendar_type: CalendarType;
  owner_user_id: string | null;
  name: string | null;
  description: string | null;
  color: string | null;
  is_archived: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ICalendarShare extends TenantEntity {
  share_id: string;
  calendar_id: string;
  grantee_type: CalendarGranteeType;
  grantee_id: string;
  access_level: CalendarAccessLevel;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

/** A share as edited in the UI (no ids/timestamps). */
export interface ICalendarShareInput {
  grantee_type: CalendarGranteeType;
  grantee_id: string;
  access_level: CalendarAccessLevel;
}

/** A share enriched with the grantee's display name for listing. */
export interface ICalendarShareView extends ICalendarShareInput {
  grantee_name: string;
}

/** A calendar the viewer can see, as listed in the schedule sidebar. */
export interface IVisibleCalendar {
  /** For personal calendars this is the owner's user id; for group calendars the calendar_id. */
  key: string;
  calendar_type: CalendarType;
  calendar_id: string | null;
  owner_user_id: string | null;
  name: string;
  description?: string | null;
  color: string;
  access_level: CalendarAccessLevel;
  is_archived?: boolean;
}

/** What the requesting viewer may see and do on the schedule, computed server-side. */
export interface IScheduleViewerCapabilities {
  viewerUserId: string;
  /** True for `user_schedule:update` holders: every internal user's calendar is visible and editable. */
  canViewAll: boolean;
  me: IVisibleCalendar;
  people: IVisibleCalendar[];
  groups: IVisibleCalendar[];
}

export interface IResource extends TenantEntity {
  resource_id: string;
  user_id: string;
  user?: IUser;
  skills: string[];
  max_daily_capacity: number;
  max_weekly_capacity: number;
  created_at: Date;
  updated_at: Date;
}

export interface IScheduleConflict extends TenantEntity {
  conflict_id: string;
  entry_id_1: string;
  entry_id_2: string;
  conflict_type: string;
  resolved: boolean;
  resolution_notes?: string;
  created_at: Date;
  updated_at: Date;
}

export enum IEditScope {
  SINGLE = 'single',
  FUTURE = 'future',
  ALL = 'all'
}

export interface CreateScheduleEntryOptions {
  assignedUserIds: string[];
  assignedByUserId?: string;
}

export enum Views {
  MONTH = 'month',
  WEEK = 'week',
  WORK_WEEK = 'work_week',
  DAY = 'day',
  AGENDA = 'agenda',
}
