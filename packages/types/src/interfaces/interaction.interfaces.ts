import { TenantEntity } from ".";
import { IOnlineMeeting } from './online-meeting.interfaces';

export interface IInteraction extends TenantEntity {
  interaction_id: string;
  type_id: string;
  type_name: string;
  icon?: string;
  contact_name_id: string | null;
  contact_name: string | null;
  client_id: string | null;
  client_name: string | null;
  user_id: string;
  user_name: string;
  ticket_id: string | null;
  opportunity_id?: string | null;
  title: string;
  notes?: string;
  interaction_date: Date;
  start_time?: Date;
  end_time?: Date;
  duration: number | null;
  status_id?: string;
  status_name?: string;
  is_status_closed?: boolean;
  online_meeting?: IOnlineMeeting | null;
}

export interface ISystemInteractionType {
  type_id: string;
  type_name: string;
  icon?: string;
  display_order?: number;
  created_at: Date;
  updated_at: Date;
}

export interface IInteractionType extends TenantEntity {
  type_id: string;
  type_name: string;
  icon?: string;
  display_order?: number;
}
