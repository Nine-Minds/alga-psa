import type { IUserWithRoles } from '../interfaces/user.interfaces';
import {
  USER_RESPONSE_FIELD_NAMES,
  sanitizeUserForResponse,
  type PublicUser,
  type PublicUserWithRoles,
} from './userResponse';

/** Authorization metadata is loaded with the user, but is not a public response field. */
export type AuthenticatedUser = PublicUser & Pick<IUserWithRoles, 'seat_reader'>;
export type AuthenticatedUserWithRoles = PublicUserWithRoles & Pick<IUserWithRoles, 'seat_reader'>;

export const AUTHENTICATED_USER_FIELD_NAMES = [...USER_RESPONSE_FIELD_NAMES, 'seat_reader'] as const;

/** Keep the database's staff/seat distinction without carrying credentials into request context. */
export function sanitizeAuthenticatedUser(user: IUserWithRoles): AuthenticatedUserWithRoles {
  const sanitized: AuthenticatedUserWithRoles = sanitizeUserForResponse(user);
  if ('seat_reader' in user) sanitized.seat_reader = user.seat_reader;
  return sanitized;
}
