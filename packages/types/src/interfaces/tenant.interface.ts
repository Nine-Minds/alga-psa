import { TenantEntity } from ".";
import { TenantTier } from "../constants/tenantTiers";

export interface ITenant extends TenantEntity {
    client_name: string;
    phone_number?: string;
    email: string;
    payment_platform_id?: string;
    payment_method_id?: string;
    auth_service_id?: string;
    plan?: TenantTier;
    addons?: string[];
    created_at?: Date;
    updated_at?: Date;
}