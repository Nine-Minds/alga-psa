/**
 * User-type vocabulary and predicates.
 *
 * `users.user_type` holds one of three values:
 *  - 'internal': a licensed MSP staff member (counts as a seat, can hold human work)
 *  - 'client':   a client-portal user
 *  - 'service':  a non-interactive identity (never has a UI/mobile session or a password)
 *
 * In Community Edition nothing produces 'service' and the CE schema rejects it; these are
 * names only. Every code path that branches on the user type must use these predicates
 * rather than `!== 'client'` / `=== 'internal'`, so a non-interactive type is always
 * handled explicitly instead of falling into "not client, so internal".
 */

/** Every value `users.user_type` may hold. */
export const USER_TYPES = ['internal', 'client', 'service'] as const;
export type UserType = (typeof USER_TYPES)[number];

/** User types that can hold a UI or mobile session. Allow-list for every login path. */
export const INTERACTIVE_USER_TYPES = ['internal', 'client'] as const;
export type InteractiveUserType = (typeof INTERACTIVE_USER_TYPES)[number];

/** User types that can call the MSP side (MSP roles, MSP data scope): internal | service. */
export const MSP_PRINCIPAL_USER_TYPES = ['internal', 'service'] as const;
export type MspPrincipalUserType = (typeof MSP_PRINCIPAL_USER_TYPES)[number];

type MaybeUserType = string | null | undefined;

/** True only for a client-portal user. */
export function isClientUserType(userType: MaybeUserType): userType is 'client' {
  return userType === 'client';
}

/** True for internal | service: the MSP side of the product. */
export function isMspPrincipalUserType(userType: MaybeUserType): userType is MspPrincipalUserType {
  return userType === 'internal' || userType === 'service';
}

/** True for internal | client: the types that can hold a UI/mobile session. */
export function isInteractiveUserType(userType: MaybeUserType): userType is InteractiveUserType {
  return userType === 'internal' || userType === 'client';
}

/** True only for 'internal': the type that counts as a seat and can hold human work. */
export function isLicensedUserType(userType: MaybeUserType): userType is 'internal' {
  return userType === 'internal';
}
