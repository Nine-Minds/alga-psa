import { TenantEntity } from ".";

export interface ITaskResource extends TenantEntity {
  assignment_id?: string;
  task_id: string;
  assigned_to: string | null;
  additional_user_id: string;
  role?: string | null;
  assigned_at?: Date;
}
