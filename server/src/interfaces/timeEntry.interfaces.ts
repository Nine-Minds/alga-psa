import { IUser } from './auth.interfaces';
import { WorkItemType, IWorkItem } from './workItem.interfaces';
import { TenantEntity } from '.';
import { DateValue, ISO8601String } from '@alga-psa/types';

export type TimeSheetStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED';

export interface ITimePeriodSettings extends TenantEntity {
  time_period_settings_id: string;
  frequency: number;
  frequency_unit: 'day' | 'week' | 'month' | 'year';
  is_active: boolean;
  effective_from: ISO8601String;
  effective_to?: ISO8601String;
  created_at: ISO8601String;
  updated_at: ISO8601String;
  tenant: string;
  // Fields applicable based on frequency_unit
  // For 'month' and 'week':
  start_day?: number; // For 'week': 1-7 (Mon-Sun), for 'month': 1-31
  end_day?: number;
  // For 'year':
  start_month?: number; // 1-12
  start_day_of_month?: number; // 1-31
  end_month?: number; // 1-12
  end_day_of_month?: number; // 1-31
  // 'day' frequency does not need start_day and end_day
}

export interface ITimeEntry extends TenantEntity  {
  entry_id?: string | null;
  work_item_id: string;
  work_item_type: WorkItemType;
  start_time: ISO8601String;
  end_time: ISO8601String;
  /**
   * Calendar date the entry is attributed to (computed server-side from start_time in work_timezone).
   * Stored as YYYY-MM-DD.
   */
  work_date?: ISO8601String;
  /**
   * IANA timezone used to compute work_date (e.g. America/Los_Angeles).
   */
  work_timezone?: string;
  created_at: ISO8601String;
  updated_at: ISO8601String;
  billable_duration: number;
  notes: string;
  user_id: string;
  time_sheet_id?: string;
  approval_status: TimeSheetStatus;
  service_id?: string;
  tax_region?: string;
  contract_line_id?: string | null;
  tax_rate_id?: string | null; // ID of the applied tax rate
  tax_percentage?: number | null; // Percentage of the applied tax rate
}

export interface ITimeSheetComment extends TenantEntity  {
  comment_id: string;
  time_sheet_id: string;
  user_id: string;
  comment: string;
  created_at: ISO8601String;
  is_approver: boolean;
  user_name?: string; // We'll include this for display purposes
}

export interface ITimePeriod extends TenantEntity  {
  period_id: string;
  start_date: DateValue;
  end_date: DateValue;
}

export interface ITimePeriodWithStatus extends ITimePeriod {
  timeSheetStatus: TimeSheetStatus;
}

export interface ITimeEntryWithWorkItem extends ITimeEntry {
  workItem: IWorkItem;
}

export interface ITimeSheet extends TenantEntity  {
  id: string;
  period_id: string;
  user_id: string;
  approval_status: TimeSheetStatus;
  submitted_at?: ISO8601String;
  approved_at?: ISO8601String;
  approved_by?: string;
  time_period?: ITimePeriod;
}

export interface ITimeSheetApproval extends ITimeSheet {
  employee_name: string;
  employee_email: string;
  comments: ITimeSheetComment[];
}

export interface ITimeSheetWithUserInfo extends ITimeSheet {
  first_name: string;
  last_name: string;
}

export interface ITimeEntryWithWorkItemString extends Omit<ITimeEntryWithWorkItem, 'start_time' | 'end_time'> {
  start_time: string;
  end_time: string;
}

export interface ITimePeriodView extends Omit<ITimePeriod, 'start_date' | 'end_date'> {
  start_date: string;
  end_date: string;
  timeSheetId?: string; // Added to support time entry creation from intervals
}

export interface ITimePeriodWithStatusView extends Omit<ITimePeriodWithStatus, 'start_date' | 'end_date'> {
  start_date: string;
  end_date: string;
}

export interface ITimeSheetView extends Omit<ITimeSheet, 'time_period'> {
  time_period?: ITimePeriodView;
}

export interface ITimeSheetApprovalView extends Omit<ITimeSheetApproval, 'time_period'> {
  time_period?: ITimePeriodView;
}
