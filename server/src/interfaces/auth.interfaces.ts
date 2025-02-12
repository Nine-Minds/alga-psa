import { UserAttributeKey, TicketAttributeKey } from '@shared/types/attributes';
import { TenantEntity } from './index';

export interface IUser {
    user_id: string;
    username: string;
    first_name?: string;
    last_name?: string;
    email: string;
    hashed_password: string;
    image?: string;
    created_at?: Date;
    two_factor_enabled?: boolean;
    two_factor_secret?: string;
    is_google_user?: boolean;
    is_inactive: boolean;
    tenant: string;
    user_type: string;
    contact_id?: string;
    phone?: string;
    timezone?: string;
}

export interface IUserWithRoles extends IUser {
    roles: IRole[];
}

export interface ITeam extends TenantEntity {
    team_id: string;
    team_name: string;
    manager_id: string | null;
    created_at?: Date;
    updated_at?: Date;
    members: IUserWithRoles[];
}

export interface IRole extends TenantEntity {
    role_id: string;
    role_name: string;
    description: string;
}

export interface IRoleWithPermissions extends IRole {
    permissions: IPermission[];
}

export interface IPermission extends TenantEntity {
    permission_id: string;
    resource: string;
    action: string;
}

export interface IResource extends TenantEntity {
    type: string;
    id: string;
    attributes: Map<string, any>;
}

export interface IPolicy extends TenantEntity {
    policy_id: string;
    policy_name: string;
    resource: string;
    action: string;
    conditions: ICondition[];
}

export interface ICondition extends TenantEntity {
    userAttribute: UserAttributeKey;
    operator: string;
    resourceAttribute: TicketAttributeKey;
}

export interface IUserRole extends TenantEntity {
    user_id: string;
    role_id: string;
}

export interface IUserRegister {
    username: string;
    email: string;
    password: string;
    companyName: string;
    user_type: string;
}

export interface IUserAuthenticated {
    isValid: boolean;
    user: IUser | null;
}

export interface TPasswordCriteria {
    minLength: boolean;
    hasUppercase: boolean;
    hasLowercase: boolean;
    hasNumber: boolean;
    hasSpecial: boolean;
}
