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
}

export interface IResource extends TenantEntity {
  resource_id: string;
  user_id: string;
  user?: IUser;
  availability: any;
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

export enum Views {
  MONTH = 'month',
  WEEK = 'week',
  WORK_WEEK = 'work_week',
  DAY = 'day',
  AGENDA = 'agenda',
}
