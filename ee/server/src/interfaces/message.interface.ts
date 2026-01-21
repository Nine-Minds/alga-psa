import { TenantEntity } from '@/interfaces/index';

export interface IMessage extends TenantEntity {
  id?: string;
  chat_id: string | null;
  chat_role: string;
  content: string;
  thumb: string | null;
  feedback: string | null;
  message_order?: number;
}
