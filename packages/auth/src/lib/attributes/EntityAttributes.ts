import { DBFieldAttribute, ComputedAttribute } from './AttributeSystem';
import type { IUser, IRole, IUserWithRoles, ITicket } from '@alga-psa/types';

export const USER_ATTRIBUTES = {
  user_id: new DBFieldAttribute<string, IUser>('user_id', 'user_id'),
  username: new DBFieldAttribute<string, IUser>('username', 'username'),
  email: new DBFieldAttribute<string, IUser>('email', 'email'),
  tenant: new DBFieldAttribute<string, IUser>('tenant', 'tenant'),
  user_type: new DBFieldAttribute<string, IUser>('user_type', 'user_type'),
  team_id: new DBFieldAttribute<string, IUser>('team_id', 'team_id' as keyof IUser),
  role_id: new ComputedAttribute<string, IUserWithRoles>('role_id', (u) => u.roles[0]?.role_id),
  roles: new DBFieldAttribute<IRole[], IUserWithRoles>('roles', 'roles'),
  isAdmin: new ComputedAttribute<boolean, IUserWithRoles>('isAdmin', (u) => u.roles.some(role => role.role_name === 'admin')),
};

export const TICKET_ATTRIBUTES = {
  ticket_id: new DBFieldAttribute<string, ITicket>('ticket_id', 'ticket_id' as keyof ITicket),
  creator_id: new DBFieldAttribute<string, ITicket>('creator_id', 'creator_id' as keyof ITicket),
  assignee_id: new DBFieldAttribute<string, ITicket>('assignee_id', 'assignee_id' as keyof ITicket),
  team_id: new DBFieldAttribute<string, ITicket>('team_id', 'team_id' as keyof ITicket),
  status: new DBFieldAttribute<string, ITicket>('status', 'status' as keyof ITicket),
  priority: new DBFieldAttribute<string, ITicket>('priority', 'priority_id'),
  tenant: new DBFieldAttribute<string, ITicket>('tenant', 'tenant' as keyof ITicket),
  isOverdue: new ComputedAttribute<boolean, ITicket>('isOverdue', (t) => {
    const dueDate = t.attributes?.due_date ? new Date(t.attributes.due_date as string) : null;
    return dueDate ? dueDate < new Date() : false;
  }),
};

export type UserAttributeKey = keyof typeof USER_ATTRIBUTES;
export type TicketAttributeKey = keyof typeof TICKET_ATTRIBUTES;
