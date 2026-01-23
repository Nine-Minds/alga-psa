import { TenantEntity } from './index';

export interface IPermission extends TenantEntity {
    permission_id: string;
    resource_type: string;
    action: string;
}

export interface IPolicy extends TenantEntity {
    policy_id: string;
    policy_name: string;
    resource: string;
    action: string;
    conditions: ICondition[];
}

export interface IUser extends TenantEntity {
    user_id: string;
    username: string;
    roles: Set<string>;
}

export interface IRole extends TenantEntity {
    role_id: string;
    role_name: string;
    permissions: Set<IPermission>;
}

export interface ICondition extends TenantEntity {
    userAttribute: string;
    operator: string;
    resourceAttribute: string;
}

export interface IUserRole extends TenantEntity {
    user_id: string;
    role_id: string;
}
