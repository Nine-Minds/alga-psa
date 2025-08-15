import { TenantEntity } from '@/interfaces';

export interface IChat extends TenantEntity {
  id?: string;
  user_id: string;
  title_text: string | null;
  title_is_locked: boolean | null;
}
