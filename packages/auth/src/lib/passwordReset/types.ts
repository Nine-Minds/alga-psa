import type { IUser } from '@alga-psa/types';

export type ResetUserType = 'internal' | 'client';

/**
 * The one user in one tenant that a password reset acts on. Every stage of a
 * reset (request, email, token, redemption, password write) speaks in subjects.
 */
export interface ResetSubject {
  tenant: string;
  user_id: string;
  email: string;
  user_type: ResetUserType;
}

/** A subject with the user row it was resolved from. */
export interface ResolvedResetSubject {
  subject: ResetSubject;
  user: IUser;
}

/** Where the request came from. Only ever narrows resolution to one tenant. */
export interface ResetHint {
  portalDomain?: string;
  tenantSlug?: string;
}
