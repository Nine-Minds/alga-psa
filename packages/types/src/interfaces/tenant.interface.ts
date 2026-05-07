import { TenantEntity } from ".";
import { ProductCode, TenantTier } from "../constants";

export interface ITenant extends TenantEntity {
    client_name: string;
    phone_number?: string;
    email: string;
    payment_platform_id?: string;
    payment_method_id?: string;
    auth_service_id?: string;
    plan?: TenantTier;
    product_code?: ProductCode;
    addons?: string[];
    created_at?: Date;
    updated_at?: Date;
}
