import type { IUserWithRoles } from '@alga-psa/types';

export type ClientSafeCurrentUser = Omit<IUserWithRoles, 'hashed_password' | 'password' | 'two_factor_secret'>;

export function projectCurrentUserForClient(user: IUserWithRoles): ClientSafeCurrentUser {
  const { hashed_password: _hashedPassword, password: _password, two_factor_secret: _twoFactorSecret, ...safeUser } = user;
  return safeUser;
}
