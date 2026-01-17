import { TenantEntity } from ".";

export interface ITicketResource extends TenantEntity {
  assignment_id?: string;
  ticket_id: string;
  assigned_to: string;
  additional_user_id?: string;
  role?: string;
  assigned_at?: Date;
}