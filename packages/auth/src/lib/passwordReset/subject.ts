import type { IUser } from '@alga-psa/types';
import type { ResetUserType, ResolvedResetSubject } from './types';

export function toResolvedSubject(user: IUser, userType: ResetUserType): ResolvedResetSubject {
  return {
    subject: {
      tenant: user.tenant,
      user_id: user.user_id,
      email: user.email.trim().toLowerCase(),
      user_type: userType,
    },
    user,
  };
}
