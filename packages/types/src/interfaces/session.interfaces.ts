import { TenantEntity } from ".";

export interface ISession extends TenantEntity {
    session_id?: string;
    user_id?: string;
    username?: string;
    token?: string;
    created_at?: Date;
    updated_at?: Date | null;
}